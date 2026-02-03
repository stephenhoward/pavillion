import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { testApp } from '@/server/common/test/lib/express';
import { createCredentialRateLimiter } from '../rate-limit-by-credential';

describe('createCredentialRateLimiter', () => {
  let router: express.Router;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let consoleWarnSpy: any;

  beforeEach(() => {
    router = express.Router();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    sandbox.restore();
    consoleWarnSpy.mockRestore();
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

  describe('logging with credential redaction', () => {
    it('should log with redacted email when limit is exceeded', async () => {
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
        .send({ email: 'testuser@example.com' });

      // Second request is rate limited
      await request(app)
        .post('/test')
        .send({ email: 'testuser@example.com' });

      // Verify console.warn was called with redacted email
      // redactEmail keeps first 2 chars + *** + @ + full domain
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Rate limit exceeded for te***@example.com on test-endpoint',
      );
    });

    it('should log with redacted short email when limit is exceeded', async () => {
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
        .send({ email: 'ab@x.co' });

      // Second request is rate limited
      await request(app)
        .post('/test')
        .send({ email: 'ab@x.co' });

      // Verify console.warn was called with redacted short email
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Rate limit exceeded for ab***@x.co on test-endpoint',
      );
    });

    it('should log "unknown" when credential is invalid', async () => {
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
        .send({ email: 'not-an-email' });

      // Second request is rate limited
      await request(app)
        .post('/test')
        .send({ email: 'not-an-email' });

      // Verify console.warn was called with "unknown"
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Rate limit exceeded for unknown on test-endpoint',
      );
    });

    it('should log "unknown" when credential field is missing', async () => {
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
        .send({ notEmail: 'value' });

      // Second request is rate limited
      await request(app)
        .post('/test')
        .send({ notEmail: 'value' });

      // Verify console.warn was called with "unknown"
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Rate limit exceeded for unknown on test-endpoint',
      );
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
