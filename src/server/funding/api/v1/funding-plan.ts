import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import FundingInterface from '@/server/funding/interface';
import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import { logError } from '@/server/common/helper/error-logger';

/**
 * User funding plan route handlers
 *
 * All routes require authentication via ExpressHelper.loggedInOnly
 */
export default class FundingPlanRoutes {
  private service: FundingInterface;

  constructor(fundingInterface: FundingInterface) {
    this.service = fundingInterface;
  }

  /**
   * Install user funding plan route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/funding/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    // All user funding plan endpoints require authentication
    router.get('/options', ExpressHelper.loggedInOnly, this.getOptions.bind(this));
    router.get('/status', ExpressHelper.loggedInOnly, this.getStatus.bind(this));
    router.post('/cancel', ExpressHelper.loggedInOnly, this.cancel.bind(this));
    router.get('/portal', ExpressHelper.loggedInOnly, this.getPortal.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * GET /options
   * Get available funding plan options (enabled providers, pricing)
   */
  async getOptions(req: Request, res: Response): Promise<void> {
    try {
      const options = await this.service.getOptions();

      res.json(options);
    }
    catch (error) {
      logError(error, 'Error fetching funding plan options');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /status
   * Get current user's funding plan status
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const fundingPlan = await this.service.getStatus(account.id);

      if (!fundingPlan) {
        res.status(404).json({ error: 'No funding plan found', errorName: 'FundingPlanNotFoundError' });
        return;
      }

      res.json({
        id: fundingPlan.id,
        status: fundingPlan.status,
        billingCycle: fundingPlan.billingCycle,
        amount: fundingPlan.amount,
        currency: fundingPlan.currency,
        currentPeriodStart: fundingPlan.currentPeriodStart,
        currentPeriodEnd: fundingPlan.currentPeriodEnd,
        cancelledAt: fundingPlan.cancelledAt,
        suspendedAt: fundingPlan.suspendedAt,
      });
    }
    catch (error) {
      logError(error, 'Error fetching funding plan status');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /cancel
   * Cancel funding plan (continues to end of billing period)
   */
  async cancel(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Get user's funding plan to get the ID
      const fundingPlan = await this.service.getStatus(account.id);

      if (!fundingPlan) {
        res.status(404).json({ error: 'No funding plan found', errorName: 'FundingPlanNotFoundError' });
        return;
      }

      // Cancel at end of period (immediate = false)
      await this.service.cancel(fundingPlan.id, false);

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error canceling funding plan');
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message, errorName: 'NotFoundError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /portal
   * Get provider's billing portal URL for funding plan management
   */
  async getPortal(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const returnUrl = req.query.returnUrl as string;

      const portalUrl = await this.service.getBillingPortalUrl(account.id, returnUrl);

      res.json({ portalUrl });
    }
    catch (error) {
      logError(error, 'Error getting billing portal URL');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message, errorName: 'NotFoundError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
