import express, { Request, Response, Application, RequestHandler } from 'express';
import config from 'config';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import { createAccountRateLimiter } from '@/server/common/middleware/rate-limit-by-account';
import NotificationsInterface from '@/server/notifications/interface';
import { logError } from '@/server/common/helper/error-logger';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;

/**
 * Rate limiter for the GET /notifications endpoint.
 * Allows 10 requests per minute per authenticated user.
 * Respects the rateLimit.enabled config flag (disabled in test/e2e environments).
 */
const notificationsRateLimiter: RequestHandler = config.get<boolean>('rateLimit.enabled')
  ? createAccountRateLimiter(10, 60000, 'notifications')
  : (_req, _res, next) => next();

export default class NotificationRoutes {
  private service: NotificationsInterface;

  constructor(internalAPI: NotificationsInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/notifications', ExpressHelper.loggedInOnly, notificationsRateLimiter, this.getNotifications.bind(this));
    router.post('/notifications/mark-all-seen', ExpressHelper.loggedInOnly, this.markAllSeen.bind(this));
    app.use(routePrefix, router);
  }

  /**
   * GET /api/v1/notifications
   *
   * Returns paginated notifications for the authenticated user, ordered by
   * creation date descending (most recent first).
   *
   * Query params:
   *   limit (optional): number of notifications to return (default 50, max 100)
   *   offset (optional): number of notifications to skip (default 0, max 10000)
   *
   * Response headers:
   *   Cache-Control: private, max-age=25
   */
  async getNotifications(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({ message: 'forbidden' });
      return;
    }

    let limit = DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      const parsed = parseInt(req.query.limit as string, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, MAX_LIMIT);
      }
    }

    let offset = 0;
    if (req.query.offset !== undefined) {
      const parsed = parseInt(req.query.offset as string, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        offset = Math.min(parsed, MAX_OFFSET);
      }
    }

    try {
      const notifications = await this.service.getNotificationsForAccount(account.id, limit, offset);
      res.set('Cache-Control', 'private, max-age=25');
      res.json(notifications.map(n => n.toObject()));
    }
    catch (error) {
      logError(error, 'Error fetching notifications');
      res.status(500).json({ error: 'An error occurred while fetching notifications' });
    }
  }

  /**
   * POST /api/v1/notifications/mark-all-seen
   *
   * Marks all unseen notifications for the authenticated user as seen.
   * Bodyless operation — scoped strictly by the authenticated account ID
   * to prevent IDOR.
   */
  async markAllSeen(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;

    if (!account) {
      res.status(403).json({ message: 'forbidden' });
      return;
    }

    try {
      await this.service.markAllSeenForAccount(account.id);
      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error marking notifications as seen');
      res.status(500).json({ error: 'An error occurred while marking notifications as seen' });
    }
  }
}
