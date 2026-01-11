import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import SubscriptionInterface from '@/server/subscription/interface';
import { ProviderConnectionService } from '@/server/subscription/service/provider_connection';
import { SubscriptionSettings } from '@/common/model/subscription';

/**
 * Admin route handlers for subscription management
 *
 * All routes require admin authentication via ExpressHelper.adminOnly
 */
export default class AdminRouteHandlers {
  private interface: SubscriptionInterface;
  private providerConnectionService: ProviderConnectionService;

  constructor(
    subscriptionInterface: SubscriptionInterface,
    providerConnectionService: ProviderConnectionService,
  ) {
    this.interface = subscriptionInterface;
    this.providerConnectionService = providerConnectionService;
  }

  /**
   * Install admin route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/subscription/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    // Settings endpoints
    router.get('/admin/settings', ...ExpressHelper.adminOnly, this.getSettings.bind(this));
    router.post('/admin/settings', ...ExpressHelper.adminOnly, this.updateSettings.bind(this));

    // Provider management endpoints
    router.get('/admin/providers', ...ExpressHelper.adminOnly, this.listProviders.bind(this));
    router.post(
      '/admin/providers/:providerType/connect',
      ...ExpressHelper.adminOnly,
      this.connectProvider.bind(this),
    );
    router.get(
      '/admin/providers/:providerType/callback',
      ...ExpressHelper.adminOnly,
      this.handleOAuthCallback.bind(this),
    );
    router.put(
      '/admin/providers/:providerType',
      ...ExpressHelper.adminOnly,
      this.updateProvider.bind(this),
    );
    router.delete(
      '/admin/providers/:providerType',
      ...ExpressHelper.adminOnly,
      this.disconnectProvider.bind(this),
    );

    // Admin subscription management
    router.get(
      '/admin/subscriptions',
      ...ExpressHelper.adminOnly,
      this.listSubscriptions.bind(this),
    );
    router.post(
      '/admin/subscriptions/:id/cancel',
      ...ExpressHelper.adminOnly,
      this.forceCancel.bind(this),
    );

    // Platform OAuth configuration endpoints
    router.get(
      '/admin/platform/oauth/status',
      ...ExpressHelper.adminOnly,
      this.getPlatformOAuthStatus.bind(this),
    );
    router.post(
      '/admin/platform/oauth/configure',
      ...ExpressHelper.adminOnly,
      this.configurePlatformOAuth.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * GET /admin/settings
   * Get instance subscription settings
   */
  async getSettings(req: Request, res: Response): Promise<void> {
    try {
      const settings = await this.interface.getSettings();

      res.json({
        enabled: settings.enabled,
        monthlyPrice: settings.monthlyPrice,
        yearlyPrice: settings.yearlyPrice,
        currency: settings.currency,
        payWhatYouCan: settings.payWhatYouCan,
        gracePeriodDays: settings.gracePeriodDays,
      });
    } catch (error) {
      console.error('Error fetching subscription settings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /admin/settings
   * Update instance subscription settings
   */
  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      const { enabled, monthlyPrice, yearlyPrice, currency, payWhatYouCan, gracePeriodDays } =
        req.body;

      // Validate millicent amounts are positive integers
      if (
        typeof monthlyPrice !== 'number' ||
        typeof yearlyPrice !== 'number' ||
        monthlyPrice < 0 ||
        yearlyPrice < 0
      ) {
        res.status(400).json({ error: 'Prices must be non-negative integers' });
        return;
      }

      // Validate currency is valid ISO 4217 code (basic check - 3 uppercase letters)
      if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
        res.status(400).json({ error: 'Invalid currency code (must be 3 uppercase letters)' });
        return;
      }

      // Validate grace period
      if (typeof gracePeriodDays !== 'number' || gracePeriodDays < 0) {
        res.status(400).json({ error: 'Grace period must be non-negative' });
        return;
      }

      const settings = new SubscriptionSettings();
      settings.enabled = enabled;
      settings.monthlyPrice = monthlyPrice;
      settings.yearlyPrice = yearlyPrice;
      settings.currency = currency;
      settings.payWhatYouCan = payWhatYouCan;
      settings.gracePeriodDays = gracePeriodDays;

      await this.interface.updateSettings(settings);

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating subscription settings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /admin/providers
   * List all configured payment providers with configured status
   */
  async listProviders(req: Request, res: Response): Promise<void> {
    try {
      const providers = await this.interface.getProviders();

      // Enhance provider data with configured status from ProviderConnectionService
      const sanitizedProviders = await Promise.all(
        providers.map(async (provider) => {
          const status = await this.providerConnectionService.getProviderStatus(
            provider.providerType,
          );

          return {
            id: provider.id,
            provider_type: provider.providerType, // Use snake_case for frontend compatibility
            enabled: provider.enabled,
            display_name: provider.displayName, // Use snake_case for frontend compatibility
            configured: status.configured,
            // Do NOT return credentials or webhook secrets
          };
        }),
      );

      res.json(sanitizedProviders);
    } catch (error) {
      console.error('Error listing providers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /admin/providers/:providerType/connect
   * Initiate OAuth flow for provider connection
   */
  async connectProvider(req: Request, res: Response): Promise<void> {
    try {
      const { providerType } = req.params;
      const { returnUrl } = req.body;

      if (!returnUrl) {
        res.status(400).json({ error: 'returnUrl is required' });
        return;
      }

      // Validate provider type
      if (providerType !== 'stripe' && providerType !== 'paypal') {
        res.status(400).json({ error: 'Invalid provider type' });
        return;
      }

      // TODO: Implement OAuth flow initialization
      // For now, return a mock URL that includes the provider type
      const mockOAuthUrl = `https://${providerType}.com/oauth/authorize?client_id=mock&redirect_uri=${encodeURIComponent(returnUrl)}`;

      res.json({
        redirectUrl: mockOAuthUrl,
      });
    } catch (error) {
      console.error('Error initiating provider connection:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /admin/providers/:providerType/callback
   * Handle OAuth callback from provider
   */
  async handleOAuthCallback(req: Request, res: Response): Promise<void> {
    try {
      const { providerType } = req.params;
      const { code } = req.query;

      if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'OAuth code is required' });
        return;
      }

      // Validate provider type
      if (providerType !== 'stripe' && providerType !== 'paypal') {
        res.status(400).json({ error: 'Invalid provider type' });
        return;
      }

      // TODO: Implement OAuth callback handling
      // This will exchange the code for credentials and store them

      res.json({ success: true });
    } catch (error) {
      console.error('Error handling OAuth callback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * PUT /admin/providers/:providerType
   * Update provider configuration (display name, enabled status)
   */
  async updateProvider(req: Request, res: Response): Promise<void> {
    try {
      const { providerType } = req.params;
      const { displayName, enabled } = req.body;

      // Validate provider type
      if (providerType !== 'stripe' && providerType !== 'paypal') {
        res.status(400).json({ error: 'Invalid provider type' });
        return;
      }

      if (typeof displayName !== 'string' || typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'displayName and enabled are required' });
        return;
      }

      await this.interface.updateProvider(providerType, displayName, enabled);

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating provider:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * DELETE /admin/providers/:providerType
   * Disconnect a payment provider
   */
  async disconnectProvider(req: Request, res: Response): Promise<void> {
    try {
      const { providerType } = req.params;

      // Validate provider type
      if (providerType !== 'stripe' && providerType !== 'paypal') {
        res.status(400).json({ error: 'Invalid provider type' });
        return;
      }

      await this.interface.disconnectProvider(providerType);

      res.json({ success: true });
    } catch (error) {
      console.error('Error disconnecting provider:', error);
      if (error instanceof Error && error.message.includes('active subscription')) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /admin/subscriptions
   * List all subscriptions with pagination
   */
  async listSubscriptions(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const result = await this.interface.listSubscriptions(page, limit);

      res.json(result);
    } catch (error) {
      console.error('Error listing subscriptions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /admin/subscriptions/:id/cancel
   * Force cancel a subscription
   */
  async forceCancel(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      await this.interface.forceCancel(id);

      res.json({ success: true });
    } catch (error) {
      console.error('Error force canceling subscription:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /admin/platform/oauth/status
   * Get platform OAuth configuration status
   */
  async getPlatformOAuthStatus(req: Request, res: Response): Promise<void> {
    try {
      const configured = await this.interface.isPlatformOAuthConfigured();

      res.json({ configured });
    } catch (error) {
      console.error('Error getting platform OAuth status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /admin/platform/oauth/configure
   * Configure platform OAuth credentials
   */
  async configurePlatformOAuth(req: Request, res: Response): Promise<void> {
    try {
      const { stripeClientId, stripeClientSecret } = req.body;

      // Validate required fields
      if (!stripeClientId || !stripeClientSecret) {
        res.status(400).json({
          error: 'Missing required fields: stripeClientId and stripeClientSecret are required',
        });
        return;
      }

      await this.interface.configurePlatformOAuth({
        stripeClientId,
        stripeClientSecret,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error configuring platform OAuth:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
