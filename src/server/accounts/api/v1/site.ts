import express, { Request, Response } from 'express';
import ServiceSettings from '../../../common/service/settings';

const handlers = {
    site: async (req: Request, res: Response) => {
        const settings = await ServiceSettings.getInstance();
        res.json({
            registrationMode: settings.get('registrationMode')
        })
    }
};

var router = express.Router();

router.get('/site', handlers.site);

export { handlers, router };