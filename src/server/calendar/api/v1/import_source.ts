import express, { Request, Response, Application, NextFunction } from 'express';
import multer from 'multer';

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
  ImportSourceFileEmptyError,
  ImportSourceFileTooLargeError,
  ImportSourceFileBadFormatError,
  ImportSourceFileTooManyEventsError,
  ImportSourceCapExceededError,
} from '@/common/exceptions/import';
import ExpressHelper from '@/server/common/helper/express';
import { logError } from '@/server/common/helper/error-logger';
import {
  limitWidgetConfigByAccount,
  limitImportSourceVerifyBySource,
  limitImportSourceSyncBySource,
} from '@/server/common/middleware/rate-limiters';
import { MAX_BODY_BYTES, ALLOWED_CONTENT_TYPES } from '../../service/import/fetcher';
import CalendarInterface from '../../interface';
import type { SyncResult } from '../../service/import/sync';

/**
 * Hard byte cap for an uploaded .ics file. Reuses the ICS URL fetcher's
 * {@link MAX_BODY_BYTES} (10 MiB) so the transport, service, and fetch paths
 * share one ceiling instead of maintaining independent copies.
 */
const FILE_MAX_BYTES = MAX_BODY_BYTES;

/**
 * Content types an .ics upload may declare. Reuses the fetcher's
 * {@link ALLOWED_CONTENT_TYPES} allowlist. Many exporters mislabel the file as
 * `application/octet-stream`, so a `.ics` filename extension is accepted as an
 * alternative (the service still enforces the `BEGIN:VCALENDAR` signature sniff,
 * so a lie about the type cannot smuggle a non-ICS payload through).
 */
const ALLOWED_ICS_MIME_TYPES = ALLOWED_CONTENT_TYPES;

/**
 * Multer instance for the file-upload route: in-memory storage (the buffer is
 * handed straight to the ICS pipeline, never written to disk), a single file,
 * and the 10 MiB transport cap. Mirrors the media-domain upload pattern
 * (src/server/media/api/v1/media.ts).
 */
const icsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FILE_MAX_BYTES,
    files: 1,
  },
});

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
 *    (`limitWidgetConfigByAccount`) as a conservative default.
 *  - /verify: per-source limiter (`limitImportSourceVerifyBySource`)
 *    configured to 3 requests per source per hour.
 *  - /sync:   per-source limiter (`limitImportSourceSyncBySource`)
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
      limitWidgetConfigByAccount,
      this.listSources.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources',
      ExpressHelper.loggedInOnly,
      limitWidgetConfigByAccount,
      this.createSource.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/file',
      ExpressHelper.loggedInOnly,
      limitWidgetConfigByAccount,
      // Authorize BEFORE multer buffers up to 10 MiB into memory. A non-editor
      // (or a bad calendar id) is rejected 400/403/404 here so an unauthorized
      // caller cannot force a large in-memory buffer for a calendar they do
      // not own. The service layer re-checks access as defense in depth.
      this.assertFileUploadAccess.bind(this),
      this.uploadIcsFile.bind(this),
      this.createSourceFromFile.bind(this),
    );
    router.get(
      '/calendars/:calendarId/import-sources/:id',
      ExpressHelper.loggedInOnly,
      limitWidgetConfigByAccount,
      this.getSource.bind(this),
    );
    router.delete(
      '/calendars/:calendarId/import-sources/:id',
      ExpressHelper.loggedInOnly,
      limitWidgetConfigByAccount,
      this.deleteSource.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/:id/verify-issue',
      ExpressHelper.loggedInOnly,
      limitWidgetConfigByAccount,
      this.issueChallenge.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/:id/verify',
      ExpressHelper.loggedInOnly,
      limitImportSourceVerifyBySource,
      this.verifySource.bind(this),
    );
    router.post(
      '/calendars/:calendarId/import-sources/:id/sync',
      ExpressHelper.loggedInOnly,
      limitImportSourceSyncBySource,
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
   * Pre-buffer authorization for the file-upload route. Runs BEFORE the multer
   * intake middleware so an unauthorized caller (bad UUID, missing calendar, or
   * non-editor) is rejected without multer buffering the up-to-10-MiB body into
   * memory. HTTP concerns only: validate the UUID shape, then confirm editor
   * access via the calendar interface. The service layer repeats these checks
   * as defense in depth (a non-HTTP caller — e.g. a CLI importer — bypasses this
   * middleware entirely).
   */
  async assertFileUploadAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      const calendar = await this.service.getCalendar(calendarId);
      if (!calendar) {
        res.status(404).json({
          error: 'Calendar not found',
          errorName: 'CalendarNotFoundError',
        });
        return;
      }

      const canModify = await this.service.userCanModifyCalendar(account, calendar);
      if (!canModify) {
        res.status(403).json({
          error: 'Permission denied',
          errorName: 'CalendarEditorPermissionError',
        });
        return;
      }

      next();
    }
    catch (error) {
      this.handleError(res, error, 'Error authorizing import file upload');
    }
  }

  /**
   * Multipart intake middleware for the file-upload route. Wraps multer's
   * `single('file')` so its own errors (notably the 10 MiB `LIMIT_FILE_SIZE`
   * transport cap) are translated to the sanitized `{ error, errorName }`
   * envelope instead of bubbling to the default Express error handler as a 500.
   * On success it populates `req.file` and continues to the handler.
   */
  uploadIcsFile(req: Request, res: Response, next: NextFunction): void {
    icsUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            error: 'Uploaded file exceeds the size limit',
            errorName: 'ImportSourceFileTooLargeError',
          });
          return;
        }
        res.status(400).json({
          error: 'Invalid file upload',
          errorName: 'ValidationError',
        });
        return;
      }
      next();
    });
  }

  /**
   * POST /api/v1/calendars/:calendarId/import-sources/file
   *
   * Create a file-backed import source from a multipart .ics upload and run
   * its events through the shared ICS pipeline. HTTP concerns only — UUID
   * shape, file presence, and the content-type / extension allowlist. All
   * business validation (editor access, size, VCALENDAR sniff, per-calendar
   * cap, parse) lives in the service. On success returns 201 `{ source, run }`.
   */
  async createSourceFromFile(req: Request, res: Response): Promise<void> {
    const account = req.user as Account;
    const { calendarId } = req.params;
    const file = req.file;

    if (!ExpressHelper.isValidUUID(calendarId)) {
      res.status(400).json({
        error: 'invalid calendarId format',
        errorName: 'ValidationError',
      });
      return;
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({
        error: 'No file uploaded',
        errorName: 'ImportSourceFileEmptyError',
      });
      return;
    }

    if (!this.isAllowedIcsUpload(file)) {
      res.status(400).json({
        error: 'File is not an ICS calendar',
        errorName: 'ImportSourceFileBadFormatError',
      });
      return;
    }

    try {
      const { source, run } = await this.service.createImportSourceFromFile(
        account,
        calendarId,
        file.buffer,
        file.originalname,
      );
      res.status(201).json({
        source: source.toObject(),
        run: toImportRunSummary(run, source.id),
      });
    }
    catch (error) {
      this.handleError(res, error, 'Error creating import source from file');
    }
  }

  /**
   * Accept an upload when its declared content type is in the ICS allowlist,
   * or (defensively) when the filename ends in `.ics`. The service's
   * `BEGIN:VCALENDAR` signature sniff is the real content gate; this is a
   * cheap first filter on the transport-declared type.
   */
  private isAllowedIcsUpload(file: Express.Multer.File): boolean {
    const mime = (file.mimetype ?? '').toLowerCase().split(';')[0].trim();
    if (ALLOWED_ICS_MIME_TYPES.has(mime)) {
      return true;
    }
    return (file.originalname ?? '').toLowerCase().endsWith('.ics');
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
    if (
      error instanceof ImportSourceParseError
      || error instanceof ImportSourceFileTooManyEventsError
    ) {
      // 422: the payload parsed but its event content is not acceptable — no
      // usable VEVENTs (ParseError) or too many VEVENTs (TooManyEvents, a DoS
      // bound). Distinct from the 400 malformed-file bucket below.
      res.status(422).json({
        error: error.message,
        errorName: error.name,
      });
      return;
    }
    // File-upload intake failures (pv-84da.1.4).
    if (
      error instanceof ImportSourceFileEmptyError
      || error instanceof ImportSourceFileTooLargeError
      || error instanceof ImportSourceFileBadFormatError
    ) {
      res.status(400).json({
        error: error.message,
        errorName: error.name,
      });
      return;
    }
    if (error instanceof ImportSourceCapExceededError) {
      res.status(409).json({
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
