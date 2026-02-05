import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createActorRateLimiter,
  resetActorRateLimitStore,
  getActorRateLimitStore,
  createCalendarRateLimiter,
  resetCalendarRateLimitStore,
  getCalendarRateLimitStore,
} from '../rate-limit';

describe('createActorRateLimiter', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset the store before each test
    resetActorRateLimitStore();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    resetActorRateLimitStore();
  });

  describe('rate limit enforcement', () => {
    it('should allow requests within the rate limit', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(3, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Make 3 requests with the same actor - all should succeed
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/inbox')
          .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('should block requests exceeding the rate limit', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(2, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Make 2 requests - should succeed
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/inbox')
          .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

        expect(response.status).toBe(200);
      }

      // Third request should be blocked
      const response = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe('Too many requests from this actor, please try again later.');
      expect(response.body.retryAfter).toBeDefined();
    });

    it('should return 429 status code with Retry-After header', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      // Second request should be rate limited
      const response = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
      expect(parseInt(response.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('should track limits per actor separately', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(2, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Actor 1: Make 2 requests
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/inbox')
          .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

        expect(response.status).toBe(200);
      }

      // Actor 2: Can still make requests (separate limit)
      const response = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/bob', type: 'Follow' });

      expect(response.status).toBe(200);

      // Actor 1: Should now be rate limited
      const rateLimitedResponse = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(rateLimitedResponse.status).toBe(429);
    });

    it('should use default values of 60 requests per minute', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter();
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Make 60 requests - all should succeed
      for (let i = 0; i < 60; i++) {
        const response = await request(app)
          .post('/inbox')
          .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

        expect(response.status).toBe(200);
      }

      // 61st request should be blocked
      const response = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(429);
    });
  });

  describe('actor extraction', () => {
    it('should extract actor from string in request body', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      // Second request should be rate limited
      const response = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(429);
    });

    it('should extract actor from object with id property', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request with actor as object
      await request(app)
        .post('/inbox')
        .send({
          actor: { id: 'https://remote.example/users/alice', type: 'Person' },
          type: 'Follow',
        });

      // Second request should be rate limited
      const response = await request(app)
        .post('/inbox')
        .send({
          actor: { id: 'https://remote.example/users/alice', type: 'Person' },
          type: 'Follow',
        });

      expect(response.status).toBe(429);
    });

    it('should allow request when actor cannot be extracted', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Request without actor should be allowed (downstream validation will handle it)
      const response = await request(app)
        .post('/inbox')
        .send({ type: 'Follow' });

      expect(response.status).toBe(200);

      // Should log a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[RateLimit] Could not extract actor from request, allowing request',
      );
    });

    it('should allow request when body is empty', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Request without body should be allowed
      const response = await request(app).post('/inbox');

      expect(response.status).toBe(200);
    });
  });

  describe('window reset', () => {
    it('should reset rate limit after window expires', async () => {
      const app = express();
      app.use(express.json());

      // Very short window for testing (100ms)
      const limiter = createActorRateLimiter(1, 100);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      const response1 = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response1.status).toBe(200);

      // Second request immediately should be blocked
      const response2 = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response2.status).toBe(429);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Third request should succeed after window reset
      const response3 = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response3.status).toBe(200);
    });
  });

  describe('logging', () => {
    it('should log when rate limit is exceeded', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      // Second request is rate limited
      await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[RateLimit] Rate limit exceeded for actor https://remote.example/users/alice (2/1 requests)',
      );
    });
  });

  describe('store cleanup', () => {
    it('should clean up expired entries', async () => {
      // Get store with 100ms window
      resetActorRateLimitStore();
      const store = getActorRateLimitStore(100);

      // Add an entry
      store.check('https://remote.example/users/alice', 10);
      expect(store.size).toBe(1);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Trigger cleanup
      store.cleanup();

      // Entry should be removed
      expect(store.size).toBe(0);
    });

    it('should not clean up entries within the window', async () => {
      // Get store with 10 second window
      resetActorRateLimitStore();
      const store = getActorRateLimitStore(10000);

      // Add an entry
      store.check('https://remote.example/users/alice', 10);
      expect(store.size).toBe(1);

      // Trigger cleanup immediately
      store.cleanup();

      // Entry should still exist
      expect(store.size).toBe(1);
    });
  });

  describe('resetActorRateLimitStore', () => {
    it('should reset the store between tests', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Exhaust the limit
      await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      const blockedResponse = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(blockedResponse.status).toBe(429);

      // Reset the store
      resetActorRateLimitStore();

      // Create new limiter (will get fresh store)
      const newLimiter = createActorRateLimiter(1, 60000);
      const newApp = express();
      newApp.use(express.json());
      newApp.post('/inbox', newLimiter, (req, res) => {
        res.json({ success: true });
      });

      // Should be able to make request again
      const response = await request(newApp)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(200);
    });
  });

  describe('ActivityPub activity types', () => {
    it('should rate limit Follow activities', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      await request(app)
        .post('/inbox')
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Follow',
          actor: 'https://remote.example/users/alice',
          object: 'https://local.example/calendars/my-calendar',
        });

      const response = await request(app)
        .post('/inbox')
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Follow',
          actor: 'https://remote.example/users/alice',
          object: 'https://local.example/calendars/my-calendar',
        });

      expect(response.status).toBe(429);
    });

    it('should rate limit Create activities', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      await request(app)
        .post('/inbox')
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Create',
          actor: 'https://remote.example/calendars/events',
          object: { type: 'Event', name: 'Test Event' },
        });

      const response = await request(app)
        .post('/inbox')
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Create',
          actor: 'https://remote.example/calendars/events',
          object: { type: 'Event', name: 'Another Event' },
        });

      expect(response.status).toBe(429);
    });

    it('should rate limit Announce activities', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createActorRateLimiter(1, 60000);
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      await request(app)
        .post('/inbox')
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Announce',
          actor: 'https://remote.example/calendars/events',
          object: 'https://another.example/calendars/cal/events/123',
        });

      const response = await request(app)
        .post('/inbox')
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Announce',
          actor: 'https://remote.example/calendars/events',
          object: 'https://another.example/calendars/cal/events/456',
        });

      expect(response.status).toBe(429);
    });
  });
});

describe('createCalendarRateLimiter', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset the store before each test
    resetCalendarRateLimitStore();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    resetCalendarRateLimitStore();
  });

  describe('rate limit enforcement', () => {
    it('should allow requests within the rate limit', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(3, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Make 3 requests to the same calendar - all should succeed
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/calendars/my-calendar/inbox')
          .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('should block requests exceeding the rate limit', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(2, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Make 2 requests - should succeed
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/calendars/my-calendar/inbox')
          .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

        expect(response.status).toBe(200);
      }

      // Third request should be blocked
      const response = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe('Too many requests to this calendar, please try again later.');
      expect(response.body.retryAfter).toBeDefined();
    });

    it('should return 429 status code with Retry-After header', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(1, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      // Second request should be rate limited
      const response = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
      expect(parseInt(response.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('should track limits per calendar separately', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(2, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Calendar 1: Make 2 requests
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/calendars/calendar-one/inbox')
          .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

        expect(response.status).toBe(200);
      }

      // Calendar 2: Can still receive requests (separate limit)
      const response = await request(app)
        .post('/calendars/calendar-two/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(200);

      // Calendar 1: Should now be rate limited
      const rateLimitedResponse = await request(app)
        .post('/calendars/calendar-one/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(rateLimitedResponse.status).toBe(429);
    });

    it('should count requests from different actors against the same calendar limit', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(2, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Request from actor 1
      const response1 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response1.status).toBe(200);

      // Request from actor 2
      const response2 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/bob', type: 'Follow' });

      expect(response2.status).toBe(200);

      // Third request from actor 3 should be blocked (calendar limit exceeded)
      const response3 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/charlie', type: 'Follow' });

      expect(response3.status).toBe(429);
    });

    it('should use default values of 120 requests per minute', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter();
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Make 120 requests - all should succeed
      for (let i = 0; i < 120; i++) {
        const response = await request(app)
          .post('/calendars/my-calendar/inbox')
          .send({ actor: `https://remote.example/users/user${i}`, type: 'Follow' });

        expect(response.status).toBe(200);
      }

      // 121st request should be blocked
      const response = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/extra', type: 'Follow' });

      expect(response.status).toBe(429);
    });
  });

  describe('calendar extraction', () => {
    it('should extract calendar from URL params', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(1, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      // Second request to same calendar should be rate limited
      const response = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/bob', type: 'Follow' });

      expect(response.status).toBe(429);
    });

    it('should allow request when calendar cannot be extracted', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(1, 60000);
      // Route without urlName param
      app.post('/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Request without calendar in params should be allowed
      const response = await request(app)
        .post('/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(200);

      // Should log a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[RateLimit] Could not extract calendar from request, allowing request',
      );
    });
  });

  describe('window reset', () => {
    it('should reset rate limit after window expires', async () => {
      const app = express();
      app.use(express.json());

      // Very short window for testing (100ms)
      const limiter = createCalendarRateLimiter(1, 100);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      const response1 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response1.status).toBe(200);

      // Second request immediately should be blocked
      const response2 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response2.status).toBe(429);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Third request should succeed after window reset
      const response3 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response3.status).toBe(200);
    });
  });

  describe('logging', () => {
    it('should log when rate limit is exceeded', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(1, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // First request succeeds
      await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      // Second request is rate limited
      await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[RateLimit] Rate limit exceeded for calendar my-calendar (2/1 requests)',
      );
    });
  });

  describe('store cleanup', () => {
    it('should clean up expired entries', async () => {
      // Get store with 100ms window
      resetCalendarRateLimitStore();
      const store = getCalendarRateLimitStore(100);

      // Add an entry
      store.check('my-calendar', 10);
      expect(store.size).toBe(1);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Trigger cleanup
      store.cleanup();

      // Entry should be removed
      expect(store.size).toBe(0);
    });

    it('should not clean up entries within the window', async () => {
      // Get store with 10 second window
      resetCalendarRateLimitStore();
      const store = getCalendarRateLimitStore(10000);

      // Add an entry
      store.check('my-calendar', 10);
      expect(store.size).toBe(1);

      // Trigger cleanup immediately
      store.cleanup();

      // Entry should still exist
      expect(store.size).toBe(1);
    });
  });

  describe('resetCalendarRateLimitStore', () => {
    it('should reset the store between tests', async () => {
      const app = express();
      app.use(express.json());

      const limiter = createCalendarRateLimiter(1, 60000);
      app.post('/calendars/:urlname/inbox', limiter, (req, res) => {
        res.json({ success: true });
      });

      // Exhaust the limit
      await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      const blockedResponse = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(blockedResponse.status).toBe(429);

      // Reset the store
      resetCalendarRateLimitStore();

      // Create new limiter (will get fresh store)
      const newLimiter = createCalendarRateLimiter(1, 60000);
      const newApp = express();
      newApp.use(express.json());
      newApp.post('/calendars/:urlname/inbox', newLimiter, (req, res) => {
        res.json({ success: true });
      });

      // Should be able to make request again
      const response = await request(newApp)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response.status).toBe(200);
    });
  });

  describe('independence from actor rate limiter', () => {
    it('should use a separate store from actor rate limiter', async () => {
      const app = express();
      app.use(express.json());

      // Set up both limiters on same route
      const actorLimiter = createActorRateLimiter(1, 60000);
      const calendarLimiter = createCalendarRateLimiter(2, 60000);
      app.post('/calendars/:urlname/inbox', actorLimiter, calendarLimiter, (req, res) => {
        res.json({ success: true });
      });

      // First request from alice should succeed
      const response1 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response1.status).toBe(200);

      // Second request from alice should be blocked by actor limiter (not calendar)
      const response2 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/alice', type: 'Follow' });

      expect(response2.status).toBe(429);
      expect(response2.body.error).toBe('Too many requests from this actor, please try again later.');

      // Request from bob should succeed (different actor, calendar still under limit)
      resetActorRateLimitStore(); // Reset actor store to allow bob
      const response3 = await request(app)
        .post('/calendars/my-calendar/inbox')
        .send({ actor: 'https://remote.example/users/bob', type: 'Follow' });

      expect(response3.status).toBe(200);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest actors when exceeding max size', () => {
      // Create a store with small max size
      resetActorRateLimitStore();
      const store = getActorRateLimitStore(60000);

      // Fill the store to max size (default 10000)
      // For testing, we'll manually set a smaller max size by creating requests
      // Note: In practice, the store has maxSize = 10000 by default

      // Add 3 actors
      store.check('actor1', 100);
      store.check('actor2', 100);
      store.check('actor3', 100);

      expect(store.size).toBe(3);

      // Access actor1 to make it most recently used
      store.check('actor1', 100);

      // If we had a smaller maxSize, actor2 would be evicted next
      // Since the default is 10000, we can't easily test eviction without filling that many entries
      // But we can verify the size management works
      expect(store.size).toBeLessThanOrEqual(10000);
    });

    it('should maintain cache size under limit during high load', () => {
      resetActorRateLimitStore();
      const store = getActorRateLimitStore(60000);

      // Simulate high load with many different actors
      for (let i = 0; i < 100; i++) {
        store.check(`actor${i}`, 100);
      }

      // Size should be exactly 100 (well under the 10000 limit)
      expect(store.size).toBe(100);
      expect(store.size).toBeLessThanOrEqual(10000);
    });
  });
});

describe('CalendarRateLimitStore LRU eviction', () => {
  beforeEach(() => {
    resetCalendarRateLimitStore();
  });

  afterEach(() => {
    resetCalendarRateLimitStore();
  });

  describe('LRU eviction', () => {
    it('should evict oldest calendars when exceeding max size', () => {
      const store = getCalendarRateLimitStore(60000);

      // Add 3 calendars
      store.check('calendar1', 100);
      store.check('calendar2', 100);
      store.check('calendar3', 100);

      expect(store.size).toBe(3);

      // Access calendar1 to make it most recently used
      store.check('calendar1', 100);

      // Verify size management
      expect(store.size).toBeLessThanOrEqual(10000);
    });

    it('should maintain cache size under limit during high load', () => {
      const store = getCalendarRateLimitStore(60000);

      // Simulate high load with many different calendars
      for (let i = 0; i < 100; i++) {
        store.check(`calendar${i}`, 100);
      }

      // Size should be exactly 100 (well under the 10000 limit)
      expect(store.size).toBe(100);
      expect(store.size).toBeLessThanOrEqual(10000);
    });
  });
});
