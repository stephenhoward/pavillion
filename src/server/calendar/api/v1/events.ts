import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '@/server/calendar/interface';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError, BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError } from '@/common/exceptions/calendar';

export default class EventRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars/:calendar/events', ExpressHelper.loggedInOnly, this.listEvents.bind(this));
    router.post('/events', ExpressHelper.loggedInOnly, this.createEvent.bind(this));
    router.post('/events/:id', ExpressHelper.loggedInOnly, this.updateEvent.bind(this));
    router.post('/events/bulk-assign-categories', ExpressHelper.loggedInOnly, this.bulkAssignCategories.bind(this));
    router.post('/events/:id/duplicate', ExpressHelper.loggedInOnly, this.duplicateEvent.bind(this));
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

    try {
      const event = await this.service.createEvent(account, req.body);
      res.json(event.toObject());
    }
    catch (error) {
      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({
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

  async bulkAssignCategories(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for bulk category assignment. Not logged in?",
      });
      return;
    }

    const { eventIds, categoryIds } = req.body;

    // Validate request body
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      res.status(400).json({
        "error": "eventIds must be a non-empty array",
      });
      return;
    }

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      res.status(400).json({
        "error": "categoryIds must be a non-empty array",
      });
      return;
    }

    // Validate that all IDs are strings
    if (!eventIds.every(id => typeof id === 'string')) {
      res.status(400).json({
        "error": "all eventIds must be strings",
      });
      return;
    }

    if (!categoryIds.every(id => typeof id === 'string')) {
      res.status(400).json({
        "error": "all categoryIds must be strings",
      });
      return;
    }

    try {
      const events = await this.service.bulkAssignCategories(account, eventIds, categoryIds);
      res.json(events.map(event => event.toObject()));
    }
    catch (error) {
      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else if (error instanceof BulkEventsNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else if (error instanceof CategoriesNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else if (error instanceof MixedCalendarEventsError) {
        res.status(422).json({
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
      else if (error instanceof EventNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else {
        console.error("Error in bulk category assignment:", error);
        res.status(500).json({
          "error": "An error occurred while assigning categories",
        });
      }
    }
  }

  async duplicateEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for event duplication. Not logged in?",
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

    const { title } = req.body;

    // Validate title if provided
    if (title !== undefined && typeof title !== 'string') {
      res.status(400).json({
        "error": "title must be a string",
      });
      return;
    }

    try {
      const result = await this.service.duplicateEvent(account, eventId, { title });
      res.json({
        success: result.success,
        originalEventId: result.originalEventId,
        duplicatedEvent: result.duplicatedEvent.toObject(),
      });
    }
    catch (error) {
      if (error instanceof EventNotFoundError) {
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
      else if (error instanceof CalendarNotFoundError) {
        res.status(404).json({
          "error": error.message,
          "errorName": error.name,
        });
      }
      else {
        console.error("Error duplicating event:", error);
        res.status(500).json({
          "error": "An error occurred while duplicating the event",
        });
      }
    }
  }
}
