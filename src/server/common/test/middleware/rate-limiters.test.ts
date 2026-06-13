import { describe, it, expect, beforeEach } from 'vitest';
import config from 'config';
import express, { Express } from 'express';
import request from 'supertest';
import { addRequestUser } from '@/server/common/test/lib/express';
import {
  limitPasswordResetByIp,
  limitPasswordResetByEmail,
  limitLoginByIp,
  limitLoginByEmail,
  limitReportSubmissionByIp,
  limitReportSubmissionByEmail,
  limitReportVerificationByIp,
  limitReportSubmissionByAccount,
  limitPublicEventInstanceByIp,
  limitPublicCalendarListByIp,
  limitApplicationByIp,
  limitApplicationByEmail,
  limitConfirmApplicationByIp,
} from '@/server/common/middleware/rate-limiters';

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

    it('should use correct config values for public event instance by IP', () => {
      const maxRequests = config.get<number>('rateLimit.publicEventInstance.byIp.max');
      const windowMs = config.get<number>('rateLimit.publicEventInstance.byIp.windowMs');

      expect(maxRequests).toBe(120);
      expect(windowMs).toBe(900000); // 15 minutes
    });

    it('should use correct config values for public calendar list by IP', () => {
      const maxRequests = config.get<number>('rateLimit.publicCalendarList.byIp.max');
      const windowMs = config.get<number>('rateLimit.publicCalendarList.byIp.windowMs');

      expect(maxRequests).toBe(60);
      expect(windowMs).toBe(60000); // 1 minute
    });

    it('should use correct config values for application by IP', () => {
      const maxRequests = config.get<number>('rateLimit.application.byIp.max');
      const windowMs = config.get<number>('rateLimit.application.byIp.windowMs');

      expect(maxRequests).toBe(5);
      expect(windowMs).toBe(900000); // 15 minutes
    });

    it('should use correct config values for application by email', () => {
      const maxRequests = config.get<number>('rateLimit.application.byEmail.max');
      const windowMs = config.get<number>('rateLimit.application.byEmail.windowMs');

      expect(maxRequests).toBe(3);
      expect(windowMs).toBe(3600000); // 1 hour
    });

    it('should use correct config values for application confirm by IP', () => {
      const maxRequests = config.get<number>('rateLimit.application.confirm.byIp.max');
      const windowMs = config.get<number>('rateLimit.application.confirm.byIp.windowMs');

      expect(maxRequests).toBe(20);
      expect(windowMs).toBe(900000); // 15 minutes
    });

    it('should check if rate limiting is enabled in config', () => {
      const enabled = config.get<boolean>('rateLimit.enabled');
      // In test environment, rate limiting is disabled
      expect(enabled).toBe(false);
    });
  });

  describe('limiter exports', () => {
    it('should export limitPasswordResetByIp limiter', () => {
      expect(limitPasswordResetByIp).toBeDefined();
      expect(typeof limitPasswordResetByIp).toBe('function');
    });

    it('should export limitPasswordResetByEmail limiter', () => {
      expect(limitPasswordResetByEmail).toBeDefined();
      expect(typeof limitPasswordResetByEmail).toBe('function');
    });

    it('should export limitLoginByIp limiter', () => {
      expect(limitLoginByIp).toBeDefined();
      expect(typeof limitLoginByIp).toBe('function');
    });

    it('should export limitLoginByEmail limiter', () => {
      expect(limitLoginByEmail).toBeDefined();
      expect(typeof limitLoginByEmail).toBe('function');
    });

    it('should export limitReportSubmissionByIp limiter', () => {
      expect(limitReportSubmissionByIp).toBeDefined();
      expect(typeof limitReportSubmissionByIp).toBe('function');
    });

    it('should export limitReportSubmissionByEmail limiter', () => {
      expect(limitReportSubmissionByEmail).toBeDefined();
      expect(typeof limitReportSubmissionByEmail).toBe('function');
    });

    it('should export limitReportVerificationByIp limiter', () => {
      expect(limitReportVerificationByIp).toBeDefined();
      expect(typeof limitReportVerificationByIp).toBe('function');
    });

    it('should export limitReportSubmissionByAccount limiter', () => {
      expect(limitReportSubmissionByAccount).toBeDefined();
      expect(typeof limitReportSubmissionByAccount).toBe('function');
    });

    it('should export limitPublicEventInstanceByIp limiter', () => {
      expect(limitPublicEventInstanceByIp).toBeDefined();
      expect(typeof limitPublicEventInstanceByIp).toBe('function');
    });

    it('should export limitPublicCalendarListByIp limiter', () => {
      expect(limitPublicCalendarListByIp).toBeDefined();
      expect(typeof limitPublicCalendarListByIp).toBe('function');
    });

    it('should export limitApplicationByIp limiter', () => {
      expect(limitApplicationByIp).toBeDefined();
      expect(typeof limitApplicationByIp).toBe('function');
    });

    it('should export limitApplicationByEmail limiter', () => {
      expect(limitApplicationByEmail).toBeDefined();
      expect(typeof limitApplicationByEmail).toBe('function');
    });

    it('should export limitConfirmApplicationByIp limiter', () => {
      expect(limitConfirmApplicationByIp).toBeDefined();
      expect(typeof limitConfirmApplicationByIp).toBe('function');
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
      app.post('/test', limitPasswordResetByIp, (req, res) => {
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
      app.post('/test', limitPasswordResetByIp, (req, res) => {
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
        limitPasswordResetByIp,
        limitPasswordResetByEmail,
        limitLoginByIp,
        limitLoginByEmail,
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
        limitReportSubmissionByIp,
        limitReportSubmissionByEmail,
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
        limitReportSubmissionByAccount,
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
      app.get('/test', limitReportVerificationByIp, (req, res) => {
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

    it('should apply limitPasswordResetByIp limiter to endpoint', async () => {
      app.post('/reset', limitPasswordResetByIp, (req, res) => {
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

    it('should apply limitPasswordResetByEmail limiter to endpoint', async () => {
      app.post('/reset', limitPasswordResetByEmail, (req, res) => {
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

    it('should apply limitLoginByIp limiter to endpoint', async () => {
      app.post('/login', limitLoginByIp, (req, res) => {
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

    it('should apply limitLoginByEmail limiter to endpoint', async () => {
      app.post('/login', limitLoginByEmail, (req, res) => {
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

    it('should apply limitReportSubmissionByIp limiter to endpoint', async () => {
      app.post('/report', limitReportSubmissionByIp, (req, res) => {
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

    it('should apply limitReportVerificationByIp limiter to endpoint', async () => {
      app.get('/verify', limitReportVerificationByIp, (req, res) => {
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

    it('should apply limitReportSubmissionByEmail limiter to endpoint', async () => {
      app.post('/report', limitReportSubmissionByEmail, (req, res) => {
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

    it('should apply limitReportSubmissionByAccount limiter to endpoint', async () => {
      app.post('/report', addRequestUser, limitReportSubmissionByAccount, (req, res) => {
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
      app.post('/reset', limitPasswordResetByIp, limitPasswordResetByEmail, (req, res) => {
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
      app.post('/report', limitReportSubmissionByIp, limitReportSubmissionByEmail, (req, res) => {
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

    it('should apply limitPublicEventInstanceByIp limiter to endpoint', async () => {
      app.get('/instance', limitPublicEventInstanceByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/instance');
      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply limitPublicCalendarListByIp limiter to endpoint', async () => {
      app.get('/calendars', limitPublicCalendarListByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/calendars');
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
      app.post('/report', addRequestUser, limitReportSubmissionByIp, limitReportSubmissionByAccount, (req, res) => {
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

    it('should apply limitApplicationByIp limiter to endpoint', async () => {
      app.post('/apply', limitApplicationByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).post('/apply');
      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should apply limitApplicationByEmail limiter to endpoint', async () => {
      app.post('/apply', limitApplicationByEmail, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/apply')
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

    it('should apply limitConfirmApplicationByIp limiter to endpoint', async () => {
      app.get('/confirm', limitConfirmApplicationByIp, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/confirm');
      expect(response.status).toBe(200);

      if (config.get<boolean>('rateLimit.enabled')) {
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
      }
      else {
        expect(response.headers['ratelimit-limit']).toBeUndefined();
      }
    });

    it('should allow combining application IP and email limiters', async () => {
      app.post('/apply', limitApplicationByIp, limitApplicationByEmail, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/apply')
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
  });
});
