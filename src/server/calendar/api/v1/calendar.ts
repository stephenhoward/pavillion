import express, { Request, Response, Application } from 'express';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar');

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import { UrlNameAlreadyExistsError, InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { ValidationError } from '@/common/exceptions/base';
import { validateContentImageAlts } from '@/server/calendar/service/image_alt';
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
        errorName: 'AuthenticationError',
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
        errorName: 'AuthenticationError',
      });
      return;
    }

    try {
      // Creating a calendar with content is two service calls, and only the
      // second one validates content.imageAlt. Left alone, a bad alt text 400s
      // after createCalendar has already committed the calendar row and its
      // owner membership and emitted `calendar.created` (which provisions the
      // ActivityPub actor) — so the urlName is consumed and the author's retry
      // with the same name gets a 409 instead. There is no rollback to reach
      // for once the actor has been provisioned, so the payload is checked
      // before the first write. updateCalendarSettings still runs the same
      // pre-pass; this one only moves the rejection earlier.
      validateContentImageAlts(req.body.content);

      // Create calendar with the specified URL name and optional title
      const calendarTitle = req.body.content?.en?.name || req.body.urlName;
      const calendar = await this.service.createCalendar(
        account,
        req.body.urlName,
        calendarTitle,
      );

      // If additional content (description) was provided, save it
      if (req.body.content) {
        await this.service.updateCalendarSettings(
          account,
          calendar.id,
          { content: req.body.content },
        );
        // Re-fetch calendar with content
        const updatedCalendar = await this.service.getCalendar(calendar.id);
        if (updatedCalendar) {
          res.json(updatedCalendar.toObject());
          return;
        }
      }

      res.json(calendar.toObject());
    }
    catch (error) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof InvalidUrlNameError) {
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
        logger.error({ err: error }, 'Error creating calendar');
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
        errorName: 'AuthenticationError',
      });
      return;
    }

    const { defaultDateRange, defaultEventImageId, content } = req.body;

    try {
      const calendar = await this.service.updateCalendarSettings(
        account,
        calendarId,
        { defaultDateRange, defaultEventImageId, content },
      );

      res.json(calendar.toObject());
    }
    catch (error) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof CalendarNotFoundError) {
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
        logger.error({ err: error }, 'Error updating calendar settings');
        res.status(500).json({
          "error": "An error occurred while updating calendar settings",
        });
      }
    }
  }
}

export default CalendarRoutes;
