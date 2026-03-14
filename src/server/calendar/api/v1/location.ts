import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import CalendarInterface from '@/server/calendar/interface';
import ExpressHelper from '@/server/common/helper/express';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError, LocationValidationError } from '@/common/exceptions/calendar';
import { logError } from '@/server/common/helper/error-logger';

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
   * @param routePrefix - Base API path (e.g., '/api/v1')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get('/calendars/:calendarId/locations', this.listLocations.bind(this));
    router.post('/calendars/:calendarId/locations', ExpressHelper.loggedInOnly, this.createLocation.bind(this));
    router.get('/calendars/:calendarId/locations/:locationId', this.getLocation.bind(this));
    router.put('/calendars/:calendarId/locations/:locationId', ExpressHelper.loggedInOnly, this.updateLocation.bind(this));
    router.delete('/calendars/:calendarId/locations/:locationId', ExpressHelper.loggedInOnly, this.deleteLocation.bind(this));

    app.use(routePrefix, router);
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
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else {
        logError(error, 'Error listing locations');
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
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ error: 'Insufficient permissions to modify this calendar', errorName: 'InsufficientCalendarPermissionsError' });
      }
      else if (error instanceof LocationValidationError) {
        res.status(400).json({ error: error.message, errorName: 'LocationValidationError' });
      }
      else {
        logError(error, 'Error creating location');
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
        res.status(404).json({ error: 'Location not found', errorName: 'LocationNotFoundError' });
        return;
      }

      res.json(location.toObject());
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else {
        logError(error, 'Error fetching location');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * PUT /api/v1/calendars/:calendarId/locations/:locationId
   * Update an existing location (full replacement).
   * Requires authentication and calendar edit permissions.
   */
  async updateLocation(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;
      const { calendarId, locationId } = req.params;
      const decodedLocationId = decodeURIComponent(locationId);

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const locationData = EventLocation.fromObject(req.body);
      const updatedLocation = await this.service.updateLocation(calendar, decodedLocationId, locationData);

      if (!updatedLocation) {
        res.status(404).json({ error: 'Location not found', errorName: 'LocationNotFoundError' });
        return;
      }

      res.json(updatedLocation.toObject());
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ error: 'Insufficient permissions to modify this calendar', errorName: 'InsufficientCalendarPermissionsError' });
      }
      else if (error instanceof LocationValidationError) {
        res.status(400).json({ error: error.message, errorName: 'LocationValidationError' });
      }
      else {
        logError(error, 'Error updating location');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * DELETE /api/v1/calendars/:calendarId/locations/:locationId
   * Delete a location and nullify location_id on associated events.
   * Requires authentication and calendar edit permissions.
   */
  async deleteLocation(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;
      const { calendarId, locationId } = req.params;
      const decodedLocationId = decodeURIComponent(locationId);

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const deleted = await this.service.deleteLocation(calendar, decodedLocationId);

      if (!deleted) {
        res.status(404).json({ error: 'Location not found', errorName: 'LocationNotFoundError' });
        return;
      }

      res.status(204).send();
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ error: 'Insufficient permissions to modify this calendar', errorName: 'InsufficientCalendarPermissionsError' });
      }
      else {
        logError(error, 'Error deleting location');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
