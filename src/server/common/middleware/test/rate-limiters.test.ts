import { describe, it, expect, beforeEach } from 'vitest';
import config from 'config';
import express, { Express } from 'express';
import request from 'supertest';
import { addRequestUser } from '@/server/common/test/lib/express';
import {
  passwordResetByIp,
  passwordResetByEmail,
  loginByIp,
  loginByEmail,
  reportSubmissionByIp,
  reportSubmissionByEmail,
  reportVerificationByIp,
  reportSubmissionByAccount,
} from '../rate-limiters';

describe('rate-limiters', () => {
  describe('configuration values', () => {
    it('should use correct config values for password reset by IP', () => {
      const maxRequests = config.get<number>('rateLimit.passwordReset.byIp.max');
      const windowMs = config.get<number>('rateLimit.passwordReset.byIp.windowMs');

      expect(maxRequests).toBe(5);
      expect(windowMs).toBe(900000); // 15 minutes
    });

    it('should use correct config values for password reset by email', () => {
      const maxRequests = config.get<number>('rateLimit.passwordReset.byEmail.max');
      const windowMs = config.get<number>('rateLimit.passwordReset.byEmail.windowMs');

      expect(maxRequests).toBe(3);
      expect(windowMs).toBe(3600000); // 1 hour
    });

    it('should use correct config values for login by IP', () => {
      const maxRequests = config.get<number>('rateLimit.login.byIp.max');
      const windowMs = config.get<number>('rateLimit.login.byIp.windowMs');

      expect(maxRequests).toBe(10);
      expect(windowMs).toBe(900000); // 15 minutes
    });

    it('should use correct config values for login by email', () => {
      const maxRequests = config.get<number>('rateLimit.login.byEmail.max');
      const windowMs = config.get<number>('rateLimit.login.byEmail.windowMs');

      expect(maxRequests).toBe(5);
      expect(windowMs).toBe(3600000); // 1 hour
    });

    it('should use correct config values for moderation report submission by IP', () => {
      const maxRequests = config.get<number>('rateLimit.moderation.reportByIp.max');
      const windowMs = config.get<number>('rateLimit.moderation.reportByIp.windowMs');

      expect(maxRequests).toBe(10);
      expect(windowMs).toBe(900000); // 15 minutes
    });

    it('should use correct config values for moderation report verification by IP', () => {
      const maxRequests = config.get<number>('rateLimit.moderation.verifyByIp.max');
      const windowMs = config.get<number>('rateLimit.moderation.verifyByIp.windowMs');

      expect(maxRequests).toBe(20);
      expect(windowMs).toBe(900000); // 15 minutes
    });

    it('should use correct config values for moderation report submission by email', () => {
      const maxRequests = config.get<number>('rateLimit.moderation.byEmail.max');
      const windowMs = config.get<number>('rateLimit.moderation.byEmail.windowMs');

      expect(maxRequests).toBe(3);
      expect(windowMs).toBe(86400000); // 24 hours
    });

    it('should use correct config values for moderation report submission by account', () => {
      const maxRequests = config.get<number>('rateLimit.moderation.byAccount.max');
      const windowMs = config.get<number>('rateLimit.moderation.byAccount.windowMs');

      expect(maxRequests).toBe(20);
      expect(windowMs).toBe(3600000); // 1 hour
    });

    it('should check if rate limiting is enabled in config', () => {
      const enabled = config.get<boolean>('rateLimit.enabled');
      // In test environment, rate limiting is disabled
      expect(enabled).toBe(false);
    });
  });

  describe('limiter exports', () => {
    it('should export passwordResetByIp limiter', () => {
      expect(passwordResetByIp).toBeDefined();
      expect(typeof passwordResetByIp).toBe('function');
    });

    it('should export passwordResetByEmail limiter', () => {
      expect(passwordResetByEmail).toBeDefined();
      expect(typeof passwordResetByEmail).toBe('function');
    });

    it('should export loginByIp limiter', () => {
      expect(loginByIp).toBeDefined();
      expect(typeof loginByIp).toBe('function');
    });

    it('should export loginByEmail limiter', () => {
      expect(loginByEmail).toBeDefined();
      expect(typeof loginByEmail).toBe('function');
    });

    it('should export reportSubmissionByIp limiter', () => {
      expect(reportSubmissionByIp).toBeDefined();
      expect(typeof reportSubmissionByIp).toBe('function');
    });

    it('should export reportSubmissionByEmail limiter', () => {
      expect(reportSubmissionByEmail).toBeDefined();
      expect(typeof reportSubmissionByEmail).toBe('function');
    });

    it('should export reportVerificationByIp limiter', () => {
      expect(reportVerificationByIp).toBeDefined();
      expect(typeof reportVerificationByIp).toBe('function');
    });

    it('should export reportSubmissionByAccount limiter', () => {
      expect(reportSubmissionByAccount).toBeDefined();
      expect(typeof reportSubmissionByAccount).toBe('function');
    });
  });

  describe('enabled/disabled behavior', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should return no-op middleware when disabled', async () => {
      // In test environment, rate limiting is disabled (test.yaml)
      expect(config.get<boolean>('rateLimit.enabled')).toBe(false);

      // When disabled, limiters should act as no-op middleware
      // Multiple requests should all succeed without rate limiting
      app.post('/test', passwordResetByIp, (req, res) => {
        res.json({ success: true });
      });

      // Make many requests - all should succeed since rate limiting is disabled
      const responses = await Promise.all([
        request(app).post('/test'),
        request(app).post('/test'),
        request(app).post('/test'),
        request(app).post('/test'),
        request(app).post('/test'),
        request(app).post('/test'),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      });
    });

    it('should not add rate limit headers when disabled', async () => {
      // When rate limiting is disabled, no rate limit headers should be added
      app.post('/test', passwordResetByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).post('/test');
      expect(response.status).toBe(200);

      // No rate limit headers when disabled
      expect(response.headers['ratelimit-limit']).toBeUndefined();
      expect(response.headers['ratelimit-remaining']).toBeUndefined();
    });

    it('should allow all limiter types to pass through when disabled', async () => {
      // Apply all four limiters - should all be no-ops
      app.post('/test',
        passwordResetByIp,
        passwordResetByEmail,
        loginByIp,
        loginByEmail,
        (req, res) => {
          res.json({ success: true });
        },
      );

      const response = await request(app)
        .post('/test')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });

    it('should allow moderation limiters to pass through when disabled', async () => {
      app.post('/test',
        reportSubmissionByIp,
        reportSubmissionByEmail,
        (req, res) => {
          res.json({ success: true });
        },
      );

      const responses = await Promise.all([
        request(app).post('/test').send({ email: 'test@example.com' }),
        request(app).post('/test').send({ email: 'test@example.com' }),
        request(app).post('/test').send({ email: 'test@example.com' }),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      });
    });

    it('should allow account limiter to pass through when disabled', async () => {
      app.post('/test',
        addRequestUser,
        reportSubmissionByAccount,
        (req, res) => {
          res.json({ success: true });
        },
      );

      const responses = await Promise.all([
        request(app).post('/test').send({ data: 'test' }),
        request(app).post('/test').send({ data: 'test' }),
        request(app).post('/test').send({ data: 'test' }),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      });
    });

    it('should allow verification limiter to pass through when disabled', async () => {
      app.get('/test', reportVerificationByIp, (req, res) => {
        res.json({ success: true });
      });

      const responses = await Promise.all([
        request(app).get('/test'),
        request(app).get('/test'),
        request(app).get('/test'),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      });
    });
  });

  describe('functional behavior', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should apply passwordResetByIp limiter to endpoint', async () => {
      app.post('/reset', passwordResetByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).post('/reset');
      expect(response.status).toBe(200);

      // In test environment (disabled), no headers expected
      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply passwordResetByEmail limiter to endpoint', async () => {
      app.post('/reset', passwordResetByEmail, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/reset')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);

      // In test environment (disabled), no headers expected
      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply loginByIp limiter to endpoint', async () => {
      app.post('/login', loginByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).post('/login');
      expect(response.status).toBe(200);

      // In test environment (disabled), no headers expected
      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply loginByEmail limiter to endpoint', async () => {
      app.post('/login', loginByEmail, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/login')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);

      // In test environment (disabled), no headers expected
      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply reportSubmissionByIp limiter to endpoint', async () => {
      app.post('/report', reportSubmissionByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).post('/report');
      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply reportVerificationByIp limiter to endpoint', async () => {
      app.get('/verify', reportVerificationByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/verify');
      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply reportSubmissionByEmail limiter to endpoint', async () => {
      app.post('/report', reportSubmissionByEmail, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/report')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply reportSubmissionByAccount limiter to endpoint', async () => {
      app.post('/report', addRequestUser, reportSubmissionByAccount, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/report')
        .send({ data: 'test' });

      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should allow combining IP and credential limiters', async () => {
      app.post('/reset', passwordResetByIp, passwordResetByEmail, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/reset')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);

      // In test environment (disabled), no headers expected
      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should allow combining report submission IP and email limiters', async () => {
      app.post('/report', reportSubmissionByIp, reportSubmissionByEmail, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/report')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should allow combining report submission IP and account limiters', async () => {
      app.post('/report', addRequestUser, reportSubmissionByIp, reportSubmissionByAccount, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/report')
        .send({ data: 'test' });

      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });
  });
});
