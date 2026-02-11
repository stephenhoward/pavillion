import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import ModerationInterface from '@/server/moderation/interface';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Route handler for admin blocked reporters endpoints.
 *
 * Provides GET, POST, and DELETE endpoints for managing
 * blocked reporter email addresses in the moderation system.
 */
export default class BlockedReportersRoutes {
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
      '/admin/moderation/blocked-reporters',
      ...ExpressHelper.adminOnly,
      this.listBlockedReporters.bind(this),
    );

    router.post(
      '/admin/moderation/blocked-reporters',
      ...ExpressHelper.adminOnly,
      this.blockReporter.bind(this),
    );

    router.delete(
      '/admin/moderation/blocked-reporters/:emailHash',
      ...ExpressHelper.adminOnly,
      this.unblockReporter.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Returns list of all blocked reporters.
   *
   * GET /api/v1/admin/moderation/blocked-reporters
   */
  async listBlockedReporters(_req: Request, res: Response): Promise<void> {
    try {
      const blockedReporters = await this.moderationInterface.listBlockedReporters();
      res.json(blockedReporters.map((reporter) => reporter.toObject()));
    }
    catch (error: any) {
      logError(error, 'Failed to retrieve blocked reporters');
      res.status(500).json({
        error: 'Failed to retrieve blocked reporters',
      });
    }
  }

  /**
   * Blocks a reporter email address.
   *
   * POST /api/v1/admin/moderation/blocked-reporters
   */
  async blockReporter(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { email, reason } = req.body ?? {};

    // Validate input
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      res.status(400).json({
        error: 'Email is required and must be a non-empty string',
        errorName: 'ValidationError',
      });
      return;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      res.status(400).json({
        error: 'Reason is required and must be a non-empty string',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const blockedReporter = await this.moderationInterface.blockReporter(
        email.trim(),
        account,
        reason.trim(),
      );

      res.status(201).json(blockedReporter.toObject());
    }
    catch (error: any) {
      logError(error, 'Failed to block reporter');
      res.status(500).json({
        error: 'Failed to block reporter',
      });
    }
  }

  /**
   * Unblocks a reporter email address.
   *
   * DELETE /api/v1/admin/moderation/blocked-reporters/:emailHash
   */
  async unblockReporter(req: Request, res: Response): Promise<void> {
    const { emailHash } = req.params;

    try {
      await this.moderationInterface.unblockReporter(emailHash);
      res.status(204).send();
    }
    catch (error: any) {
      logError(error, 'Failed to unblock reporter');
      res.status(500).json({
        error: 'Failed to unblock reporter',
      });
    }
  }
}
