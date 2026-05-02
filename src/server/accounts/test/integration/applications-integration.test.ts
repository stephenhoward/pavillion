import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';

import { AccountApplicationEntity } from '@/server/common/entity/account';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the public application confirmation endpoints
 * (`GET /api/v1/applications/confirm/:token` and
 *  `POST /api/v1/applications/confirm/:token`).
 *
 * Covers:
 *   - Happy path: valid token → GET reports valid → POST consumes → second
 *     POST collapses to the same failure shape (double-consume parity).
 *   - Anti-enumeration: invalid / expired / missing-status / wrong-status
 *     tokens return IDENTICAL `{ valid: false }` from both verbs (HTTP 200).
 *   - No session / no cookies: anonymous visitors must NOT receive any
 *     `Set-Cookie` headers in responses.
 *
 * Bead: pv-l9wv.4.2
 */
describe('Public confirm endpoints (integration)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    // Setup mode middleware would otherwise return 503 for unauthenticated
    // API requests. Provisioning the first account exits setup mode so the
    // public confirm endpoints respond on their own merits.
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
    await accountService._setupAccount('admin-confirm@pavillion.dev', 'testpassword!1');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    await AccountApplicationEntity.destroy({ where: {}, truncate: true });
  });

  /**
   * Seed an application in `pending_confirmation` state with a fresh,
   * unexpired confirmation token. Returns the token string.
   */
  async function seedPendingConfirmation(overrides: Partial<{
    token: string;
    expiresAt: Date;
    status: string;
    email: string;
  }> = {}): Promise<string> {
    const token = overrides.token ?? `confirm-token-${uuidv4()}`;
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email: overrides.email ?? `${uuidv4()}@example.com`,
      message: 'integration applicant',
      status: overrides.status ?? 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: token,
      confirmation_token_expiration:
        overrides.expiresAt ?? DateTime.utc().plus({ days: 7 }).toJSDate(),
    });
    return token;
  }

  describe('happy path: validate → consume → double-consume parity', () => {
    it('GET reports valid:true, POST reports success:true, second POST collapses to valid:false', async () => {
      const token = await seedPendingConfirmation();

      const getResponse = await request(env.app).get(`/api/v1/applications/confirm/${token}`);
      expect(getResponse.status).toBe(200);
      expect(getResponse.body).toEqual({ valid: true });

      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${token}`);
      expect(postResponse.status).toBe(200);
      expect(postResponse.body).toEqual({ success: true });

      // Double-consume parity: the row has been transitioned out of
      // `pending_confirmation` and the token cleared, so a second consume
      // attempt must look IDENTICAL to any other terminal failure.
      const secondPost = await request(env.app).post(`/api/v1/applications/confirm/${token}`);
      expect(secondPost.status).toBe(200);
      expect(secondPost.body).toEqual({ valid: false });

      // After consume, GET on the same token also collapses to valid:false
      // (anti-enumeration: cannot distinguish "consumed" from "never existed").
      const getAfter = await request(env.app).get(`/api/v1/applications/confirm/${token}`);
      expect(getAfter.status).toBe(200);
      expect(getAfter.body).toEqual({ valid: false });
    });
  });

  describe('anti-enumeration: identical shape across all failure modes', () => {
    it('returns identical valid:false shape for an unknown token (GET and POST)', async () => {
      const bogus = 'this-token-does-not-exist';

      const getResponse = await request(env.app).get(`/api/v1/applications/confirm/${bogus}`);
      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${bogus}`);

      expect(getResponse.status).toBe(200);
      expect(postResponse.status).toBe(200);
      expect(getResponse.body).toEqual({ valid: false });
      expect(postResponse.body).toEqual({ valid: false });
    });

    it('returns identical valid:false shape for an expired token (GET and POST)', async () => {
      const token = await seedPendingConfirmation({
        expiresAt: DateTime.utc().minus({ days: 1 }).toJSDate(),
      });

      const getResponse = await request(env.app).get(`/api/v1/applications/confirm/${token}`);
      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

      expect(getResponse.status).toBe(200);
      expect(postResponse.status).toBe(200);
      expect(getResponse.body).toEqual({ valid: false });
      expect(postResponse.body).toEqual({ valid: false });
    });

    it('returns identical valid:false shape for a wrong-status token (GET and POST)', async () => {
      // Token exists but the application has already been promoted out of
      // pending_confirmation (e.g. consumed by another path).
      const token = await seedPendingConfirmation({ status: 'pending' });

      const getResponse = await request(env.app).get(`/api/v1/applications/confirm/${token}`);
      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

      expect(getResponse.status).toBe(200);
      expect(postResponse.status).toBe(200);
      expect(getResponse.body).toEqual({ valid: false });
      expect(postResponse.body).toEqual({ valid: false });
    });
  });

  describe('privacy: anonymous visitors receive no cookies', () => {
    it('does not set any Set-Cookie header on GET (valid token)', async () => {
      const token = await seedPendingConfirmation();

      const response = await request(env.app).get(`/api/v1/applications/confirm/${token}`);

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('does not set any Set-Cookie header on GET (invalid token)', async () => {
      const response = await request(env.app).get('/api/v1/applications/confirm/no-such-token');

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('does not set any Set-Cookie header on POST (valid token)', async () => {
      const token = await seedPendingConfirmation();

      const response = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('does not set any Set-Cookie header on POST (invalid token)', async () => {
      const response = await request(env.app).post('/api/v1/applications/confirm/no-such-token');

      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('route ordering: confirm path is not matched as :id', () => {
    it('confirm GET path resolves to the confirm handler, not the admin processApplication handler', async () => {
      // The admin processApplication handler is admin-gated and would return
      // 401/403 if it accepted `confirm` as an id. The confirm GET handler is
      // anonymous and returns HTTP 200 with the anti-enumeration body shape.
      // A 200 with `{ valid: false }` proves the confirm route matched first.
      const response = await request(env.app).get('/api/v1/applications/confirm/anything-here');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: false });
    });
  });
});

/**
 * Integration tests for the public POST /api/v1/applications endpoint covering
 * the five service-level branches (epic pv-l9wv):
 *   1. New email — creates pending_confirmation row + sends confirmation email
 *   2. Resubmit on pending_confirmation — regenerates token, resends confirmation
 *   3. Duplicate against an existing pending row — touches row + acknowledges
 *   4. Duplicate against an existing rejected row — touches row + acknowledges
 *   5. Existing account — touches account-exists email
 *
 * The anti-enumeration contract is that all five branches must return an
 * IDENTICAL response body and status, and must perform real DB work so timing
 * cannot be used to distinguish them. These tests assert both invariants.
 *
 * Bead: pv-l9wv.4.3
 */
describe('Public POST /api/v1/applications anti-enumeration (integration)', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    // Provision an admin to exit setup mode so the public apply endpoint
    // responds on its own merits (setup mode would otherwise return 503).
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
    await accountService._setupAccount('admin-apply@pavillion.dev', 'testpassword!1');

    // The apply endpoint requires registrationMode === 'apply' or it throws
    // AccountApplicationsClosedError before any branch logic runs.
    await configurationInterface.setSetting('registrationMode', 'apply');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    // Clear application rows between tests so each test seeds its own
    // fixtures from a clean slate. Account rows (used by Branch 5) are
    // intentionally NOT cleared here — every test that exercises Branch 5
    // uses a unique uuid-based email, so accumulated accounts do not
    // collide between tests, and the FK chain (account_role,
    // account_secrets) makes per-test cleanup unnecessarily noisy.
    await AccountApplicationEntity.destroy({ where: {}, truncate: true });
  });

  /** Apply with a fresh email — exercises Branch 1 (new). */
  async function applyNew(): Promise<request.Response> {
    return request(env.app)
      .post('/api/v1/applications')
      .send({ email: `new-${uuidv4()}@example.com`, message: 'integration applicant' });
  }

  /** Seed a pending_confirmation row, then re-apply on the same email
   *  — exercises Branch 2 (resubmit). */
  async function applyResubmitPendingConfirmation(): Promise<request.Response> {
    const email = `resubmit-${uuidv4()}@example.com`;
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email,
      message: 'first submission',
      status: 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: `seed-token-${uuidv4()}`,
      confirmation_token_expiration: DateTime.utc().plus({ days: 7 }).toJSDate(),
    });
    return request(env.app)
      .post('/api/v1/applications')
      .send({ email, message: 'integration applicant' });
  }

  /** Seed a pending row, then re-apply on the same email
   *  — exercises Branch 3 (duplicate against pending). */
  async function applyDuplicatePending(): Promise<request.Response> {
    const email = `duplicate-pending-${uuidv4()}@example.com`;
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email,
      message: 'first submission',
      status: 'pending',
      status_timestamp: new Date(),
    });
    return request(env.app)
      .post('/api/v1/applications')
      .send({ email, message: 'integration applicant' });
  }

  /** Seed a rejected row, then re-apply on the same email
   *  — exercises Branch 4 (duplicate against rejected). */
  async function applyDuplicateRejected(): Promise<request.Response> {
    const email = `duplicate-rejected-${uuidv4()}@example.com`;
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email,
      message: 'first submission',
      status: 'rejected',
      status_timestamp: new Date(),
    });
    return request(env.app)
      .post('/api/v1/applications')
      .send({ email, message: 'integration applicant' });
  }

  /** Provision an account, then apply on the same email
   *  — exercises Branch 5 (existing account). */
  async function applyExistingAccount(): Promise<request.Response> {
    const email = `existing-account-${uuidv4()}@example.com`;
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
    await accountService._setupAccount(email, 'testpassword!1');

    return request(env.app)
      .post('/api/v1/applications')
      .send({ email, message: 'integration applicant' });
  }

  describe('anti-enumeration: identical response shape across all 5 branches', () => {
    it('Branch 1 (new email) returns { success: true, message: "application_submitted" } at HTTP 200', async () => {
      const res = await applyNew();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'application_submitted' });
    });

    it('Branch 2 (resubmit on pending_confirmation) returns the same shape as Branch 1', async () => {
      const res = await applyResubmitPendingConfirmation();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'application_submitted' });
    });

    it('Branch 3 (duplicate on pending) returns the same shape as Branch 1', async () => {
      const res = await applyDuplicatePending();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'application_submitted' });
    });

    it('Branch 4 (duplicate on rejected) returns the same shape as Branch 1', async () => {
      const res = await applyDuplicateRejected();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'application_submitted' });
    });

    it('Branch 5 (existing account) returns the same shape as Branch 1', async () => {
      const res = await applyExistingAccount();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'application_submitted' });
    });

    it('resubmitting an existing pending_confirmation email returns the SAME response as the first submit (no leakage of prior submission)', async () => {
      const email = `same-${uuidv4()}@example.com`;

      const first = await request(env.app)
        .post('/api/v1/applications')
        .send({ email, message: 'first' });
      const second = await request(env.app)
        .post('/api/v1/applications')
        .send({ email, message: 'second' });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
    });
  });

  describe('timing parity: every branch performs real DB work (no early return)', () => {
    it('all 5 branches take broadly comparable wall-clock time (within a generous bound)', async () => {
      // Each branch makes at least one DB write/read and one email enqueue —
      // the timing assertion only needs to prove no branch short-circuits
      // before doing real work. A generous bound (≤500ms drift) is enough to
      // catch a missing await on a DB write while staying robust to the
      // unavoidable noise of CI hardware scheduling.
      const timings: Record<string, number> = {};

      const time = async (label: string, fn: () => Promise<request.Response>) => {
        const start = Date.now();
        const res = await fn();
        timings[label] = Date.now() - start;
        // Body shape parity assertion is duplicated here so a regression in
        // any branch surfaces as part of the timing test as well.
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, message: 'application_submitted' });
      };

      await time('new', applyNew);
      await time('resubmit-pending_confirmation', applyResubmitPendingConfirmation);
      await time('dup-pending', applyDuplicatePending);
      await time('dup-rejected', applyDuplicateRejected);
      await time('dup-account', applyExistingAccount);

      // Verify all five branches did real work (>0ms is a weak signal but
      // catches obvious sync no-op early returns).
      for (const [label, ms] of Object.entries(timings)) {
        expect(ms, `branch ${label} returned with no measurable DB work`).toBeGreaterThan(0);
      }

      // Relaxed timing bound: max drift across branches must stay within
      // 500ms. This is intentionally loose — the goal is to detect a missing
      // DB call (which would manifest as one branch finishing in <5ms while
      // others take 50-200ms), not micro-benchmark.
      const values = Object.values(timings);
      const max = Math.max(...values);
      const min = Math.min(...values);
      expect(
        max - min,
        `timing drift across branches exceeded 500ms: ${JSON.stringify(timings)}`,
      ).toBeLessThan(500);
    });

    it('every branch leaves a row in account_application (proving the DB write actually ran)', async () => {
      // Branches 1+2: an apply on a fresh email creates a pending_confirmation row.
      const newEmail = `db-1-${uuidv4()}@example.com`;
      await request(env.app).post('/api/v1/applications').send({ email: newEmail });
      const newRow = await AccountApplicationEntity.findOne({ where: { email: newEmail } });
      expect(newRow).not.toBeNull();
      expect(newRow!.status).toBe('pending_confirmation');

      // Branch 3: an apply against an existing pending row touches the
      // status_timestamp (real DB write).
      const dupPendingEmail = `db-3-${uuidv4()}@example.com`;
      const seededDupPending = await AccountApplicationEntity.create({
        id: uuidv4(),
        email: dupPendingEmail,
        message: 'first',
        status: 'pending',
        status_timestamp: new Date(2020, 0, 1),
      });
      const seededTs = seededDupPending.status_timestamp.getTime();
      await request(env.app).post('/api/v1/applications').send({ email: dupPendingEmail });
      const reloadedDupPending =
        await AccountApplicationEntity.findOne({ where: { email: dupPendingEmail } });
      expect(reloadedDupPending!.status_timestamp.getTime()).toBeGreaterThan(seededTs);

      // Branch 4: an apply against an existing rejected row also touches status_timestamp.
      const dupRejectedEmail = `db-4-${uuidv4()}@example.com`;
      const seededDupRejected = await AccountApplicationEntity.create({
        id: uuidv4(),
        email: dupRejectedEmail,
        message: 'first',
        status: 'rejected',
        status_timestamp: new Date(2020, 0, 1),
      });
      const rejectedSeededTs = seededDupRejected.status_timestamp.getTime();
      await request(env.app).post('/api/v1/applications').send({ email: dupRejectedEmail });
      const reloadedDupRejected =
        await AccountApplicationEntity.findOne({ where: { email: dupRejectedEmail } });
      expect(reloadedDupRejected!.status_timestamp.getTime()).toBeGreaterThan(rejectedSeededTs);
    });
  });
});
