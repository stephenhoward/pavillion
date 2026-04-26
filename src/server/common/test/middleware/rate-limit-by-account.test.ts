import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import { createAccountRateLimiter } from '@/server/common/middleware/rate-limit-by-account';
import { Account } from '@/common/model/account';

describe('createAccountRateLimiter', () => {
  let router: express.Router;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('rate limit enforcement', () => {
    it('should allow requests up to the limit', async () => {
      const limiter = createAccountRateLimiter(3, 60000, 'test-endpoint');

      router.post('/test', addRequestUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/test')
          .send({ data: 'test' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('should block requests exceeding the limit', async () => {
      const limiter = createAccountRateLimiter(2, 60000, 'test-endpoint');

      router.post('/test', addRequestUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 2 requests - should succeed
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/test')
          .send({ data: 'test' });

        expect(response.status).toBe(200);
      }

      // Third request should be blocked
      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe(
        'Too many test-endpoint requests for this account, please try again later.',
      );
      expect(response.body.errorName).toBe('RateLimitError');
    });

    it('should track limits per account separately', async () => {
      const limiter = createAccountRateLimiter(2, 60000, 'test-endpoint');

      // Middleware that sets different user per request based on header
      const setUser = (req: express.Request, _res: express.Response, next: express.NextFunction): void => {
        const userId = req.headers['x-test-user-id'] as string || 'default-id';
        req.user = new Account(userId, 'testuser', 'test@test.com');
        next();
      };

      router.post('/test', setUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // User 1: Make 2 requests
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/test')
          .set('x-test-user-id', 'user-1')
          .send({ data: 'test' });

        expect(response.status).toBe(200);
      }

      // User 2: Can still make requests (separate limit)
      const response = await request(app)
        .post('/test')
        .set('x-test-user-id', 'user-2')
        .send({ data: 'test' });

      expect(response.status).toBe(200);

      // User 1: Should now be rate limited
      const rateLimitedResponse = await request(app)
        .post('/test')
        .set('x-test-user-id', 'user-1')
        .send({ data: 'test' });

      expect(rateLimitedResponse.status).toBe(429);
    });

    it('should use "unknown" key when no user is present', async () => {
      const limiter = createAccountRateLimiter(2, 60000, 'test-endpoint');

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 2 requests without user
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/test')
          .send({ data: 'test' });

        expect(response.status).toBe(200);
      }

      // Third request should be rate limited (all go to "unknown" key)
      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });

      expect(response.status).toBe(429);
    });
  });

  describe('account-based keying behavior', () => {
    it('should rate limit each account independently', async () => {
      const limiter = createAccountRateLimiter(1, 60000, 'test-endpoint');

      const setUser = (req: express.Request, _res: express.Response, next: express.NextFunction): void => {
        const userId = req.headers['x-test-user-id'] as string || 'default-id';
        req.user = new Account(userId, 'testuser', 'test@test.com');
        next();
      };

      router.post('/test', setUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Exhaust the limit for account-a
      await request(app)
        .post('/test')
        .set('x-test-user-id', 'account-a')
        .send({ data: 'test' });

      // account-a is now rate limited
      const blockedResponse = await request(app)
        .post('/test')
        .set('x-test-user-id', 'account-a')
        .send({ data: 'test' });
      expect(blockedResponse.status).toBe(429);

      // account-b should still be allowed (separate bucket)
      const allowedResponse = await request(app)
        .post('/test')
        .set('x-test-user-id', 'account-b')
        .send({ data: 'test' });
      expect(allowedResponse.status).toBe(200);
    });

    it('should share rate limit bucket for unauthenticated requests', async () => {
      const limiter = createAccountRateLimiter(1, 60000, 'test-endpoint');

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // First unauthenticated request succeeds
      const firstResponse = await request(app).post('/test');
      expect(firstResponse.status).toBe(200);

      // Second unauthenticated request shares the "unknown" bucket and is blocked
      const secondResponse = await request(app).post('/test');
      expect(secondResponse.status).toBe(429);
    });

    it('should not share bucket between authenticated and unauthenticated requests', async () => {
      const limiter = createAccountRateLimiter(1, 60000, 'test-endpoint');

      const optionalUser = (req: express.Request, _res: express.Response, next: express.NextFunction): void => {
        const userId = req.headers['x-test-user-id'] as string;
        if (userId) {
          req.user = new Account(userId, 'testuser', 'test@test.com');
        }
        next();
      };

      router.post('/test', optionalUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Exhaust the limit for unauthenticated ("unknown") bucket
      await request(app).post('/test').send({ data: 'test' });

      // Unauthenticated is now blocked
      const blockedResponse = await request(app).post('/test').send({ data: 'test' });
      expect(blockedResponse.status).toBe(429);

      // Authenticated request should still succeed (different bucket)
      const allowedResponse = await request(app)
        .post('/test')
        .set('x-test-user-id', 'authenticated-user')
        .send({ data: 'test' });
      expect(allowedResponse.status).toBe(200);
    });
  });

  describe('error response format', () => {
    it('should return 429 status code when limit exceeded', async () => {
      const limiter = createAccountRateLimiter(1, 60000, 'test-endpoint');

      router.post('/test', addRequestUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      await request(app).post('/test').send({ data: 'test' });

      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });

      expect(response.status).toBe(429);
    });

    it('should return JSON error with correct structure', async () => {
      const limiter = createAccountRateLimiter(1, 60000, 'report-submission');

      router.post('/test', addRequestUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      await request(app).post('/test').send({ data: 'test' });

      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe(
        'Too many report-submission requests for this account, please try again later.',
      );
    });

    it('should include rate limit headers', async () => {
      const limiter = createAccountRateLimiter(2, 60000, 'test-endpoint');

      router.post('/test', addRequestUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });

      expect(response.headers['ratelimit-limit']).toBe('2');
      expect(response.headers['ratelimit-remaining']).toBeDefined();
      expect(response.headers['ratelimit-reset']).toBeDefined();
    });
  });

  describe('configuration for report submission', () => {
    it('should work with report submission config (20 requests per hour per account)', async () => {
      const limiter = createAccountRateLimiter(
        20,
        3600000,
        'report-submission',
      );

      router.post('/reports', addRequestUser, limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 20 requests - should all succeed
      for (let i = 0; i < 20; i++) {
        const response = await request(app)
          .post('/reports')
          .send({ data: 'test' });

        expect(response.status).toBe(200);
      }

      // 21st request should be rate limited
      const response = await request(app)
        .post('/reports')
        .send({ data: 'test' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe(
        'Too many report-submission requests for this account, please try again later.',
      );
    });
  });
});
