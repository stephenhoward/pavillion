import express, { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import FundingInterface from '@/server/funding/interface';
import { ProviderConnectionService } from '@/server/funding/service/provider_connection';
import { FundingSettings } from '@/common/model/funding-plan';
import { ValidationError } from '@/common/exceptions/base';
import {
  AccountNotFoundError,
  CalendarNotFoundError,
  DuplicateGrantError,
  GrantNotFoundError,
} from '@/server/funding/exceptions';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Admin route handlers for funding management
 *
 * All routes require admin authentication via ExpressHelper.adminOnly
 */
export default class AdminRouteHandlers {
  private interface: FundingInterface;
  private providerConnectionService: ProviderConnectionService;

  constructor(
    fundingInterface: FundingInterface,
    providerConnectionService: ProviderConnectionService,
  ) {
    this.interface = fundingInterface;
    this.providerConnectionService = providerConnectionService;
  }

  /**
   * Install admin route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/funding/v1')
   */
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();

    // Settings endpoints
    router.get('/admin/settings', ...ExpressHelper.adminOnly, this.getSettings.bind(this));
    router.post('/admin/settings', ...ExpressHelper.adminOnly, this.updateSettings.bind(this));

    // Provider management endpoints
    router.get('/admin/providers', ...ExpressHelper.adminOnly, this.listProviders.bind(this));
    router.put(
      '/admin/providers/:providerType',
      ...ExpressHelper.adminOnly,
      this.updateProvider.bind(this),
    );

    // Admin funding management
    router.get(
      '/admin/funding-plans',
      ...ExpressHelper.adminOnly,
      this.listFundingPlans.bind(this),
    );
    router.post(
      '/admin/funding-plans/:id/cancel',
      ...ExpressHelper.adminOnly,
      this.forceCancel.bind(this),
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
      logError(error, 'Error fetching funding settings');
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

      const settings = new FundingSettings();
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
      logError(error, 'Error updating subscription settings');
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
      logError(error, 'Error listing providers');
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

      await this.interface.updateProvider(providerType, displayName, enabled);

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error updating provider');
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

  /**
   * GET /admin/funding-plans
   * List all funding plans with pagination
   */
  async listFundingPlans(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const result = await this.interface.listFundingPlans(page, limit);

      res.json(result);
    }
    catch (error) {
      logError(error, 'Error listing funding plans');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /admin/funding-plans/:id/cancel
   * Force cancel a funding plan
   */
  async forceCancel(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      await this.interface.forceCancel(id);

      res.json({ success: true });
    }
    catch (error) {
      logError(error, 'Error force canceling funding plan');
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message, errorName: 'NotFoundError' });
      }
      else {
        res.status(500).json({ error: 'Internal server error' });
      }
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
      logError(error, 'Error listing grants');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /admin/grants
   * Create a complimentary grant for a calendar
   *
   * Body: { calendarId: string, reason?: string, expiresAt?: Date }
   * Sets grantedBy from req.user.id — never from request body.
   */
  async createGrant(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, reason, expiresAt } = req.body;
      const adminUser = req.user!;

      // Validate calendarId is present
      if (!calendarId) {
        res.status(400).json({ error: 'calendarId is required', errorName: 'ValidationError' });
        return;
      }

      // Validate calendarId is a valid UUID
      if (!ExpressHelper.isValidUUID(calendarId)) {
        res.status(400).json({ error: 'Invalid calendarId: must be a valid UUID', errorName: 'ValidationError' });
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

      const grant = await this.interface.createGrant(calendarId, grantedBy, reason, expiresAtDate);

      res.status(201).json(grant.toObject());
    }
    catch (error) {
      logError(error, 'Error creating grant');
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof AccountNotFoundError) {
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
      logError(error, 'Error revoking grant');
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
