import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '@/server/calendar/interface';

export default class EventRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars/:calendar/events', ExpressHelper.loggedInOnly, this.listEvents.bind(this));
    router.post('/calendars/:calendar/events', ExpressHelper.loggedInOnly, this.createEvent.bind(this));
    router.post('/calendars/:calendar/events/:id', ExpressHelper.loggedInOnly, this.updateEvent.bind(this));
    app.use(routePrefix, router);
  }

  async listEvents(req: Request, res: Response) {
    const calendarName = req.params.calendar;
    if ( !req.params.calendar ) {
      res.status(400).json({
        "error": "missing calendar name",
      });
      return;
    }

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
      });
      return;
    }

    const events = await this.service.listEvents(calendar);
    res.json(events.map((event) => event.toObject()));
  }

  async createEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for events. Not logged in?",
      });
      return;
    }

    const calendarName = req.params.calendar;
    if (!calendarName) {
      res.status(400).json({
        "error": "missing calendar name",
      });
      return;
    }

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
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
        "error": "missing account for events. Not logged in?",
      });
      return;
    }
    const event = await this.service.updateEvent(account, req.params.id, req.body);

    res.json(event.toObject());
  }
}
