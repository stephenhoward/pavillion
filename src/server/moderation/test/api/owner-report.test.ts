import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { ReportValidationError } from '@/common/exceptions/report';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import OwnerReportRoutes from '@/server/moderation/api/v1/owner-report-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import {
  ReportNotFoundError,
  ReportAlreadyResolvedError,
} from '@/server/moderation/exceptions';

/** Valid UUID v4 test identifiers for route parameter validation. */
const TEST_CALENDAR_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_REPORT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const OTHER_REPORT_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const OTHER_CALENDAR_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const NONEXISTENT_REPORT_ID = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';

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
  ownerNotes: string | null;
}> = {}): Report {
  const report = new Report(overrides.id ?? TEST_REPORT_ID);
  report.eventId = overrides.eventId ?? 'event-1';
  report.calendarId = overrides.calendarId ?? TEST_CALENDAR_ID;
  report.category = overrides.category ?? ReportCategory.SPAM;
  report.description = overrides.description ?? 'Test report description';
  report.status = overrides.status ?? ReportStatus.SUBMITTED;
  report.reporterType = (overrides.reporterType as any) ?? 'authenticated';
  report.ownerNotes = overrides.ownerNotes ?? null;
  return report;
}

describe('Owner Report API', () => {
  let routes: OwnerReportRoutes;
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
    routes = new OwnerReportRoutes(moderationInterface, calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Helper: stubs moderationInterface.userCanReviewReports to grant or deny access.
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

  // =========================================================================
  // GET /calendars/:calendarId/reports - List reports
  // =========================================================================
  describe('GET /calendars/:calendarId/reports', () => {

    describe('successful listing', () => {
      it('should return 200 with paginated reports', async () => {
        stubAccess();

        const reports = [
          createTestReport({ id: TEST_REPORT_ID }),
          createTestReport({ id: OTHER_REPORT_ID, category: ReportCategory.HARASSMENT }),
        ];

        sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports,
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalCount: 2,
            limit: 20,
          },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports`);

        expect(response.status).toBe(200);
        expect(response.body.reports).toHaveLength(2);
        expect(response.body.pagination).toBeDefined();
        expect(response.body.pagination.totalCount).toBe(2);
      });

      it('should serialize reports using toOwnerObject()', async () => {
        stubAccess();

        const report = createTestReport();
        report.reporterAccountId = 'secret-account-id';
        report.reporterEmailHash = 'secret-hash';
        report.verificationToken = 'secret-token';
        report.adminNotes = 'admin-only notes';

        sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports: [report],
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalCount: 1,
            limit: 20,
          },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports`);

        expect(response.status).toBe(200);

        const reportObj = response.body.reports[0];
        // Verify owner-safe fields are present
        expect(reportObj.id).toBe(TEST_REPORT_ID);
        expect(reportObj.eventId).toBe('event-1');
        expect(reportObj.calendarId).toBe(TEST_CALENDAR_ID);
        expect(reportObj.category).toBe('spam');
        expect(reportObj.status).toBe('submitted');
        expect(reportObj.reporterType).toBe('authenticated');

        // Verify sensitive fields are absent
        expect(reportObj).not.toHaveProperty('reporterAccountId');
        expect(reportObj).not.toHaveProperty('reporterEmailHash');
        expect(reportObj).not.toHaveProperty('verificationToken');
        expect(reportObj).not.toHaveProperty('adminNotes');
        expect(reportObj).not.toHaveProperty('adminId');
        expect(reportObj).not.toHaveProperty('reviewerId');
      });

      it('should pass status filter to service', async () => {
        stubAccess();

        const getReportsStub = sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?status=submitted`);

        expect(getReportsStub.calledOnce).toBe(true);
        expect(getReportsStub.firstCall.args[1].status).toBe('submitted');
      });

      it('should pass category filter to service', async () => {
        stubAccess();

        const getReportsStub = sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?category=spam`);

        expect(getReportsStub.calledOnce).toBe(true);
        expect(getReportsStub.firstCall.args[1].category).toBe('spam');
      });

      it('should pass eventId filter to service', async () => {
        stubAccess();

        const getReportsStub = sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?eventId=event-123`);

        expect(getReportsStub.calledOnce).toBe(true);
        expect(getReportsStub.firstCall.args[1].eventId).toBe('event-123');
      });

      it('should pass source filter to service', async () => {
        stubAccess();

        const getReportsStub = sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?source=anonymous`);

        expect(getReportsStub.calledOnce).toBe(true);
        expect(getReportsStub.firstCall.args[1].source).toBe('anonymous');
      });

      it('should pass sortBy and sortOrder to service', async () => {
        stubAccess();

        const getReportsStub = sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?sortBy=updated_at&sortOrder=ASC`);

        expect(getReportsStub.calledOnce).toBe(true);
        expect(getReportsStub.firstCall.args[1].sortBy).toBe('updated_at');
        expect(getReportsStub.firstCall.args[1].sortOrder).toBe('ASC');
      });

      it('should pass page and limit to service', async () => {
        stubAccess();

        const getReportsStub = sandbox.stub(moderationInterface, 'getReportsForCalendar').resolves({
          reports: [],
          pagination: { currentPage: 2, totalPages: 3, totalCount: 25, limit: 10 },
        });

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?page=2&limit=10`);

        expect(getReportsStub.calledOnce).toBe(true);
        expect(getReportsStub.firstCall.args[1].page).toBe(2);
        expect(getReportsStub.firstCall.args[1].limit).toBe(10);
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid calendarId format', async () => {
        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/calendars/not-a-uuid/reports');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 for invalid status filter', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Invalid status. Must be one of: submitted, pending_verification, escalated, resolved, dismissed'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?status=invalid_status`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid category filter', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Invalid category'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?category=invalid_category`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid source filter', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Invalid source'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?source=invalid_source`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid sortBy field', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Invalid sortBy'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?sortBy=invalid_field`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid sortOrder', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Invalid sortOrder. Must be ASC or DESC'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?sortOrder=INVALID`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid page number', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Page must be a positive integer'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?page=0`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for non-numeric page', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Page must be a positive integer'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?page=abc`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for limit exceeding 100', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new ReportValidationError('Limit must be between 1 and 100'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports?limit=101`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.get('/calendars/:calendarId/reports', (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports`);

        expect(response.status).toBe(403);
      });

      it('should return 403 when user is not a calendar owner or editor', async () => {
        stubAccessDenied();

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports`);

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });

      it('should return 403 when calendar does not exist', async () => {
        stubAccess(false);

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${OTHER_CALENDAR_ID}/reports`);

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportsForCalendar').rejects(
          new Error('Database connection failed'),
        );

        router.get('/calendars/:calendarId/reports', addRequestUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports`);

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // GET /calendars/:calendarId/reports/:reportId - Report detail
  // =========================================================================
  describe('GET /calendars/:calendarId/reports/:reportId', () => {

    describe('successful retrieval', () => {
      it('should return 200 with report and escalation history', async () => {
        stubAccess();

        const report = createTestReport();
        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
        sandbox.stub(moderationInterface, 'getEscalationHistory').resolves([
          {
            id: 'esc-1',
            reportId: TEST_REPORT_ID,
            fromStatus: 'submitted',
            toStatus: 'resolved',
            reviewerId: 'reviewer-1',
            reviewerRole: 'owner',
            decision: 'resolved',
            notes: 'Looks good',
            createdAt: new Date(),
          },
        ]);

        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(200);
        expect(response.body.report).toBeDefined();
        expect(response.body.report.id).toBe(TEST_REPORT_ID);
        expect(response.body.escalationHistory).toBeDefined();
        expect(response.body.escalationHistory).toHaveLength(1);
        expect(response.body.escalationHistory[0].decision).toBe('resolved');
      });

      it('should use toOwnerObject() serialization', async () => {
        stubAccess();

        const report = createTestReport();
        report.adminNotes = 'secret admin notes';
        report.verificationToken = 'secret-token';

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(report);
        sandbox.stub(moderationInterface, 'getEscalationHistory').resolves([]);

        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(200);
        expect(response.body.report).not.toHaveProperty('adminNotes');
        expect(response.body.report).not.toHaveProperty('verificationToken');
        expect(response.body.report.reporterType).toBe('authenticated');
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid calendarId format', async () => {
        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/not-a-uuid/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 for invalid reportId format', async () => {
        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/not-a-uuid`);

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });
    });

    describe('report not found - 404', () => {
      it('should return 404 when report does not exist', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/${NONEXISTENT_REPORT_ID}`);

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });

      it('should return 404 when report belongs to a different calendar', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.get('/calendars/:calendarId/reports/:reportId', (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(403);
      });

      it('should return 403 when user lacks calendar access', async () => {
        stubAccessDenied();

        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(
          new Error('Database error'),
        );

        router.get('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // PUT /calendars/:calendarId/reports/:reportId - Update report notes
  // =========================================================================
  describe('PUT /calendars/:calendarId/reports/:reportId', () => {

    describe('successful update', () => {
      it('should return 200 with updated report', async () => {
        stubAccess();

        const existingReport = createTestReport();
        const updatedReport = createTestReport({ ownerNotes: 'My notes about this report' });

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(existingReport);
        sandbox.stub(moderationInterface, 'updateReportNotes').resolves(updatedReport);

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 'My notes about this report' });

        expect(response.status).toBe(200);
        expect(response.body.report).toBeDefined();
      });

      it('should pass ownerNotes to service', async () => {
        stubAccess();

        const existingReport = createTestReport();
        const updateStub = sandbox.stub(moderationInterface, 'updateReportNotes').resolves(existingReport);
        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(existingReport);

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 'Updated notes' });

        expect(updateStub.calledOnce).toBe(true);
        expect(updateStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
        expect(updateStub.firstCall.args[1]).toBe('Updated notes');
      });

      it('should allow empty string for ownerNotes (clearing notes)', async () => {
        stubAccess();

        const existingReport = createTestReport();
        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(existingReport);
        sandbox.stub(moderationInterface, 'updateReportNotes').resolves(existingReport);

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: '' });

        expect(response.status).toBe(200);
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid calendarId format', async () => {
        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/not-a-uuid/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 'notes' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 for invalid reportId format', async () => {
        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/not-a-uuid`)
          .send({ ownerNotes: 'notes' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when ownerNotes is missing', async () => {
        stubAccess();

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when ownerNotes is not a string', async () => {
        stubAccess();

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 123 });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });
    });

    describe('report not found - 404', () => {
      it('should return 404 when report does not exist', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${NONEXISTENT_REPORT_ID}`)
          .send({ ownerNotes: 'notes' });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });

      it('should return 404 when report belongs to a different calendar', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 'notes' });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.put('/calendars/:calendarId/reports/:reportId', (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 'notes' });

        expect(response.status).toBe(403);
      });

      it('should return 403 when user lacks calendar access', async () => {
        stubAccessDenied();

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 'notes' });

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(createTestReport());
        sandbox.stub(moderationInterface, 'updateReportNotes').rejects(
          new Error('Unexpected error'),
        );

        router.put('/calendars/:calendarId/reports/:reportId', addRequestUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}`)
          .send({ ownerNotes: 'notes' });

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // POST /calendars/:calendarId/reports/:reportId/resolve - Resolve report
  // =========================================================================
  describe('POST /calendars/:calendarId/reports/:reportId/resolve', () => {

    describe('successful resolution', () => {
      it('should return 200 with resolved report', async () => {
        stubAccess();

        const existingReport = createTestReport();
        const resolvedReport = createTestReport({ status: ReportStatus.RESOLVED });

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(existingReport);
        sandbox.stub(moderationInterface, 'resolveReport').resolves(resolvedReport);

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 'This has been addressed' });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Report resolved successfully');
        expect(response.body.report).toBeDefined();
        expect(response.body.report.status).toBe('resolved');
      });

      it('should pass the reviewer account ID and trimmed notes to service', async () => {
        stubAccess();

        const existingReport = createTestReport();
        const resolveStub = sandbox.stub(moderationInterface, 'resolveReport').resolves(existingReport);
        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(existingReport);

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: '  Resolution notes  ' });

        expect(resolveStub.calledOnce).toBe(true);
        expect(resolveStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
        expect(resolveStub.firstCall.args[1]).toBe('id'); // from addRequestUser
        expect(resolveStub.firstCall.args[2]).toBe('Resolution notes');
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid calendarId format', async () => {
        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/not-a-uuid/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 'Resolution notes' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 for invalid reportId format', async () => {
        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/not-a-uuid/resolve`)
          .send({ notes: 'Resolution notes' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes is missing', async () => {
        stubAccess();

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes is empty', async () => {
        stubAccess();

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: '   ' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes is not a string', async () => {
        stubAccess();

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 123 });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });
    });

    describe('report not found - 404', () => {
      it('should return 404 when report does not exist', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${NONEXISTENT_REPORT_ID}/resolve`)
          .send({ notes: 'Resolution notes' });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });

      it('should return 404 when report belongs to a different calendar', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 'Resolution notes' });

        expect(response.status).toBe(404);
      });
    });

    describe('already resolved - 409', () => {
      it('should return 409 when report is already resolved', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(createTestReport());
        sandbox.stub(moderationInterface, 'resolveReport').rejects(
          new ReportAlreadyResolvedError(),
        );

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 'Resolution notes' });

        expect(response.status).toBe(409);
        expect(response.body.errorName).toBe('ReportAlreadyResolvedError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.post('/calendars/:calendarId/reports/:reportId/resolve', (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 'notes' });

        expect(response.status).toBe(403);
      });

      it('should return 403 when user lacks calendar access', async () => {
        stubAccessDenied();

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 'notes' });

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(createTestReport());
        sandbox.stub(moderationInterface, 'resolveReport').rejects(
          new Error('Database error'),
        );

        router.post('/calendars/:calendarId/reports/:reportId/resolve', addRequestUser, (req, res) => {
          routes.resolveReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/resolve`)
          .send({ notes: 'Resolution notes' });

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // POST /calendars/:calendarId/reports/:reportId/dismiss - Dismiss report
  // =========================================================================
  describe('POST /calendars/:calendarId/reports/:reportId/dismiss', () => {

    describe('successful dismissal', () => {
      it('should return 200 with escalated report', async () => {
        stubAccess();

        const existingReport = createTestReport();
        const escalatedReport = createTestReport({ status: ReportStatus.ESCALATED });

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(existingReport);
        sandbox.stub(moderationInterface, 'dismissReport').resolves(escalatedReport);

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 'Not a valid concern' });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Report dismissed and escalated to admin');
        expect(response.body.report).toBeDefined();
        expect(response.body.report.status).toBe('escalated');
      });

      it('should pass the reviewer account ID and trimmed notes to service', async () => {
        stubAccess();

        const existingReport = createTestReport();
        const dismissStub = sandbox.stub(moderationInterface, 'dismissReport').resolves(existingReport);
        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(existingReport);

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: '  Dismissal reason  ' });

        expect(dismissStub.calledOnce).toBe(true);
        expect(dismissStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
        expect(dismissStub.firstCall.args[1]).toBe('id'); // from addRequestUser
        expect(dismissStub.firstCall.args[2]).toBe('Dismissal reason');
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid calendarId format', async () => {
        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/not-a-uuid/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 'Dismissal notes' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 for invalid reportId format', async () => {
        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/not-a-uuid/dismiss`)
          .send({ notes: 'Dismissal notes' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes is missing', async () => {
        stubAccess();

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes is empty whitespace', async () => {
        stubAccess();

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: '   ' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes is not a string', async () => {
        stubAccess();

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 123 });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
      });
    });

    describe('report not found - 404', () => {
      it('should return 404 when report does not exist', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${NONEXISTENT_REPORT_ID}/dismiss`)
          .send({ notes: 'Dismissal notes' });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });

      it('should return 404 when report belongs to a different calendar', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').rejects(new ReportNotFoundError());

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 'Dismissal notes' });

        expect(response.status).toBe(404);
      });
    });

    describe('already resolved - 409', () => {
      it('should return 409 when report is already resolved', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(createTestReport());
        sandbox.stub(moderationInterface, 'dismissReport').rejects(
          new ReportAlreadyResolvedError(),
        );

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 'Dismissal notes' });

        expect(response.status).toBe(409);
        expect(response.body.errorName).toBe('ReportAlreadyResolvedError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.post('/calendars/:calendarId/reports/:reportId/dismiss', (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 'notes' });

        expect(response.status).toBe(403);
      });

      it('should return 403 when user lacks calendar access', async () => {
        stubAccessDenied();

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 'notes' });

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        stubAccess();

        sandbox.stub(moderationInterface, 'getReportForCalendar').resolves(createTestReport());
        sandbox.stub(moderationInterface, 'dismissReport').rejects(
          new Error('Database error'),
        );

        router.post('/calendars/:calendarId/reports/:reportId/dismiss', addRequestUser, (req, res) => {
          routes.dismissReport(req, res);
        });

        const response = await request(testApp(router))
          .post(`/calendars/${TEST_CALENDAR_ID}/reports/${TEST_REPORT_ID}/dismiss`)
          .send({ notes: 'Dismissal notes' });

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // Route installation
  // =========================================================================
  describe('route installation', () => {
    it('should install all route handlers', () => {
      const app = express();
      app.use(express.json());
      routes.installHandlers(app, '/api/v1');

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

      // 6 routes: GET list, GET detail, PUT update, POST resolve, POST dismiss, POST forward
      expect(routeCount).toBe(6);
    });
  });
});
