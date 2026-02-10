import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import ModerationInterface from '@/server/moderation/interface';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Route handler for admin instance blocking endpoints.
 *
 * Provides POST, GET, and DELETE endpoints for blocking/unblocking
 * ActivityPub instances at the federation level.
 */
export default class AdminInstanceRoutes {
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
      '/admin/moderation/block-instance',
      ...ExpressHelper.adminOnly,
      this.blockInstance.bind(this),
    );

    router.get(
      '/admin/moderation/blocked-instances',
      ...ExpressHelper.adminOnly,
      this.listBlockedInstances.bind(this),
    );

    router.delete(
      '/admin/moderation/blocked-instances/:domain',
      ...ExpressHelper.adminOnly,
      this.unblockInstance.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Blocks an instance from federating with this instance.
   *
   * POST /api/v1/admin/moderation/block-instance
   */
  async blockInstance(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { domain, reason } = req.body ?? {};

    // Validate input
    if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
      res.status(400).json({
        error: 'Domain is required and must be a non-empty string',
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
      const blockedInstance = await this.moderationInterface.blockInstance(
        domain.trim(),
        reason.trim(),
        account.id,
      );

      res.status(201).json(blockedInstance.toObject());
    }
    catch (error: any) {
      if (error.name === 'InstanceAlreadyBlockedError') {
        res.status(409).json({
          error: 'Instance is already blocked',
          errorName: error.name,
        });
        return;
      }

      logError(error, 'Failed to block instance');
      res.status(500).json({
        error: 'Failed to block instance',
      });
    }
  }

  /**
   * Returns list of all blocked instances.
   *
   * GET /api/v1/admin/moderation/blocked-instances
   */
  async listBlockedInstances(_req: Request, res: Response): Promise<void> {
    try {
      const blockedInstances = await this.moderationInterface.listBlockedInstances();
      res.json(blockedInstances.map((instance) => instance.toObject()));
    }
    catch (error: any) {
      logError(error, 'Failed to retrieve blocked instances');
      res.status(500).json({
        error: 'Failed to retrieve blocked instances',
      });
    }
  }

  /**
   * Unblocks an instance, allowing it to federate again.
   *
   * DELETE /api/v1/admin/moderation/blocked-instances/:domain
   */
  async unblockInstance(req: Request, res: Response): Promise<void> {
    const { domain } = req.params;

    try {
      await this.moderationInterface.unblockInstance(domain);
      res.status(204).send();
    }
    catch (error: any) {
      logError(error, 'Failed to unblock instance');
      res.status(500).json({
        error: 'Failed to unblock instance',
      });
    }
  }
}
