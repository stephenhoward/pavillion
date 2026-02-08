import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { Account } from '@/common/model/account';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import AuthenticatedReportRoutes from '@/server/moderation/api/v1/authenticated-report-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { DuplicateReportError } from '@/common/exceptions/report';
import { createAccountRateLimiter } from '@/server/common/middleware/rate-limit-by-account';
import { createIpRateLimiter } from '@/server/common/middleware/rate-limit-by-ip';

describe('Authenticated Report API - POST /reports', () => {
  let routes: AuthenticatedReportRoutes;
  let router: express.Router;
  let moderationInterface: ModerationInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    const calendarInterface = new CalendarInterface(new EventEmitter());
    const accountsInterface = new AccountsInterface(new EventEmitter());
    const emailInterface = new EmailInterface();
    moderationInterface = new ModerationInterface(
      new EventEmitter(),
      calendarInterface,
      accountsInterface,
      emailInterface,
    );
    routes = new AuthenticatedReportRoutes(moderationInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('successful report submission', () => {
    it('should return 201 with report object', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.reporterType = 'authenticated';
      report.reporterAccountId = 'id';
      report.status = ReportStatus.SUBMITTED;

      const createReportStub = sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'This is spam',
        });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Report submitted successfully.');
      expect(response.body.report).toBeDefined();
      expect(response.body.report.id).toBe('report-id-1');
      expect(response.body.report.status).toBe('submitted');
      expect(createReportStub.calledOnce).toBe(true);

      const callArgs = createReportStub.firstCall.args[0];
      expect(callArgs.eventId).toBe('event-1');
      expect(callArgs.category).toBe(ReportCategory.SPAM);
      expect(callArgs.description).toBe('This is spam');
      expect(callArgs.reporterAccountId).toBe('id');
      expect(callArgs.reporterType).toBe('authenticated');
    });

    it('should not leak sensitive fields in the response', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.reporterType = 'authenticated';
      report.reporterAccountId = 'account-id-1';
      report.reporterEmailHash = 'hash-abc123';
      report.verificationToken = 'secret-token';
      report.verificationExpiration = new Date('2026-02-09T10:00:00Z');
      report.adminNotes = 'Admin notes here';
      report.adminId = 'admin-id-1';
      report.reviewerId = 'reviewer-id-1';
      report.reviewerNotes = 'Reviewer notes here';
      report.status = ReportStatus.SUBMITTED;

      sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'This is spam',
        });

      expect(response.status).toBe(201);

      const reportObj = response.body.report;

      // Verify only reporter-safe fields are present
      expect(Object.keys(reportObj).sort()).toEqual(
        ['category', 'createdAt', 'description', 'eventId', 'id', 'status'],
      );

      // Explicitly verify sensitive fields are absent
      expect(reportObj).not.toHaveProperty('verificationToken');
      expect(reportObj).not.toHaveProperty('verificationExpiration');
      expect(reportObj).not.toHaveProperty('reporterEmailHash');
      expect(reportObj).not.toHaveProperty('reporterAccountId');
      expect(reportObj).not.toHaveProperty('adminNotes');
      expect(reportObj).not.toHaveProperty('adminId');
      expect(reportObj).not.toHaveProperty('reviewerId');
      expect(reportObj).not.toHaveProperty('reviewerNotes');
      expect(reportObj).not.toHaveProperty('ownerNotes');
      expect(reportObj).not.toHaveProperty('calendarId');
    });
  });

  describe('unauthenticated requests - 403', () => {
    it('should return 403 when no user is present', async () => {
      router.post('/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'This is spam',
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('request validation - 400 errors', () => {
    it('should return 400 when eventId is missing', async () => {
      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          category: 'spam',
          description: 'Missing eventId',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when category is missing', async () => {
      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          description: 'Missing category',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when category is invalid', async () => {
      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'not_a_valid_category',
          description: 'Invalid category',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when description is missing', async () => {
      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when description is empty whitespace', async () => {
      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: '   ',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when description exceeds 2000 characters', async () => {
      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const longDescription = 'a'.repeat(2001);

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: longDescription,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('2000 characters or fewer');
      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('event not found - 404', () => {
    it('should return 404 when event does not exist', async () => {
      sandbox.stub(moderationInterface, 'createReportForEvent').rejects(new EventNotFoundError());

      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'nonexistent-event',
          category: 'spam',
          description: 'Event does not exist',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('EventNotFoundError');
    });
  });

  describe('duplicate report - 409', () => {
    it('should return 409 when reporter has already reported the event', async () => {
      sandbox.stub(moderationInterface, 'createReportForEvent').rejects(new DuplicateReportError());

      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'Duplicate report',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('DuplicateReportError');
    });
  });

  describe('all valid report categories', () => {
    const validCategories = ['spam', 'inappropriate', 'misleading', 'harassment', 'other'];

    for (const category of validCategories) {
      it(`should accept category "${category}"`, async () => {
        const report = new Report('report-id-1');
        report.eventId = 'event-1';
        report.calendarId = 'calendar-1';
        report.category = category as ReportCategory;
        report.description = `Report for ${category}`;
        report.reporterType = 'authenticated';
        report.status = ReportStatus.SUBMITTED;

        sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

        router.post('/reports', addRequestUser, (req, res) => {
          routes.submitReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/reports')
          .send({
            eventId: 'event-1',
            category,
            description: `Report for ${category}`,
          });

        expect(response.status).toBe(201);

        // Restore stubs for next iteration
        sandbox.restore();
      });
    }
  });

  describe('server error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      sandbox.stub(moderationInterface, 'createReportForEvent').rejects(new Error('Database connection failed'));

      router.post('/reports', addRequestUser, (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'Some report',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('route installation', () => {
    it('should install the report route handler', () => {
      const app = express();
      routes.installHandlers(app, '/api/v1');

      // Verify routes are mounted by checking the router stack
      let routeCount = 0;
      if (app._router && app._router.stack) {
        app._router.stack.forEach((middleware: any) => {
          if (middleware.name === 'router') {
            middleware.handle.stack.forEach((handler: any) => {
              if (handler.route) {
                routeCount++;
              }
            });
          }
        });
      }
      expect(routeCount).toBeGreaterThan(0);
    });

    it('should include rate limiting middleware in the route stack', () => {
      const app = express();
      routes.installHandlers(app, '/api/v1');

      // Find the router middleware and count the handlers on the POST /reports route
      let routeHandlerCount = 0;
      if (app._router && app._router.stack) {
        app._router.stack.forEach((middleware: any) => {
          if (middleware.name === 'router') {
            middleware.handle.stack.forEach((handler: any) => {
              if (handler.route && handler.route.path === '/reports') {
                routeHandlerCount = handler.route.stack.length;
              }
            });
          }
        });
      }

      // Route should have multiple handlers: loggedInOnly middleware(s),
      // reportSubmissionByIp, reportSubmissionByAccount, and submitReport handler
      // With rate limiting disabled (test env), no-op middleware still counts
      expect(routeHandlerCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe('rate limiting - IP based', () => {
    it('should return 429 when IP rate limit is exceeded', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.reporterType = 'authenticated';
      report.status = ReportStatus.SUBMITTED;

      sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      // Create IP rate limiter with low limit for testing
      const ipLimiter = createIpRateLimiter(2, 60000, 'report-submission');

      router.post('/reports', addRequestUser, ipLimiter, (req, res) => {
        routes.submitReport(req, res);
      });

      const app = testApp(router);

      // First 2 requests should succeed
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/reports')
          .send({
            eventId: 'event-1',
            category: 'spam',
            description: 'This is spam',
          });

        expect(response.status).toBe(201);
      }

      // Third request should be rate limited
      const response = await request(app)
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'This is spam',
        });

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many report-submission requests from this IP');
    });
  });

  describe('rate limiting - per account', () => {
    it('should return 429 when account rate limit is exceeded', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.reporterType = 'authenticated';
      report.status = ReportStatus.SUBMITTED;

      sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      // Create account rate limiter with low limit for testing
      const accountLimiter = createAccountRateLimiter(2, 60000, 'report-submission');

      router.post('/reports', addRequestUser, accountLimiter, (req, res) => {
        routes.submitReport(req, res);
      });

      const app = testApp(router);

      // First 2 requests should succeed
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/reports')
          .send({
            eventId: 'event-1',
            category: 'spam',
            description: 'This is spam',
          });

        expect(response.status).toBe(201);
      }

      // Third request should be rate limited
      const response = await request(app)
        .post('/reports')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'This is spam',
        });

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many report-submission requests for this account');
    });

    it('should track rate limits per account separately', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.reporterType = 'authenticated';
      report.status = ReportStatus.SUBMITTED;

      sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      const accountLimiter = createAccountRateLimiter(2, 60000, 'report-submission');

      // Middleware that sets different user per request based on header
      const setUser = (req: express.Request, _res: express.Response, next: express.NextFunction): void => {
        const userId = req.headers['x-test-user-id'] as string || 'default-id';
        req.user = new Account(userId, 'testuser', 'test@test.com');
        next();
      };

      router.post('/reports', setUser, accountLimiter, (req, res) => {
        routes.submitReport(req, res);
      });

      const app = testApp(router);

      // User 1: Make 2 requests (exhausts their limit)
      for (let i = 0; i < 2; i++) {
        const response = await request(app)
          .post('/reports')
          .set('x-test-user-id', 'user-1')
          .send({
            eventId: 'event-1',
            category: 'spam',
            description: 'This is spam',
          });

        expect(response.status).toBe(201);
      }

      // User 2: Should still succeed (separate rate limit bucket)
      const user2Response = await request(app)
        .post('/reports')
        .set('x-test-user-id', 'user-2')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'This is spam',
        });

      expect(user2Response.status).toBe(201);

      // User 1: Should be rate limited
      const rateLimitedResponse = await request(app)
        .post('/reports')
        .set('x-test-user-id', 'user-1')
        .send({
          eventId: 'event-1',
          category: 'spam',
          description: 'This is spam',
        });

      expect(rateLimitedResponse.status).toBe(429);
    });
  });
});
