import express, { Request, Response, Application, RequestHandler } from 'express';
import config from 'config';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import { createAccountRateLimiter } from '@/server/common/middleware/rate-limit-by-account';
import NotificationsInterface from '@/server/notifications/interface';
import { NotificationRecipientNotFoundError } from '@/common/exceptions/notifications';
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
    router.patch(
      '/notification/:id',
      ExpressHelper.loggedInOnly,
      this.patchNotification.bind(this),
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

  /**
   * PATCH /api/v1/notification/:id
   *
   * Updates the recipient-side lifecycle flags (`seen` / `dismissed`) on a
   * single notification owned by the authenticated account. The route
   * accepts a body shaped `{ seen?: boolean, dismissed?: boolean }` and
   * delegates the flip semantics (timestamp on flip, null on reverse,
   * idempotent on no-op) to the service layer.
   *
   * Response codes:
   *   - 200: update applied (or no-op when the requested state matches).
   *   - 400: malformed body — missing `id`, neither flag supplied, non-boolean values.
   *   - 401: not authenticated (defense-in-depth alongside `loggedInOnly`).
   *   - 404: recipient not found OR belongs to another account. The two
   *     cases are intentionally indistinguishable — see
   *     `NotificationRecipientNotFoundError` for the rationale.
   *   - 500: unexpected service-layer failure.
   */
  async patchNotification(req: Request, res: Response): Promise<void> {
    const account = req.user as Account | undefined;

    if (!account) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }

    const id = req.params.id;
    if (!ExpressHelper.isValidUUID(id)) {
      // Invalid UUID — 404 rather than 400 so the response code does not
      // tell an attacker "this id was a syntactically valid UUID but no
      // row exists" vs "this id was malformed". The recipient table is
      // never enumerated through this endpoint; the 404 collapse is the
      // privacy mitigation.
      res.status(404).json({
        error: 'Notification not found',
        errorName: 'NotificationRecipientNotFoundError',
      });
      return;
    }

    const { seen, dismissed } = req.body ?? {};

    // Body validation: at least one flag must be supplied, and both must
    // be booleans when present. Reject everything else with 400.
    if (seen === undefined && dismissed === undefined) {
      res.status(400).json({
        error: 'At least one of `seen` or `dismissed` must be supplied',
        errorName: 'ValidationError',
      });
      return;
    }
    if (seen !== undefined && typeof seen !== 'boolean') {
      res.status(400).json({
        error: '`seen` must be a boolean',
        errorName: 'ValidationError',
      });
      return;
    }
    if (dismissed !== undefined && typeof dismissed !== 'boolean') {
      res.status(400).json({
        error: '`dismissed` must be a boolean',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      await this.service.updateRecipientState(account.id, id, { seen, dismissed });
      res.status(200).json({ ok: true });
    }
    catch (error) {
      if (error instanceof NotificationRecipientNotFoundError) {
        // Existence-not-leak invariant: 404 covers both "no row" and
        // "row belongs to another account". The service collapses the
        // two cases by combining the account_id filter into the WHERE
        // clause, so by the time we get here we cannot tell them apart
        // either.
        res.status(404).json({
          error: 'Notification not found',
          errorName: error.name,
        });
        return;
      }
      logError(error, 'Error updating notification recipient state');
      res.status(500).json({
        error: 'An error occurred while updating the notification',
        errorName: 'InternalServerError',
      });
    }
  }
}
