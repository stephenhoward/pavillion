import { Request, Response, Application } from 'express';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import CalendarInterface from '@/server/calendar/interface';
import ExpressHelper from '@/server/common/helper/express';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

/**
 * Location API Routes
 * Provides REST endpoints for managing event locations within calendars.
 */
export default class LocationRoutes {
  private service: CalendarInterface;

  constructor(service: CalendarInterface) {
    this.service = service;
  }

  /**
   * Install all location route handlers.
   *
   * @param app - Express application instance
   * @param basePath - Base API path (e.g., '/api/v1')
   */
  installHandlers(app: Application, basePath: string): void {
    app.get(
      `${basePath}/calendars/:calendarId/locations`,
      this.listLocations.bind(this),
    );

    app.post(
      `${basePath}/calendars/:calendarId/locations`,
      ExpressHelper.loggedInOnly,
      this.createLocation.bind(this),
    );

    app.get(
      `${basePath}/calendars/:calendarId/locations/:locationId`,
      this.getLocation.bind(this),
    );
  }

  /**
   * GET /api/v1/calendars/:calendarId/locations
   * List all locations for a calendar.
   */
  async listLocations(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId } = req.params;

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const locations = await this.service.getLocationsForCalendar(calendar);
      res.json(locations.map(location => location.toObject()));
    } catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * POST /api/v1/calendars/:calendarId/locations
   * Create a new location for a calendar.
   * Requires authentication and calendar edit permissions.
   */
  async createLocation(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;
      const { calendarId } = req.params;

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const locationData = EventLocation.fromObject(req.body);
      const createdLocation = await this.service.createLocation(calendar, locationData);

      res.status(201).json(createdLocation.toObject());
    } catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      } else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ error: 'Insufficient permissions to modify this calendar', errorName: 'InsufficientCalendarPermissionsError' });
      } else if (error instanceof Error && error.message === 'Location name is required') {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /api/v1/calendars/:calendarId/locations/:locationId
   * Get a specific location by ID.
   */
  async getLocation(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, locationId } = req.params;
      // Decode the location ID in case it's URL-encoded
      const decodedLocationId = decodeURIComponent(locationId);

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const location = await this.service.getLocationById(calendar, decodedLocationId);
      if (!location) {
        res.status(404).json({ error: 'Location not found' });
        return;
      }

      res.json(location.toObject());
    } catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
