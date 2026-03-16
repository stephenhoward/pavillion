import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import FundingInterface from '@/server/funding/interface';
import { Account } from '@/common/model/account';
import { ProviderConfig } from '@/common/model/funding-plan';
import { ValidationError } from '@/common/exceptions/base';
import { logError } from '@/server/common/helper/error-logger';
import { MAX_CALENDAR_IDS } from '@/server/funding/service/funding';

/**
 * Extract the publishable key from a Stripe provider's credentials JSON.
 *
 * Returns undefined for non-Stripe providers or when credentials are
 * missing / malformed. Never returns secret keys or webhook secrets.
 *
 * @param provider - Provider configuration with credentials
 * @returns The Stripe publishable key, or undefined
 */
function extractPublishableKey(provider: ProviderConfig): string | undefined {
  if (provider.providerType !== 'stripe') {
    return undefined;
  }

  try {
    const credentials = JSON.parse(provider.credentials);
    const key = credentials.publishableKey;

    // Only return keys that look like Stripe publishable keys
    if (typeof key === 'string' && (key.startsWith('pk_test_') || key.startsWith('pk_live_'))) {
      return key;
    }

    return undefined;
  }
  catch {
    return undefined;
  }
}

/**
 * User subscription route handlers
 *
 * All routes require authentication via ExpressHelper.loggedInOnly
 */
export default class FundingPlanRouteHandlers {
  private interface: FundingInterface;

  constructor(fundingInterface: FundingInterface) {
    this.interface = fundingInterface;
  }

  /**
   * Install user subscription route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/funding/v1')
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
      // Include publishableKey for Stripe providers (safe to expose to client)
      const sanitizedProviders = options.providers.map((provider) => {
        const result: Record<string, any> = {
          id: provider.id,
          providerType: provider.providerType,
          displayName: provider.displayName,
        };

        const publishableKey = extractPublishableKey(provider);
        if (publishableKey) {
          result.publishableKey = publishableKey;
        }

        return result;
      });

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
      logError(error, 'Error fetching subscription options');
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

      const { providerConfigId, billingCycle, amount, calendarIds } = req.body;

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

      const subscription = await this.interface.subscribe(
        account.id,
        account.email,
        providerConfigId,
        billingCycle,
        amount,
        calendarIds,
      );

      res.json(subscription.toObject());
    }
    catch (error) {
      logError(error, 'Error creating subscription');
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('not enabled')) {
          res.status(400).json({ error: error.message, errorName: 'ValidationError' });
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
        res.status(404).json({ error: 'No subscription found', errorName: 'SubscriptionNotFoundError' });
        return;
      }

      res.json(subscription.toObject());
    }
    catch (error) {
      logError(error, 'Error fetching subscription status');
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
        res.status(404).json({ error: 'No subscription found', errorName: 'SubscriptionNotFoundError' });
        return;
      }

      // Cancel at end of period (immediate = false)
      await this.interface.cancel(subscription.id, false);

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error canceling subscription');
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
