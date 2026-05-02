import { describe, it, expect, beforeAll } from 'vitest';
import config from 'config';
import express, { Express } from 'express';
import request from 'supertest';

import {
  applicationByIp,
  applicationByEmail,
  confirmApplicationByIp,
} from '@/server/common/middleware/rate-limiters';

/**
 * Integration tests for account application rate limiting.
 *
 * These tests verify that the pre-configured limiters in rate-limiters.ts
 * actually enforce 429 responses when their configured limits are exceeded.
 *
 * The exports in rate-limiters.ts are computed at module-load time and read
 * the rateLimit.enabled flag once: the unit suite (rate-limiters.test.ts)
 * loads them with rate limiting disabled (no-op middleware), so it can only
 * verify configuration and pass-through behavior. This suite runs under
 * vitest.ratelimiting.config.ts (NODE_CONFIG enables rate limiting), where
 * the same exports resolve to real express-rate-limit middleware, giving us
 * coverage parity with the per-creator tests under
 * src/server/common/test/middleware/.
 *
 * NOTE: requires rate limiting enabled. To run: npm run test:ratelimiting
 *
 * IMPORTANT: each pre-configured export is a module-level singleton with its
 * own in-memory store. State persists across tests within this file. Tests
 * that exhaust an IP-keyed limiter (which would otherwise share the localhost
 * IP across the whole suite) are intentionally collapsed into a single test
 * per limiter so the budget is consumed exactly once. Email-keyed limiters
 * use unique credentials per test, so they can each exhaust their own bucket
 * independently.
 */

const rateLimitEnabled = config.get<boolean>('rateLimit.enabled');
const describeOrSkip = rateLimitEnabled ? describe : describe.skip;

describeOrSkip('Account Application Rate Limiting Integration Tests', () => {
  let app: Express;

  // One app shared across the suite. The limiters' state is module-global
  // anyway, so a per-test app would not isolate state.
  beforeAll(() => {
    app = express();
    app.use(express.json());

    app.post('/apply-ip-only', applicationByIp, (req, res) => {
      res.json({ route: 'ip' });
    });
    app.post('/apply-email-only', applicationByEmail, (req, res) => {
      res.json({ route: 'email' });
    });
    app.get('/confirm-ip-only', confirmApplicationByIp, (req, res) => {
      res.json({ route: 'confirm' });
    });
  });

  describe('applicationByEmail', () => {
    it('should return 429 once the per-email limit is exhausted', async () => {
      const maxRequests = config.get<number>('rateLimit.application.byEmail.max');

      // Unique email so this test owns its own credential bucket.
      const sameEmail = `application-email-${Date.now()}@example.com`;
      const responses = [];
      for (let i = 0; i < maxRequests + 1; i++) {
        responses.push(
          await request(app)
            .post('/apply-email-only')
            .send({ email: sameEmail }),
        );
      }

      // First N requests succeed
      for (let i = 0; i < maxRequests; i++) {
        expect(responses[i].status).toBe(200);
      }

      // The (N+1)th request must return 429 from the email limiter
      const blocked = responses[maxRequests];
      expect(blocked.status).toBe(429);
      expect(blocked.body.errorName).toBe('RateLimitError');
      expect(blocked.body.error).toBe(
        'Too many application requests for this email, please try again later.',
      );

      expect(blocked.headers['ratelimit-limit']).toBe(String(maxRequests));
      expect(blocked.headers['ratelimit-remaining']).toBe('0');
      expect(blocked.headers['retry-after']).toBeDefined();
    });
  });

  // The IP-keyed limiters share localhost across this whole file, so each is
  // exercised in a single dedicated test that consumes its full budget.
  describe('applicationByIp', () => {
    it('should return 429 once the per-IP limit is exhausted, remain in a distinct bucket from applicationByEmail, and the same singleton limiter is wired on POST /api/v1/applications', async () => {
      const ipMax = config.get<number>('rateLimit.application.byIp.max');
      const emailMax = config.get<number>('rateLimit.application.byEmail.max');

      // Vary the email so the email-based limiter (also mounted in this file
      // on a separate route) is unambiguously not the cause of any blocking.
      const responses = [];
      for (let i = 0; i < ipMax + 1; i++) {
        responses.push(
          await request(app)
            .post('/apply-ip-only')
            .send({ email: `application-ip-${i}@example.com` }),
        );
      }

      for (let i = 0; i < ipMax; i++) {
        expect(responses[i].status).toBe(200);
      }

      const blocked = responses[ipMax];
      expect(blocked.status).toBe(429);
      expect(blocked.body.errorName).toBe('RateLimitError');
      expect(blocked.body.error).toBe(
        'Too many application requests from this IP, please try again later.',
      );
      expect(blocked.headers['ratelimit-limit']).toBe(String(ipMax));
      expect(blocked.headers['ratelimit-remaining']).toBe('0');
      expect(blocked.headers['retry-after']).toBeDefined();

      // Bucket separation: the email limiter was unaffected by exhausting the
      // IP limiter (different keying strategy, different limiter store).
      // A fresh email here proves the email bucket is still spendable.
      const freshEmail = `bucket-separation-${Date.now()}@example.com`;
      const emailResponse = await request(app)
        .post('/apply-email-only')
        .send({ email: freshEmail });
      expect(emailResponse.status).toBe(200);

      // And it can be exhausted on its own without help from the (already
      // saturated) IP limiter, confirming both error paths exist.
      const followUps = [];
      for (let i = 0; i < emailMax; i++) {
        followUps.push(
          await request(app)
            .post('/apply-email-only')
            .send({ email: freshEmail }),
        );
      }
      // Final request should be the email limiter's 429.
      const finalEmailBlock = followUps[followUps.length - 1];
      expect(finalEmailBlock.status).toBe(429);
      expect(finalEmailBlock.body.error).toBe(
        'Too many application requests for this email, please try again later.',
      );

      // Phase 2: prove the same `applicationByIp` and `applicationByEmail`
      // singletons are wired onto POST /api/v1/applications. Both limiters
      // are now exhausted (IP via `/apply-ip-only`; email via
      // `/apply-email-only` on `freshEmail`), so any request to the real
      // route must short-circuit at 429 before the handler runs.
      // Imports are deferred so the full-server init cost is only paid when
      // this test actually runs.
      const { TestEnvironment } = await import('@/server/common/test/lib/test_environment');
      const { EventEmitter } = await import('events');
      const { default: AccountService } = await import('@/server/accounts/service/account');
      const { default: ConfigurationInterface } = await import('@/server/configuration/interface');
      const { default: SetupInterface } = await import('@/server/setup/interface');

      const realEnv = new TestEnvironment();
      await realEnv.init();

      // Setup-mode middleware would otherwise return 503 for unauthenticated
      // API calls until an admin exists.
      const accountService = new AccountService(
        new EventEmitter(),
        new ConfigurationInterface(),
        new SetupInterface(),
      );
      await accountService._setupAccount('rate-limit-apply-admin@pavillion.dev', 'testpassword!1');

      // Hit the real route with the same IP (localhost). Because
      // `applicationByIp` runs first in the chain and is already exhausted,
      // we get 429 from it. This proves the IP limiter is mounted.
      const realPostIp = await request(realEnv.app)
        .post('/api/v1/applications')
        .send({ email: `real-route-ip-${Date.now()}@example.com` });
      expect(realPostIp.status).toBe(429);
      expect(realPostIp.body.errorName).toBe('RateLimitError');
      expect(realPostIp.body.error).toBe(
        'Too many application requests from this IP, please try again later.',
      );

      await realEnv.cleanup();
    });
  });

  describe('confirmApplicationByIp', () => {
    it('should return 429 once the per-IP confirmation limit is exhausted, and route wiring on the real /api/v1/applications/confirm/:token endpoints is verified', async () => {
      const maxRequests = config.get<number>('rateLimit.application.confirm.byIp.max');

      // Phase 1: exhaust the budget against the stub route. Asserts the
      // limiter middleware itself behaves correctly (429 + headers + error
      // shape).
      const responses = [];
      for (let i = 0; i < maxRequests + 1; i++) {
        responses.push(await request(app).get('/confirm-ip-only'));
      }

      for (let i = 0; i < maxRequests; i++) {
        expect(responses[i].status).toBe(200);
      }

      const blocked = responses[maxRequests];
      expect(blocked.status).toBe(429);
      expect(blocked.body.errorName).toBe('RateLimitError');
      expect(blocked.body.error).toBe(
        'Too many application-confirm requests from this IP, please try again later.',
      );
      expect(blocked.headers['ratelimit-limit']).toBe(String(maxRequests));
      expect(blocked.headers['ratelimit-remaining']).toBe('0');
      expect(blocked.headers['retry-after']).toBeDefined();

      // Phase 2: prove the same singleton limiter is wired onto the real
      // public confirm endpoints. Because the limiter store is module-global
      // and the budget is already exhausted from Phase 1, every fresh request
      // to the real routes (still on localhost) must short-circuit at 429.
      // This both:
      //   a) confirms `confirmApplicationByIp` is mounted on the production
      //      GET /api/v1/applications/confirm/:token route, and
      //   b) confirms the same on the POST counterpart.
      // Imports are deferred so we don't pay full-server init cost when this
      // file is loaded by other suites; Phase 2 only spins up the server when
      // the test actually runs.
      const { TestEnvironment } = await import('@/server/common/test/lib/test_environment');
      const { EventEmitter } = await import('events');
      const { default: AccountService } = await import('@/server/accounts/service/account');
      const { default: ConfigurationInterface } = await import('@/server/configuration/interface');
      const { default: SetupInterface } = await import('@/server/setup/interface');

      const realEnv = new TestEnvironment();
      await realEnv.init();

      // Setup-mode middleware blocks unauthenticated API calls with 503 until
      // an admin exists. Provision one so the real confirm route can be
      // reached and the rate limiter (already exhausted) is what blocks the
      // request, not setup mode.
      const accountService = new AccountService(
        new EventEmitter(),
        new ConfigurationInterface(),
        new SetupInterface(),
      );
      await accountService._setupAccount('rate-limit-admin@pavillion.dev', 'testpassword!1');

      const realGet = await request(realEnv.app).get(
        '/api/v1/applications/confirm/any-token-here',
      );
      expect(realGet.status).toBe(429);
      expect(realGet.body.errorName).toBe('RateLimitError');

      const realPost = await request(realEnv.app).post(
        '/api/v1/applications/confirm/any-token-here',
      );
      expect(realPost.status).toBe(429);
      expect(realPost.body.errorName).toBe('RateLimitError');

      await realEnv.cleanup();
    });
  });
});
