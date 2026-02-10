import express, { Request, Response, Application } from 'express';

import ExpressHelper from '@/server/common/helper/express';
import ModerationInterface from '@/server/moderation/interface';
import { logError } from '@/server/common/helper/error-logger';

/** Valid setting keys that can be updated via the API. */
const VALID_SETTING_KEYS = [
  'autoEscalationHours',
  'adminReportEscalationHours',
  'reminderBeforeEscalationHours',
] as const;

/**
 * Route handler for admin moderation settings endpoints.
 *
 * Provides GET and PUT endpoints for instance-wide moderation
 * configuration such as auto-escalation timeframes and reminder
 * timing.
 */
export default class AdminSettingsRoutes {
  private moderationInterface: ModerationInterface;

  constructor(moderationInterface: ModerationInterface) {
    this.moderationInterface = moderationInterface;
  }

  /**
   * Registers route handlers on the given Express application.
   *
   * @param app - Express application instance
   * @param routePrefix - URL prefix for all routes (e.g. '/api/v1')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get(
      '/admin/moderation/settings',
      ...ExpressHelper.adminOnly,
      this.getSettings.bind(this),
    );

    router.put(
      '/admin/moderation/settings',
      ...ExpressHelper.adminOnly,
      this.updateSettings.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Returns current moderation settings.
   *
   * GET /api/v1/admin/moderation/settings
   */
  async getSettings(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await this.moderationInterface.getModerationSettings();
      res.json(settings);
    }
    catch (error: any) {
      logError(error, 'Failed to retrieve moderation settings');
      res.status(500).json({
        error: 'Failed to retrieve moderation settings',
      });
    }
  }

  /**
   * Updates moderation settings. Supports partial updates.
   *
   * PUT /api/v1/admin/moderation/settings
   */
  async updateSettings(req: Request, res: Response): Promise<void> {
    const body = req.body ?? {};

    // Extract only valid setting keys from the request body
    const updates: Record<string, number> = {};
    const errors: string[] = [];

    for (const key of VALID_SETTING_KEYS) {
      if (key in body) {
        const value = body[key];
        if (typeof value !== 'number' || !isFinite(value) || value <= 0) {
          errors.push(`${key} must be a positive number`);
        }
        else {
          updates[key] = value;
        }
      }
    }

    // If there are validation errors, return them all
    if (errors.length > 0) {
      res.status(400).json({
        error: errors.join('; '),
        errors,
        errorName: 'ValidationError',
      });
      return;
    }

    // Require at least one valid setting to update
    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        error: 'At least one valid setting is required: ' + VALID_SETTING_KEYS.join(', '),
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const settings = await this.moderationInterface.updateModerationSettings(updates);
      res.json(settings);
    }
    catch (error: any) {
      logError(error, 'Failed to update moderation settings');
      res.status(500).json({
        error: 'Failed to update moderation settings',
      });
    }
  }
}
