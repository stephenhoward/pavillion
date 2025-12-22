import config from 'config';
import express, { Request, Response } from 'express';
import ExpressHelper from '../../../common/helper/express';
import SettingsInterface from '@/server/configuration/interface';

export default class SiteRouteHandlers {
  private service: SettingsInterface;
  constructor(serviceSettings: SettingsInterface) {
    this.service = serviceSettings;
  }
  installHandlers(app: express.Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/site', this.getSettings.bind(this));
    router.post('/site', ExpressHelper.adminOnly, this.updateSettings.bind(this));
    app.use(routePrefix, router);
  }

  async getSettings(req: Request, res: Response): Promise<void> {
    const settings = await this.service.getInstance();
    res.json({
      registrationMode: settings.get('registrationMode'),
      siteTitle: settings.get('siteTitle'),
      defaultDateRange: settings.get('defaultDateRange'),
      domain: config.get('domain'),
    });
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      const settings = await this.service.getInstance();
      // TODO: wrap this in a transaction so we don't update some settings but not others:
      for( const key in req.body ) {
        const success = await settings.set(key, req.body[key]);
        if (! success) {
          res.status(500).json({ error: 'Failed to update service setting: "'+key +'"' });
          return;
        }
      }

      res.status(200).json({ success: true  });
      return;
    }
    catch (error) {
      console.error('Error updating service settings:', error);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
  }
}
