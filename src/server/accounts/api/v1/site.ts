import express, { Request, Response } from 'express';
import ServiceSettings from '../../../common/service/settings';

var router = express.Router();

router.get('/site',
    async (req, res) => {
        const settings = await ServiceSettings.getInstance();
        res.json({
            registrationMode: settings.get('registrationMode')
        })
    }
);

export default router;