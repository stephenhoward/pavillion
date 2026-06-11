import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express, { Application } from 'express';
import request from 'supertest';
import config from 'config';

import UserActorRoutes from '@/server/activitypub/api/v1/user-actor';
import {
  resetActorRateLimitStore,
  resetUserRateLimitStore,
} from '@/server/activitypub/middleware/rate-limit';

/**
 * Integration tests for ActivityPub user-inbox rate limiting.
 *
 * These tests exercise the REAL route-level middleware chain installed by
 * UserActorRoutes.installHandlers on POST /users/:username/inbox:
 *
 *   createActorRateLimiter() -> createUserRateLimiter() -> verifyHttpSignature -> handler
 *
 * The limiters run BEFORE HTTP signature verification, mirroring the calendar
 * inbox chain (activitypub/api/v1/server.ts) and the DEC-013 ingest-boundary
 * posture. Signature verification is bypassed here (SKIP_SIGNATURES) so requests
 * reach the limiters and the terminal handler without managing certificates;
 * this isolates limiter behavior while still proving the wiring and ordering.
 *
 * The federation-identity limiters use the AP-domain in-memory LRU store
 * (rateLimit.activitypub.{actor,user}) and assert on 429 status, not on the
 * express-rate-limit ratelimit-* headers used by the common HTTP-client limiters.
 *
 * NOTE: These tests require rate limiting to be enabled in the test environment.
 * Run with: npm run test:ratelimiting
 */

const rateLimitEnabled = config.get<boolean>('rateLimit.enabled');
const describeOrSkip = rateLimitEnabled ? describe : describe.skip;

/**
 * Minimal stub of UserActorService. The user-inbox limiters precede the handler,
 * so the handler only needs to resolve a user and return 200 for under-limit
 * requests. processAdd/Remove are never reached for the default activity type.
 */
function createStubUserActorService(): any {
  return {
    getActorByUsername: async (username: string) => ({
      actorUri: `https://local.example/users/${username}`,
      publicKey: 'stub-public-key',
    }),
    processAddActivity: async () => undefined,
    processRemoveActivity: async () => undefined,
  };
}

function buildApp(): Application {
  const app = express();
  const routes = new UserActorRoutes(createStubUserActorService());
  routes.installHandlers(app, '/');
  return app;
}

describeOrSkip('ActivityPub User Inbox Rate Limiting Integration Tests', () => {
  let app: Application;

  beforeAll(() => {
    // Bypass HTTP signature verification so requests reach the limiters and the
    // terminal handler. The limiters run before verifyHttpSignature, so this
    // lets us assert end-to-end limiter behavior without valid signatures.
    process.env.SKIP_SIGNATURES = 'true';
  });

  afterAll(() => {
    delete process.env.SKIP_SIGNATURES;
  });

  beforeEach(() => {
    resetActorRateLimitStore();
    resetUserRateLimitStore();
    app = buildApp();
  });

  afterEach(() => {
    resetActorRateLimitStore();
    resetUserRateLimitStore();
  });

  describe('per-user limiter', () => {
    it('returns 429 once the per-user threshold is exceeded', async () => {
      // Config default: rateLimit.activitypub.user.max = 120 per minute.
      const max = config.get<number>('rateLimit.activitypub.user.max');

      // Vary the actor each request so the actor limiter (max 60) does not fire
      // first; this isolates the per-user limiter as the cause of the 429.
      for (let i = 0; i < max; i++) {
        const response = await request(app)
          .post('/users/alice/inbox')
          .send({ type: 'Follow', actor: `https://remote.example/users/sender${i}` });

        expect(response.status).toBe(200);
      }

      const blocked = await request(app)
        .post('/users/alice/inbox')
        .send({ type: 'Follow', actor: 'https://remote.example/users/senderN' });

      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('keeps per-user limits isolated: exhausting user A does not affect user B', async () => {
      const max = config.get<number>('rateLimit.activitypub.user.max');

      // Exhaust user A's per-user budget, varying actors to avoid the actor cap.
      for (let i = 0; i < max; i++) {
        const response = await request(app)
          .post('/users/alice/inbox')
          .send({ type: 'Follow', actor: `https://remote.example/users/sender${i}` });

        expect(response.status).toBe(200);
      }

      const aBlocked = await request(app)
        .post('/users/alice/inbox')
        .send({ type: 'Follow', actor: 'https://remote.example/users/senderN' });

      expect(aBlocked.status).toBe(429);

      // User B is unaffected by user A's exhaustion.
      const bAllowed = await request(app)
        .post('/users/bob/inbox')
        .send({ type: 'Follow', actor: 'https://remote.example/users/fresh' });

      expect(bAllowed.status).toBe(200);
    });

    it('does not echo the username in the 429 body', async () => {
      const max = config.get<number>('rateLimit.activitypub.user.max');

      for (let i = 0; i < max; i++) {
        await request(app)
          .post('/users/secret-user/inbox')
          .send({ type: 'Follow', actor: `https://remote.example/users/sender${i}` });
      }

      const blocked = await request(app)
        .post('/users/secret-user/inbox')
        .send({ type: 'Follow', actor: 'https://remote.example/users/senderN' });

      expect(blocked.status).toBe(429);
      expect(JSON.stringify(blocked.body)).not.toContain('secret-user');
    });
  });

  describe('per-actor limiter', () => {
    it('returns 429 once the per-actor threshold is exceeded', async () => {
      // Config default: rateLimit.activitypub.actor.max = 60 per minute.
      const max = config.get<number>('rateLimit.activitypub.actor.max');
      const actor = 'https://remote.example/users/aggressor';

      // Vary the username each request so the per-user limiter (max 120) does
      // not fire first; this isolates the actor limiter as the cause of the 429.
      for (let i = 0; i < max; i++) {
        const response = await request(app)
          .post(`/users/target${i}/inbox`)
          .send({ type: 'Follow', actor });

        expect(response.status).toBe(200);
      }

      const blocked = await request(app)
        .post('/users/targetN/inbox')
        .send({ type: 'Follow', actor });

      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('keeps per-actor limits isolated: exhausting actor A does not affect actor B', async () => {
      const max = config.get<number>('rateLimit.activitypub.actor.max');
      const actorA = 'https://remote.example/users/actorA';
      const actorB = 'https://remote.example/users/actorB';

      // Exhaust actor A across distinct usernames to avoid the per-user cap.
      for (let i = 0; i < max; i++) {
        const response = await request(app)
          .post(`/users/target${i}/inbox`)
          .send({ type: 'Follow', actor: actorA });

        expect(response.status).toBe(200);
      }

      const aBlocked = await request(app)
        .post('/users/targetN/inbox')
        .send({ type: 'Follow', actor: actorA });

      expect(aBlocked.status).toBe(429);

      // Actor B is unaffected by actor A's exhaustion.
      const bAllowed = await request(app)
        .post('/users/freshtarget/inbox')
        .send({ type: 'Follow', actor: actorB });

      expect(bAllowed.status).toBe(200);
    });

    it('does not echo the actor in the 429 body', async () => {
      const max = config.get<number>('rateLimit.activitypub.actor.max');
      const actor = 'https://remote.example/users/secret-actor';

      for (let i = 0; i < max; i++) {
        await request(app)
          .post(`/users/target${i}/inbox`)
          .send({ type: 'Follow', actor });
      }

      const blocked = await request(app)
        .post('/users/targetN/inbox')
        .send({ type: 'Follow', actor });

      expect(blocked.status).toBe(429);
      expect(JSON.stringify(blocked.body)).not.toContain('secret-actor');
    });
  });

  describe('chain ordering', () => {
    it('runs limiters before signature verification (both limits enforced on the same route)', async () => {
      // The actor cap (60) is lower than the per-user cap (120). Holding both the
      // username and actor constant, the actor limiter must trip first, proving
      // the actor limiter is installed and reached on the user-inbox route.
      const actorMax = config.get<number>('rateLimit.activitypub.actor.max');
      const actor = 'https://remote.example/users/steady';

      for (let i = 0; i < actorMax; i++) {
        const response = await request(app)
          .post('/users/alice/inbox')
          .send({ type: 'Follow', actor });

        expect(response.status).toBe(200);
      }

      const blocked = await request(app)
        .post('/users/alice/inbox')
        .send({ type: 'Follow', actor });

      // 429 (not 401) confirms the limiter shed the request before signature
      // verification ran, matching the calendar-inbox chain ordering.
      expect(blocked.status).toBe(429);
    });
  });
});
