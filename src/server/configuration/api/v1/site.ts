import config from 'config';
import express, { Request, Response } from 'express';
import ExpressHelper from '../../../common/helper/express';
import ConfigurationInterface from '@/server/configuration/interface';
import { createLogger } from '@/server/common/helper/logger';
import { limitConfigSiteByIp } from '@/server/common/middleware/rate-limiters';

const logger = createLogger('configuration');

// Settings keys whose values are serialized as JSON strings for storage
const JSON_SETTINGS = new Set(['enabledLanguages']);

// Allowlist of keys that may be updated via the API (key-value settings only)
const ALLOWED_SETTINGS = new Set(['registrationMode', 'defaultLanguage', 'enabledLanguages', 'forceLanguage', 'siteTitle']);

export default class SiteRouteHandlers {
  private service: ConfigurationInterface;
  constructor(service: ConfigurationInterface) {
    this.service = service;
  }
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/site', limitConfigSiteByIp, this.getSettings.bind(this));
    router.post('/site', ExpressHelper.adminOnly, this.updateSettings.bind(this));
    app.use(routePrefix, router);
  }

  async getSettings(req: Request, res: Response): Promise<void> {
    res.json({
      registrationMode: await this.service.getSetting('registrationMode'),
      siteTitle: await this.service.getSetting('siteTitle'),
      defaultDateRange: await this.service.getSetting('defaultDateRange'),
      defaultLanguage: await this.service.getSetting('defaultLanguage'),
      domain: config.get('domain'),
      enabledLanguages: await this.service.getEnabledLanguages(),
      forceLanguage: await this.service.getForceLanguage(),
      instanceDescription: await this.service.getInstanceDescription(),
      instancePolicy: await this.service.getInstancePolicy(),
    });
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      // Handle instanceDescription separately via its dedicated content table
      if (req.body.instanceDescription !== undefined) {
        const success = await this.service.setInstanceDescription(req.body.instanceDescription);
        if (!success) {
          res.status(400).json({ error: 'Invalid value for setting: "instanceDescription"' });
          return;
        }
      }

      // Handle instancePolicy separately via its dedicated content table
      if (req.body.instancePolicy !== undefined) {
        const success = await this.service.setInstancePolicy(req.body.instancePolicy);
        if (!success) {
          res.status(400).json({ error: 'Invalid value for setting: "instancePolicy"' });
          return;
        }
      }

      // Handle key-value settings
      for ( const key in req.body ) {
        // Defense-in-depth: only process known, allowed setting keys
        if (!ALLOWED_SETTINGS.has(key)) {
          continue;
        }
        const rawValue = req.body[key];
        // Serialize complex values (arrays) to JSON strings for storage
        const value = JSON_SETTINGS.has(key)
          ? JSON.stringify(rawValue)
          : rawValue;
        const success = await this.service.setSetting(key, value);
        if (!success) {
          res.status(400).json({ error: 'Invalid value for setting: "' + key + '"' });
          return;
        }
      }

      res.status(200).json({ success: true });
      return;
    }
    catch (error) {
      logger.error({ err: error }, 'Error updating service settings');
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
  }
}
