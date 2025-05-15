import express, { Request, Response } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarService from '@/server/calendar/service/calendar';
import { UrlNameAlreadyExistsError, InvalidUrlNameError } from '@/common/exceptions/calendar';

class CalendarRoutes {
  router: express.Router;

  constructor() {

    this.router = express.Router();

    this.router.get('/calendars', ExpressHelper.loggedInOnly, (req, res) => this.listCalendars(req, res));
    this.router.post('/calendars', ExpressHelper.loggedInOnly, (req, res) => this.createCalendar(req, res));

  }

  async listCalendars(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for calendars. Not logged in?",
      });
      return;
    }

    const calendars = await CalendarService.editableCalendarsForUser(account);
    res.json(calendars.map((calendar) => calendar.toObject()));
  }

  async createCalendar(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for calendar creation. Not logged in?",
      });
      return;
    }

    if (!req.body.urlName) {
      res.status(400).json({
        "error": "missing urlName",
      });
      return;
    }

    try {
      // Create calendar with the specified URL name
      const calendar = await CalendarService.createCalendar(
        account,
        req.body.urlName,
        req.body.content?.en?.name || req.body.urlName,
      );

      res.json(calendar.toObject());
    }
    catch (error) {
      if (error instanceof InvalidUrlNameError) {
        res.status(400).json({
          "error": "Invalid URL name format",
          "errorName": error.name,
        });
      }
      else if (error instanceof UrlNameAlreadyExistsError) {
        res.status(409).json({
          "error": "URL name already exists",
          "errorName": error.name,
        });
      }
      else {
        console.error("Error creating calendar:", error);
        res.status(500).json({
          "error": "An error occurred while creating the calendar",
        });
      }
    }
  }
}

export default CalendarRoutes;
