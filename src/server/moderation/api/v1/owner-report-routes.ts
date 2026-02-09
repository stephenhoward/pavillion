import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import type { ReporterType } from '@/common/model/report';
import { ReportValidationError } from '@/common/exceptions/report';
import ExpressHelper from '@/server/common/helper/express';
import ModerationInterface from '@/server/moderation/interface';
import {
  ReportNotFoundError,
  ReportAlreadyResolvedError,
} from '@/server/moderation/exceptions';
import { logError } from '@/server/common/helper/error-logger';

/** UUID v4 format regex for path parameter validation. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validated request context extracted by requireAuth.
 */
interface AuthContext {
  account: Account;
  calendarId: string;
  reportId?: string;
}

/**
 * Route handler for calendar owner report management.
 *
 * Provides endpoints for calendar owners (and editors with appropriate
 * permissions) to list, view, and act on reports filed against events
 * in their calendars.
 */
export default class OwnerReportRoutes {
  private moderationInterface: ModerationInterface;

  constructor(moderationInterface: ModerationInterface) {
    this.moderationInterface = moderationInterface;
  }

  /**
   * Registers route handlers on the given Express application.
   *
   * @param app - Express application instance
   * @param routePrefix - URL prefix for all routes (e.g. '/api/v1')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get(
      '/calendars/:calendarId/reports',
      ...ExpressHelper.loggedInOnly,
      this.listReports.bind(this),
    );

    router.get(
      '/calendars/:calendarId/reports/:reportId',
      ...ExpressHelper.loggedInOnly,
      this.getReport.bind(this),
    );

    router.put(
      '/calendars/:calendarId/reports/:reportId',
      ...ExpressHelper.loggedInOnly,
      this.updateReport.bind(this),
    );

    router.post(
      '/calendars/:calendarId/reports/:reportId/resolve',
      ...ExpressHelper.loggedInOnly,
      this.resolveReport.bind(this),
    );

    router.post(
      '/calendars/:calendarId/reports/:reportId/dismiss',
      ...ExpressHelper.loggedInOnly,
      this.dismissReport.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Extracts and validates common request context: authentication,
   * UUID format of path params, and calendar access permission.
   * Sends the appropriate error response and returns null if any check fails.
   *
   * @param req - Express request
   * @param res - Express response
   * @param requireReportId - Whether to also validate :reportId param
   * @returns Validated context or null if a response was already sent
   */
  private async requireAuth(req: Request, res: Response, requireReportId: boolean = false): Promise<AuthContext | null> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Authentication required',
        errorName: 'AuthenticationError',
      });
      return null;
    }

    const { calendarId, reportId } = req.params;

    if (!UUID_REGEX.test(calendarId)) {
      res.status(400).json({
        error: 'Invalid calendarId format',
        errorName: 'ValidationError',
      });
      return null;
    }

    if (requireReportId && !UUID_REGEX.test(reportId)) {
      res.status(400).json({
        error: 'Invalid reportId format',
        errorName: 'ValidationError',
      });
      return null;
    }

    const hasAccess = await this.moderationInterface.userCanReviewReports(account, calendarId);
    if (!hasAccess) {
      res.status(403).json({
        error: 'You do not have permission to manage reports for this calendar',
        errorName: 'ForbiddenError',
      });
      return null;
    }

    return { account, calendarId, reportId };
  }

  /**
   * Lists reports for a calendar with pagination and filtering.
   *
   * GET /api/v1/calendars/:calendarId/reports
   */
  async listReports(req: Request, res: Response): Promise<void> {
    const ctx = await this.requireAuth(req, res);
    if (!ctx) return;

    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const status = req.query.status as string | undefined;
      const category = req.query.category as string | undefined;
      const eventId = req.query.eventId as string | undefined;
      const source = req.query.source as string | undefined;
      const sortBy = req.query.sortBy as string | undefined;
      const sortOrder = req.query.sortOrder as string | undefined;

      const result = await this.moderationInterface.getReportsForCalendar(ctx.calendarId, {
        page,
        limit,
        status: status as any,
        category: category as any,
        eventId,
        source: source as ReporterType | undefined,
        sortBy: sortBy as any,
        sortOrder: sortOrder?.toUpperCase() as 'ASC' | 'DESC' | undefined,
      });

      res.json({
        reports: result.reports.map((report) => report.toOwnerObject()),
        pagination: result.pagination,
      });
    }
    catch (error: any) {
      if (error instanceof ReportValidationError) {
        res.status(400).json({
          error: error.message,
          errorName: 'ValidationError',
        });
        return;
      }

      logError(error, 'Failed to list reports for calendar');
      res.status(500).json({
        error: 'Failed to retrieve reports',
      });
    }
  }

  /**
   * Retrieves a single report with escalation history.
   *
   * GET /api/v1/calendars/:calendarId/reports/:reportId
   */
  async getReport(req: Request, res: Response): Promise<void> {
    const ctx = await this.requireAuth(req, res, true);
    if (!ctx) return;

    try {
      const report = await this.moderationInterface.getReportForCalendar(ctx.reportId!, ctx.calendarId);
      const escalationHistory = await this.moderationInterface.getEscalationHistory(ctx.reportId!);

      res.json({
        report: report.toOwnerObject(),
        escalationHistory,
      });
    }
    catch (error: any) {
      if (error instanceof ReportNotFoundError) {
        res.status(404).json({
          error: 'Report not found',
          errorName: 'ReportNotFoundError',
        });
        return;
      }

      logError(error, 'Failed to get report detail');
      res.status(500).json({
        error: 'Failed to retrieve report',
      });
    }
  }

  /**
   * Updates a report's owner notes.
   *
   * PUT /api/v1/calendars/:calendarId/reports/:reportId
   */
  async updateReport(req: Request, res: Response): Promise<void> {
    const ctx = await this.requireAuth(req, res, true);
    if (!ctx) return;

    const { ownerNotes } = req.body ?? {};

    if (ownerNotes === undefined || ownerNotes === null) {
      res.status(400).json({
        error: 'ownerNotes is required',
        errorName: 'ValidationError',
      });
      return;
    }

    if (typeof ownerNotes !== 'string') {
      res.status(400).json({
        error: 'ownerNotes must be a string',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      // Verify the report exists and belongs to this calendar
      await this.moderationInterface.getReportForCalendar(ctx.reportId!, ctx.calendarId);

      const updatedReport = await this.moderationInterface.updateReportNotes(ctx.reportId!, ownerNotes);

      res.json({
        report: updatedReport.toOwnerObject(),
      });
    }
    catch (error: any) {
      if (error instanceof ReportNotFoundError) {
        res.status(404).json({
          error: 'Report not found',
          errorName: 'ReportNotFoundError',
        });
        return;
      }

      logError(error, 'Failed to update report');
      res.status(500).json({
        error: 'Failed to update report',
      });
    }
  }

  /**
   * Resolves a report with notes.
   *
   * POST /api/v1/calendars/:calendarId/reports/:reportId/resolve
   */
  async resolveReport(req: Request, res: Response): Promise<void> {
    const ctx = await this.requireAuth(req, res, true);
    if (!ctx) return;

    const { notes } = req.body ?? {};

    if (!notes || (typeof notes === 'string' && notes.trim().length === 0)) {
      res.status(400).json({
        error: 'Notes are required to resolve a report',
        errorName: 'ValidationError',
      });
      return;
    }

    if (typeof notes !== 'string') {
      res.status(400).json({
        error: 'Notes must be a string',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      // Verify the report exists and belongs to this calendar
      await this.moderationInterface.getReportForCalendar(ctx.reportId!, ctx.calendarId);

      const resolvedReport = await this.moderationInterface.resolveReport(ctx.reportId!, ctx.account.id, notes.trim());

      res.json({
        message: 'Report resolved successfully',
        report: resolvedReport.toOwnerObject(),
      });
    }
    catch (error: any) {
      if (error instanceof ReportNotFoundError) {
        res.status(404).json({
          error: 'Report not found',
          errorName: 'ReportNotFoundError',
        });
        return;
      }

      if (error instanceof ReportAlreadyResolvedError) {
        res.status(409).json({
          error: error.message,
          errorName: 'ReportAlreadyResolvedError',
        });
        return;
      }

      logError(error, 'Failed to resolve report');
      res.status(500).json({
        error: 'Failed to resolve report',
      });
    }
  }

  /**
   * Dismisses a report. Auto-escalates to admin review.
   *
   * POST /api/v1/calendars/:calendarId/reports/:reportId/dismiss
   */
  async dismissReport(req: Request, res: Response): Promise<void> {
    const ctx = await this.requireAuth(req, res, true);
    if (!ctx) return;

    const { notes } = req.body ?? {};

    if (!notes || (typeof notes === 'string' && notes.trim().length === 0)) {
      res.status(400).json({
        error: 'Notes are required to dismiss a report',
        errorName: 'ValidationError',
      });
      return;
    }

    if (typeof notes !== 'string') {
      res.status(400).json({
        error: 'Notes must be a string',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      // Verify the report exists and belongs to this calendar
      await this.moderationInterface.getReportForCalendar(ctx.reportId!, ctx.calendarId);

      const dismissedReport = await this.moderationInterface.dismissReport(ctx.reportId!, ctx.account.id, notes.trim());

      res.json({
        message: 'Report dismissed and escalated to admin',
        report: dismissedReport.toOwnerObject(),
      });
    }
    catch (error: any) {
      if (error instanceof ReportNotFoundError) {
        res.status(404).json({
          error: 'Report not found',
          errorName: 'ReportNotFoundError',
        });
        return;
      }

      if (error instanceof ReportAlreadyResolvedError) {
        res.status(409).json({
          error: error.message,
          errorName: 'ReportAlreadyResolvedError',
        });
        return;
      }

      logError(error, 'Failed to dismiss report');
      res.status(500).json({
        error: 'Failed to dismiss report',
      });
    }
  }
}
