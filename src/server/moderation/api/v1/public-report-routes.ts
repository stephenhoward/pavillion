import express, { Request, Response, Application } from 'express';

import { ReportCategory } from '@/common/model/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import ModerationInterface from '@/server/moderation/interface';
import { EmailRateLimitError, ReporterBlockedError } from '@/server/moderation/exceptions';
import {
  reportSubmissionByIp,
  reportSubmissionByEmail,
} from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Public-facing route handler for anonymous event report submission.
 *
 * Handles POST /events/:eventId/reports for anonymous visitors
 * who want to report an event. No authentication is required.
 */
export default class PublicReportRoutes {
  private moderationInterface: ModerationInterface;

  constructor(moderationInterface: ModerationInterface) {
    this.moderationInterface = moderationInterface;
  }

  /**
   * Registers route handlers on the given Express application.
   *
   * @param app - Express application instance
   * @param routePrefix - URL prefix for all routes (e.g. '/api/public/v1')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.post(
      '/events/:eventId/reports',
      reportSubmissionByIp,
      reportSubmissionByEmail,
      this.submitReport.bind(this),
    );
    app.use(routePrefix, router);
  }

  /**
   * Handles anonymous report submission for a specific event.
   *
   * Parses the request body and delegates to ModerationInterface
   * for validation, event lookup, and report creation.
   *
   * @param req - Express request with eventId param and report body
   * @param res - Express response
   */
  async submitReport(req: Request, res: Response): Promise<void> {
    const { eventId } = req.params;
    const { category, description, email } = req.body ?? {};

    try {
      const report = await this.moderationInterface.createReportForEvent({
        eventId,
        category: category as ReportCategory,
        description: typeof description === 'string' ? description.trim() : description,
        reporterEmail: typeof email === 'string' ? email.trim().toLowerCase() : email,
        reporterType: 'anonymous',
      });

      res.status(201).json({
        message: 'Report submitted. Please check your email to verify.',
        reportId: report.id,
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

      if (error instanceof EmailRateLimitError) {
        res.status(429).json({
          error: error.message,
          errorName: error.name,
        });
        return;
      }

      if (error instanceof ReporterBlockedError) {
        res.status(403).json({
          error: error.message,
          errorName: error.name,
        });
        return;
      }

      logError(error, 'Failed to submit report');
      res.status(500).json({
        error: 'Failed to submit report',
      });
    }
  }
}
