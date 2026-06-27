import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import CalendarInterface from '@/server/calendar/interface';
import ExpressHelper from '@/server/common/helper/express';
import {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  InvalidClientIdError,
  LocationValidationError,
  SpaceHijackError,
} from '@/common/exceptions/calendar';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Serialize an EventLocation for the GET response, stamping each Space's
 * `eventCount` (a read-only server-computed field) onto the wire shape.
 *
 * `EventLocation.toObject()` and `EventLocationSpace.toObject()` intentionally
 * omit `eventCount` — the model contract is "writes never carry eventCount"
 * (asserted in `src/common/test/event_location_space.test.ts`). The API layer
 * is responsible for re-adding it on outbound serialization so the editor can
 * decide which delete dialog to show without a follow-up round trip.
 */
function serializeLocationForApi(location: EventLocation): Record<string, any> {
  const obj = location.toObject();
  if (Array.isArray(obj.spaces)) {
    obj.spaces = obj.spaces.map((spaceObj: Record<string, any>, index: number) => {
      const space = location.spaces[index];
      if (space && typeof space.eventCount === 'number') {
        return { ...spaceObj, eventCount: space.eventCount };
      }
      return spaceObj;
    });
  }
  return obj;
}

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

    router.get('/calendars/:calendarId/locations', ExpressHelper.loggedInOnly, this.listLocations.bind(this));
    router.post('/calendars/:calendarId/locations', ExpressHelper.loggedInOnly, this.createLocation.bind(this));
    router.get('/calendars/:calendarId/locations/:locationId', ExpressHelper.loggedInOnly, this.getLocation.bind(this));
    router.put('/calendars/:calendarId/locations/:locationId', ExpressHelper.loggedInOnly, this.updateLocation.bind(this));
    router.delete('/calendars/:calendarId/locations/:locationId', ExpressHelper.loggedInOnly, this.deleteLocation.bind(this));
    router.post(
      '/calendars/:calendarId/locations/:locationId/reassign-events',
      ExpressHelper.loggedInOnly,
      this.reassignEvents.bind(this),
    );

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
      res.json(locations.map(location => serializeLocationForApi(location)));
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

      res.status(201).json(serializeLocationForApi(createdLocation));
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
      else if (error instanceof InvalidClientIdError) {
        res.status(400).json({ error: error.message, errorName: 'InvalidClientIdError' });
      }
      else if (error instanceof SpaceHijackError) {
        res.status(400).json({ error: error.message, errorName: 'SpaceHijackError' });
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

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const location = await this.service.getLocationById(calendar, locationId);
      if (!location) {
        res.status(404).json({ error: 'Location not found', errorName: 'LocationNotFoundError' });
        return;
      }

      res.json(serializeLocationForApi(location));
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

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const locationData = EventLocation.fromObject(req.body);
      const updatedLocation = await this.service.updateLocation(calendar, locationId, locationData);

      if (!updatedLocation) {
        res.status(404).json({ error: 'Location not found', errorName: 'LocationNotFoundError' });
        return;
      }

      res.json(serializeLocationForApi(updatedLocation));
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
      else if (error instanceof InvalidClientIdError) {
        res.status(400).json({ error: error.message, errorName: 'InvalidClientIdError' });
      }
      else if (error instanceof SpaceHijackError) {
        res.status(400).json({ error: error.message, errorName: 'SpaceHijackError' });
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

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const deleted = await this.service.deleteLocation(calendar, locationId);

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

  /**
   * POST /api/v1/calendars/:calendarId/locations/:locationId/reassign-events
   *
   * Bulk-reassign every Event row attached to `(placeId, fromSpaceId)` onto
   * `toSpaceId`. Action-path bulk operation; mirrors the
   * `bulk-assign-categories` precedent in `events.ts`.
   *
   * Body: `{ fromSpaceId: string, toSpaceId: string }`.
   *
   * Validation chain:
   *   1. `fromSpaceId` is a UUID (format gate against malformed input).
   *   2. `toSpaceId` references a Space currently on this Place. Unknown →
   *      400. The structural fence is `place_id = :locationId`, so a Space
   *      owned by a sibling Place — even on the same calendar — is rejected.
   *   3. `fromSpaceId` is intentionally NOT validated against this Place's
   *      Space set. The `place_id` WHERE-clause in the service-layer UPDATE
   *      is the safety boundary; events outside this Place can never be
   *      touched. Out-of-Place `fromSpaceId` returns `200 { count: 0 }` —
   *      a documented no-op for retry-as-no-op idempotency.
   *
   * Response: `200 { count }` — the number of event rows updated.
   */
  async reassignEvents(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;
      const { calendarId, locationId } = req.params;
      const decodedLocationId = decodeURIComponent(locationId);
      const { fromSpaceId, toSpaceId } = req.body ?? {};

      // UUID-format gate on `fromSpaceId`. Note: we deliberately do NOT
      // reject `fromSpaceId` if it does not appear in this Place's Space
      // set — see the place_id WHERE-clause comment in
      // LocationService.reassignEvents.
      if (typeof fromSpaceId !== 'string' || !ExpressHelper.isValidUUID(fromSpaceId)) {
        res.status(400).json({
          error: 'fromSpaceId must be a valid UUID',
          errorName: 'ValidationError',
        });
        return;
      }
      if (typeof toSpaceId !== 'string' || toSpaceId.length === 0) {
        res.status(400).json({
          error: 'toSpaceId is required',
          errorName: 'ValidationError',
        });
        return;
      }

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const result = await this.service.reassignEvents(
        calendar,
        decodedLocationId,
        fromSpaceId,
        toSpaceId,
      );

      if (!result.placeFound) {
        res.status(404).json({
          error: 'Location not found',
          errorName: 'LocationNotFoundError',
        });
        return;
      }

      if (!result.toSpaceValid) {
        res.status(400).json({
          error: 'toSpaceId does not reference a Space on this Place',
          errorName: 'ValidationError',
        });
        return;
      }

      res.status(200).json({ count: result.count });
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ error: 'Insufficient permissions to modify this calendar', errorName: 'InsufficientCalendarPermissionsError' });
      }
      else {
        logError(error, 'Error reassigning events');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
