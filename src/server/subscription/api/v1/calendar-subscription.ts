import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import SubscriptionInterface from '@/server/subscription/interface';
import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import {
  SubscriptionNotFoundError,
  CalendarSubscriptionNotFoundError,
  DuplicateCalendarSubscriptionError,
  CalendarNotFoundError,
} from '@/server/subscription/exceptions';
import { calendarSubscriptionByAccount } from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Calendar subscription route handlers
 *
 * Manages per-calendar subscription operations: adding/removing calendars
 * from a subscription and checking funding status. All routes require
 * authentication and ownership verification.
 */
export default class CalendarSubscriptionRoutes {
  private interface: SubscriptionInterface;

  constructor(subscriptionInterface: SubscriptionInterface) {
    this.interface = subscriptionInterface;
  }

  /**
   * Install calendar subscription route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/subscription/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    router.post(
      '/calendars',
      ...ExpressHelper.loggedInOnly,
      calendarSubscriptionByAccount,
      this.addCalendar.bind(this),
    );

    router.delete(
      '/calendars/:calendarId',
      ...ExpressHelper.loggedInOnly,
      calendarSubscriptionByAccount,
      this.removeCalendar.bind(this),
    );

    router.get(
      '/calendars/:calendarId/funding',
      ...ExpressHelper.loggedInOnly,
      this.getFundingStatus.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * POST /calendars
   * Add a calendar to the user's subscription
   *
   * Body: { calendarId: string, amount: number }
   */
  async addCalendar(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { calendarId, amount } = req.body;

      if (!calendarId) {
        res.status(400).json({ error: 'calendarId is required', errorName: 'ValidationError' });
        return;
      }

      if (!ExpressHelper.isValidUUID(calendarId)) {
        res.status(400).json({ error: 'Invalid calendarId: must be a valid UUID', errorName: 'ValidationError' });
        return;
      }

      if (amount === undefined || amount === null || typeof amount !== 'number') {
        res.status(400).json({ error: 'amount is required and must be a number', errorName: 'ValidationError' });
        return;
      }

      await this.interface.addCalendarToSubscription(
        account.id,
        calendarId,
        amount,
      );

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error adding calendar to subscription');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof SubscriptionNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'SubscriptionNotFoundError' });
      }
      else if (error instanceof DuplicateCalendarSubscriptionError) {
        res.status(409).json({ error: error.message, errorName: 'DuplicateCalendarSubscriptionError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * DELETE /calendars/:calendarId
   * Remove a calendar from the user's subscription
   */
  async removeCalendar(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { calendarId } = req.params;

      if (!ExpressHelper.isValidUUID(calendarId)) {
        res.status(400).json({ error: 'Invalid calendarId: must be a valid UUID', errorName: 'ValidationError' });
        return;
      }

      await this.interface.removeCalendarFromSubscription(
        account.id,
        calendarId,
      );

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error removing calendar from subscription');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof CalendarSubscriptionNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'CalendarSubscriptionNotFoundError' });
      }
      else if (error instanceof SubscriptionNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'SubscriptionNotFoundError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /calendars/:calendarId/funding
   * Get funding status for a calendar (owner-only)
   *
   * Ownership is verified by the service layer. Returns 400 (ValidationError)
   * if the authenticated user does not own the calendar.
   */
  async getFundingStatus(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { calendarId } = req.params;

      if (!ExpressHelper.isValidUUID(calendarId)) {
        res.status(400).json({ error: 'Invalid calendarId: must be a valid UUID', errorName: 'ValidationError' });
        return;
      }

      const fundingStatus = await this.interface.getFundingStatusForCalendar(account.id, calendarId);

      res.json({ calendarId, fundingStatus });
    }
    catch (error) {
      logError(error, 'Error fetching funding status');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'CalendarNotFoundError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
