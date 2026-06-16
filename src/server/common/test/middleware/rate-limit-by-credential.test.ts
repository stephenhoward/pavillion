import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { testApp } from '@/server/common/test/lib/express';
import { createCredentialRateLimiter } from '@/server/common/middleware/rate-limit-by-credential';

describe('createCredentialRateLimiter', () => {
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
      const limiter = createCredentialRateLimiter(
        3,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 3 requests with the same email - all should succeed
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/test')
          .send({ email: 'user@example.com' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('should block requests exceeding the limit', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 2 requests - should succeed
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/test')
          .send({ email: 'user@example.com' });

        expect(response.status).toBe(200);
      }

      // Third request should be blocked
      const response = await request(app)
        .post('/test')
        .send({ email: 'user@example.com' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe('Too many test-endpoint requests for this email, please try again later.');
    });

    it('should track limits per credential separately', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // User 1: Make 2 requests
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/test')
          .send({ email: 'user1@example.com' });

        expect(response.status).toBe(200);
      }

      // User 2: Can still make requests (separate limit)
      const response = await request(app)
        .post('/test')
        .send({ email: 'user2@example.com' });

      expect(response.status).toBe(200);

      // User 1: Should now be rate limited
      const rateLimitedResponse = await request(app)
        .post('/test')
        .send({ email: 'user1@example.com' });

      expect(rateLimitedResponse.status).toBe(429);
    });

    it('should use "unknown" key when credential field is missing', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 2 requests without email field
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/test')
          .send({ noEmail: 'value' });

        expect(response.status).toBe(200);
      }

      // Third request should be rate limited (all go to "unknown" key)
      const response = await request(app)
        .post('/test')
        .send({ noEmail: 'value' });

      expect(response.status).toBe(429);
    });

    it('should use "unknown" key when request body is missing', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 2 requests without body
      for (let i = 0; i < 2; i++) {
        const response = await request(app).post('/test');

        expect(response.status).toBe(200);
      }

      // Third request should be rate limited
      const response = await request(app).post('/test');

      expect(response.status).toBe(429);
    });
  });

  describe('credential-based keying behavior', () => {
    it('should rate limit each email independently', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Exhaust the limit for testuser@example.com
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post('/test')
          .send({ email: 'testuser@example.com' });
      }

      // A different email should still be allowed (separate bucket)
      const otherResponse = await request(app)
        .post('/test')
        .send({ email: 'other@example.com' });

      expect(otherResponse.status).toBe(200);

      // The original email should be blocked
      const blockedResponse = await request(app)
        .post('/test')
        .send({ email: 'testuser@example.com' });

      expect(blockedResponse.status).toBe(429);
    });

    it('should share one bucket across case and whitespace variants of the same email', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // First variant: mixed case
      const firstResponse = await request(app)
        .post('/test')
        .send({ email: 'Alice@x.com' });

      expect(firstResponse.status).toBe(200);

      // Second variant: surrounding whitespace
      const secondResponse = await request(app)
        .post('/test')
        .send({ email: ' alice@x.com ' });

      expect(secondResponse.status).toBe(200);

      // Third variant: canonical form — shares the normalized bucket, so blocked
      const blockedResponse = await request(app)
        .post('/test')
        .send({ email: 'alice@x.com' });

      expect(blockedResponse.status).toBe(429);

      // Control: a distinct address still gets its own bucket (no over-collapse)
      const distinctResponse = await request(app)
        .post('/test')
        .send({ email: 'bob@x.com' });

      expect(distinctResponse.status).toBe(200);
    });

    it('should share the unknown key for empty and missing credentials', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // First request with empty email — falsy, uses 'unknown' key
      const emptyResponse = await request(app)
        .post('/test')
        .send({ email: '' });

      expect(emptyResponse.status).toBe(200);

      // Second request with missing credential field — also uses 'unknown' key
      const missingResponse = await request(app)
        .post('/test')
        .send({ notEmail: 'value' });

      expect(missingResponse.status).toBe(200);

      // Third request should be blocked because both shared the 'unknown' bucket
      const blockedResponse = await request(app)
        .post('/test')
        .send({ notEmail: 'other-value' });

      expect(blockedResponse.status).toBe(429);
    });

    it('should coerce a non-string credential into its own isolated bucket', async () => {
      const limiter = createCredentialRateLimiter(
        1,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Exhaust the bucket for a legitimate string email.
      const firstStringResponse = await request(app)
        .post('/test')
        .send({ email: 'alice@x.com' });

      expect(firstStringResponse.status).toBe(200);

      const blockedStringResponse = await request(app)
        .post('/test')
        .send({ email: 'alice@x.com' });

      expect(blockedStringResponse.status).toBe(429);

      // A non-string credential is coerced to a deterministic key
      // (String({...}) === '[object Object]', normalized to '[object object]')
      // that is distinct from the exhausted string bucket — so it is still
      // allowed. This proves the String() guard yields an isolated key rather
      // than collapsing the non-string value into the string email's bucket.
      const objectResponse = await request(app)
        .post('/test')
        .send({ email: { inject: 'x' } });

      expect(objectResponse.status).toBe(200);
    });
  });

  describe('error response format', () => {
    it('should return 429 status code when limit exceeded', async () => {
      const limiter = createCredentialRateLimiter(
        1,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // First request succeeds
      await request(app)
        .post('/test')
        .send({ email: 'user@example.com' });

      // Second request should return 429
      const response = await request(app)
        .post('/test')
        .send({ email: 'user@example.com' });

      expect(response.status).toBe(429);
    });

    it('should return JSON error with correct structure', async () => {
      const limiter = createCredentialRateLimiter(
        1,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // First request succeeds
      await request(app)
        .post('/test')
        .send({ email: 'user@example.com' });

      // Second request should return error
      const response = await request(app)
        .post('/test')
        .send({ email: 'user@example.com' });

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe(
        'Too many test-endpoint requests for this email, please try again later.',
      );
      expect(response.body).toHaveProperty('errorName', 'RateLimitError');
    });

    it('should include rate limit headers', async () => {
      const limiter = createCredentialRateLimiter(
        2,
        60000,
        'test-endpoint',
        'email',
      );

      router.post('/test', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      const response = await request(app)
        .post('/test')
        .send({ email: 'user@example.com' });

      // Verify rate limit headers are present
      expect(response.headers['ratelimit-limit']).toBe('2');
      expect(response.headers['ratelimit-remaining']).toBeDefined();
      expect(response.headers['ratelimit-reset']).toBeDefined();
    });
  });

  describe('configuration examples from config', () => {
    it('should work with password reset config (3 requests per hour per email)', async () => {
      // Use actual config values for password reset
      const limiter = createCredentialRateLimiter(
        3,              // max: 3 requests
        3600000,        // windowMs: 1 hour
        'password-reset',
        'email',
      );

      router.post('/reset', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 3 requests - should all succeed
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/reset')
          .send({ email: 'user@example.com' });

        expect(response.status).toBe(200);
      }

      // 4th request should be rate limited
      const response = await request(app)
        .post('/reset')
        .send({ email: 'user@example.com' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe(
        'Too many password reset requests for this email, please try again later.',
      );
    });

    it('should work with login config (5 requests per hour per email)', async () => {
      // Use actual config values for login
      const limiter = createCredentialRateLimiter(
        5,              // max: 5 requests
        3600000,        // windowMs: 1 hour
        'login',
        'email',
      );

      router.post('/login', limiter, (req, res) => {
        res.status(200).json({ success: true });
      });

      const app = testApp(router);

      // Make 5 requests - should all succeed
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/login')
          .send({ email: 'user@example.com' });

        expect(response.status).toBe(200);
      }

      // 6th request should be rate limited
      const response = await request(app)
        .post('/login')
        .send({ email: 'user@example.com' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe(
        'Too many login requests for this email, please try again later.',
      );
    });
  });
});
