import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import request from 'supertest';
import config from 'config';

import UserActorRoutes from '@/server/activitypub/api/v1/user-actor';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import {
  getActorRateLimitStore,
  getCalendarRateLimitStore,
  getUserRateLimitStore,
  resetActorRateLimitStore,
  resetCalendarRateLimitStore,
  resetUserRateLimitStore,
} from '@/server/activitypub/middleware/rate-limit';

/**
 * Integration tests for ActivityPub inbox rate limiting.
 *
 * These tests exercise the REAL route-level middleware chains installed on the
 * two inbox routes:
 *
 *   POST /users/:username/inbox (UserActorRoutes.installHandlers)
 *     createUserRateLimiter() -> verifyHttpSignature -> createActorRateLimiter() -> handler
 *
 *   POST /calendars/:urlname/inbox (ActivityPubServerRoutes.installHandlers)
 *     createCalendarRateLimiter() -> verifyHttpSignature -> createActorRateLimiter() -> handler
 *
 * The per-user and per-calendar limiters bound signature work before
 * verification; the per-peer (actor) limiter runs after it and keys on the
 * verified keyId origin (DEC-013). Signature verification is bypassed here
 * (SKIP_SIGNATURES) so requests reach the limiters and the terminal handler
 * without managing certificates; this isolates limiter behavior while still
 * proving the wiring. Requests meant to count against the per-peer limiter
 * carry a parseable Signature header (`signedBy`); unsigned requests have no
 * keyId origin and pass it uncounted. The ordering relative to verification is
 * proved with signatures enforced in test/api/inbox-rate-limit-order.test.ts.
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
 * requests. Requests send an Add so they reach a handled branch; an unhandled
 * type is refused with 400 and would mask the limiter's 200/429 split.
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

function buildServer(): http.Server {
  const app = express();
  const routes = new UserActorRoutes(createStubUserActorService());
  routes.installHandlers(app, '/');
  return http.createServer(app);
}

/**
 * Minimal stubs of the interfaces ActivityPubServerRoutes needs on the calendar
 * inbox path. Under-limit requests send a well-formed Follow from a non-Person
 * actor, which resolves the calendar and is enqueued through addToInbox, so the
 * handler answers 200 and the limiter's 200/429 split is unambiguous.
 */
function buildCalendarServer(): http.Server {
  const app = express();
  const activityPubInterface: any = {
    isPersonActorUri: () => false,
    addToInbox: async () => undefined,
  };
  const calendarInterface: any = {
    getCalendarByName: async (urlName: string) => ({ id: `calendar-${urlName}`, urlName }),
  };
  const routes = new ActivityPubServerRoutes(activityPubInterface, calendarInterface);
  routes.installHandlers(app, '/');
  return http.createServer(app);
}

/**
 * Signature and Date headers naming `actor`'s key. Under SKIP_SIGNATURES the
 * signature is never checked; the per-peer limiter only needs a parseable keyId.
 */
function signedBy(actor: string): Record<string, string> {
  return {
    Signature: `keyId="${actor}#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="fake"`,
    Date: new Date().toUTCString(),
  };
}

function followActivity(calendar: string, actor: string, n: number | string) {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${actor}/activities/follow-${n}`,
    type: 'Follow',
    actor,
    object: `https://local.example/calendars/${calendar}`,
  };
}

describeOrSkip('ActivityPub User Inbox Rate Limiting Integration Tests', () => {
  // One listen()ed server serves the entire suite, reused by every supertest
  // request. Passing a bare Express app to request() makes supertest create
  // and tear down an ephemeral server per request; at 120+ sequential requests
  // that per-request server churn intermittently races on Node 25 ('Parse
  // Error: Expected HTTP/' client failures, or a lost request body that makes
  // the limiter under-count so the over-limit request sees 200 instead of
  // 429). A per-test server is not enough either: Node's default global agent
  // keeps connections alive keyed by host:port, so when a closed test server's
  // ephemeral port is quickly reassigned to the next test's server, a stale
  // pooled socket can be reused against the new server and the same parse
  // error appears. A suite-lifetime server keeps one stable port, so pooled
  // keep-alive sockets stay valid for every request. Limiter state is cleared
  // between tests through the shared stores rather than by rebuilding the app,
  // because the route middleware captures its store instance at build time.
  let server: http.Server;

  beforeAll(async () => {
    // Bypass HTTP signature verification so requests reach both limiters and
    // the terminal handler without valid signatures.
    process.env.SKIP_SIGNATURES = 'true';

    server = buildServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      // Unblock close(): destroy pooled keep-alive sockets still held open by
      // the client agent.
      server.closeAllConnections();
    });

    delete process.env.SKIP_SIGNATURES;
    resetActorRateLimitStore();
    resetUserRateLimitStore();
  });

  beforeEach(() => {
    // Same store instances the route middleware captured at build time; clear
    // entries so each test starts with fresh counters.
    getActorRateLimitStore().clear();
    getUserRateLimitStore().clear();
  });

  describe('per-user limiter', () => {
    it('returns 429 once the per-user threshold is exceeded', async () => {
      // Config default: rateLimit.activitypub.user.max = 120 per minute.
      const max = config.get<number>('rateLimit.activitypub.user.max');

      // Requests are unsigned, so the per-peer limiter (max 60) has no keyId
      // origin to count; this isolates the per-user limiter as the cause of the 429.
      for (let i = 0; i < max; i++) {
        const response = await request(server)
          .post('/users/alice/inbox')
          .send({ type: 'Add', actor: `https://remote.example/users/sender${i}` });

        expect(response.status).toBe(200);
      }

      const blocked = await request(server)
        .post('/users/alice/inbox')
        .send({ type: 'Add', actor: 'https://remote.example/users/senderN' });

      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('keeps per-user limits isolated: exhausting user A does not affect user B', async () => {
      const max = config.get<number>('rateLimit.activitypub.user.max');

      // Exhaust user A's per-user budget; unsigned requests skip the per-peer cap.
      for (let i = 0; i < max; i++) {
        const response = await request(server)
          .post('/users/alice/inbox')
          .send({ type: 'Add', actor: `https://remote.example/users/sender${i}` });

        expect(response.status).toBe(200);
      }

      const aBlocked = await request(server)
        .post('/users/alice/inbox')
        .send({ type: 'Add', actor: 'https://remote.example/users/senderN' });

      expect(aBlocked.status).toBe(429);

      // User B is unaffected by user A's exhaustion.
      const bAllowed = await request(server)
        .post('/users/bob/inbox')
        .send({ type: 'Add', actor: 'https://remote.example/users/fresh' });

      expect(bAllowed.status).toBe(200);
    });

    it('does not echo the username in the 429 body', async () => {
      const max = config.get<number>('rateLimit.activitypub.user.max');

      for (let i = 0; i < max; i++) {
        await request(server)
          .post('/users/secret-user/inbox')
          .send({ type: 'Add', actor: `https://remote.example/users/sender${i}` });
      }

      const blocked = await request(server)
        .post('/users/secret-user/inbox')
        .send({ type: 'Add', actor: 'https://remote.example/users/senderN' });

      expect(blocked.status).toBe(429);
      expect(JSON.stringify(blocked.body)).not.toContain('secret-user');
    });
  });

  describe('per-peer limiter', () => {
    it('returns 429 once the per-peer threshold is exceeded', async () => {
      // Config default: rateLimit.activitypub.actor.max = 60 per minute.
      const max = config.get<number>('rateLimit.activitypub.actor.max');
      const actor = 'https://remote.example/users/aggressor';

      // Vary the username each request so the per-user limiter (max 120) does
      // not fire first; this isolates the per-peer limiter as the cause of the 429.
      for (let i = 0; i < max; i++) {
        const response = await request(server)
          .post(`/users/target${i}/inbox`)
          .set(signedBy(actor))
          .send({ type: 'Add', actor });

        expect(response.status).toBe(200);
      }

      const blocked = await request(server)
        .post('/users/targetN/inbox')
        .set(signedBy(actor))
        .send({ type: 'Add', actor });

      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('keeps per-peer limits isolated: exhausting peer A does not affect peer B', async () => {
      const max = config.get<number>('rateLimit.activitypub.actor.max');
      const actorA = 'https://remote.example/users/actorA';
      const actorB = 'https://other.example/users/actorB';

      // Exhaust peer A across distinct usernames to avoid the per-user cap.
      for (let i = 0; i < max; i++) {
        const response = await request(server)
          .post(`/users/target${i}/inbox`)
          .set(signedBy(actorA))
          .send({ type: 'Add', actor: actorA });

        expect(response.status).toBe(200);
      }

      const aBlocked = await request(server)
        .post('/users/targetN/inbox')
        .set(signedBy(actorA))
        .send({ type: 'Add', actor: actorA });

      expect(aBlocked.status).toBe(429);

      // Peer B (a different origin) is unaffected by peer A's exhaustion.
      const bAllowed = await request(server)
        .post('/users/freshtarget/inbox')
        .set(signedBy(actorB))
        .send({ type: 'Add', actor: actorB });

      expect(bAllowed.status).toBe(200);
    });

    it('does not echo the actor in the 429 body', async () => {
      const max = config.get<number>('rateLimit.activitypub.actor.max');
      const actor = 'https://remote.example/users/secret-actor';

      for (let i = 0; i < max; i++) {
        await request(server)
          .post(`/users/target${i}/inbox`)
          .set(signedBy(actor))
          .send({ type: 'Add', actor });
      }

      const blocked = await request(server)
        .post('/users/targetN/inbox')
        .set(signedBy(actor))
        .send({ type: 'Add', actor });

      expect(blocked.status).toBe(429);
      expect(JSON.stringify(blocked.body)).not.toContain('secret-actor');
    });
  });

  describe('chain ordering', () => {
    it('installs both limiters on the user inbox, and the per-peer limiter trips first', async () => {
      // The per-peer cap (60) is lower than the per-user cap (120). Holding both
      // the username and signer constant, the per-peer limiter must trip first,
      // proving it is installed and reached on the user-inbox route.
      const actorMax = config.get<number>('rateLimit.activitypub.actor.max');
      const actor = 'https://remote.example/users/steady';

      for (let i = 0; i < actorMax; i++) {
        const response = await request(server)
          .post('/users/alice/inbox')
          .set(signedBy(actor))
          .send({ type: 'Add', actor });

        expect(response.status).toBe(200);
      }

      const blocked = await request(server)
        .post('/users/alice/inbox')
        .set(signedBy(actor))
        .send({ type: 'Add', actor });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('Too many requests from this actor, please try again later.');
    });
  });
});

describeOrSkip('ActivityPub Calendar Inbox Rate Limiting Integration Tests', () => {
  // Same suite-lifetime server rationale as the user-inbox suite above.
  let server: http.Server;

  beforeAll(async () => {
    process.env.SKIP_SIGNATURES = 'true';

    server = buildCalendarServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });

    delete process.env.SKIP_SIGNATURES;
    resetActorRateLimitStore();
    resetCalendarRateLimitStore();
  });

  beforeEach(() => {
    getActorRateLimitStore().clear();
    getCalendarRateLimitStore().clear();
  });

  describe('per-calendar limiter', () => {
    it('returns 429 once the per-calendar threshold is exceeded', async () => {
      const max = config.get<number>('rateLimit.activitypub.calendar.max');

      // Requests are unsigned, so the per-peer limiter (lower cap) has no keyId
      // origin to count; this isolates the per-calendar limiter as the cause of the 429.
      for (let i = 0; i < max; i++) {
        const sender = `https://remote.example/users/sender${i}`;
        const response = await request(server)
          .post('/calendars/alpha/inbox')
          .send(followActivity('alpha', sender, i));

        expect(response.status).toBe(200);
      }

      const lastSender = 'https://remote.example/users/senderN';
      const blocked = await request(server)
        .post('/calendars/alpha/inbox')
        .send(followActivity('alpha', lastSender, 'N'));

      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(blocked.body.error).toBe('Too many requests to this calendar, please try again later.');
      expect(JSON.stringify(blocked.body)).not.toContain('alpha');
    });

    it('keeps per-calendar limits isolated: exhausting calendar A does not affect calendar B', async () => {
      const max = config.get<number>('rateLimit.activitypub.calendar.max');

      for (let i = 0; i < max; i++) {
        const sender = `https://remote.example/users/sender${i}`;
        const response = await request(server)
          .post('/calendars/alpha/inbox')
          .send(followActivity('alpha', sender, i));

        expect(response.status).toBe(200);
      }

      const aBlocked = await request(server)
        .post('/calendars/alpha/inbox')
        .send(followActivity('alpha', 'https://remote.example/users/senderN', 'N'));

      expect(aBlocked.status).toBe(429);

      // Calendar B is unaffected by calendar A's exhaustion.
      const bAllowed = await request(server)
        .post('/calendars/beta/inbox')
        .send(followActivity('beta', 'https://remote.example/users/fresh', 'fresh'));

      expect(bAllowed.status).toBe(200);
    });
  });

  describe('chain ordering', () => {
    it('installs both limiters on the calendar inbox, and the per-peer limiter trips first', async () => {
      // The per-peer cap is lower than the per-calendar cap. Holding both the
      // calendar and signer constant, the per-peer limiter must trip first,
      // proving it is installed and reached on the calendar-inbox route.
      const actorMax = config.get<number>('rateLimit.activitypub.actor.max');
      const calendarMax = config.get<number>('rateLimit.activitypub.calendar.max');
      expect(actorMax).toBeLessThan(calendarMax);

      const actor = 'https://remote.example/users/steady';

      for (let i = 0; i < actorMax; i++) {
        const response = await request(server)
          .post('/calendars/alpha/inbox')
          .set(signedBy(actor))
          .send(followActivity('alpha', actor, i));

        expect(response.status).toBe(200);
      }

      const blocked = await request(server)
        .post('/calendars/alpha/inbox')
        .set(signedBy(actor))
        .send(followActivity('alpha', actor, 'N'));

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('Too many requests from this actor, please try again later.');
    });
  });
});
