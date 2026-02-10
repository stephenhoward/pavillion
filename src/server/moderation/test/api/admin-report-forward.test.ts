import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { CalendarEvent } from '@/common/model/events';
import { Account } from '@/common/model/account';
import { testApp } from '@/server/common/test/lib/express';
import AdminReportRoutes from '@/server/moderation/api/v1/admin-report-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import {
  ReportNotFoundError,
} from '@/server/moderation/exceptions';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';

/** Valid UUID v4 test identifiers. */
const TEST_REPORT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const TEST_EVENT_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const TEST_CALENDAR_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const NONEXISTENT_REPORT_ID = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';

/**
 * Middleware that attaches an admin user to the request.
 */
function addAdminUser(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const account = new Account('admin-id', 'admin', 'admin@test.com');
  account.roles = ['admin'];
  req.user = account;
  next();
}

/**
 * Middleware that attaches a non-admin user to the request.
 */
function addRegularUser(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const account = new Account('user-id', 'regular', 'user@test.com');
  account.roles = [];
  req.user = account;
  next();
}

/**
 * Creates a test Report instance with reasonable defaults.
 */
function createTestReport(overrides: Partial<{
  id: string;
  eventId: string;
  calendarId: string;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  reporterType: string;
}> = {}): Report {
  const report = new Report(overrides.id ?? TEST_REPORT_ID);
  report.eventId = overrides.eventId ?? TEST_EVENT_ID;
  report.calendarId = overrides.calendarId ?? TEST_CALENDAR_ID;
  report.category = overrides.category ?? ReportCategory.SPAM;
  report.description = overrides.description ?? 'Test report description';
  report.status = overrides.status ?? ReportStatus.ESCALATED;
  report.reporterType = (overrides.reporterType as any) ?? 'authenticated';
  return report;
}

/**
 * Creates a test CalendarEvent instance with optional remote properties.
 */
function createTestEvent(overrides: Partial<{
  id: string;
  calendarId: string | null;
  eventSourceUrl: string;
}> = {}): CalendarEvent {
  const event = new CalendarEvent(
    overrides.id ?? TEST_EVENT_ID,
    overrides.calendarId !== undefined ? overrides.calendarId : TEST_CALENDAR_ID,
    overrides.eventSourceUrl ?? '',
  );
  return event;
}

describe('Admin Report Forward API', () => {
  let routes: AdminReportRoutes;
  let router: express.Router;
  let moderationInterface: ModerationInterface;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    const accountsInterface = new AccountsInterface(new EventEmitter());
    const emailInterface = new EmailInterface();
    const configurationInterface = new ConfigurationInterface(new EventEmitter());
    const activityPubInterface = new ActivityPubInterface(new EventEmitter(), calendarInterface);
    moderationInterface = new ModerationInterface(
      new EventEmitter(),
      calendarInterface,
      accountsInterface,
      emailInterface,
      configurationInterface,
      activityPubInterface,
    );
    routes = new AdminReportRoutes(moderationInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // =========================================================================
  // POST /admin/reports/:reportId/forward-to-admin - Forward to remote admin
  // =========================================================================
  describe('POST /admin/reports/:reportId/forward-to-admin', () => {

    describe('successful forwarding', () => {
      it('should return 200 when forwarding to remote admin succeeds', async () => {
        const report = createTestReport();
        const remoteEvent = createTestEvent({
          calendarId: null,
          eventSourceUrl: 'https://remote.instance.com/events/event-uuid',
        });

        sandbox.stub(moderationInterface, 'getAdminReport').resolves(report);
        sandbox.stub(moderationInterface, 'getEventById').resolves(remoteEvent);
        sandbox.stub(moderationInterface, 'forwardReport').resolves();

        // Mock the entity save to prevent DB operations
        const saveSpy = sandbox.stub(ReportEscalationEntity.prototype, 'save').resolves({
          toModel: () => ({
            id: 'esc-id',
            reportId: TEST_REPORT_ID,
            fromStatus: 'escalated',
            toStatus: 'escalated',
            reviewerId: 'admin-id',
            reviewerRole: 'admin',
            decision: 'forwarded_to_remote_admin',
            notes: null,
            createdAt: new Date(),
          }),
        } as any);

        router.post('/admin/reports/:reportId/forward-to-admin', addAdminUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        const response = await request(testApp(router))
          .post(`/admin/reports/${TEST_REPORT_ID}/forward-to-admin`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Report forwarded to remote admin');
      });

      it('should call forwardReport with correct parameters', async () => {
        const report = createTestReport();
        const remoteEvent = createTestEvent({
          calendarId: null,
          eventSourceUrl: 'https://remote.instance.com/events/event-uuid',
        });

        sandbox.stub(moderationInterface, 'getAdminReport').resolves(report);
        sandbox.stub(moderationInterface, 'getEventById').resolves(remoteEvent);
        const forwardStub = sandbox.stub(moderationInterface, 'forwardReport').resolves();
        sandbox.stub(ReportEscalationEntity.prototype, 'save').resolves({} as any);

        router.post('/admin/reports/:reportId/forward-to-admin', addAdminUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        await request(testApp(router))
          .post(`/admin/reports/${TEST_REPORT_ID}/forward-to-admin`);

        expect(forwardStub.calledOnce).toBe(true);
        expect(forwardStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
        // The second argument should be the remote admin actor URI
        expect(forwardStub.firstCall.args[1]).toBe('https://remote.instance.com/admin');
      });

      it('should create escalation record with decision=forwarded_to_remote_admin', async () => {
        const report = createTestReport();
        const remoteEvent = createTestEvent({
          calendarId: null,
          eventSourceUrl: 'https://remote.instance.com/events/event-uuid',
        });

        sandbox.stub(moderationInterface, 'getAdminReport').resolves(report);
        sandbox.stub(moderationInterface, 'getEventById').resolves(remoteEvent);
        sandbox.stub(moderationInterface, 'forwardReport').resolves();
        const saveSpy = sandbox.stub(ReportEscalationEntity.prototype, 'save').resolves({} as any);

        router.post('/admin/reports/:reportId/forward-to-admin', addAdminUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        await request(testApp(router))
          .post(`/admin/reports/${TEST_REPORT_ID}/forward-to-admin`);

        expect(saveSpy.calledOnce).toBe(true);
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid reportId format', async () => {
        router.post('/admin/reports/:reportId/forward-to-admin', addAdminUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports/not-a-uuid/forward-to-admin');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
        expect(response.body.error).toBe('Invalid reportId format');
      });

      it('should return 400 when event is not remote', async () => {
        const report = createTestReport();
        const localEvent = createTestEvent({ calendarId: TEST_CALENDAR_ID }); // Local event

        sandbox.stub(moderationInterface, 'getAdminReport').resolves(report);
        sandbox.stub(moderationInterface, 'getEventById').resolves(localEvent);

        router.post('/admin/reports/:reportId/forward-to-admin', addAdminUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        const response = await request(testApp(router))
          .post(`/admin/reports/${TEST_REPORT_ID}/forward-to-admin`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
        expect(response.body.error).toBe('Cannot forward report: event is not from a remote instance');
      });
    });

    describe('not found - 404', () => {
      it('should return 404 for non-existent report', async () => {
        sandbox.stub(moderationInterface, 'getAdminReport').rejects(new ReportNotFoundError());

        router.post('/admin/reports/:reportId/forward-to-admin', addAdminUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        const response = await request(testApp(router))
          .post(`/admin/reports/${NONEXISTENT_REPORT_ID}/forward-to-admin`);

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.post('/admin/reports/:reportId/forward-to-admin', (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        const response = await request(testApp(router))
          .post(`/admin/reports/${TEST_REPORT_ID}/forward-to-admin`);

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });

      it('should return 403 when user is not an admin', async () => {
        router.post('/admin/reports/:reportId/forward-to-admin', addRegularUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        const response = await request(testApp(router))
          .post(`/admin/reports/${TEST_REPORT_ID}/forward-to-admin`);

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'getAdminReport').rejects(
          new Error('Database error'),
        );

        router.post('/admin/reports/:reportId/forward-to-admin', addAdminUser, (req, res) => {
          routes.forwardToAdmin(req, res);
        });

        const response = await request(testApp(router))
          .post(`/admin/reports/${TEST_REPORT_ID}/forward-to-admin`);

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to forward report');
      });
    });
  });
});
