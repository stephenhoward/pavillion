import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import { ProviderConnectionService } from '@/server/funding/service/provider_connection';
import { ProviderType } from '@/common/model/funding-plan';
import { ValidationError } from '@/common/exceptions/base';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Provider Connection route handlers
 *
 * Handles admin endpoints for configuring and disconnecting payment providers.
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
   * @param routePrefix - Route prefix (e.g., '/api/funding/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

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
      logError(error, 'Error configuring PayPal');

      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
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
      logError(error, 'Error disconnecting provider');

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
