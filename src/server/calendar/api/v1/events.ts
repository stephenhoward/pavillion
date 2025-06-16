import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '@/server/calendar/interface';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError } from '@/common/exceptions/calendar';

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

    try {
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
    catch (error) {
      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else {
        console.error("Error creating event:", error);
        res.status(500).json({
          "error": "An error occurred while creating the event",
        });
      }
    }
  }

  async updateEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for events. Not logged in?",
      });
      return;
    }

    const eventId = req.params.id;
    if (!eventId) {
      res.status(400).json({
        "error": "missing event ID",
      });
      return;
    }

    try {
      const updatedEvent = await this.service.updateEvent(account, eventId, req.body);
      res.json(updatedEvent.toObject());
    }
    catch (error) {
      if (error instanceof EventNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else {
        console.error("Error updating event:", error);
        res.status(500).json({
          "error": "An error occurred while updating the event",
        });
      }
    }
  }
}
