import config from 'config';
import express, { Request, Response } from 'express';
import ExpressHelper from '../../../common/helper/express';
import ConfigurationInterface from '@/server/configuration/interface';

// Settings keys whose values are serialized as JSON strings for storage
const JSON_SETTINGS = new Set(['enabledLanguages', 'localeDetectionMethods']);

export default class SiteRouteHandlers {
  private service: ConfigurationInterface;
  constructor(service: ConfigurationInterface) {
    this.service = service;
  }
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/site', this.getSettings.bind(this));
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
      localeDetectionMethods: await this.service.getLocaleDetectionMethods(),
    });
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      // TODO: wrap this in a transaction so we don't update some settings but not others:
      for ( const key in req.body ) {
        const rawValue = req.body[key];
        // Serialize complex values (arrays, objects) to JSON strings for storage
        const value = JSON_SETTINGS.has(key)
          ? JSON.stringify(rawValue)
          : rawValue;
        const success = await this.service.setSetting(key, value);
        if (!success) {
          res.status(500).json({ error: 'Failed to update service setting: "' + key + '"' });
          return;
        }
      }

      res.status(200).json({ success: true });
      return;
    }
    catch (error) {
      console.error('Error updating service settings:', error);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
  }
}
