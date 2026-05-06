import express, { Request, Response, Application } from 'express';
import { DateTime } from 'luxon';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '@/server/calendar/interface';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError, BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError, LocationValidationError, InvalidOccurrenceDateError, SpaceLocationMismatchError } from '@/common/exceptions/calendar';
import { ValidationError } from '@/common/exceptions/base';
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
    router.put('/events/:id/categories', ExpressHelper.loggedInOnly, this.replaceEventCategories.bind(this));
    router.get(
      '/events/:eventId/upcoming-occurrences',
      ExpressHelper.loggedInOnly,
      this.listUpcomingOccurrences.bind(this),
    );
    router.post(
      '/events/:eventId/occurrences/cancel',
      ExpressHelper.loggedInOnly,
      this.cancelEventOccurrence.bind(this),
    );
    router.delete(
      '/events/:eventId/occurrences/cancel',
      ExpressHelper.loggedInOnly,
      this.restoreEventOccurrence.bind(this),
    );
    app.use(routePrefix, router);
  }

  async listEvents(req: Request, res: Response) {
    const calendarName = req.params.calendar;
    if ( !req.params.calendar ) {
      res.status(400).json({
        "error": "missing calendar name",
        errorName: 'ValidationError',
      });
      return;
    }

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
        errorName: 'CalendarNotFoundError',
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

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
        errorName: 'ValidationError',
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
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof EventNotFoundError) {
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
        errorName: 'AuthenticationError',
      });
      return;
    }

    try {
      const event = await this.service.createEvent(account, req.body);
      res.status(201).json(event.toObject());
    }
    catch (error) {
      if (error instanceof ValidationError || error instanceof LocationValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof SpaceLocationMismatchError) {
        // Cross-entity invariant violation: the supplied (locationId, spaceId)
        // pair refers to a Space that does not belong to the Place. Surfaced
        // as 400 with the errorName field so clients can disambiguate from
        // generic ValidationError responses.
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
        errorName: 'AuthenticationError',
      });
      return;
    }

    // Check for event ID before decoding
    if (!req.params.id) {
      res.status(400).json({
        "error": "missing event ID",
        errorName: 'ValidationError',
      });
      return;
    }

    // Decode the URL-encoded event ID from the path parameter
    const eventId = decodeURIComponent(req.params.id);

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const updatedEvent = await this.service.updateEvent(account, eventId, req.body);
      res.json(updatedEvent.toObject());
    }
    catch (error) {
      if (error instanceof ValidationError || error instanceof LocationValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof SpaceLocationMismatchError) {
        // Cross-entity invariant violation: the supplied (locationId, spaceId)
        // pair refers to a Space that does not belong to the Place. Surfaced
        // as 400 with the errorName field so clients can disambiguate from
        // generic ValidationError responses.
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
        errorName: 'AuthenticationError',
      });
      return;
    }

    const { eventIds, categoryIds } = req.body;

    try {
      const events = await this.service.bulkAssignCategories(account, eventIds, categoryIds);
      res.json(events.map(event => event.toObject()));
    }
    catch (error) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
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

  async replaceEventCategories(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for category replacement. Not logged in?",
        errorName: 'AuthenticationError',
      });
      return;
    }

    const eventId = req.params.id;
    const { categoryIds, calendarId } = req.body;

    if (!Array.isArray(categoryIds)) {
      res.status(400).json({
        "error": "categoryIds must be an array",
        errorName: 'ValidationError',
      });
      return;
    }

    if (calendarId !== undefined && typeof calendarId !== 'string') {
      res.status(400).json({
        "error": "calendarId must be a string when provided",
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const event = await this.service.replaceEventCategories(account, eventId, categoryIds, calendarId);
      res.json(event.toObject());
    }
    catch (error) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (
        error instanceof EventNotFoundError ||
        error instanceof InsufficientCalendarPermissionsError ||
        error instanceof CategoriesNotFoundError
      ) {
        // Unified 404: all three errors return identical responses to prevent
        // event ID enumeration and repost relationship disclosure via error differentiation
        res.status(404).json({
          "error": "Event not found",
          errorName: 'NotFoundError',
        });
      }
      else {
        logError(error, "Error in category replacement");
        res.status(500).json({
          "error": "An error occurred while replacing categories",
        });
      }
    }
  }

  async deleteEvent(req: Request, res: Response) {
    const account = req.user as Account;

    if (!account) {
      res.status(400).json({
        "error": "missing account for event deletion. Not logged in?",
        errorName: 'AuthenticationError',
      });
      return;
    }

    const eventId = req.params.id;
    if (!eventId) {
      res.status(400).json({
        "error": "missing event ID",
        errorName: 'ValidationError',
      });
      return;
    }

    // Validate UUID format
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
        errorName: 'ValidationError',
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
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else if (error instanceof EventNotFoundError) {
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

  /**
   * GET /events/:eventId/upcoming-occurrences?limit=10&after=<iso-date>
   *
   * Returns a window of upcoming occurrences computed from the event's
   * RRuleSet, independent of the materialization horizon. Each occurrence
   * carries a state tag (active / cancelled-shown / hidden) and — for
   * non-active states — the owning exclusion schedule's id. Active
   * occurrences carry scheduleId: null.
   *
   * Security: performs the editor check BEFORE delegating to the service's
   * listUpcomingOccurrences method, which has no built-in auth. Both
   * EventNotFoundError and InsufficientCalendarPermissionsError are remapped
   * to 404 here (IDOR prevention — never leak existence of events the
   * caller cannot edit).
   */
  async listUpcomingOccurrences(req: Request, res: Response) {
    const account = req.user as Account;
    if (!account) {
      res.status(401).json({
        "error": "not authenticated",
        errorName: 'AuthenticationError',
      });
      return;
    }

    const eventId = req.params.eventId;
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
        errorName: 'ValidationError',
      });
      return;
    }

    // Silent clamp of limit to [1, 50]; non-numeric or missing defaults to 10.
    const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : '';
    const parsedLimit = parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 50));

    // Parse `after` via Luxon; default to "now" when omitted. Invalid ISO or
    // pre-1900 dates → 400 ValidationError.
    let afterDate = DateTime.now().toUTC();
    if (typeof req.query.after === 'string' && req.query.after.length > 0) {
      const parsed = DateTime.fromISO(req.query.after, { zone: 'utc' });
      if (!parsed.isValid || parsed.year < 1900) {
        res.status(400).json({
          "error": "after must be an ISO-8601 datetime (year 1900 or later)",
          errorName: 'ValidationError',
        });
        return;
      }
      afterDate = parsed;
    }

    try {
      // Auth-before-use: load the event, then verify editor permission BEFORE
      // invoking the service's listUpcomingOccurrences (which has no auth).
      const event = await this.service.getEventById(eventId);
      const editableCalendars = await this.service.editableCalendarsForUser(account);
      if (!editableCalendars.some(c => c.id === event.calendarId)) {
        throw new InsufficientCalendarPermissionsError(event.calendarId ?? undefined);
      }

      const result = await this.service.listUpcomingOccurrences(event, afterDate, limit);

      res.json({
        occurrences: result.occurrences.map(o => ({
          start: o.start.toISO(),
          state: o.state,
          scheduleId: o.state === 'active' ? null : o.scheduleId,
        })),
        hasMore: result.hasMore,
      });
    }
    catch (error) {
      // IDOR prevention: both EventNotFoundError and
      // InsufficientCalendarPermissionsError return 404 — never leak
      // existence of events the caller cannot edit.
      if (error instanceof EventNotFoundError || error instanceof InsufficientCalendarPermissionsError) {
        res.status(404).json({
          "error": "Event not found",
          errorName: 'NotFoundError',
        });
      }
      else if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else {
        logError(error, "Error listing upcoming occurrences");
        res.status(500).json({
          "error": "An error occurred while listing upcoming occurrences",
        });
      }
    }
  }

  /**
   * POST /events/:eventId/occurrences/cancel
   * Body: { start: ISO8601, hideFromPublic: boolean }
   *
   * Strict-date: the server returns 422 (InvalidOccurrenceDateError) if
   * `start` does not land on the event's RRuleSet. The new UI never submits
   * mismatched dates (it picks from the upcoming-occurrences endpoint) but
   * the API remains honest for direct callers.
   *
   * Privacy: the 422 body carries ONLY { errorName } — no message field.
   * Security: both EventNotFoundError and InsufficientCalendarPermissionsError
   * remap to 404 (IDOR prevention).
   */
  async cancelEventOccurrence(req: Request, res: Response) {
    const account = req.user as Account;
    if (!account) {
      res.status(401).json({
        "error": "not authenticated",
        errorName: 'AuthenticationError',
      });
      return;
    }

    const eventId = req.params.eventId;
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
        errorName: 'ValidationError',
      });
      return;
    }

    const { start, hideFromPublic } = req.body ?? {};
    if (typeof start !== 'string') {
      res.status(400).json({
        "error": "start must be an ISO-8601 datetime string",
        errorName: 'ValidationError',
      });
      return;
    }
    const parsedStart = DateTime.fromISO(start, { zone: 'utc' });
    if (!parsedStart.isValid || parsedStart.year < 1900) {
      res.status(400).json({
        "error": "start must be an ISO-8601 datetime (year 1900 or later)",
        errorName: 'ValidationError',
      });
      return;
    }
    if (typeof hideFromPublic !== 'boolean') {
      res.status(400).json({
        "error": "hideFromPublic must be a boolean",
        errorName: 'ValidationError',
      });
      return;
    }

    // Truncate to millisecond precision for consistency with
    // assertDateMatchesOccurrence (which compares in ms).
    const startDate = DateTime.fromMillis(parsedStart.toMillis(), { zone: 'utc' });

    try {
      await this.service.cancelOccurrenceByDate(account, eventId, startDate, hideFromPublic);
      res.status(204).send();
    }
    catch (error) {
      if (error instanceof InvalidOccurrenceDateError) {
        // Privacy binding: errorName-only body (no message leak).
        res.status(422).json({
          errorName: error.name,
        });
      }
      else if (error instanceof EventNotFoundError || error instanceof InsufficientCalendarPermissionsError) {
        res.status(404).json({
          "error": "Event not found",
          errorName: 'NotFoundError',
        });
      }
      else if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else {
        logError(error, "Error cancelling event occurrence");
        res.status(500).json({
          "error": "An error occurred while cancelling the event occurrence",
        });
      }
    }
  }

  /**
   * DELETE /events/:eventId/occurrences/cancel
   * Body: { start: ISO8601 }
   *
   * Removes the exclusion schedule row for the given occurrence start if it
   * exists. Silent 204 no-op otherwise (consistent with the instance-ID
   * restore endpoint).
   *
   * Security: both EventNotFoundError and InsufficientCalendarPermissionsError
   * remap to 404 (IDOR prevention).
   */
  async restoreEventOccurrence(req: Request, res: Response) {
    const account = req.user as Account;
    if (!account) {
      res.status(401).json({
        "error": "not authenticated",
        errorName: 'AuthenticationError',
      });
      return;
    }

    const eventId = req.params.eventId;
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(400).json({
        "error": "invalid UUID format in event ID",
        errorName: 'ValidationError',
      });
      return;
    }

    const { start } = req.body ?? {};
    if (typeof start !== 'string') {
      res.status(400).json({
        "error": "start must be an ISO-8601 datetime string",
        errorName: 'ValidationError',
      });
      return;
    }
    const parsedStart = DateTime.fromISO(start, { zone: 'utc' });
    if (!parsedStart.isValid || parsedStart.year < 1900) {
      res.status(400).json({
        "error": "start must be an ISO-8601 datetime (year 1900 or later)",
        errorName: 'ValidationError',
      });
      return;
    }

    // Truncate to millisecond precision.
    const startDate = DateTime.fromMillis(parsedStart.toMillis(), { zone: 'utc' });

    try {
      await this.service.restoreOccurrenceByDate(account, eventId, startDate);
      res.status(204).send();
    }
    catch (error) {
      if (error instanceof EventNotFoundError || error instanceof InsufficientCalendarPermissionsError) {
        res.status(404).json({
          "error": "Event not found",
          errorName: 'NotFoundError',
        });
      }
      else if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
      }
      else {
        logError(error, "Error restoring event occurrence");
        res.status(500).json({
          "error": "An error occurred while restoring the event occurrence",
        });
      }
    }
  }
}
