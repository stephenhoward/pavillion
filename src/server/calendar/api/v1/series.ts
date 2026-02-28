import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';
import { CalendarNotFoundError, EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  SeriesNotFoundError,
  SeriesUrlNameAlreadyExistsError,
  InvalidSeriesUrlNameError,
  DuplicateSeriesNameError,
  SeriesEventCalendarMismatchError,
} from '@/common/exceptions/series';
import { logError } from '@/server/common/helper/error-logger';

class SeriesRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get('/calendars/:calendarId/series', this.getSeriesForCalendar.bind(this));
    router.post('/calendars/:calendarId/series', ExpressHelper.loggedInOnly, this.createSeries.bind(this));
    router.get('/calendars/:calendarId/series/:seriesId', this.getSeries.bind(this));
    router.put('/calendars/:calendarId/series/:seriesId', ExpressHelper.loggedInOnly, this.updateSeries.bind(this));
    router.delete('/calendars/:calendarId/series/:seriesId', ExpressHelper.loggedInOnly, this.deleteSeries.bind(this));
    router.get('/calendars/:calendarId/series/:seriesId/events', this.getSeriesEvents.bind(this));

    // Series assignment routes (event-scoped, mirrors category assignment pattern)
    router.post('/events/:eventId/series/:seriesId', ExpressHelper.loggedInOnly, this.setSeriesForEvent.bind(this));
    router.delete('/events/:eventId/series/:seriesId', ExpressHelper.loggedInOnly, this.clearSeriesForEvent.bind(this));
    router.get('/events/:eventId/series', this.getEventSeries.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * Get all series for a calendar
   * GET /api/v1/calendars/:calendarId/series
   */
  async getSeriesForCalendar(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId } = req.params;

      let calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        calendar = await this.service.getCalendarByName(calendarId);
      }

      if (!calendar) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      const seriesList = await this.service.getSeriesForCalendar(calendar.id);
      const stats = await this.service.getSeriesStats(calendar.id);

      const seriesWithCounts = seriesList.map((series) => {
        const seriesObj = series.toObject();
        return {
          ...seriesObj,
          eventCount: stats.get(series.id) || 0,
        };
      });

      res.json(seriesWithCounts);
    }
    catch (error) {
      logError(error, 'Error fetching series for calendar');
      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Create a new series for a calendar
   * POST /api/v1/calendars/:calendarId/series
   */
  async createSeries(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for series creation. Not logged in?",
          errorName: 'AuthenticationError',
        });
        return;
      }

      let calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        calendar = await this.service.getCalendarByName(calendarId);
      }

      if (!calendar) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      const series = await this.service.createSeries(account, calendar.id, req.body);
      res.status(201).json(series.toObject());
    }
    catch (error) {
      logError(error, 'Error creating series');

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", errorName: 'InsufficientCalendarPermissionsError' });
        return;
      }

      if (error instanceof SeriesUrlNameAlreadyExistsError) {
        res.status(409).json({ "error": "A series with this URL name already exists", errorName: 'SeriesUrlNameAlreadyExistsError' });
        return;
      }

      if (error instanceof InvalidSeriesUrlNameError) {
        res.status(400).json({ "error": "Invalid series URL name", errorName: 'InvalidSeriesUrlNameError' });
        return;
      }

      if (error instanceof DuplicateSeriesNameError) {
        res.status(409).json({ "error": "A series with this name already exists", errorName: 'DuplicateSeriesNameError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Get a specific series by ID with calendar context
   * GET /api/v1/calendars/:calendarId/series/:seriesId
   */
  async getSeries(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, seriesId } = req.params;

      let calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        calendar = await this.service.getCalendarByName(calendarId);
      }

      if (!calendar) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      const series = await this.service.getSeries(seriesId, calendar.id);
      res.json(series.toObject());
    }
    catch (error) {
      logError(error, 'Error fetching series');

      if (error instanceof SeriesNotFoundError) {
        res.status(404).json({ "error": "Series not found", errorName: 'SeriesNotFoundError' });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Update a series with calendar context
   * PUT /api/v1/calendars/:calendarId/series/:seriesId
   */
  async updateSeries(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, seriesId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for series update. Not logged in?",
          errorName: 'AuthenticationError',
        });
        return;
      }

      let calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        calendar = await this.service.getCalendarByName(calendarId);
      }

      if (!calendar) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      const series = await this.service.updateSeries(account, seriesId, req.body, calendar.id);
      res.json(series.toObject());
    }
    catch (error) {
      logError(error, 'Error updating series');

      if (error instanceof SeriesNotFoundError) {
        res.status(404).json({ "error": "Series not found", errorName: 'SeriesNotFoundError' });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", errorName: 'InsufficientCalendarPermissionsError' });
        return;
      }

      if (error instanceof InvalidSeriesUrlNameError) {
        res.status(400).json({ "error": "Invalid series URL name", errorName: 'InvalidSeriesUrlNameError' });
        return;
      }

      if (error instanceof SeriesUrlNameAlreadyExistsError) {
        res.status(409).json({ "error": "A series with this URL name already exists", errorName: 'SeriesUrlNameAlreadyExistsError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Delete a series with calendar context
   * DELETE /api/v1/calendars/:calendarId/series/:seriesId
   */
  async deleteSeries(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, seriesId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for series deletion. Not logged in?",
          errorName: 'AuthenticationError',
        });
        return;
      }

      let calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        calendar = await this.service.getCalendarByName(calendarId);
      }

      if (!calendar) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      await this.service.deleteSeries(account, seriesId, calendar.id);
      res.status(204).send();
    }
    catch (error) {
      logError(error, 'Error deleting series');

      if (error instanceof SeriesNotFoundError) {
        res.status(404).json({ "error": "Series not found", errorName: 'SeriesNotFoundError' });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", errorName: 'InsufficientCalendarPermissionsError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Get all events belonging to a series
   * GET /api/v1/calendars/:calendarId/series/:seriesId/events
   */
  async getSeriesEvents(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, seriesId } = req.params;

      let calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        calendar = await this.service.getCalendarByName(calendarId);
      }

      if (!calendar) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      const events = await this.service.getSeriesEvents(seriesId, calendar.id);
      res.json(events.map(event => event.toObject()));
    }
    catch (error) {
      logError(error, 'Error fetching series events');

      if (error instanceof SeriesNotFoundError) {
        res.status(404).json({ "error": "Series not found", errorName: 'SeriesNotFoundError' });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Assign an event to a series
   * POST /api/v1/events/:eventId/series/:seriesId
   */
  async setSeriesForEvent(req: Request, res: Response): Promise<void> {
    try {
      const { eventId, seriesId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for series assignment. Not logged in?",
          errorName: 'AuthenticationError',
        });
        return;
      }

      await this.service.setSeriesForEvent(account, eventId, seriesId);
      res.status(204).send();
    }
    catch (error) {
      logError(error, 'Error assigning series to event');

      if (error instanceof EventNotFoundError) {
        res.status(404).json({ "error": "Event not found", errorName: 'EventNotFoundError' });
        return;
      }

      if (error instanceof SeriesNotFoundError) {
        res.status(404).json({ "error": "Series not found", errorName: 'SeriesNotFoundError' });
        return;
      }

      if (error instanceof SeriesEventCalendarMismatchError) {
        res.status(400).json({ "error": "Event and series must belong to the same calendar", errorName: 'SeriesEventCalendarMismatchError' });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", errorName: 'InsufficientCalendarPermissionsError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Clear the series assignment from an event
   * DELETE /api/v1/events/:eventId/series/:seriesId
   */
  async clearSeriesForEvent(req: Request, res: Response): Promise<void> {
    try {
      const { eventId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for series assignment. Not logged in?",
          errorName: 'AuthenticationError',
        });
        return;
      }

      await this.service.clearSeriesForEvent(account, eventId);
      res.status(204).send();
    }
    catch (error) {
      logError(error, 'Error clearing series from event');

      if (error instanceof EventNotFoundError) {
        res.status(404).json({ "error": "Event not found", errorName: 'EventNotFoundError' });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", errorName: 'CalendarNotFoundError' });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", errorName: 'InsufficientCalendarPermissionsError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Get the series assigned to an event
   * GET /api/v1/events/:eventId/series
   */
  async getEventSeries(req: Request, res: Response): Promise<void> {
    try {
      const { eventId } = req.params;

      const series = await this.service.getEventSeries(eventId);
      res.json(series ? series.toObject() : null);
    }
    catch (error) {
      logError(error, 'Error fetching event series');

      if (error instanceof EventNotFoundError) {
        res.status(404).json({ "error": "Event not found", errorName: 'EventNotFoundError' });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }
}

export default SeriesRoutes;
