import express, { Request, Response, Application } from 'express';

import { ReportCategory } from '@/common/model/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import ModerationInterface from '@/server/moderation/interface';
import { DuplicateReportError, EmailRateLimitError } from '@/server/moderation/exceptions';
import {
  reportSubmissionByIp,
  reportSubmissionByEmail,
} from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';

/** Valid report categories derived from the ReportCategory enum values. */
const VALID_CATEGORIES = Object.values(ReportCategory);

/** Basic email format validation pattern. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Maximum allowed length for email address (RFC 5321 limit). */
const MAX_EMAIL_LENGTH = 254;

/** Maximum allowed length for report description text. */
const MAX_DESCRIPTION_LENGTH = 2000;

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
   * Validates the request body (category, description, email)
   * and delegates to ModerationInterface for event lookup
   * and report creation.
   *
   * @param req - Express request with eventId param and report body
   * @param res - Express response
   */
  async submitReport(req: Request, res: Response): Promise<void> {
    const { eventId } = req.params;
    const { category, description, email } = req.body ?? {};

    // Validate required fields
    const validationErrors = this.validateReportInput(category, description, email);
    if (validationErrors.length > 0) {
      res.status(400).json({
        error: validationErrors.join('; '),
        errorName: 'ValidationError',
      });
      return;
    }

    // Delegate to ModerationInterface for event lookup and report creation
    try {
      const report = await this.moderationInterface.createReportForEvent({
        eventId,
        category: category as ReportCategory,
        description: description.trim(),
        reporterEmail: email.trim().toLowerCase(),
        reporterType: 'anonymous',
      });

      res.status(201).json({
        message: 'Report submitted. Please check your email to verify.',
        reportId: report.id,
      });
    }
    catch (error: any) {
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

      logError(error, 'Failed to submit report');
      res.status(500).json({
        error: 'Failed to submit report',
      });
    }
  }

  /**
   * Validates report submission input fields.
   *
   * @param category - Report category enum value
   * @param description - Report description text
   * @param email - Reporter email address
   * @returns Array of validation error messages (empty if valid)
   */
  private validateReportInput(category: any, description: any, email: any): string[] {
    const errors: string[] = [];

    // Category validation
    if (!category) {
      errors.push('Category is required');
    }
    else if (!VALID_CATEGORIES.includes(category)) {
      errors.push(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    // Description validation
    if (!description) {
      errors.push('Description is required');
    }
    else if (typeof description === 'string' && description.trim().length === 0) {
      errors.push('Description is required');
    }
    else if (typeof description === 'string' && description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
    }

    // Email validation
    if (!email) {
      errors.push('Email is required');
    }
    else if (typeof email === 'string' && email.trim().length > MAX_EMAIL_LENGTH) {
      errors.push(`Email address must be ${MAX_EMAIL_LENGTH} characters or fewer`);
    }
    else if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      errors.push('A valid email address is required');
    }

    return errors;
  }
}
