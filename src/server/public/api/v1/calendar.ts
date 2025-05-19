import express, { Request, Response } from 'express';

import CalendarService from '@/server/calendar/service/calendar';
import EventService from '@/server/calendar/service/events';

class CalendarRoutes {
  router: express.Router;
  service: EventService;

  constructor() {

    this.router = express.Router();

    this.router.get('/calendars/:urlName', (req, res) => this.getCalendar(req, res));
    this.router.get('/calendars/:calendar/events', (req, res) => this.listEvents(req, res));
    this.router.get('/events/:id', (req, res) => this.getEvent(req,res));

    this.service = new EventService();

  }

  async getCalendar(req: Request, res: Response) {

    const calendar = await CalendarService.getCalendarByName(req.params.urlName);
    if (calendar) {
      res.json(calendar.toObject());
    }
    else {
      res.status(404).json({
        "error": "calendar not found",
      });
    }
  }

  async listEvents(req: Request, res: Response) {
    const calendarName = req.params.calendar;
    if ( !req.params.calendar ) {
      res.status(400).json({
        "error": "missing calendar name",
      });
      return;
    }

    const calendar = await CalendarService.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
      });
      return;
    }

    const events = await this.service.listEvents(calendar);
    res.json(events.map((event) => event.toObject()));
  }

  async getEvent(req: Request, res: Response) {
    const eventId = req.params.id;
    const event = await this.service.getEvent(eventId);
    res.json(event.toObject());
  }

}

export default CalendarRoutes;
