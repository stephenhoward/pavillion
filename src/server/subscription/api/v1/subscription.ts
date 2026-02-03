import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import SubscriptionInterface from '@/server/subscription/interface';
import { Account } from '@/common/model/account';
import {
  InvalidBillingCycleError,
  InvalidAmountError,
  MissingRequiredFieldError,
} from '@/server/subscription/exceptions';

/**
 * User subscription route handlers
 *
 * All routes require authentication via ExpressHelper.loggedInOnly
 */
export default class SubscriptionRouteHandlers {
  private interface: SubscriptionInterface;

  constructor(subscriptionInterface: SubscriptionInterface) {
    this.interface = subscriptionInterface;
  }

  /**
   * Install user subscription route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/subscription/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    // All user subscription endpoints require authentication
    router.get('/options', ExpressHelper.loggedInOnly, this.getOptions.bind(this));
    router.post('/subscribe', ExpressHelper.loggedInOnly, this.subscribe.bind(this));
    router.get('/status', ExpressHelper.loggedInOnly, this.getStatus.bind(this));
    router.post('/cancel', ExpressHelper.loggedInOnly, this.cancel.bind(this));
    router.get('/portal', ExpressHelper.loggedInOnly, this.getPortal.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * GET /options
   * Get available subscription options (enabled providers, pricing)
   */
  async getOptions(req: Request, res: Response): Promise<void> {
    try {
      const options = await this.interface.getOptions();

      // Return only enabled providers with sanitized data
      const sanitizedProviders = options.providers.map((provider) => ({
        id: provider.id,
        providerType: provider.providerType,
        displayName: provider.displayName,
      }));

      res.json({
        enabled: options.enabled,
        providers: sanitizedProviders,
        monthlyPrice: options.monthlyPrice,
        yearlyPrice: options.yearlyPrice,
        currency: options.currency,
        payWhatYouCan: options.payWhatYouCan,
      });
    }
    catch (error) {
      console.error('Error fetching subscription options:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /subscribe
   * Create new subscription with chosen provider
   */
  async subscribe(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { providerConfigId, billingCycle, amount } = req.body;

      const subscription = await this.interface.subscribe(
        account.id,
        account.email,
        providerConfigId,
        billingCycle,
        amount,
      );

      res.json(subscription.toObject());
    }
    catch (error) {
      console.error('Error creating subscription:', error);
      if (error instanceof MissingRequiredFieldError) {
        res.status(400).json({ error: error.message });
      }
      else if (error instanceof InvalidBillingCycleError) {
        res.status(400).json({ error: error.message });
      }
      else if (error instanceof InvalidAmountError) {
        res.status(400).json({ error: error.message });
      }
      else if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('not enabled')) {
          res.status(400).json({ error: error.message });
        }
        else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /status
   * Get current user's subscription status
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const subscription = await this.interface.getStatus(account.id);

      if (!subscription) {
        res.status(404).json({ error: 'No subscription found' });
        return;
      }

      res.json(subscription.toObject());
    }
    catch (error) {
      console.error('Error fetching subscription status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /cancel
   * Cancel subscription (continues to end of billing period)
   */
  async cancel(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Get user's subscription to get the subscription ID
      const subscription = await this.interface.getStatus(account.id);

      if (!subscription) {
        res.status(404).json({ error: 'No subscription found' });
        return;
      }

      // Cancel at end of period (immediate = false)
      await this.interface.cancel(subscription.id, false);

      res.json({ success: true });
    }
    catch (error) {
      console.error('Error canceling subscription:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /portal
   * Get provider's billing portal URL for subscription management
   */
  async getPortal(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const returnUrl = req.query.returnUrl as string;

      const portalUrl = await this.interface.getBillingPortalUrl(account.id, returnUrl);

      res.json({ portalUrl });
    }
    catch (error) {
      console.error('Error getting billing portal URL:', error);
      if (error instanceof MissingRequiredFieldError) {
        res.status(400).json({ error: error.message });
      }
      else if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
