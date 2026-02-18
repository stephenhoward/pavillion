import express, { Request, Response, Application } from 'express';
import axios from 'axios';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';
import CategoryMappingService from '@/server/calendar/service/category_mapping';
import { EventCategoryEntity, EventCategoryContentEntity } from '@/server/calendar/entity/event_category';
import { logError } from '@/server/common/helper/error-logger';

interface ActorInfo {
  actorType: 'local' | 'remote';
  calendarId: string | null;
  actorUri: string;
}

class CategoryMappingRoutes {
  private service: CalendarInterface;
  private categoryMappingService: CategoryMappingService;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
    this.categoryMappingService = internalAPI.categoryMappingService;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get(
      '/calendars/:calendarId/following/:actorId/source-categories',
      ExpressHelper.loggedInOnly,
      this.getSourceCategories.bind(this),
    );

    router.get(
      '/calendars/:calendarId/following/:actorId/category-mappings',
      ExpressHelper.loggedInOnly,
      this.getCategoryMappings.bind(this),
    );

    router.put(
      '/calendars/:calendarId/following/:actorId/category-mappings',
      ExpressHelper.loggedInOnly,
      this.setCategoryMappings.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Get source categories for a followed calendar actor.
   * For local actors: queries the source calendar's DB records.
   * For remote actors: proxies to stored actor_uri public API (SSRF-safe).
   *
   * GET /api/v1/calendars/:calendarId/following/:actorId/source-categories
   */
  async getSourceCategories(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, actorId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      // Resolve calendar and verify caller is an editor
      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        res.status(404).json({ error: 'calendar not found' });
        return;
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      let actor: ActorInfo;
      try {
        actor = await this.categoryMappingService.getActorInFollowing(calendarId, actorId);
      }
      catch (err: any) {
        res.status(404).json({ error: err.message });
        return;
      }

      if (actor.actorType === 'local') {
        await this.handleLocalActor(actor, res);
      }
      else {
        await this.handleRemoteActor(actor, res);
      }
    }
    catch (error) {
      logError(error, 'Error fetching source categories');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get all category mappings for a followed calendar actor.
   *
   * GET /api/v1/calendars/:calendarId/following/:actorId/category-mappings
   */
  async getCategoryMappings(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, actorId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        res.status(404).json({ error: 'calendar not found' });
        return;
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      try {
        await this.categoryMappingService.getActorInFollowing(calendarId, actorId);
      }
      catch (err: any) {
        res.status(404).json({ error: err.message });
        return;
      }

      const mappings = await this.categoryMappingService.getMappings(calendarId, actorId);
      res.json(mappings.map(m => ({
        sourceCategoryId: m.source_category_id,
        sourceCategoryName: m.source_category_name,
        localCategoryId: m.local_category_id,
      })));
    }
    catch (error) {
      logError(error, 'Error fetching category mappings');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Replace all category mappings for a followed calendar actor.
   * Atomically replaces the full set of mappings.
   *
   * PUT /api/v1/calendars/:calendarId/following/:actorId/category-mappings
   * Body: { mappings: [{sourceCategoryId, sourceCategoryName, localCategoryId}] }
   */
  async setCategoryMappings(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId, actorId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        res.status(404).json({ error: 'calendar not found' });
        return;
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      try {
        await this.categoryMappingService.getActorInFollowing(calendarId, actorId);
      }
      catch (err: any) {
        res.status(404).json({ error: err.message });
        return;
      }

      const { mappings } = req.body;

      if (!Array.isArray(mappings)) {
        res.status(400).json({ error: 'mappings must be an array' });
        return;
      }

      if (mappings.length > 100) {
        res.status(422).json({ error: 'Cannot set more than 100 category mappings at once' });
        return;
      }

      // UUID validation for all ID inputs
      for (const m of mappings) {
        if (!ExpressHelper.isValidUUID(m.sourceCategoryId)) {
          res.status(400).json({ error: 'Invalid UUID format for sourceCategoryId' });
          return;
        }
        if (!ExpressHelper.isValidUUID(m.localCategoryId)) {
          res.status(400).json({ error: 'Invalid UUID format for localCategoryId' });
          return;
        }
      }

      // Verify each localCategoryId belongs to the caller's calendar (prevent cross-calendar reference)
      if (mappings.length > 0) {
        const localCategoryIds = mappings.map((m: any) => m.localCategoryId);
        try {
          await this.categoryMappingService.validateLocalCategories(calendarId, localCategoryIds);
        }
        catch (err: any) {
          res.status(400).json({ error: err.message });
          return;
        }
      }

      await this.categoryMappingService.setMappings(calendarId, actorId, mappings.map((m: any) => ({
        sourceCategoryId: m.sourceCategoryId,
        sourceCategoryName: String(m.sourceCategoryName ?? '').slice(0, 255),
        localCategoryId: m.localCategoryId,
      })));

      const updated = await this.categoryMappingService.getMappings(calendarId, actorId);
      res.json(updated.map(m => ({
        sourceCategoryId: m.source_category_id,
        sourceCategoryName: m.source_category_name,
        localCategoryId: m.local_category_id,
      })));
    }
    catch (error) {
      logError(error, 'Error setting category mappings');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle local actor branch: fetch categories from the source calendar's DB.
   */
  private async handleLocalActor(
    actor: ActorInfo,
    res: Response,
  ): Promise<void> {
    const categories = await EventCategoryEntity.findAll({
      where: { calendar_id: actor.calendarId as string },
      include: [EventCategoryContentEntity],
    });

    const result = categories.map((c) => ({
      id: c.id,
      name: c.content?.[0]?.name ?? '',
    }));

    res.json(result);
  }

  /**
   * Handle remote actor branch: proxy to the stored actor_uri public API.
   * SSRF protection: URL is derived from actor.actor_uri (stored field), never from request input.
   */
  private async handleRemoteActor(
    actor: ActorInfo,
    res: Response,
  ): Promise<void> {
    try {
      // Derive the public categories URL from the stored actor_uri
      // actor_uri example: https://remote.domain/calendars/calname
      // public categories endpoint: https://remote.domain/api/public/v1/calendar/calname/categories
      const actorUrl = new URL(actor.actorUri);
      const calName = actorUrl.pathname.split('/').filter(Boolean).pop();
      const remoteCategoriesUrl = `${actorUrl.origin}/api/public/v1/calendar/${calName}/categories`;

      const response = await axios.get(remoteCategoriesUrl, { timeout: 5000 });

      const result = response.data.map((c: any) => ({
        id: c.id,
        name: c.content?.en?.name ?? '',
      }));

      res.json(result);
    }
    catch {
      res.status(502).json({ error: 'Could not reach source calendar' });
    }
  }
}

export default CategoryMappingRoutes;
