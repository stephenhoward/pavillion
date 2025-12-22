import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import { UrlNameAlreadyExistsError, InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { DefaultDateRange } from '@/common/model/calendar';
import CalendarInterface from '../../interface';

class CalendarRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars', ExpressHelper.loggedInOnly, this.listCalendars.bind(this));
    router.post('/calendars', ExpressHelper.loggedInOnly, this.createCalendar.bind(this));
    router.patch('/calendars/:calendarId/settings', ExpressHelper.loggedInOnly, this.updateCalendarSettings.bind(this));
    app.use(routePrefix, router);
  }

  async listCalendars(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for calendars. Not logged in?",
      });
      return;
    }

    const calendarsWithRelationship = await this.service.editableCalendarsWithRoleForUser(account);
    res.json(calendarsWithRelationship.map((calendarInfo) => ({
      ...calendarInfo.calendar.toObject(),
      userRelationship: calendarInfo.role, // 'owner' or 'editor'
    })));
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
      const calendar = await this.service.createCalendar(
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

  async updateCalendarSettings(req: Request, res: Response) {
    const account = req.user as Account;
    const { calendarId } = req.params;

    if (!account) {
      res.status(400).json({
        "error": "missing account for settings update. Not logged in?",
      });
      return;
    }

    if (!calendarId) {
      res.status(400).json({
        "error": "missing calendarId",
      });
      return;
    }

    const { defaultDateRange } = req.body;

    // Validate defaultDateRange if provided
    const validRanges: DefaultDateRange[] = ['1week', '2weeks', '1month'];
    if (defaultDateRange && !validRanges.includes(defaultDateRange)) {
      res.status(400).json({
        "error": "Invalid defaultDateRange. Must be one of: 1week, 2weeks, 1month",
      });
      return;
    }

    try {
      const calendar = await this.service.updateCalendarSettings(
        account,
        calendarId,
        { defaultDateRange },
      );

      res.json(calendar.toObject());
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": "Calendar not found",
          "errorName": error.name,
        });
      }
      else if (error instanceof CalendarEditorPermissionError) {
        res.status(403).json({
          "error": "Permission denied",
          "errorName": error.name,
        });
      }
      else {
        console.error("Error updating calendar settings:", error);
        res.status(500).json({
          "error": "An error occurred while updating calendar settings",
        });
      }
    }
  }
}

export default CalendarRoutes;
