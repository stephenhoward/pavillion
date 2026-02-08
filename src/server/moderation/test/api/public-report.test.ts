import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { testApp } from '@/server/common/test/lib/express';
import PublicReportRoutes from '@/server/moderation/api/v1/public-report-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { DuplicateReportError } from '@/common/exceptions/report';
import { EmailRateLimitError } from '@/server/moderation/exceptions';

describe('Public Report API - POST /events/:eventId/reports', () => {
  let routes: PublicReportRoutes;
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
    routes = new PublicReportRoutes(moderationInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('successful report submission', () => {
    it('should return 201 with reportId and verification message', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.status = ReportStatus.PENDING_VERIFICATION;

      const createReportStub = sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'This is spam',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.reportId).toBe('report-id-1');
      expect(response.body.message).toBeDefined();
      expect(createReportStub.calledOnce).toBe(true);

      const callArgs = createReportStub.firstCall.args[0];
      expect(callArgs.eventId).toBe('event-1');
      expect(callArgs.category).toBe(ReportCategory.SPAM);
      expect(callArgs.description).toBe('This is spam');
      expect(callArgs.reporterEmail).toBe('reporter@example.com');
      expect(callArgs.reporterType).toBe('anonymous');
    });
  });

  describe('request validation - 400 errors', () => {
    it('should return 400 when category is missing', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          description: 'Missing category',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when category is invalid', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'not_a_valid_category',
          description: 'Invalid category',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when description is missing', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when description is empty', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: '   ',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when description exceeds 2000 characters', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const longDescription = 'a'.repeat(2001);

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: longDescription,
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('2000 characters or fewer');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should accept a description of exactly 2000 characters', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'a'.repeat(2000);
      report.status = ReportStatus.PENDING_VERIFICATION;

      sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const exactDescription = 'a'.repeat(2000);

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: exactDescription,
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(201);
    });

    it('should return 400 when email is missing', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Missing email',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when email format is invalid', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Bad email',
          email: 'not-an-email',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when email exceeds 254 characters', async () => {
      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const longEmail = 'a'.repeat(250) + '@test.com';

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Bad email length',
          email: longEmail,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('254 characters or fewer');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should accept an email of exactly 254 characters', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'Email length test';
      report.status = ReportStatus.PENDING_VERIFICATION;

      sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const exactEmail = 'a'.repeat(244) + '@test.com';

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Valid email length',
          email: exactEmail,
        });

      expect(response.status).toBe(201);
    });
  });

  describe('event not found - 404', () => {
    it('should return 404 when event does not exist', async () => {
      sandbox.stub(moderationInterface, 'createReportForEvent').rejects(new EventNotFoundError());

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/nonexistent-event/reports')
        .send({
          category: 'spam',
          description: 'Event does not exist',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('EventNotFoundError');
    });
  });

  describe('duplicate report - 409', () => {
    it('should return 409 when reporter has already reported the event', async () => {
      sandbox.stub(moderationInterface, 'createReportForEvent').rejects(new DuplicateReportError());

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Duplicate report',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('DuplicateReportError');
    });
  });

  describe('per-email rate limit - 429', () => {
    it('should return 429 when email has exceeded rate limit', async () => {
      sandbox.stub(moderationInterface, 'createReportForEvent').rejects(new EmailRateLimitError());

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Too many reports',
          email: 'spammer@example.com',
        });

      expect(response.status).toBe(429);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('EmailRateLimitError');
    });

    it('should include appropriate error message for rate limited responses', async () => {
      sandbox.stub(moderationInterface, 'createReportForEvent').rejects(new EmailRateLimitError());

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Rate limited',
          email: 'limited@example.com',
        });

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many reports');
      expect(response.body.errorName).toBe('EmailRateLimitError');
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
        report.status = ReportStatus.PENDING_VERIFICATION;

        sandbox.stub(moderationInterface, 'createReportForEvent').resolves(report);

        router.post('/events/:eventId/reports', (req, res) => {
          routes.submitReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/events/event-1/reports')
          .send({
            category,
            description: `Report for ${category}`,
            email: 'reporter@example.com',
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

      router.post('/events/:eventId/reports', (req, res) => {
        routes.submitReport(req, res);
      });

      const response = await request(testApp(router))
        .post('/events/event-1/reports')
        .send({
          category: 'spam',
          description: 'Some report',
          email: 'reporter@example.com',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('route installation', () => {
    it('should install the report route handler', () => {
      const app = express();
      routes.installHandlers(app, '/api/public/v1');

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
  });
});
