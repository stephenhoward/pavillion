import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import { ImportSourceVerificationType } from '@/common/model/import_source';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import {
  ImportSourceNotFoundError,
  ImportSourceNotVerifiedError,
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
  ImportSourceVerifyRateLimitError,
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  ImportSourceParseError,
} from '@/common/exceptions/import';
import ExpressHelper from '@/server/common/helper/express';
import { logError } from '@/server/common/helper/error-logger';
import {
  widgetConfigByAccount,
  importSourceVerifyBySource,
  importSourceSyncBySource,
} from '@/server/common/middleware/rate-limiters';
import CalendarInterface from '../../interface';
import type { SyncResult } from '../../service/import/sync';

/**
 * API routes for per-calendar ICS import sources.
 *
 * Exposes the CRUD surface from ImportSourceService plus the DNS verify
 * and manual-sync endpoints. The verify-issue endpoint surfaces the
 * per-source HMAC verification token (owner-only) so the UI can render
 * the exact TXT record value the owner must publish.
 *
 * Thin HTTP adapter: parse params, call the interface, serialize the
 * response. Ownership / editor-permission checks live in the service
 * layer (ImportSourceService.assertEditorAccess).
 *
 * Rate limiting:
 *  - list/create/get/delete/verify-issue: account-scoped limiter
 *    (`widgetConfigByAccount`) as a conservative default.
 *  - /verify: per-source limiter (`importSourceVerifyBySource`)
 *    configured to 3 requests per source per hour.
 *  - /sync:   per-source limiter (`importSourceSyncBySource`)
 *    configured to 4 requests per source per hour, in addition to the
 *    service-level sliding window enforced by SyncService.
 *
 * @see bead pv-1qcp.1.5 / pv-uffj
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
      '/calendars/:calendarId/import-sources/:id/verify-issue',
      ExpressHelper.loggedInOnly,
      widgetConfigByAccount,
      this.issueChallenge.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/:id/verify',
      ExpressHelper.loggedInOnly,
      importSourceVerifyBySource,
      this.verifySource.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/:id/sync',
      ExpressHelper.loggedInOnly,
      importSourceSyncBySource,
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
   * (surfaced only by the verify-issue flow).
   */
  async createSource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const url = typeof body.url === 'string' ? body.url : '';

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
   * POST /api/v1/calendars/:calendarId/import-sources/:id/verify-issue
   *
   * Return the per-source HMAC verification token. Owner-only (editor
   * permission required); the token allows a calendar owner to render
   * the exact TXT record value they must publish, or to embed the
   * well-known URL in a `<a rel="me">` backlink. Token is deterministic
   * per (sourceId, calendarId), so calling this repeatedly is safe.
   *
   * Optional body: `{ verification_type?: 'dns-txt' | 'rel-me' }`. When
   * present, the service updates the source's verification mechanism
   * (clearing `verifiedAt` if the mechanism actually changes). The handler
   * stays thin: the value is forwarded as-is to the service, which
   * validates and surfaces errors via ValidationError.
   */
  async issueChallenge(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId, id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const verificationType
      = body.verification_type === undefined
        ? undefined
        // Cast is safe here because service-layer validation rejects any
        // string that is not in IMPORT_SOURCE_VERIFICATION_TYPES.
        : (body.verification_type as ImportSourceVerificationType);

    if (!ExpressHelper.isValidUUID(calendarId) || !ExpressHelper.isValidUUID(id)) {
      res.status(400).json({
        error: 'invalid id format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const token = await this.service.issueImportSourceChallenge(
        account,
        calendarId,
        id,
        verificationType,
      );
      res.json({ challengeToken: token });
    }
    catch (error) {
      this.handleError(res, error, 'Error issuing import source challenge');
    }
  }

  /**
   * POST /api/v1/calendars/:calendarId/import-sources/:id/verify
   *
   * Perform ownership verification (DNS TXT or rel="me" backlink, per the
   * source's `verificationType` discriminator), persist the outcome to the
   * entity, and return the updated source on success. Sanitized failure
   * modes map to typed exceptions the frontend uses to display actionable
   * error messages.
   *
   * Optional body: `{ verification_page_url?: string }`. Required when the
   * source's `verificationType === 'rel-me'`; ignored for DNS sources.
   * The handler stays thin: the value is forwarded as-is to the service,
   * which validates structure (https-only, hostname equality, length cap)
   * and surfaces failures via ValidationError or
   * ImportSourceRelMeVerificationError.
   */
  async verifySource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId, id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const verificationPageUrl
      = typeof body.verification_page_url === 'string'
        ? body.verification_page_url
        : undefined;

    if (!ExpressHelper.isValidUUID(calendarId) || !ExpressHelper.isValidUUID(id)) {
      res.status(400).json({
        error: 'invalid id format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const updated = await this.service.verifyImportSource(
        account,
        calendarId,
        id,
        verificationPageUrl,
      );
      res.json(updated.toObject());
    }
    catch (error) {
      this.handleError(res, error, 'Error verifying import source');
    }
  }

  /**
   * POST /api/v1/calendars/:calendarId/import-sources/:id/sync
   *
   * Trigger a manual sync run via SyncService. Returns an ImportRunSummary
   * shape matching the frontend contract.
   */
  async syncSource(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId, id } = req.params;

    if (!ExpressHelper.isValidUUID(calendarId) || !ExpressHelper.isValidUUID(id)) {
      res.status(400).json({
        error: 'invalid id format',
        errorName: 'ValidationError',
      });
      return;
    }

    try {
      const result = await this.service.syncImportSource(account, calendarId, id);
      res.json(toImportRunSummary(result, id));
    }
    catch (error) {
      this.handleError(res, error, 'Error syncing import source');
    }
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
    if (error instanceof ImportSourceDnsVerificationError) {
      res.status(400).json({
        error: error.message,
        errorName: error.name,
        reason: error.reason,
      });
      return;
    }
    if (error instanceof ImportSourceRelMeVerificationError) {
      // Mirrors the DNS branch: 400 with `errorName` + `reason`. Reason is
      // one of the IMPORT_RELME_* sanitized codes (no URLs, no hostnames,
      // no raw HTML — those live on `details` for structured logs only).
      res.status(400).json({
        error: error.message,
        errorName: error.name,
        reason: error.reason,
      });
      return;
    }
    if (error instanceof ImportSourceVerifyRateLimitError) {
      res.status(429).json({
        error: error.message,
        errorName: error.name,
      });
      return;
    }
    if (error instanceof ImportSourceSsrfBlockedError) {
      res.status(400).json({
        error: error.message,
        errorName: error.name,
      });
      return;
    }
    if (error instanceof ImportSourceFetchError) {
      res.status(502).json({
        error: error.message,
        errorName: error.name,
      });
      return;
    }
    if (error instanceof ImportSourceParseError) {
      res.status(422).json({
        error: error.message,
        errorName: error.name,
      });
      return;
    }
    // Sync service throws ImportSourceNotVerifiedError when the source's
    // verification state blocks the run — translate to 409 Conflict.
    if (error instanceof ImportSourceNotVerifiedError) {
      res.status(409).json({
        error: error.message,
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

/**
 * Translate SyncService's internal SyncResult shape into the API wire
 * shape consumed by the frontend (`ImportRunSummary`). The run's real
 * `startedAt` is preserved from the service result; `finishedAt` is
 * captured at API-handler return time (the run is definitively finished
 * by the time this function runs).
 */
function toImportRunSummary(
  result: SyncResult,
  importSourceId: string,
): Record<string, unknown> {
  return {
    id: result.runId,
    importSourceId,
    startedAt: result.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    outcome: result.outcome,
    eventsCreated: result.eventsCreated,
    eventsUpdated: result.eventsUpdated,
    eventsSkippedLocallyEdited: result.eventsSkippedLocallyEdited,
    eventsDisappeared: result.eventsDisappeared,
    errorMessage: result.errorMessage,
  };
}

export default ImportSourceRoutes;
