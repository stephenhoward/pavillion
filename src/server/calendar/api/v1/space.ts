import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import CalendarInterface from '@/server/calendar/interface';
import ExpressHelper from '@/server/common/helper/express';
import {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  LocationNotFoundError,
  LocationValidationError,
} from '@/common/exceptions/calendar';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Space API Routes
 * Provides REST endpoints for managing Spaces (sub-areas of a Place)
 * within a calendar. Routes resolve the calendar by URL name (`:urlname`)
 * and delegate Space CRUD to LocationsService via CalendarInterface.
 */
export default class SpaceRoutes {
  private service: CalendarInterface;

  constructor(service: CalendarInterface) {
    this.service = service;
  }

  /**
   * Install all Space route handlers.
   *
   * @param app - Express application instance
   * @param routePrefix - Base API path (e.g., '/api/v1')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get('/calendars/:urlname/places/:placeId/spaces', this.listSpaces.bind(this));
    router.post('/calendars/:urlname/places/:placeId/spaces', ExpressHelper.loggedInOnly, this.createSpace.bind(this));
    router.get('/calendars/:urlname/spaces/:spaceId', this.getSpace.bind(this));
    router.put('/calendars/:urlname/spaces/:spaceId', ExpressHelper.loggedInOnly, this.updateSpace.bind(this));
    router.delete('/calendars/:urlname/spaces/:spaceId', ExpressHelper.loggedInOnly, this.deleteSpace.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * Build a `contentByLang` map from an inbound request body's `content`
   * field. Each language entry is normalized to `{ name, accessibilityInfo }`
   * with empty-string fallbacks so the service receives a uniform shape.
   *
   * Returns an empty object when the body has no `content` field or it is
   * not a plain object.
   */
  private extractContentByLang(body: any): Record<string, { name: string; accessibilityInfo: string }> {
    const out: Record<string, { name: string; accessibilityInfo: string }> = {};
    const content = body?.content;
    if (!content || typeof content !== 'object') {
      return out;
    }
    for (const [language, raw] of Object.entries(content)) {
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, any>;
        out[language] = {
          name: typeof obj.name === 'string' ? obj.name : '',
          accessibilityInfo: typeof obj.accessibilityInfo === 'string' ? obj.accessibilityInfo : '',
        };
      }
    }
    return out;
  }

  /**
   * GET /api/v1/calendars/:urlname/places/:placeId/spaces
   * List all Spaces under a Place.
   */
  async listSpaces(req: Request, res: Response): Promise<void> {
    try {
      const { urlname, placeId } = req.params;

      const calendar = await this.service.getCalendarByName(urlname);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const spaces = await this.service.getSpacesForPlace(calendar, placeId);
      res.json(spaces.map(space => space.toObject()));
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else {
        logError(error, 'Error listing spaces');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * POST /api/v1/calendars/:urlname/places/:placeId/spaces
   * Create a new Space under a Place.
   * Requires authentication and calendar edit permissions.
   */
  async createSpace(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;
      const { urlname, placeId } = req.params;

      const calendar = await this.service.getCalendarByName(urlname);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const contentByLang = this.extractContentByLang(req.body);
      const created = await this.service.createSpace(calendar, placeId, contentByLang);

      res.status(201).json(created.toObject());
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ error: 'Insufficient permissions to modify this calendar', errorName: 'InsufficientCalendarPermissionsError' });
      }
      else if (error instanceof LocationNotFoundError) {
        res.status(404).json({ error: error.message, errorName: 'LocationNotFoundError' });
      }
      else if (error instanceof LocationValidationError) {
        res.status(400).json({ error: error.message, errorName: 'LocationValidationError' });
      }
      else {
        logError(error, 'Error creating space');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * GET /api/v1/calendars/:urlname/spaces/:spaceId
   * Get a specific Space by ID.
   */
  async getSpace(req: Request, res: Response): Promise<void> {
    try {
      const { urlname, spaceId } = req.params;
      const decodedSpaceId = decodeURIComponent(spaceId);

      const calendar = await this.service.getCalendarByName(urlname);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const space = await this.service.getSpaceById(calendar, decodedSpaceId);
      if (!space) {
        res.status(404).json({ error: 'Space not found', errorName: 'LocationNotFoundError' });
        return;
      }

      res.json(space.toObject());
    }
    catch (error) {
      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
      }
      else {
        logError(error, 'Error fetching space');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * PUT /api/v1/calendars/:urlname/spaces/:spaceId
   * Update an existing Space's multilingual content (full replacement).
   * Requires authentication and calendar edit permissions.
   */
  async updateSpace(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;
      const { urlname, spaceId } = req.params;
      const decodedSpaceId = decodeURIComponent(spaceId);

      const calendar = await this.service.getCalendarByName(urlname);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const contentByLang = this.extractContentByLang(req.body);
      const updated = await this.service.updateSpace(calendar, decodedSpaceId, contentByLang);

      if (!updated) {
        res.status(404).json({ error: 'Space not found', errorName: 'LocationNotFoundError' });
        return;
      }

      res.json(updated.toObject());
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
        logError(error, 'Error updating space');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * DELETE /api/v1/calendars/:urlname/spaces/:spaceId
   * Delete a Space and nullify space_id on referencing events.
   * Requires authentication and calendar edit permissions.
   */
  async deleteSpace(req: Request, res: Response): Promise<void> {
    try {
      const account = req.user as Account;
      const { urlname, spaceId } = req.params;
      const decodedSpaceId = decodeURIComponent(spaceId);

      const calendar = await this.service.getCalendarByName(urlname);
      if (!calendar) {
        throw new CalendarNotFoundError();
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        throw new InsufficientCalendarPermissionsError();
      }

      const deleted = await this.service.deleteSpace(calendar, decodedSpaceId);

      if (!deleted) {
        res.status(404).json({ error: 'Space not found', errorName: 'LocationNotFoundError' });
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
        logError(error, 'Error deleting space');
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
