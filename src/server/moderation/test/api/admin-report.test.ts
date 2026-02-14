import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { ReportValidationError, DuplicateReportError } from '@/common/exceptions/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { Account } from '@/common/model/account';
import { testApp } from '@/server/common/test/lib/express';
import AdminReportRoutes from '@/server/moderation/api/v1/admin-report-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import {
  ReportNotFoundError,
  ReportAlreadyResolvedError,
} from '@/server/moderation/exceptions';

/** Valid UUID v4 test identifiers. */
const TEST_REPORT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const OTHER_REPORT_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const TEST_CALENDAR_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_EVENT_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
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
  escalationType: string | null;
  ownerNotes: string | null;
  adminNotes: string | null;
}> = {}): Report {
  const report = new Report(overrides.id ?? TEST_REPORT_ID);
  report.eventId = overrides.eventId ?? 'event-1';
  report.calendarId = overrides.calendarId ?? TEST_CALENDAR_ID;
  report.category = overrides.category ?? ReportCategory.SPAM;
  report.description = overrides.description ?? 'Test report description';
  report.status = overrides.status ?? ReportStatus.ESCALATED;
  report.reporterType = (overrides.reporterType as any) ?? 'authenticated';
  report.escalationType = (overrides.escalationType as any) ?? 'automatic';
  report.ownerNotes = overrides.ownerNotes ?? null;
  report.adminNotes = overrides.adminNotes ?? null;
  return report;
}

describe('Admin Report API', () => {
  let routes: AdminReportRoutes;
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
    routes = new AdminReportRoutes(moderationInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // =========================================================================
  // GET /admin/reports - List admin reports
  // =========================================================================
  describe('GET /admin/reports', () => {

    describe('successful listing', () => {
      it('should return 200 with paginated reports', async () => {
        const reports = [
          createTestReport({ id: TEST_REPORT_ID }),
          createTestReport({ id: OTHER_REPORT_ID, category: ReportCategory.HARASSMENT }),
        ];

        sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports,
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalCount: 2,
            limit: 20,
          },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports');

        expect(response.status).toBe(200);
        expect(response.body.reports).toHaveLength(2);
        expect(response.body.pagination).toBeDefined();
        expect(response.body.pagination.totalCount).toBe(2);
      });

      it('should serialize reports using toAdminObject()', async () => {
        const report = createTestReport();
        report.reporterAccountId = 'account-id-123';
        report.reporterEmailHash = 'hash-value';
        report.adminNotes = 'admin notes visible';
        report.adminId = 'admin-creator-id';
        report.verificationToken = 'secret-token';

        sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [report],
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalCount: 1,
            limit: 20,
          },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports');

        expect(response.status).toBe(200);

        const reportObj = response.body.reports[0];
        // Admin-visible fields should be present
        expect(reportObj.id).toBe(TEST_REPORT_ID);
        expect(reportObj.eventId).toBe('event-1');
        expect(reportObj.calendarId).toBe(TEST_CALENDAR_ID);
        expect(reportObj.category).toBe('spam');
        expect(reportObj.status).toBe('escalated');
        expect(reportObj.reporterType).toBe('authenticated');
        expect(reportObj.adminNotes).toBe('admin notes visible');
        expect(reportObj.adminId).toBe('admin-creator-id');
        expect(reportObj.reporterAccountId).toBe('account-id-123');
        expect(reportObj.reporterEmailHash).toBe('hash-value');

        // Verification secrets should not be present
        expect(reportObj).not.toHaveProperty('verificationToken');
        expect(reportObj).not.toHaveProperty('verificationExpiration');
      });

      it('should pass status filter to service', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get('/admin/reports?status=escalated');

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].status).toBe('escalated');
      });

      it('should pass category filter to service', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get('/admin/reports?category=spam');

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].category).toBe('spam');
      });

      it('should pass calendarId filter to service', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get(`/admin/reports?calendarId=${TEST_CALENDAR_ID}`);

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].calendarId).toBe(TEST_CALENDAR_ID);
      });

      it('should pass source filter to service', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get('/admin/reports?source=administrator');

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].source).toBe('administrator');
      });

      it('should pass escalationType filter to service', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get('/admin/reports?escalationType=automatic');

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].escalationType).toBe('automatic');
      });

      it('should pass sortBy and sortOrder to service', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get('/admin/reports?sortBy=updated_at&sortOrder=ASC');

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].sortBy).toBe('updated_at');
        expect(getAdminReportsStub.firstCall.args[0].sortOrder).toBe('ASC');
      });

      it('should pass page and limit to service', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 2, totalPages: 3, totalCount: 25, limit: 10 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get('/admin/reports?page=2&limit=10');

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].page).toBe(2);
        expect(getAdminReportsStub.firstCall.args[0].limit).toBe(10);
      });

      it('should normalize sortOrder to uppercase', async () => {
        const getAdminReportsStub = sandbox.stub(moderationInterface, 'getAdminReports').resolves({
          reports: [],
          pagination: { currentPage: 1, totalPages: 0, totalCount: 0, limit: 20 },
        });

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        await request(testApp(router))
          .get('/admin/reports?sortOrder=asc');

        expect(getAdminReportsStub.calledOnce).toBe(true);
        expect(getAdminReportsStub.firstCall.args[0].sortOrder).toBe('ASC');
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid status filter', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Invalid status. Must be one of: submitted, pending_verification, escalated, resolved, dismissed'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?status=invalid_status');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid category filter', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Invalid category'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?category=invalid_category');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid source filter', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Invalid source'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?source=invalid_source');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid sortBy field', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Invalid sortBy'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?sortBy=invalid_field');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid sortOrder', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Invalid sortOrder. Must be ASC or DESC'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?sortOrder=INVALID');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid page number', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Page must be a positive integer'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?page=0');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for non-numeric page', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Page must be a positive integer'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?page=abc');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for limit exceeding 100', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Limit must be between 1 and 100'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?limit=101');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 for invalid escalationType filter', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new ReportValidationError('Invalid escalationType. Must be one of: manual, automatic'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports?escalationType=invalid');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.get('/admin/reports', (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports');

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });

      it('should return 403 when user is not an admin', async () => {
        router.get('/admin/reports', addRegularUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports');

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'getAdminReports').rejects(
          new Error('Database connection failed'),
        );

        router.get('/admin/reports', addAdminUser, (req, res) => {
          routes.listReports(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports');

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // POST /admin/reports - Create admin report
  // =========================================================================
  describe('POST /admin/reports', () => {

    describe('successful creation', () => {
      it('should return 201 with created report', async () => {
        const createdReport = createTestReport({
          eventId: TEST_EVENT_ID,
          reporterType: 'administrator',
          status: ReportStatus.SUBMITTED,
        });
        createdReport.adminId = 'admin-id';
        createdReport.adminPriority = 'high';

        sandbox.stub(moderationInterface, 'createAdminReport').resolves(createdReport);

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'This event is spam',
            priority: 'high',
          });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Report created successfully');
        expect(response.body.report).toBeDefined();
        expect(response.body.report.reporterType).toBe('administrator');
      });

      it('should serialize report using toAdminObject()', async () => {
        const createdReport = createTestReport({
          eventId: TEST_EVENT_ID,
          reporterType: 'administrator',
          status: ReportStatus.SUBMITTED,
        });
        createdReport.adminId = 'admin-id';
        createdReport.adminPriority = 'medium';
        createdReport.adminNotes = 'Admin notes here';
        createdReport.verificationToken = 'should-not-appear';

        sandbox.stub(moderationInterface, 'createAdminReport').resolves(createdReport);

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Spam event',
            priority: 'medium',
            adminNotes: 'Admin notes here',
          });

        expect(response.status).toBe(201);
        expect(response.body.report.adminId).toBe('admin-id');
        expect(response.body.report.adminNotes).toBe('Admin notes here');
        expect(response.body.report).not.toHaveProperty('verificationToken');
      });

      it('should pass correct data to createAdminReport', async () => {
        const createdReport = createTestReport({
          eventId: TEST_EVENT_ID,
          reporterType: 'administrator',
          status: ReportStatus.SUBMITTED,
        });

        const createStub = sandbox.stub(moderationInterface, 'createAdminReport').resolves(createdReport);

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'harassment',
            description: '  Report description  ',
            priority: 'low',
            deadline: '2027-01-01T00:00:00.000Z',
            adminNotes: '  Some notes  ',
          });

        expect(createStub.calledOnce).toBe(true);
        const callArgs = createStub.firstCall.args[0];
        expect(callArgs.eventId).toBe(TEST_EVENT_ID);
        expect(callArgs.category).toBe('harassment');
        expect(callArgs.description).toBe('Report description');
        expect(callArgs.adminId).toBe('admin-id');
        expect(callArgs.priority).toBe('low');
        expect(callArgs.deadline).toEqual(new Date('2027-01-01T00:00:00.000Z'));
        expect(callArgs.adminNotes).toBe('Some notes');
      });

      it('should create report without optional deadline and adminNotes', async () => {
        const createdReport = createTestReport({
          eventId: TEST_EVENT_ID,
          reporterType: 'administrator',
          status: ReportStatus.SUBMITTED,
        });

        const createStub = sandbox.stub(moderationInterface, 'createAdminReport').resolves(createdReport);

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Spam event',
            priority: 'high',
          });

        expect(createStub.calledOnce).toBe(true);
        const callArgs = createStub.firstCall.args[0];
        expect(callArgs.deadline).toBeUndefined();
        expect(callArgs.adminNotes).toBeUndefined();
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 when eventId is missing', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new ReportValidationError(['Event ID is required']),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            category: 'spam',
            description: 'Test',
            priority: 'high',
          });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 when category is missing', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new ReportValidationError(['Category is required']),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            description: 'Test',
            priority: 'high',
          });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 when description is missing', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new ReportValidationError(['Description is required']),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            priority: 'high',
          });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 when priority is missing', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new ReportValidationError(['Priority is required']),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Test description',
          });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
      });

      it('should return 400 when priority is invalid', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new ReportValidationError(['Invalid priority. Must be one of: low, medium, high']),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Test description',
            priority: 'urgent',
          });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
        expect(response.body.error).toContain('priority');
      });

      it('should return 400 with multiple validation errors', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new ReportValidationError(['Event ID is required', 'Category is required', 'Priority is required']),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            description: 'Test description',
          });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ReportValidationError');
        expect(response.body.error).toContain('Event ID is required');
        expect(response.body.error).toContain('Category is required');
        expect(response.body.error).toContain('Priority is required');
      });
    });

    describe('event not found - 404', () => {
      it('should return 404 when event does not exist', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new EventNotFoundError(),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: NONEXISTENT_REPORT_ID,
            category: 'spam',
            description: 'Test description',
            priority: 'high',
          });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('EventNotFoundError');
        expect(response.body.error).toBe('Event not found');
      });
    });

    describe('duplicate report - 409', () => {
      it('should return 409 when admin has already reported this event', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new DuplicateReportError(),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Test description',
            priority: 'high',
          });

        expect(response.status).toBe(409);
        expect(response.body.errorName).toBe('DuplicateReportError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.post('/admin/reports', (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Test',
            priority: 'high',
          });

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });

      it('should return 403 when user is not an admin', async () => {
        router.post('/admin/reports', addRegularUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Test',
            priority: 'high',
          });

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'createAdminReport').rejects(
          new Error('Database connection failed'),
        );

        router.post('/admin/reports', addAdminUser, (req, res) => {
          routes.createReport(req, res);
        });

        const response = await request(testApp(router))
          .post('/admin/reports')
          .send({
            eventId: TEST_EVENT_ID,
            category: 'spam',
            description: 'Test',
            priority: 'high',
          });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to create report');
      });
    });
  });

  // =========================================================================
  // GET /admin/reports/:reportId - Get report detail
  // =========================================================================
  describe('GET /admin/reports/:reportId', () => {

    describe('successful retrieval', () => {
      it('should return 200 with report detail and escalation history', async () => {
        const report = createTestReport({ ownerNotes: 'Owner reviewed this' });
        const escalationHistory = [
          {
            id: 'esc-1',
            reportId: TEST_REPORT_ID,
            fromStatus: 'submitted',
            toStatus: 'escalated',
            reviewerId: 'owner-1',
            reviewerRole: 'owner',
            decision: 'dismissed',
            notes: 'Not relevant',
            createdAt: new Date('2026-02-01'),
          },
        ];

        sandbox.stub(moderationInterface, 'getAdminReport').resolves(report);
        sandbox.stub(moderationInterface, 'getEscalationHistory').resolves(escalationHistory);

        router.get('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/admin/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(200);
        expect(response.body.report).toBeDefined();
        expect(response.body.report.id).toBe(TEST_REPORT_ID);
        expect(response.body.report.ownerNotes).toBe('Owner reviewed this');
        expect(response.body.escalationHistory).toBeDefined();
        expect(response.body.escalationHistory).toHaveLength(1);
        expect(response.body.escalationHistory[0].decision).toBe('dismissed');
      });

      it('should serialize report using toAdminObject()', async () => {
        const report = createTestReport();
        report.reporterAccountId = 'account-123';
        report.adminNotes = 'Admin notes here';
        report.verificationToken = 'secret-token';

        sandbox.stub(moderationInterface, 'getAdminReport').resolves(report);
        sandbox.stub(moderationInterface, 'getEscalationHistory').resolves([]);

        router.get('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/admin/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(200);
        expect(response.body.report.adminNotes).toBe('Admin notes here');
        expect(response.body.report.reporterAccountId).toBe('account-123');
        expect(response.body.report).not.toHaveProperty('verificationToken');
      });

      it('should call getAdminReport with reportId', async () => {
        const getAdminReportStub = sandbox.stub(moderationInterface, 'getAdminReport').resolves(createTestReport());
        sandbox.stub(moderationInterface, 'getEscalationHistory').resolves([]);

        router.get('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.getReport(req, res);
        });

        await request(testApp(router))
          .get(`/admin/reports/${TEST_REPORT_ID}`);

        expect(getAdminReportStub.calledOnce).toBe(true);
        expect(getAdminReportStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
      });

      it('should return empty escalation history when no records exist', async () => {
        sandbox.stub(moderationInterface, 'getAdminReport').resolves(createTestReport());
        sandbox.stub(moderationInterface, 'getEscalationHistory').resolves([]);

        router.get('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/admin/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(200);
        expect(response.body.escalationHistory).toEqual([]);
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid reportId format', async () => {
        router.get('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get('/admin/reports/not-a-uuid');

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
        expect(response.body.error).toBe('Invalid reportId format');
      });
    });

    describe('not found - 404', () => {
      it('should return 404 for non-existent report', async () => {
        sandbox.stub(moderationInterface, 'getAdminReport').rejects(new ReportNotFoundError());

        router.get('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/admin/reports/${NONEXISTENT_REPORT_ID}`);

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.get('/admin/reports/:reportId', (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/admin/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });

      it('should return 403 when user is not an admin', async () => {
        router.get('/admin/reports/:reportId', addRegularUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/admin/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'getAdminReport').rejects(
          new Error('Database error'),
        );

        router.get('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.getReport(req, res);
        });

        const response = await request(testApp(router))
          .get(`/admin/reports/${TEST_REPORT_ID}`);

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // PUT /admin/reports/:reportId - Admin actions
  // =========================================================================
  describe('PUT /admin/reports/:reportId', () => {

    describe('resolve action', () => {
      it('should return 200 with resolved report', async () => {
        const resolvedReport = createTestReport({ status: ReportStatus.RESOLVED });

        sandbox.stub(moderationInterface, 'adminResolveReport').resolves(resolvedReport);

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: 'Admin resolved this report' });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Report resolve successful');
        expect(response.body.report).toBeDefined();
        expect(response.body.report.status).toBe('resolved');
      });

      it('should pass admin ID and trimmed notes to service', async () => {
        const resolvedReport = createTestReport({ status: ReportStatus.RESOLVED });

        const adminResolveStub = sandbox.stub(moderationInterface, 'adminResolveReport').resolves(resolvedReport);

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: '  Resolution notes  ' });

        expect(adminResolveStub.calledOnce).toBe(true);
        expect(adminResolveStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
        expect(adminResolveStub.firstCall.args[1]).toBe('admin-id');
        expect(adminResolveStub.firstCall.args[2]).toBe('Resolution notes');
      });
    });

    describe('dismiss action', () => {
      it('should return 200 with dismissed report', async () => {
        const dismissedReport = createTestReport({ status: ReportStatus.DISMISSED });

        sandbox.stub(moderationInterface, 'adminDismissReport').resolves(dismissedReport);

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'dismiss', notes: 'Not a valid concern' });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Report dismiss successful');
        expect(response.body.report.status).toBe('dismissed');
      });

      it('should pass admin ID and notes to adminDismissReport', async () => {
        const dismissedReport = createTestReport({ status: ReportStatus.DISMISSED });

        const adminDismissStub = sandbox.stub(moderationInterface, 'adminDismissReport').resolves(dismissedReport);

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'dismiss', notes: 'Dismiss notes' });

        expect(adminDismissStub.calledOnce).toBe(true);
        expect(adminDismissStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
        expect(adminDismissStub.firstCall.args[1]).toBe('admin-id');
        expect(adminDismissStub.firstCall.args[2]).toBe('Dismiss notes');
      });
    });

    describe('override action', () => {
      it('should return 200 with overridden report', async () => {
        const overriddenReport = createTestReport({ status: ReportStatus.RESOLVED });

        sandbox.stub(moderationInterface, 'adminOverrideReport').resolves(overriddenReport);

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'override', notes: 'Overriding owner decision' });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Report override successful');
        expect(response.body.report).toBeDefined();
      });

      it('should pass admin ID and notes to adminOverrideReport', async () => {
        const overriddenReport = createTestReport({ status: ReportStatus.RESOLVED });

        const adminOverrideStub = sandbox.stub(moderationInterface, 'adminOverrideReport').resolves(overriddenReport);

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'override', notes: 'Override notes' });

        expect(adminOverrideStub.calledOnce).toBe(true);
        expect(adminOverrideStub.firstCall.args[0]).toBe(TEST_REPORT_ID);
        expect(adminOverrideStub.firstCall.args[1]).toBe('admin-id');
        expect(adminOverrideStub.firstCall.args[2]).toBe('Override notes');
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 for invalid reportId format', async () => {
        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put('/admin/reports/not-a-uuid')
          .send({ action: 'resolve', notes: 'Some notes' });

        expect(response.status).toBe(400);
        expect(response.body.errorName).toBe('ValidationError');
        expect(response.body.error).toBe('Invalid reportId format');
      });

      it('should return 400 when action is missing', async () => {
        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ notes: 'Some notes' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Action is required');
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 for invalid action', async () => {
        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'invalid_action', notes: 'Some notes' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid action');
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes are missing', async () => {
        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Notes are required for admin actions');
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when notes are empty string', async () => {
        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: '   ' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Notes are required for admin actions');
      });

      it('should return 400 when notes are not a string', async () => {
        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: 12345 });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Notes must be a string');
      });
    });

    describe('not found - 404', () => {
      it('should return 404 for non-existent report on resolve', async () => {
        sandbox.stub(moderationInterface, 'adminResolveReport').rejects(new ReportNotFoundError());

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${NONEXISTENT_REPORT_ID}`)
          .send({ action: 'resolve', notes: 'notes' });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });

      it('should return 404 for non-existent report on dismiss', async () => {
        sandbox.stub(moderationInterface, 'adminDismissReport').rejects(new ReportNotFoundError());

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${NONEXISTENT_REPORT_ID}`)
          .send({ action: 'dismiss', notes: 'notes' });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });

      it('should return 404 for non-existent report on override', async () => {
        sandbox.stub(moderationInterface, 'adminOverrideReport').rejects(new ReportNotFoundError());

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${NONEXISTENT_REPORT_ID}`)
          .send({ action: 'override', notes: 'notes' });

        expect(response.status).toBe(404);
        expect(response.body.errorName).toBe('ReportNotFoundError');
      });
    });

    describe('conflict - 409', () => {
      it('should return 409 when report is already resolved (resolve action)', async () => {
        sandbox.stub(moderationInterface, 'adminResolveReport').rejects(new ReportAlreadyResolvedError());

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: 'notes' });

        expect(response.status).toBe(409);
        expect(response.body.errorName).toBe('ReportAlreadyResolvedError');
      });

      it('should return 409 when report is already resolved (dismiss action)', async () => {
        sandbox.stub(moderationInterface, 'adminDismissReport').rejects(new ReportAlreadyResolvedError());

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'dismiss', notes: 'notes' });

        expect(response.status).toBe(409);
        expect(response.body.errorName).toBe('ReportAlreadyResolvedError');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when no user is present', async () => {
        router.put('/admin/reports/:reportId', (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: 'notes' });

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });

      it('should return 403 when user is not an admin', async () => {
        router.put('/admin/reports/:reportId', addRegularUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: 'notes' });

        expect(response.status).toBe(403);
        expect(response.body.errorName).toBe('ForbiddenError');
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors on resolve', async () => {
        sandbox.stub(moderationInterface, 'adminResolveReport').rejects(
          new Error('Database error'),
        );

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'resolve', notes: 'notes' });

        expect(response.status).toBe(500);
      });

      it('should return 500 for unexpected errors on dismiss', async () => {
        sandbox.stub(moderationInterface, 'adminDismissReport').rejects(
          new Error('Database error'),
        );

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'dismiss', notes: 'notes' });

        expect(response.status).toBe(500);
      });

      it('should return 500 for unexpected errors on override', async () => {
        sandbox.stub(moderationInterface, 'adminOverrideReport').rejects(
          new Error('Database error'),
        );

        router.put('/admin/reports/:reportId', addAdminUser, (req, res) => {
          routes.updateReport(req, res);
        });

        const response = await request(testApp(router))
          .put(`/admin/reports/${TEST_REPORT_ID}`)
          .send({ action: 'override', notes: 'notes' });

        expect(response.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // Route installation
  // =========================================================================
  describe('route installation', () => {
    it('should install route handlers', () => {
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

      // 5 routes: GET /admin/reports, POST /admin/reports, GET /admin/reports/:reportId, PUT /admin/reports/:reportId, POST /admin/reports/:reportId/forward-to-admin
      expect(routeCount).toBe(5);
    });
  });
});
