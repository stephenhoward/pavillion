import express, { Request, Response, Application } from 'express';
import { createLogger } from '@/server/common/helper/logger';

import { ValidationError } from '@/common/exceptions/base';
import ExpressHelper from '@/server/common/helper/express';
import { logError } from '@/server/common/helper/error-logger';
import CalendarInterface from '@/server/calendar/interface';
import type { AdminCalendarListFilters } from '@/server/calendar/service/calendar';

const logger = createLogger('calendar-admin');

/**
 * Admin-scoped calendar route handlers.
 *
 * Parallels AdminAccountRouteHandlers in the accounts domain. All routes
 * are registered behind ExpressHelper.adminOnly at router-registration
 * time; the handlers themselves are thin HTTP wrappers that delegate
 * all business logic and validation to CalendarService.
 */
export default class AdminCalendarRouteHandlers {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get('/admin/calendars', ...ExpressHelper.adminOnly, this.listCalendars.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * GET /api/v1/admin/calendars
   *
   * List all local calendars with pagination, filtering, and sort.
   * Privacy: the search VALUE is never logged; only a boolean flag
   * indicating whether a search term was provided.
   */
  async listCalendars(req: Request, res: Response): Promise<void> {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const hasOpenReports = req.query.hasOpenReports === 'true' || req.query.hasOpenReports === '1';
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined;
    const sortDir = typeof req.query.sortDir === 'string' ? req.query.sortDir : undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    logger.info({ hasSearch: !!search, hasOpenReports, sortBy, sortDir, page, limit }, 'Admin calendars list request');

    try {
      const filters: AdminCalendarListFilters = {
        search,
        hasOpenReports,
        sortBy: sortBy as AdminCalendarListFilters['sortBy'],
        sortDir: sortDir as AdminCalendarListFilters['sortDir'],
        page,
        limit,
      };

      const result = await this.service.listAllCalendarsForAdmin(filters);

      res.json(result);
    }
    catch (error) {
      if (error instanceof ValidationError) {
        ExpressHelper.sendValidationError(res, error);
        return;
      }

      logError(error, 'Error listing calendars for admin');
      res.status(500).json({ error: 'Failed to list calendars' });
    }
  }
}
