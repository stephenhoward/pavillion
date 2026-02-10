import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import type { ReporterType, EscalationType } from '@/common/model/report';
import { ReportValidationError, DuplicateReportError } from '@/common/exceptions/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import ExpressHelper from '@/server/common/helper/express';
import ModerationInterface from '@/server/moderation/interface';
import {
  ReportNotFoundError,
  ReportAlreadyResolvedError,
} from '@/server/moderation/exceptions';
import { VALID_ADMIN_ACTIONS } from '@/server/moderation/service/moderation';
import { logError } from '@/server/common/helper/error-logger';

/** UUID v4 format regex for path parameter validation. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Route handler for admin report management.
 *
 * Provides endpoints for instance administrators to list, view,
 * create, and act on escalated and admin-initiated reports across all calendars.
 */
export default class AdminReportRoutes {
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
      '/admin/reports',
      ...ExpressHelper.adminOnly,
      this.listReports.bind(this),
    );

    router.post(
      '/admin/reports',
      ...ExpressHelper.adminOnly,
      this.createReport.bind(this),
    );

    router.get(
      '/admin/reports/:reportId',
      ...ExpressHelper.adminOnly,
      this.getReport.bind(this),
    );

    router.put(
      '/admin/reports/:reportId',
      ...ExpressHelper.adminOnly,
      this.updateReport.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Lists admin-relevant reports with pagination and filtering.
   * Returns escalated reports and admin-initiated reports.
   *
   * GET /api/v1/admin/reports
   */
  async listReports(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Authentication required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    if (!account.hasRole('admin')) {
      res.status(403).json({
        error: 'Admin access required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const status = req.query.status as string | undefined;
      const category = req.query.category as string | undefined;
      const calendarId = req.query.calendarId as string | undefined;
      const source = req.query.source as string | undefined;
      const escalationType = req.query.escalationType as string | undefined;
      const sortBy = req.query.sortBy as string | undefined;
      const sortOrder = req.query.sortOrder as string | undefined;

      const result = await this.moderationInterface.getAdminReports({
        page,
        limit,
        status: status as any,
        category: category as any,
        calendarId,
        source: source as ReporterType | undefined,
        escalationType: escalationType as EscalationType | undefined,
        sortBy: sortBy as any,
        sortOrder: sortOrder?.toUpperCase() as 'ASC' | 'DESC' | undefined,
      });

      res.json({
        reports: result.reports.map((report) => report.toAdminObject()),
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

      logError(error, 'Failed to list admin reports');
      res.status(500).json({
        error: 'Failed to retrieve reports',
      });
    }
  }

  /**
   * Creates an admin-initiated report for an event.
   * Admin reports skip email verification and go directly to submitted status.
   *
   * POST /api/v1/admin/reports
   */
  async createReport(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Authentication required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    if (!account.hasRole('admin')) {
      res.status(403).json({
        error: 'Admin access required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    const { eventId, category, description, priority, deadline, adminNotes } = req.body ?? {};

    try {
      const report = await this.moderationInterface.createAdminReport({
        eventId,
        category,
        description: typeof description === 'string' ? description.trim() : description,
        adminId: account.id,
        priority,
        deadline: deadline ? new Date(deadline) : undefined,
        adminNotes: typeof adminNotes === 'string' ? adminNotes.trim() : adminNotes,
      });

      res.status(201).json({
        message: 'Report created successfully',
        report: report.toAdminObject(),
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

      if (error instanceof EventNotFoundError) {
        res.status(404).json({
          error: 'Event not found',
          errorName: 'EventNotFoundError',
        });
        return;
      }

      if (error instanceof DuplicateReportError) {
        res.status(409).json({
          error: error.message,
          errorName: error.name,
        });
        return;
      }

      logError(error, 'Failed to create admin report');
      res.status(500).json({
        error: 'Failed to create report',
      });
    }
  }

  /**
   * Retrieves a single report with escalation history and owner notes.
   *
   * GET /api/v1/admin/reports/:reportId
   */
  async getReport(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Authentication required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    if (!account.hasRole('admin')) {
      res.status(403).json({
        error: 'Admin access required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    const { reportId } = req.params;

    if (!UUID_REGEX.test(reportId)) {
      res.status(400).json({
        error: 'Invalid reportId format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const report = await this.moderationInterface.getAdminReport(reportId);
      const escalationHistory = await this.moderationInterface.getEscalationHistory(reportId);

      res.json({
        report: report.toAdminObject(),
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

      logError(error, 'Failed to get admin report detail');
      res.status(500).json({
        error: 'Failed to retrieve report',
      });
    }
  }

  /**
   * Performs an admin action on a report.
   * Supported actions: override, resolve, dismiss.
   *
   * PUT /api/v1/admin/reports/:reportId
   */
  async updateReport(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Authentication required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    if (!account.hasRole('admin')) {
      res.status(403).json({
        error: 'Admin access required',
        errorName: 'ForbiddenError',
      });
      return;
    }

    const { reportId } = req.params;

    if (!UUID_REGEX.test(reportId)) {
      res.status(400).json({
        error: 'Invalid reportId format',
        errorName: 'ValidationError',
      });
      return;
    }

    const { action, notes } = req.body ?? {};

    if (!action) {
      res.status(400).json({
        error: 'Action is required',
        errorName: 'ValidationError',
      });
      return;
    }

    if (!VALID_ADMIN_ACTIONS.includes(action)) {
      res.status(400).json({
        error: `Invalid action. Must be one of: ${VALID_ADMIN_ACTIONS.join(', ')}`,
        errorName: 'ValidationError',
      });
      return;
    }

    if (!notes || (typeof notes === 'string' && notes.trim().length === 0)) {
      res.status(400).json({
        error: 'Notes are required for admin actions',
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
      let updatedReport;

      switch (action) {
        case 'resolve':
          updatedReport = await this.moderationInterface.adminResolveReport(reportId, account.id, notes.trim());
          break;
        case 'dismiss':
          updatedReport = await this.moderationInterface.adminDismissReport(reportId, account.id, notes.trim());
          break;
        case 'override':
          updatedReport = await this.moderationInterface.adminOverrideReport(reportId, account.id, notes.trim());
          break;
      }

      res.json({
        message: `Report ${action} successful`,
        report: updatedReport!.toAdminObject(),
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

      logError(error, `Failed to ${action} report`);
      res.status(500).json({
        error: `Failed to ${action} report`,
      });
    }
  }
}
