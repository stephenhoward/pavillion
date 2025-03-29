import express, { Request, Response } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import EventProxy from '@/server/common/helper/event_proxy';
import EventService from '@/server/calendar/service/events';
import CalendarService from '@/server/calendar/service/calendar';

class EventRoutes extends EventProxy {
    router: express.Router;
    service: EventService;

    constructor() {
        super();

        this.router = express.Router();

        this.router.get('/events', ExpressHelper.loggedInOnly, (req, res) => this.listEvents(req, res));

        this.router.post('/events', ExpressHelper.loggedInOnly, (req, res) => this.createEvent(req, res));

        this.router.post('/events/:id', ExpressHelper.loggedInOnly, (req, res) => this.updateEvent(req,res));

        this.service = new EventService();
        this.proxyEvents(this.service, ['eventCreated', 'eventUpdated']);
    }

    async listEvents(req: Request, res: Response) {
        const account = req.user as Account;

        if (!account) {
            res.status(400).json({
                "error": "missing account for events. Not logged in?"
            });
            return;
        }

        const events = await this.service.listEvents(account);
        res.json(events.map((event) => event.toObject()));
    }

    async createEvent(req: Request, res: Response) {
        const account = req.user as Account;

        if (!account) {
            res.status(400).json({
                "error": "missing account for events. Not logged in?"
            });
            return;
        }
        if (!req.body.calendarId) {
            res.status(400).json({
                "error": "missing calendar id"
            });
            return;
        }
        const calendar = await CalendarService.getCalendar(req.body.calendarId);
        if (!calendar) {
            res.status(404).json({
                "error": "calendar not found"
            });
            return;
        }
        const event = await this.service.createEvent(account, calendar, req.body);
        res.json(event.toObject());
    }

    async updateEvent(req: Request, res: Response) {
        const account = req.user as Account;

        if (!account) {
            res.status(400).json({
                "error": "missing account for events. Not logged in?"
            });
            return;
        }
        const event = await this.service.updateEvent(account, req.params.id, req.body);

        res.json(event.toObject());
    }
}

export default EventRoutes;
