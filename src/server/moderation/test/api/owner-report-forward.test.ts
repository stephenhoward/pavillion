import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { CalendarEvent } from '@/common/model/events';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import OwnerReportRoutes from '@/server/moderation/api/v1/owner-report-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import { ReportNotFoundError } from '@/server/moderation/exceptions';
import { EventNotFoundError } from '@/common/exceptions/calendar';

/** Valid UUID v4 test identifiers. */
const TEST_CALENDAR_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_REPORT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const TEST_EVENT_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const REMOTE_OWNER_URI = 'https://remote.instance/calendars/remote-calendar';

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
}> = {}): Report {
  const report = new Report(overrides.id ?? TEST_REPORT_ID);
  report.eventId = overrides.eventId ?? TEST_EVENT_ID;
  report.calendarId = overrides.calendarId ?? TEST_CALENDAR_ID;
  report.category = overrides.category ?? ReportCategory.SPAM;
  report.description = overrides.description ?? 'Test report';
  report.status = overrides.status ?? ReportStatus.SUBMITTED;
  report.reporterType = 'authenticated';
  return report;
}

/**
 * Creates a test CalendarEvent instance.
 */
function createTestEvent(overrides: Partial<{
  id: string;
  calendarId: string | null;
}> = {}): CalendarEvent {
  const event = new CalendarEvent(
    overrides.id ?? TEST_EVENT_ID,
    overrides.calendarId === undefined ? null : overrides.calendarId,
    'https://remote.instance/events/123',
  );
  return event;
}

describe('POST /calendars/:calendarId/reports/:reportId/forward - Forward report to remote owner', () => {
  let routes: OwnerReportRoutes;
  let router: express.Router;
  let moderationInterface: ModerationInterface;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    const accountsInterface = new AccountsInterface(new EventEmitter());
    const emailInterface = new EmailInterface();
    const configurationInterface = new ConfigurationInterface(new EventEmitter());
    const activityPubInterface = new ActivityPubInterface(new EventEmitter());

    moderationInterface = new ModerationInterface(
      new EventEmitter(),
      calendarInterface,
      accountsInterface,
      emailInterface,
      configurationInterface,
      activityPubInterface,
    );

    routes = new OwnerReportRoutes(moderationInterface, calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Helper: stubs moderationInterface.userCanReviewReports to grant access.
   */
  function stubAccess(granted: boolean = true): void {
    sandbox.stub(moderationInterface, 'userCanReviewReports').resolves(granted);
  }

  /**
   * Helper: stubs moderationInterface to deny access.
   */
  function stubAccessDenied(): void {
    sandbox.stub(moderationInterface, 'userCanReviewReports').resolves(false);
  }

  describe('successful forward', () => {
    it('should return 200 with success message when forwarding to remote owner', async () => {
      stubAccess();

      const report = createTestReport();
      const remoteEvent = createTestEvent({ calendarId: null }); // Remote event

      sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
      sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);
      const forwardStub = sandbox.stub(moderationInterface, 'forwardReport').resolves();

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({ message: 'Please review this report' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Report forwarded successfully');
      expect(forwardStub.calledOnce).toBe(true);
    });

    it('should forward without optional message', async () => {
      stubAccess();

      const report = createTestReport();
      const remoteEvent = createTestEvent({ calendarId: null });

      sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
      sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);
      const forwardStub = sandbox.stub(moderationInterface, 'forwardReport').resolves();

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(200);
      expect(forwardStub.calledOnce).toBe(true);
    });

    it('should extract remote owner actor URI from event source URL', async () => {
      stubAccess();

      const report = createTestReport();
      const remoteEvent = createTestEvent({ calendarId: null });
      remoteEvent.eventSourceUrl = 'https://remote.instance/events/abc123';

      sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
      sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);
      const forwardStub = sandbox.stub(moderationInterface, 'forwardReport').resolves();

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(forwardStub.calledOnce).toBe(true);
      // Verify it extracted the actor URI from the event source URL
      const actorUri = forwardStub.firstCall.args[1];
      expect(actorUri).toMatch(/^https:\/\/remote\.instance/);
    });
  });

  describe('validation errors - 400', () => {
    it('should return 400 for invalid calendarId format', async () => {
      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/not-a-uuid/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 for invalid reportId format', async () => {
      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/not-a-uuid/forward`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when event is not remote (has calendarId)', async () => {
      stubAccess();

      const report = createTestReport();
      const localEvent = createTestEvent({ calendarId: TEST_CALENDAR_ID }); // Local event

      sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
      sandbox.stub(calendarInterface, 'getEventById').resolves(localEvent);

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('only be forwarded for reposted');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when event has no source URL', async () => {
      stubAccess();

      const report = createTestReport();
      const remoteEvent = createTestEvent({ calendarId: null });
      remoteEvent.eventSourceUrl = null as any; // No source URL

      sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
      sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('source URL');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 for invalid message type', async () => {
      stubAccess();

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({ message: 123 });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('report not found - 404', () => {
    it('should return 404 when report does not exist', async () => {
      stubAccess();

      sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('ReportNotFoundError');
    });

    it('should return 404 when event does not exist', async () => {
      stubAccess();

      const report = createTestReport();
      sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
      sandbox.stub(calendarInterface, 'getEventById').rejects(new EventNotFoundError());

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('EventNotFoundError');
    });
  });

  describe('authorization - 403', () => {
    it('should return 403 when no user is present', async () => {
      router.post('/calendars/:calendarId/reports/:reportId/forward', (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(403);
    });

    it('should return 403 when user lacks calendar access', async () => {
      stubAccessDenied();

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('ForbiddenError');
    });
  });

  describe('server error - 500', () => {
    it('should return 500 for unexpected errors', async () => {
      stubAccess();

      const report = createTestReport();
      const remoteEvent = createTestEvent({ calendarId: null });

      sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
      sandbox.stub(calendarInterface, 'getEventById').resolves(remoteEvent);
      sandbox.stub(moderationInterface, 'forwardReport').rejects(new Error('Unexpected error'));

      router.post('/calendars/:calendarId/reports/:reportId/forward', addRequestUser, (req, res) => {
        routes.forwardReport(req, res);
      });

      const response = await request(testApp(router))
        .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/forward`)
        .send({});

      expect(response.status).toBe(500);
    });
  });
});
