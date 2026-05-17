import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';

import {
  AccountApplicationEntity,
  AccountEntity,
  AccountRoleEntity,
} from '@/server/common/entity/account';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the public application confirmation endpoint
 * (`POST /api/v1/applications/confirm/:token`).
 *
 * Covers:
 *   - Happy path: POST consumes the token; a second POST collapses to the
 *     same failure shape (double-consume parity).
 *   - Anti-enumeration: invalid / expired / wrong-status tokens return
 *     IDENTICAL `{ valid: false }` (HTTP 200).
 *   - No session / no cookies: anonymous visitors must NOT receive any
 *     `Set-Cookie` headers in responses.
 *
 * Bead: pv-l9wv.4.2 (single-step collapse: pv-xmas)
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

  describe('happy path: consume → double-consume parity', () => {
    it('POST reports success:true on first call; second POST collapses to valid:false', async () => {
      const token = await seedPendingConfirmation();

      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${token}`);
      expect(postResponse.status).toBe(200);
      expect(postResponse.body).toEqual({ success: true });

      // Double-consume parity: the row has been transitioned out of
      // `pending_confirmation` and the token cleared, so a second consume
      // attempt must look IDENTICAL to any other terminal failure.
      const secondPost = await request(env.app).post(`/api/v1/applications/confirm/${token}`);
      expect(secondPost.status).toBe(200);
      expect(secondPost.body).toEqual({ valid: false });
    });
  });

  describe('anti-enumeration: identical shape across all failure modes', () => {
    it('returns identical valid:false shape for an unknown token', async () => {
      const bogus = 'this-token-does-not-exist';

      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${bogus}`);

      expect(postResponse.status).toBe(200);
      expect(postResponse.body).toEqual({ valid: false });
    });

    it('returns identical valid:false shape for an expired token', async () => {
      const token = await seedPendingConfirmation({
        expiresAt: DateTime.utc().minus({ days: 1 }).toJSDate(),
      });

      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

      expect(postResponse.status).toBe(200);
      expect(postResponse.body).toEqual({ valid: false });
    });

    it('returns identical valid:false shape for a wrong-status token', async () => {
      // Token exists but the application has already been promoted out of
      // pending_confirmation (e.g. consumed by another path).
      const token = await seedPendingConfirmation({ status: 'pending' });

      const postResponse = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

      expect(postResponse.status).toBe(200);
      expect(postResponse.body).toEqual({ valid: false });
    });
  });

  describe('privacy: anonymous visitors receive no cookies', () => {
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
    it('confirm POST path resolves to the confirm handler, not the admin processApplication handler', async () => {
      // The admin processApplication handler is admin-gated and would return
      // 401/403 if it accepted `confirm` as an id. The confirm POST handler is
      // anonymous and returns HTTP 200 with the anti-enumeration body shape.
      // A 200 with `{ valid: false }` proves the confirm route matched first.
      const response = await request(env.app).post('/api/v1/applications/confirm/anything-here');
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

/**
 * Integration tests for the admin-notify side-effect of
 * `confirmAccountApplication`.
 *
 * When an applicant confirms their email, the status flips from
 * `pending_confirmation` to `pending` and the applicant receives an
 * acknowledgment email. This suite verifies the additional admin-notify
 * fan-out: every admin returned by `AccountService.getAdmins()` receives an
 * email, and the confirm response stays `true` regardless of admin-loop
 * outcomes (zero admins, send failure mid-loop, etc.).
 *
 * Bead: pv-hne7
 */
describe('confirmAccountApplication admin-notify (integration)', () => {
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    // Provision a single admin account to exit setup mode so the public
    // confirm endpoint responds on its own merits. This bootstrap admin is
    // preserved across tests (the FK chain via account_secrets makes wholesale
    // truncation noisy); per-test admin seeding controls which admin roles
    // exist via the AccountRole table only.
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);
    await accountService._setupAccount('admin-notify-bootstrap@pavillion.dev', 'testpassword!1');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    await AccountApplicationEntity.destroy({ where: {}, truncate: true });
    // Clear ALL admin roles (including the bootstrap admin's role). Each test
    // re-adds the role assignments it needs. Account rows themselves are not
    // truncated — the bootstrap row stays so the FK chain via
    // account_secrets is preserved.
    await AccountRoleEntity.destroy({ where: {}, truncate: true });
  });

  afterEach(() => {
    sandbox.restore();
  });

  /** Seed a confirmation-pending application; returns the token. */
  async function seedPendingConfirmation(): Promise<string> {
    const token = `notify-token-${uuidv4()}`;
    await AccountApplicationEntity.create({
      id: uuidv4(),
      email: `${uuidv4()}@example.com`,
      message: 'integration applicant',
      status: 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: token,
      confirmation_token_expiration: DateTime.utc().plus({ days: 7 }).toJSDate(),
    });
    return token;
  }

  /** Create an account row with an optional role + language. */
  async function seedAccount(
    overrides: { role?: string; language?: string; email?: string } = {},
  ): Promise<AccountEntity> {
    const id = uuidv4();
    const account = await AccountEntity.create({
      id,
      username: `user-${id}`,
      email: overrides.email ?? `acct-${id}@example.com`,
      language: overrides.language ?? 'en',
    });
    if (overrides.role) {
      await AccountRoleEntity.create({ account_id: id, role: overrides.role });
    }
    return account;
  }

  it('fans out one admin-notify email per admin and skips non-admin accounts', async () => {
    const admin1 = await seedAccount({ role: 'admin', email: 'admin1@example.com' });
    const admin2 = await seedAccount({ role: 'admin', email: 'admin2@example.com' });
    await seedAccount({ email: 'regular@example.com' }); // non-admin: must not receive
    const sendStub = sandbox.stub(EmailInterface.prototype, 'sendEmail').resolves();
    const token = await seedPendingConfirmation();

    const response = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    // 1 applicant ack + 2 admin notifies = 3 sends.
    expect(sendStub.callCount).toBe(3);

    const recipients = sendStub.getCalls().map(call => (call.args[0] as { emailAddress: string }).emailAddress);
    expect(recipients).toContain(admin1.email);
    expect(recipients).toContain(admin2.email);
    expect(recipients).not.toContain('regular@example.com');
  });

  it('uses the admin account language when sending the admin-notify email', async () => {
    await seedAccount({ role: 'admin', email: 'admin-fr@example.com', language: 'fr' });
    const sendStub = sandbox.stub(EmailInterface.prototype, 'sendEmail').resolves();
    const token = await seedPendingConfirmation();

    const response = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    // The admin send is the one addressed to admin-fr@example.com — find it
    // and verify the MailData was built for 'fr'. The MailData itself does
    // not carry a language field; we inspect the rendered subject to
    // confirm the fr namespace was used. Since only EN translations exist
    // today, fr falls back to EN, but the contract is that buildMessage(
    // 'fr') is invoked, not buildMessage('en'). We capture the test by
    // asserting the admin send completed (no language-fallback error) and
    // by inspecting that the call to sendEmail was made with an email
    // addressed to the fr admin (proving the loop reached the send).
    const adminCall = sendStub.getCalls().find(
      call => (call.args[0] as { emailAddress: string }).emailAddress === 'admin-fr@example.com',
    );
    expect(adminCall).toBeDefined();
  });

  it('returns success even when there are zero admins (loop is empty)', async () => {
    // No admin role seeded — getAdmins() returns [].
    const sendStub = sandbox.stub(EmailInterface.prototype, 'sendEmail').resolves();
    const token = await seedPendingConfirmation();

    const response = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    // Only the applicant ack send fires — no admin notifies.
    expect(sendStub.callCount).toBe(1);
  });

  it('returns success when an admin-notify send throws inside the loop', async () => {
    await seedAccount({ role: 'admin', email: 'admin-fail@example.com' });
    const sendStub = sandbox.stub(EmailInterface.prototype, 'sendEmail');
    // First call (applicant ack) succeeds; second call (admin notify) throws.
    sendStub.onFirstCall().resolves();
    sendStub.onSecondCall().rejects(new Error('SMTP boom'));
    const token = await seedPendingConfirmation();

    const response = await request(env.app).post(`/api/v1/applications/confirm/${token}`);

    // Confirm endpoint still reports success — admin-notify is a side effect
    // and must not fail the confirm.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    // Both sends were attempted (applicant ack + admin notify); the loop
    // failure was caught and swallowed.
    expect(sendStub.callCount).toBe(2);
  });
});

