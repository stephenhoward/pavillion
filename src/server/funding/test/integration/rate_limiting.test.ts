import { describe, it, expect, beforeAll } from 'vitest';
import config from 'config';
import express, { Express } from 'express';
import request from 'supertest';

import { limitFundingWebhookByIp } from '@/server/common/middleware/rate-limiters';

/**
 * Integration tests for funding (Stripe webhook) rate limiting.
 *
 * The pre-configured limiter in rate-limiters.ts is computed at module-load
 * time and reads the rateLimit.enabled flag once. This suite runs under
 * vitest.ratelimiting.config.ts (NODE_CONFIG enables rate limiting), where the
 * export resolves to real express-rate-limit middleware rather than the no-op.
 *
 * NOTE: requires rate limiting enabled. To run: npm run test:ratelimiting
 *
 * IMPORTANT: limitFundingWebhookByIp is a module-level singleton with its own
 * in-memory store, keyed by IP. The whole suite shares the localhost IP, so the
 * IP budget is exhausted exactly once in a single dedicated test. The webhook
 * limiter is deliberately generous (DEC-007: belt-and-braces behind Stripe
 * signature verification) and must never gate legitimate Stripe delivery or
 * retries — the test only asserts that the configured ceiling is enforced.
 */

const rateLimitEnabled = config.get<boolean>('rateLimit.enabled');
const describeOrSkip = rateLimitEnabled ? describe : describe.skip;

describeOrSkip('Funding Webhook Rate Limiting Integration Tests', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    app.post('/webhook-ip-only', limitFundingWebhookByIp, (req, res) => {
      res.json({ route: 'funding-webhook-ip' });
    });
  });

  describe('limitFundingWebhookByIp', () => {
    it('should return 429 once the per-IP limit is exhausted and wire the same singleton onto POST /api/funding/webhooks/stripe', async () => {
      const ipMax = config.get<number>('rateLimit.fundingWebhook.byIp.max');

      const responses = [];
      for (let i = 0; i < ipMax + 1; i++) {
        responses.push(
          await request(app)
            .post('/webhook-ip-only')
            .send({ event: `funding-webhook-${i}` }),
        );
      }

      // The first ipMax requests are under the ceiling and pass through.
      for (let i = 0; i < ipMax; i++) {
        expect(responses[i].status).toBe(200);
      }

      // The (ipMax + 1)th request must be blocked by the IP limiter with a
      // generic 429 body and standard ratelimit-* headers.
      const blocked = responses[ipMax];
      expect(blocked.status).toBe(429);
      expect(blocked.body.errorName).toBe('RateLimitError');
      expect(blocked.body.error).toBe(
        'Too many funding-webhook requests from this IP, please try again later.',
      );
      expect(blocked.headers['ratelimit-limit']).toBe(String(ipMax));
      expect(blocked.headers['ratelimit-remaining']).toBe('0');
      expect(blocked.headers['retry-after']).toBeDefined();

      // Prove the same `limitFundingWebhookByIp` singleton is wired onto the real
      // webhook route. The limiter is now exhausted for localhost, so a request
      // to POST /api/funding/webhooks/stripe must short-circuit at 429 before
      // the raw-body parser and signature-verification handler run.
      // Imports are deferred so the full-server init cost is only paid here.
      const { TestEnvironment } = await import('@/server/common/test/lib/test_environment');
      const { EventEmitter } = await import('events');
      const { default: AccountService } = await import('@/server/accounts/service/account');
      const { default: ConfigurationInterface } = await import('@/server/configuration/interface');
      const { default: SetupInterface } = await import('@/server/setup/interface');

      const realEnv = new TestEnvironment();
      await realEnv.init();

      // Create an admin account so the setup-mode middleware (which returns 503
      // for API requests while no admin exists) lets the request through to the
      // funding route where the limiter is wired.
      const accountService = new AccountService(
        new EventEmitter(),
        new ConfigurationInterface(),
        new SetupInterface(),
      );
      await accountService._setupAccount('funding-ratelimit@pavillion.dev', 'testpassword123');

      const webhookResponse = await request(realEnv.app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'test-signature')
        .send({ event: 'wired-check' });

      expect(webhookResponse.status).toBe(429);
      expect(webhookResponse.body.errorName).toBe('RateLimitError');
      expect(webhookResponse.body.error).toBe(
        'Too many funding-webhook requests from this IP, please try again later.',
      );

      await realEnv.cleanup();
    });
  });
});
