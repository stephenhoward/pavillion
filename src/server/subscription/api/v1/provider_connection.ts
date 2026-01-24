import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import { ProviderConnectionService } from '@/server/subscription/service/provider_connection';
import { ProviderType } from '@/common/model/subscription';

/**
 * Provider Connection route handlers
 *
 * Handles admin endpoints for connecting, configuring, and disconnecting payment providers.
 * All routes require admin authentication via ExpressHelper.adminOnly.
 */
export default class ProviderConnectionRoutes {
  private service: ProviderConnectionService;

  constructor(service: ProviderConnectionService) {
    this.service = service;
  }

  /**
   * Install provider connection route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/subscription/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    // Stripe OAuth routes
    router.post(
      '/admin/providers/stripe/connect',
      ...ExpressHelper.adminOnly,
      this.initiateStripeOAuth.bind(this),
    );
    router.get(
      '/admin/providers/stripe/callback',
      // No auth required - callback from Stripe
      this.handleStripeCallback.bind(this),
    );

    // PayPal configuration route
    router.post(
      '/admin/providers/paypal/configure',
      ...ExpressHelper.adminOnly,
      this.configurePayPal.bind(this),
    );

    // Provider disconnection route
    router.delete(
      '/admin/providers/:providerType',
      ...ExpressHelper.adminOnly,
      this.disconnectProvider.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * POST /admin/providers/stripe/connect
   * Initiate Stripe OAuth flow
   */
  async initiateStripeOAuth(req: Request, res: Response): Promise<void> {
    try {
      const adminUser = req.user as any;

      if (!adminUser) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const result = await this.service.initiateStripeOAuth({
        id: adminUser.id,
        email: adminUser.email,
      });

      res.json({
        oauthUrl: result.oauthUrl,
      });
    }
    catch (error) {
      console.error('Error initiating Stripe OAuth:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /admin/providers/stripe/callback
   * Handle OAuth callback from Stripe
   */
  async handleStripeCallback(req: Request, res: Response): Promise<void> {
    try {
      const { code, state, error } = req.query;

      // Handle OAuth errors from provider
      if (error) {
        res.redirect(`/admin/funding?error=${error}`);
        return;
      }

      // Validate required parameters
      if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
        res.redirect('/admin/funding?error=invalid_request');
        return;
      }

      // Process OAuth callback
      const success = await this.service.handleStripeCallback(code, state);

      if (!success) {
        res.redirect('/admin/funding?error=invalid_state');
        return;
      }

      // Success - redirect to funding page
      res.redirect('/admin/funding?success=stripe_connected');
    }
    catch (error) {
      console.error('Error handling Stripe OAuth callback:', error);
      res.redirect('/admin/funding?error=connection_failed');
    }
  }

  /**
   * POST /admin/providers/paypal/configure
   * Configure PayPal credentials manually
   */
  async configurePayPal(req: Request, res: Response): Promise<void> {
    try {
      const adminUser = req.user as any;

      if (!adminUser) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { client_id, client_secret, environment } = req.body;

      // Validate required fields
      if (!client_id || !client_secret || !environment) {
        res.status(400).json({
          error: 'Missing required fields: client_id, client_secret, and environment are required',
        });
        return;
      }

      // Validate environment value
      if (environment !== 'sandbox' && environment !== 'production') {
        res.status(400).json({
          error: 'Invalid environment value. Must be "sandbox" or "production"',
        });
        return;
      }

      const credentials = {
        client_id,
        client_secret,
        environment,
      };

      await this.service.configurePayPal(credentials, {
        id: adminUser.id,
        email: adminUser.email,
      });

      res.json({ success: true });
    }
    catch (error) {
      console.error('Error configuring PayPal:', error);

      if (error instanceof Error && error.message.includes('Invalid')) {
        res.status(400).json({ error: error.message });
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
      const { confirm } = req.query;

      // Validate provider type
      if (providerType !== 'stripe' && providerType !== 'paypal') {
        res.status(400).json({ error: 'Invalid provider type' });
        return;
      }

      const confirmed = confirm === 'true';

      const result = await this.service.disconnectProvider(
        providerType as ProviderType,
        confirmed,
      );

      // If confirmation required, return the warning
      if (result.requiresConfirmation) {
        res.json(result);
        return;
      }

      // Disconnection successful
      res.json({ success: true });
    }
    catch (error) {
      console.error('Error disconnecting provider:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
