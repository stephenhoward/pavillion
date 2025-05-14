import config from 'config';
import express, { Request, Response } from 'express';
import ServiceSettings from '../../service/settings';
import ExpressHelper from '../../../common/helper/express';

const handlers = {
  site: async (req: Request, res: Response) => {
    const settings = await ServiceSettings.getInstance();
    res.json({
      registrationMode: settings.get('registrationMode'),
      siteTitle: settings.get('siteTitle'),
      domain: config.get('domain'),
    });
  },

  updateSettings: async (req: Request, res: Response) => {
    try {
      const settings = await ServiceSettings.getInstance();
      // TODO: wrap this in a transaction so we don't update some settings but not others:
      for( const key in req.body ) {
        const success = await settings.set(key, req.body[key]);
        if (! success) {
          return res.status(500).json({ error: 'Failed to update service setting: "'+key +'"' });
        }
      }

      return res.status(200).json({ success: true  });
    }
    catch (error) {
      console.error('Error updating service settings:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
};

var router = express.Router();

router.get('/site', handlers.site);
router.post('/site', ExpressHelper.adminOnly, handlers.updateSettings);

export { handlers, router };
