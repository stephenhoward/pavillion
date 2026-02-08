import express, { Request, Response, Application } from 'express';

import ModerationInterface from '@/server/moderation/interface';
import { InvalidVerificationTokenError } from '@/server/moderation/exceptions';
import { reportVerificationByIp } from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Public-facing route handler for report email verification.
 *
 * Handles GET /reports/verify/:token for anonymous reporters
 * to confirm their email address after submitting a report.
 */
export default class VerifyRoutes {
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
    router.get(
      '/reports/verify/:token',
      reportVerificationByIp,
      this.verifyToken.bind(this),
    );
    app.use(routePrefix, router);
  }

  /**
   * Handles email verification for a submitted report.
   *
   * Validates the token via ModerationService and returns the appropriate
   * HTTP response based on the outcome.
   *
   * @param req - Express request with token param
   * @param res - Express response
   */
  async verifyToken(req: Request, res: Response): Promise<void> {
    const { token } = req.params;

    try {
      const report = await this.moderationInterface.verifyReport(token);

      res.status(200).json({
        message: 'Your report has been verified successfully. Thank you for helping keep our community safe.',
        reportId: report.id,
      });
    }
    catch (error: any) {
      if (error instanceof InvalidVerificationTokenError) {
        res.status(400).json({
          error: error.message,
          errorName: error.name,
        });
        return;
      }

      logError(error, 'Failed to verify report');
      res.status(500).json({
        error: 'Failed to verify report',
      });
    }
  }
}
