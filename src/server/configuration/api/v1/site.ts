import express, { Request, Response } from 'express';
import ServiceSettings from '../../service/settings';

const handlers = {
  site: async (req: Request, res: Response) => {
    const settings = await ServiceSettings.getInstance();
    res.json({
      registrationMode: settings.get('registrationMode'),
      siteTitle: settings.get('siteTitle'),
    });
  },

  updateRegistrationMode: async (req: Request, res: Response) => {
    const { mode } = req.body;

    // Validate the mode
    if (!mode || !['open', 'apply', 'invite', 'closed'].includes(mode)) {
      return res.status(400).json({
        error: 'Invalid registration mode. Must be one of: open, apply, invite, closed',
      });
    }

    try {
      const settings = await ServiceSettings.getInstance();
      const success = await settings.setRegistrationMode(mode);

      if (success) {
        return res.status(200).json({ success: true, mode });
      }
      else {
        return res.status(500).json({ error: 'Failed to update registration mode' });
      }
    }
    catch (error) {
      console.error('Error updating registration mode:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
};

var router = express.Router();

router.get('/site', handlers.site);
router.post('/site/registration-mode', handlers.updateRegistrationMode);

export { handlers, router };
