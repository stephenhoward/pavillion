import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '@/server/calendar/interface';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError, BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError, LocationValidationError } from '@/common/exceptions/calendar';
import { logError } from '@/server/common/helper/error-logger';

export default class EventRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars/:calendar/events', ExpressHelper.loggedInOnly, this.listEvents.bind(this));
    router.get('/events/:id', ExpressHelper.loggedInOnly, this.getEvent.bind(this));
    router.post('/events', ExpressHelper.loggedInOnly, this.createEvent.bind(this));
    router.put('/events/:id', ExpressHelper.loggedInOnly, this.updateEvent.bind(this));
    router.delete('/events/:id', ExpressHelper.loggedInOnly, this.deleteEvent.bind(this));
    router.post('/events/bulk-assign-categories', ExpressHelper.loggedInOnly, this.bulkAssignCategories.bind(this));
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

    // Parse query parameters for filtering and searching
    const options: {
      search?: string;
      categories?: string[];
    } = {};

    // Handle search parameter
    if (req.query.search && typeof req.query.search === 'string') {
      options.search = req.query.search.trim();
    }

    // Handle categories parameter (can be comma-separated or array)
    if (req.query.categories) {
      if (typeof req.query.categories === 'string') {
        options.categories = req.query.categories.split(',').map(c => c.trim()).filter(c => c.length > 0);
      }
      else if (Array.isArray(req.query.categories)) {
        options.categories = req.query.categories.filter(c => typeof c === 'string' && c.trim().length > 0);
      }
    }


    const events = await this.service.listEvents(calendar, options);
    res.json(events.map((event) => event.toObject()));
  }

  async getEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(401).json({
        "error": "not authenticated",
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

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
      });
      return;
    }

    try {
      const event = await this.service.getEventById(eventId);

      // Check if user has permission to edit this event (is editor or owner of calendar)
      const editableCalendars = await this.service.editableCalendarsForUser(account);
      const hasPermission = editableCalendars.some(c => c.id === event.calendarId);

      if (!hasPermission) {
        throw new InsufficientCalendarPermissionsError(event.calendarId);
      }

      res.json(event.toObject());
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
      else {
        logError(error, "Error getting event");
        res.status(500).json({
          "error": "An error occurred while getting the event",
        });
      }
    }
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
      res.status(201).json(event.toObject());
    }
    catch (error) {
      if (error instanceof LocationValidationError) {
        res.status(400).json({
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
        logError(error, "Error creating event");
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

    // Check for event ID before decoding
    if (!req.params.id) {
      res.status(400).json({
        "error": "missing event ID",
      });
      return;
    }

    // Decode the URL-encoded event ID from the path parameter
    const eventId = decodeURIComponent(req.params.id);

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
      });
      return;
    }

    try {
      const updatedEvent = await this.service.updateEvent(account, eventId, req.body);
      res.json(updatedEvent.toObject());
    }
    catch (error) {
      if (error instanceof LocationValidationError) {
        res.status(400).json({
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
        logError(error, "Error updating event");
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

    // Validate that all IDs are valid UUIDs
    const invalidEventIds = ExpressHelper.findInvalidUUIDs(eventIds);
    if (invalidEventIds.length > 0) {
      res.status(400).json({
        "error": "invalid UUID format in eventIds",
        "invalidIds": invalidEventIds,
      });
      return;
    }

    const invalidCategoryIds = ExpressHelper.findInvalidUUIDs(categoryIds);
    if (invalidCategoryIds.length > 0) {
      res.status(400).json({
        "error": "invalid UUID format in categoryIds",
        "invalidIds": invalidCategoryIds,
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
        logError(error, "Error in bulk category assignment");
        res.status(500).json({
          "error": "An error occurred while assigning categories",
        });
      }
    }
  }

  async deleteEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for event deletion. Not logged in?",
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

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
      });
      return;
    }

    // calendarId is optional - needed for remote event deletion
    const calendarId = req.query.calendarId as string | undefined;

    try {
      await this.service.deleteEvent(account, eventId, calendarId);
      res.status(204).send(); // No content response for successful deletion
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
      else {
        logError(error, "Error deleting event");
        res.status(500).json({
          "error": "An error occurred while deleting the event",
        });
      }
    }
  }
}
