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
