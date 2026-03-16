import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import FundingInterface from '@/server/funding/interface';
import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import {
  FundingPlanNotFoundError,
  CalendarFundingPlanNotFoundError,
  DuplicateCalendarFundingPlanError,
  CalendarNotFoundError,
} from '@/server/funding/exceptions';
import { calendarFundingPlanByAccount } from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Calendar funding plan route handlers
 *
 * Manages per-calendar funding plan operations: adding/removing calendars
 * from a funding plan and checking funding status. All routes require
 * authentication and ownership verification.
 */
export default class CalendarFundingPlanRoutes {
  private interface: FundingInterface;

  constructor(fundingInterface: FundingInterface) {
    this.interface = fundingInterface;
  }

  /**
   * Install calendar funding plan route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/funding/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    router.post(
      '/calendars',
      ...ExpressHelper.loggedInOnly,
      calendarFundingPlanByAccount,
      this.addCalendar.bind(this),
    );

    router.delete(
      '/calendars/:calendarId',
      ...ExpressHelper.loggedInOnly,
      calendarFundingPlanByAccount,
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
   * Add a calendar to the user's funding plan
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

      await this.interface.addCalendarToFundingPlan(
        account.id,
        calendarId,
        amount,
      );

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error adding calendar to funding plan');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof FundingPlanNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'FundingPlanNotFoundError' });
      }
      else if (error instanceof DuplicateCalendarFundingPlanError) {
        res.status(409).json({ error: error.message, errorName: 'DuplicateCalendarFundingPlanError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * DELETE /calendars/:calendarId
   * Remove a calendar from the user's funding plan
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

      await this.interface.removeCalendarFromFundingPlan(
        account.id,
        calendarId,
      );

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error removing calendar from funding plan');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof CalendarFundingPlanNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'CalendarFundingPlanNotFoundError' });
      }
      else if (error instanceof FundingPlanNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'FundingPlanNotFoundError' });
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
