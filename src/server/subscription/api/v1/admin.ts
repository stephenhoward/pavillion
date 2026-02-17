import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import SubscriptionInterface from '@/server/subscription/interface';
import { ProviderConnectionService } from '@/server/subscription/service/provider_connection';
import { SubscriptionSettings } from '@/common/model/subscription';
import {
  InvalidProviderTypeError,
  InvalidAmountError,
  InvalidCurrencyError,
  MissingRequiredFieldError,
  AccountNotFoundError,
  DuplicateGrantError,
  GrantNotFoundError,
} from '@/server/subscription/exceptions';
import { ValidationError } from '@/common/exceptions/base';

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

    // Complimentary grant management endpoints
    router.get('/admin/grants', ...ExpressHelper.adminOnly, this.listGrants.bind(this));
    router.post('/admin/grants', ...ExpressHelper.adminOnly, this.createGrant.bind(this));
    router.delete('/admin/grants/:id', ...ExpressHelper.adminOnly, this.revokeGrant.bind(this));

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
    }
    catch (error) {
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
        res.status(400).json({ error: 'Prices must be non-negative integers', errorName: 'ValidationError' });
        return;
      }

      // Validate currency is valid ISO 4217 code (basic check - 3 uppercase letters)
      if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
        res.status(400).json({ error: 'Invalid currency code (must be 3 uppercase letters)', errorName: 'ValidationError' });
        return;
      }

      // Validate grace period
      if (typeof gracePeriodDays !== 'number' || gracePeriodDays < 0) {
        res.status(400).json({ error: 'Grace period must be non-negative', errorName: 'ValidationError' });
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
    }
    catch (error) {
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
    }
    catch (error) {
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
        res.status(400).json({ error: 'returnUrl is required', errorName: 'ValidationError' });
        return;
      }

      // Validate provider type (would be done in service if this was implemented)
      if (providerType !== 'stripe' && providerType !== 'paypal') {
        res.status(400).json({ error: 'Invalid provider type', errorName: 'ValidationError' });
        return;
      }

      // TODO: Implement OAuth flow initialization
      // For now, return a mock URL that includes the provider type
      const mockOAuthUrl = `https://${providerType}.com/oauth/authorize?client_id=mock&redirect_uri=${encodeURIComponent(returnUrl)}`;

      res.json({
        redirectUrl: mockOAuthUrl,
      });
    }
    catch (error) {
      console.error('Error initiating provider connection:', error);
      if (error instanceof InvalidProviderTypeError) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
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
        res.status(400).json({ error: 'OAuth code is required', errorName: 'ValidationError' });
        return;
      }

      // Validate provider type (would be done in service if this was implemented)
      if (providerType !== 'stripe' && providerType !== 'paypal') {
        res.status(400).json({ error: 'Invalid provider type', errorName: 'ValidationError' });
        return;
      }

      // TODO: Implement OAuth callback handling
      // This will exchange the code for credentials and store them

      res.json({ success: true });
    }
    catch (error) {
      console.error('Error handling OAuth callback:', error);
      if (error instanceof InvalidProviderTypeError) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
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

      await this.interface.updateProvider(providerType, displayName, enabled);

      res.json({ success: true });
    }
    catch (error) {
      console.error('Error updating provider:', error);
      if (error instanceof InvalidProviderTypeError) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else if (error instanceof MissingRequiredFieldError) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message, errorName: 'NotFoundError' });
      }
      else {
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

      await this.interface.disconnectProvider(providerType);

      res.json({ success: true });
    }
    catch (error) {
      console.error('Error disconnecting provider:', error);
      if (error instanceof InvalidProviderTypeError) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else if (error instanceof Error && error.message.includes('active subscription')) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else {
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
    }
    catch (error) {
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
    }
    catch (error) {
      console.error('Error force canceling subscription:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message, errorName: 'NotFoundError' });
      }
      else {
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
    }
    catch (error) {
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
          errorName: 'ValidationError',
        });
        return;
      }

      await this.interface.configurePlatformOAuth({
        stripeClientId,
        stripeClientSecret,
      });

      res.json({ success: true });
    }
    catch (error) {
      console.error('Error configuring platform OAuth:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /admin/grants
   * List complimentary grants
   *
   * Query params:
   *   - includeRevoked: boolean (default false) — when true, include revoked grants
   */
  async listGrants(req: Request, res: Response): Promise<void> {
    try {
      const includeRevoked = req.query.includeRevoked === 'true';

      const grants = await this.interface.listGrants(includeRevoked);

      res.json(grants.map((grant) => grant.toObject()));
    }
    catch (error) {
      console.error('Error listing grants:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /admin/grants
   * Create a complimentary grant for an account
   *
   * Body: { accountId: string, reason?: string, expiresAt?: Date }
   * Sets grantedBy from req.user.id — never from request body.
   */
  async createGrant(req: Request, res: Response): Promise<void> {
    try {
      const { accountId, reason, expiresAt } = req.body;
      const adminUser = req.user!;

      // Validate accountId is present
      if (!accountId) {
        res.status(400).json({ error: 'accountId is required', errorName: 'ValidationError' });
        return;
      }

      // Validate accountId is a valid UUID
      if (!ExpressHelper.isValidUUID(accountId)) {
        res.status(400).json({ error: 'Invalid accountId: must be a valid UUID', errorName: 'ValidationError' });
        return;
      }

      // Parse and validate expiresAt if provided
      let expiresAtDate: Date | undefined;
      if (expiresAt !== undefined && expiresAt !== null) {
        expiresAtDate = new Date(expiresAt);
        if (isNaN(expiresAtDate.getTime())) {
          res.status(400).json({ error: 'Invalid expiresAt: must be a valid date', errorName: 'ValidationError' });
          return;
        }
        if (expiresAtDate <= new Date()) {
          res.status(400).json({ error: 'expiresAt must be a future date', errorName: 'ValidationError' });
          return;
        }
      }

      // Validate reason length
      if (reason !== undefined && reason !== null && reason.length > 500) {
        res.status(400).json({ error: 'reason must not exceed 500 characters', errorName: 'ValidationError' });
        return;
      }

      // grantedBy is always set from the authenticated user — never from the request body
      const grantedBy = adminUser.id;

      const grant = await this.interface.createGrant(accountId, grantedBy, reason, expiresAtDate);

      res.status(201).json(grant.toObject());
    }
    catch (error) {
      console.error('Error creating grant:', error);
      if (error instanceof AccountNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'AccountNotFoundError' });
      }
      else if (error instanceof DuplicateGrantError) {
        res.status(409).json({ error: error.message, errorName: 'DuplicateGrantError' });
      }
      else if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * DELETE /admin/grants/:id
   * Revoke a complimentary grant
   *
   * Sets revokedBy from req.user.id — never from request body.
   * Returns 204 No Content on success.
   */
  async revokeGrant(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const adminUser = req.user!;

      // Validate grant ID is a valid UUID
      if (!ExpressHelper.isValidUUID(id)) {
        res.status(400).json({ error: 'Invalid grant ID: must be a valid UUID', errorName: 'ValidationError' });
        return;
      }

      // revokedBy is always set from the authenticated user — never from the request body
      const revokedBy = adminUser.id;

      await this.interface.revokeGrant(id, revokedBy);

      res.status(204).send();
    }
    catch (error) {
      console.error('Error revoking grant:', error);
      if (error instanceof GrantNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'GrantNotFoundError' });
      }
      else if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message, errorName: 'ValidationError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
