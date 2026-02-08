import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import { ReportCategory } from '@/common/model/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import ExpressHelper from '@/server/common/helper/express';
import ModerationInterface from '@/server/moderation/interface';
import {
  reportSubmissionByIp,
  reportSubmissionByAccount,
} from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Authenticated route handler for event report submission.
 *
 * Handles POST /reports for logged-in users who want to report
 * an event. Requires JWT authentication via loggedInOnly middleware.
 * No email verification is needed for authenticated reporters.
 *
 * Rate limited by IP address (shared with public routes) and
 * per-account (max 20 reports per account per hour).
 */
export default class AuthenticatedReportRoutes {
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
    router.post(
      '/reports',
      ...ExpressHelper.loggedInOnly,
      reportSubmissionByIp,
      reportSubmissionByAccount,
      this.submitReport.bind(this),
    );
    app.use(routePrefix, router);
  }

  /**
   * Handles authenticated report submission.
   *
   * Parses the request body and delegates to ModerationInterface
   * for validation, event lookup, and report creation. Uses the
   * authenticated user's account ID as the reporter identifier.
   *
   * @param req - Express request with authenticated user and report body
   * @param res - Express response
   */
  async submitReport(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({
        error: 'Authentication required',
        errorName: 'AuthenticationError',
      });
      return;
    }

    const { eventId, category, description } = req.body ?? {};

    try {
      const report = await this.moderationInterface.createReportForEvent({
        eventId,
        category: category as ReportCategory,
        description: typeof description === 'string' ? description.trim() : description,
        reporterAccountId: account.id,
        reporterType: 'authenticated',
      });

      res.status(201).json({
        message: 'Report submitted successfully.',
        report: report.toReporterObject(),
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

      logError(error, 'Failed to submit authenticated report');
      res.status(500).json({
        error: 'Failed to submit report',
      });
    }
  }
}
