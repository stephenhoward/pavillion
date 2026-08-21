import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import FundingInterface from '@/server/funding/interface';
import { Account } from '@/common/model/account';
import { CalendarFundingSummary, FUNDING_GATED_FEATURES, FundingGatedFeature } from '@/common/model/funding-plan';
import { ValidationError } from '@/common/exceptions/base';
import {
  FundingPlanNotFoundError,
  CalendarFundingPlanNotFoundError,
  DuplicateCalendarFundingPlanError,
} from '@/common/exceptions/funding';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { limitCalendarFundingPlanByAccount } from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Calendar funding plan route handlers
 *
 * Manages per-calendar funding plan operations: adding/removing calendars
 * from a funding plan and checking funding status. All routes require
 * authentication and ownership verification.
 */
export default class CalendarFundingPlanRoutes {
  private service: FundingInterface;

  constructor(fundingInterface: FundingInterface) {
    this.service = fundingInterface;
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
      limitCalendarFundingPlanByAccount,
      this.addCalendar.bind(this),
    );

    router.get(
      '/calendars',
      ...ExpressHelper.loggedInOnly,
      this.getCalendars.bind(this),
    );

    router.delete(
      '/calendars/:calendarId',
      ...ExpressHelper.loggedInOnly,
      limitCalendarFundingPlanByAccount,
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

      await this.service.addCalendarToFundingPlan(
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
   * GET /calendars
   * Get all calendars in the authenticated user's funding plan
   *
   * Returns array of { calendarId, amount } for active calendar allocations.
   */
  async getCalendars(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const calendars = await this.service.getCalendarsInFundingPlan(account.id);

      res.json(calendars.map((c) => ({
        calendarId: c.calendarId,
        amount: c.amount,
      })));
    }
    catch (error) {
      logError(error, 'Error fetching calendars in funding plan');
      res.status(500).json({ error: 'Internal server error' });
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

      await this.service.removeCalendarFromFundingPlan(
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
   * Ownership is verified by the service layer via CalendarInterface
   * .isCalendarOwnerById, which matches the calendar membership role 'owner'
   * only. A calendar editor is therefore refused outright with 400
   * (ValidationError) — the funding of a calendar is its owner's business, and
   * an editor is not told anything about it.
   *
   * ## Response field allowlist
   *
   * The body is assembled field by field below, and a model's toObject() is
   * never handed to res.json(). That is deliberate rather than stylistic:
   * FundingPlan.toObject() includes accountId, and the entity behind it holds
   * provider_customer_id and provider_subscription_id. Those identify the
   * owner's account and their Stripe customer/subscription objects, answer no
   * question this screen asks, and must not reach any caller here. Widening
   * this response means adding a named field to CalendarFundingSummary and to
   * the literal below — never relaxing it into a spread.
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

      const summary = await this.service.getCalendarFundingSummary(account.id, calendarId);

      // Annotated, not spread: the annotation makes CalendarFundingSummary the
      // checkable allowlist for this body rather than a prose one. A field
      // dropped here stops compiling, and a field added here has to be added
      // to the type first — which is where the reasoning about what an owner
      // may be told lives.
      const body: CalendarFundingSummary = {
        status: summary.status,
        // The registry is the allowlist for this sub-object: only registered
        // funding-gated features are reported, whatever the service returned.
        features: Object.fromEntries(
          (Object.keys(FUNDING_GATED_FEATURES) as FundingGatedFeature[])
            .map((feature) => [feature, summary.features[feature] === true]),
        ) as Record<FundingGatedFeature, boolean>,
      };

      res.json(body);
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
