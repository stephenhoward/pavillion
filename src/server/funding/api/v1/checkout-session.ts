import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import FundingInterface from '@/server/funding/interface';
import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import {
  ActiveFundingPlanExistsError,
  ProviderNotConfiguredError,
  InvalidSessionIdError,
  FundingPlanNotFoundError,
} from '@/common/exceptions/funding';
import { checkoutSessionByAccount } from '@/server/common/middleware/rate-limiters';
import { logError } from '@/server/common/helper/error-logger';
import { MAX_CALENDAR_IDS } from '@/server/funding/service/funding';

/**
 * Checkout session route handlers
 *
 * Manages Stripe embedded checkout session creation and status retrieval.
 * All routes require authentication via ExpressHelper.loggedInOnly.
 */
export default class CheckoutSessionRoutes {
  private service: FundingInterface;

  constructor(fundingInterface: FundingInterface) {
    this.service = fundingInterface;
  }

  /**
   * Install checkout session route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/funding/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    router.post(
      '/checkout-sessions',
      ...ExpressHelper.loggedInOnly,
      checkoutSessionByAccount,
      this.createSession.bind(this),
    );

    router.get(
      '/checkout-sessions/:sessionId/status',
      ...ExpressHelper.loggedInOnly,
      this.getSessionStatus.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * POST /checkout-sessions
   * Create a Stripe checkout session for embedded checkout
   *
   * Body: { billingCycle: string, returnUrl: string, amount?: number, calendarIds?: string[] }
   */
  async createSession(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { billingCycle, returnUrl, amount, calendarIds } = req.body;

      // Validate required fields
      if (!billingCycle) {
        res.status(400).json({ error: 'billingCycle is required', errorName: 'ValidationError' });
        return;
      }

      if (!returnUrl || typeof returnUrl !== 'string') {
        res.status(400).json({ error: 'returnUrl is required', errorName: 'ValidationError' });
        return;
      }

      // Validate calendarIds if provided
      if (calendarIds !== undefined) {
        if (!Array.isArray(calendarIds)) {
          res.status(400).json({ error: 'calendarIds must be an array', errorName: 'ValidationError' });
          return;
        }

        if (calendarIds.length > MAX_CALENDAR_IDS) {
          res.status(400).json({ error: `calendarIds cannot exceed ${MAX_CALENDAR_IDS} entries`, errorName: 'ValidationError' });
          return;
        }

        const invalidUUIDs = ExpressHelper.findInvalidUUIDs(calendarIds);
        if (invalidUUIDs.length > 0) {
          res.status(400).json({ error: `Invalid calendar IDs: ${invalidUUIDs.join(', ')}`, errorName: 'ValidationError' });
          return;
        }
      }

      const result = await this.service.createCheckoutSession(
        account.id,
        billingCycle,
        returnUrl,
        amount,
        calendarIds,
      );

      res.json({
        clientSecret: result.clientSecret,
        sessionId: result.sessionId,
      });
    }
    catch (error) {
      logError(error, 'Error creating checkout session');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof ActiveFundingPlanExistsError) {
        res.status(409).json({ error: error.message, errorName: 'ActiveFundingPlanExistsError' });
      }
      else if (error instanceof ProviderNotConfiguredError) {
        res.status(404).json({ error: error.message, errorName: 'ProviderNotConfiguredError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /checkout-sessions/:sessionId/status
   * Get the status of a checkout session
   */
  async getSessionStatus(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { sessionId } = req.params;

      const result = await this.service.getCheckoutSessionStatus(
        account.id,
        sessionId,
      );

      res.json(result);
    }
    catch (error) {
      logError(error, 'Error fetching checkout session status');
      if (error instanceof InvalidSessionIdError) {
        res.status(400).json({ error: error.message, errorName: 'InvalidSessionIdError' });
      }
      else if (error instanceof FundingPlanNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'FundingPlanNotFoundError' });
      }
      else if (error instanceof ProviderNotConfiguredError) {
        res.status(404).json({ error: error.message, errorName: 'ProviderNotConfiguredError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
