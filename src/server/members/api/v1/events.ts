import express, { Request, Response } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import EventService from '@/server/members/service/events';

const handlers = {
    listEvents: async (req: Request, res: Response) => {
        const account = req.user as Account;

        if (!account) {
            res.status(400).json({
                "error": "missing account for events. Not logged in?"
            });
            return;
        }

        const events = await EventService.listEvents(account);
        res.json(events.map((event) => event.toObject()));
    },
    createEvent: async (req: Request, res: Response) => {
        const account = req.user as Account;

        if (!account) {
            res.status(400).json({
                "error": "missing account for events. Not logged in?"
            });
            return;
        }
        const event = await EventService.createEvent(account, req.body);
        res.json(event.toObject());
    },
    updateEvent: async (req: Request, res: Response) => {
        const account = req.user as Account;

        if (!account) {
            res.status(400).json({
                "error": "missing account for events. Not logged in?"
            });
            return;
        }
        const event = await EventService.updateEvent(account, req.params.id, req.body);

        res.json(event.toObject());
    }

};
var router = express.Router();

router.get('/events', ExpressHelper.loggedInOnly, handlers.listEvents);

router.post('/events', ExpressHelper.loggedInOnly, handlers.createEvent);

router.post('/events/:id', ExpressHelper.loggedInOnly, handlers.updateEvent);

export { handlers, router };