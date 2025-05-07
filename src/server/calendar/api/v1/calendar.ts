import express, { Request, Response } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarService from '@/server/calendar/service/calendar';

class CalendarRoutes {
  router: express.Router;

  constructor() {

    this.router = express.Router();

    this.router.get('/calendars', ExpressHelper.loggedInOnly, (req, res) => this.listCalendars(req, res));

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

}

export default CalendarRoutes;
