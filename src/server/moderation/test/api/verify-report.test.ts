import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { testApp } from '@/server/common/test/lib/express';
import VerifyRoutes from '@/server/moderation/api/v1/verify-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import { InvalidVerificationTokenError } from '@/server/moderation/exceptions';

describe('Verify Report API - GET /reports/verify/:token', () => {
  let routes: VerifyRoutes;
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
    routes = new VerifyRoutes(moderationInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('successful verification - 200', () => {
    it('should return 200 with confirmation message on valid token', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.status = ReportStatus.SUBMITTED;

      const verifyStub = sandbox.stub(moderationInterface, 'verifyReport').resolves(report);

      router.get('/reports/verify/:token', (req, res) => {
        routes.verifyToken(req, res);
      });

      const response = await request(testApp(router))
        .get('/reports/verify/valid-token-abc123');

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();
      expect(response.body.reportId).toBe('report-id-1');
      expect(verifyStub.calledOnce).toBe(true);
      expect(verifyStub.calledWith('valid-token-abc123')).toBe(true);
    });
  });

  describe('invalid or expired token - 400', () => {
    it('should return 400 when token is expired', async () => {
      const error = new InvalidVerificationTokenError('Verification token is invalid or has expired');
      sandbox.stub(moderationInterface, 'verifyReport').rejects(error);

      router.get('/reports/verify/:token', (req, res) => {
        routes.verifyToken(req, res);
      });

      const response = await request(testApp(router))
        .get('/reports/verify/expired-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(response.body.errorName).toBe('InvalidVerificationTokenError');
    });

    it('should return 400 when token is invalid', async () => {
      sandbox.stub(moderationInterface, 'verifyReport').rejects(
        new InvalidVerificationTokenError(),
      );

      router.get('/reports/verify/:token', (req, res) => {
        routes.verifyToken(req, res);
      });

      const response = await request(testApp(router))
        .get('/reports/verify/invalid-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('server error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      sandbox.stub(moderationInterface, 'verifyReport').rejects(
        new Error('Database connection failed'),
      );

      router.get('/reports/verify/:token', (req, res) => {
        routes.verifyToken(req, res);
      });

      const response = await request(testApp(router))
        .get('/reports/verify/some-token');

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('route installation', () => {
    it('should install the verify route handler', () => {
      const app = express();
      routes.installHandlers(app, '/api/public/v1');

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
