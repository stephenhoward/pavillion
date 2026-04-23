import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { ImportSourceNotFoundError } from '@/common/exceptions/import';
import ExpressHelper from '@/server/common/helper/express';
import { logError } from '@/server/common/helper/error-logger';
import { widgetConfigByAccount } from '@/server/common/middleware/rate-limiters';
import CalendarInterface from '../../interface';

/**
 * API routes for per-calendar ICS import sources.
 *
 * Exposes the CRUD surface from ImportSourceService plus verify/sync
 * placeholders that will be wired in later beads:
 *  - verify handler → pv-1qcp.1.9
 *  - sync handler   → pv-1qcp.2.4
 *
 * Thin HTTP adapter: parse params, call the service, serialize the
 * response. Ownership / editor-permission checks live in the service
 * layer (ImportSourceService.assertEditorAccess).
 *
 * Rate limiting note: the epic requires stricter per-endpoint limits
 * (verify: 3/hostname/hour, sync: 4/source/hour) that need custom
 * keying. For now we apply the existing account-scoped limiter on all
 * write endpoints as a conservative default; stricter per-hostname /
 * per-source middleware is tracked for bead pv-1qcp.1.8 or the sync
 * orchestrator (pv-1qcp.2.4). TODO: replace `widgetConfigByAccount`
 * with dedicated import-source limiters once available.
 *
 * @see bead pv-1qcp.1.5
 */
class ImportSourceRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get(
      '/calendars/:calendarId/import-sources',
      ExpressHelper.loggedInOnly,
      widgetConfigByAccount,
      this.listSources.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources',
      ExpressHelper.loggedInOnly,
      widgetConfigByAccount,
      this.createSource.bind(this),
    );
    router.get(
      '/calendars/:calendarId/import-sources/:id',
      ExpressHelper.loggedInOnly,
      widgetConfigByAccount,
      this.getSource.bind(this),
    );
    router.delete(
      '/calendars/:calendarId/import-sources/:id',
      ExpressHelper.loggedInOnly,
      widgetConfigByAccount,
      this.deleteSource.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/:id/verify',
      ExpressHelper.loggedInOnly,
      widgetConfigByAccount,
      this.verifySource.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/:id/sync',
      ExpressHelper.loggedInOnly,
      widgetConfigByAccount,
      this.syncSource.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * GET /api/v1/calendars/:calendarId/import-sources
   * List all import sources for a calendar.
   */
  async listSources(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId } = req.params;

    if (!account) {
      res.status(401).json({
        error: 'missing account. Not logged in?',
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        error: 'invalid calendarId format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const sources = await this.service.listImportSources(account, calendarId);
      res.json(sources.map(source => source.toObject()));
    }
    catch (error) {
      this.handleError(res, error, 'Error listing import sources');
    }
  }

  /**
   * POST /api/v1/calendars/:calendarId/import-sources
   * Create a new import source. Body: { url: string }.
   * Returns the persisted source; verification token is NOT included
   * (surfaced only by the verify-issue flow in milestone B).
   */
  async createSource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const url = typeof body.url === 'string' ? body.url : '';

    if (!account) {
      res.status(401).json({
        error: 'missing account. Not logged in?',
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        error: 'invalid calendarId format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const source = await this.service.createImportSource(account, calendarId, url);
      res.status(201).json(source.toObject());
    }
    catch (error) {
      this.handleError(res, error, 'Error creating import source');
    }
  }

  /**
   * GET /api/v1/calendars/:calendarId/import-sources/:id
   */
  async getSource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId, id } = req.params;

    if (!account) {
      res.status(401).json({
        error: 'missing account. Not logged in?',
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!ExpressHelper.isValidUUID(calendarId) || !ExpressHelper.isValidUUID(id)) {
      res.status(400).json({
        error: 'invalid id format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const source = await this.service.getImportSource(account, calendarId, id);
      res.json(source.toObject());
    }
    catch (error) {
      this.handleError(res, error, 'Error fetching import source');
    }
  }

  /**
   * DELETE /api/v1/calendars/:calendarId/import-sources/:id
   */
  async deleteSource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId, id } = req.params;

    if (!account) {
      res.status(401).json({
        error: 'missing account. Not logged in?',
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!ExpressHelper.isValidUUID(calendarId) || !ExpressHelper.isValidUUID(id)) {
      res.status(400).json({
        error: 'invalid id format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      await this.service.deleteImportSource(account, calendarId, id);
      res.status(204).send();
    }
    catch (error) {
      this.handleError(res, error, 'Error deleting import source');
    }
  }

  /**
   * POST /api/v1/calendars/:calendarId/import-sources/:id/verify
   *
   * Placeholder — full DNS verification wiring lands in pv-1qcp.1.9.
   * Returns 501 with a TODO note so the client-facing contract is
   * visible while the service is not yet available.
   */
  async verifySource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId, id } = req.params;

    if (!account) {
      res.status(401).json({
        error: 'missing account. Not logged in?',
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!ExpressHelper.isValidUUID(calendarId) || !ExpressHelper.isValidUUID(id)) {
      res.status(400).json({
        error: 'invalid id format',
        errorName: 'ValidationError',
      });
      return;
    }

    res.status(501).json({
      error: 'DNS verification is not yet implemented',
      errorName: 'NotImplementedError',
      todo: 'pv-1qcp.1.9',
    });
  }

  /**
   * POST /api/v1/calendars/:calendarId/import-sources/:id/sync
   *
   * Placeholder — sync orchestration wiring lands in pv-1qcp.2.4.
   * Returns 501 with a TODO note so the client-facing contract is
   * visible while the service is not yet available.
   */
  async syncSource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId, id } = req.params;

    if (!account) {
      res.status(401).json({
        error: 'missing account. Not logged in?',
        errorName: 'AuthenticationError',
      });
      return;
    }

    if (!ExpressHelper.isValidUUID(calendarId) || !ExpressHelper.isValidUUID(id)) {
      res.status(400).json({
        error: 'invalid id format',
        errorName: 'ValidationError',
      });
      return;
    }

    res.status(501).json({
      error: 'Manual sync is not yet implemented',
      errorName: 'NotImplementedError',
      todo: 'pv-1qcp.2.4',
    });
  }

  /**
   * Translate domain exceptions into HTTP responses following the
   * backend-error-serialization contract: every error carries an
   * `errorName` so the frontend can reconstruct the exception type.
   */
  private handleError(res: Response, error: unknown, logContext: string): void {
    if (error instanceof ValidationError) {
      ExpressHelper.sendValidationError(res, error);
      return;
    }
    if (error instanceof CalendarNotFoundError) {
      res.status(404).json({
        error: 'Calendar not found',
        errorName: error.name,
      });
      return;
    }
    if (error instanceof ImportSourceNotFoundError) {
      res.status(404).json({
        error: 'Import source not found',
        errorName: error.name,
      });
      return;
    }
    if (error instanceof CalendarEditorPermissionError) {
      res.status(403).json({
        error: 'Permission denied',
        errorName: error.name,
      });
      return;
    }

    logError(error, logContext);
    res.status(500).json({
      error: 'An error occurred while processing the request',
    });
  }
}

export default ImportSourceRoutes;
