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
 * Rate limiter for the GET /notification endpoint.
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
    router.get(
      '/notification',
      ExpressHelper.loggedInOnly,
      notificationsRateLimiter,
      this.getNotifications.bind(this),
    );
    app.use(routePrefix, router);
  }

  /**
   * GET /api/v1/notification
   *
   * Returns paginated notifications for the authenticated user, ordered by
   * creation date descending (most recent first). The route handler clamps
   * `limit` to `[1, MAX_LIMIT]` and `offset` to `[0, MAX_OFFSET]`, then
   * delegates the recipient+activity query and wire-shape projection to
   * the notifications service through the domain interface. The route
   * handler does not import entity classes directly — that responsibility
   * lives on the service, matching the convention used by every other
   * domain API in the codebase.
   *
   * Query params:
   *   limit (optional): number of notifications to return (default 50, max 100)
   *   offset (optional): number of notifications to skip (default 0, max 10000)
   *
   * Response headers:
   *   Cache-Control: private, max-age=25
   */
  async getNotifications(req: Request, res: Response): Promise<void> {
    const account = req.user as Account | undefined;

    // Defense-in-depth — `loggedInOnly` middleware already 401s/403s on a
    // missing user, but explicit guard here prevents a crash if the route
    // is ever installed without the middleware (e.g. test misconfiguration).
    if (!account) {
      res.status(401).json({ error: 'not authenticated' });
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
      const notifications = await this.service.getNotifications(account.id, limit, offset);
      res.set('Cache-Control', 'private, max-age=25');
      res.json(notifications);
    }
    catch (error) {
      logError(error, 'Error fetching notifications');
      res.status(500).json({ error: 'An error occurred while fetching notifications' });
    }
  }
}
