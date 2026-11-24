import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarExportError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import ExpressHelper from '@/server/common/helper/express';
import { logError } from '@/server/common/helper/error-logger';
import { limitWidgetConfigByAccount } from '@/server/common/middleware/rate-limiters';
import CalendarInterface from '../../interface';

/**
 * API routes for exporting a calendar's own events as one iCalendar file.
 *
 * Thin HTTP adapter: parse params, call the interface, set headers and map
 * errors. The owner check, the language set and the serialization live in
 * CalendarExportService.
 *
 * Both routes are logged-in only and rate limited per account
 * (`limitWidgetConfigByAccount`, the import routes' default).
 */
class CalendarExportRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    router.get(
      '/calendars/:calendarId/export',
      ExpressHelper.loggedInOnly,
      limitWidgetConfigByAccount,
      this.exportCalendar.bind(this),
    );
    router.get(
      '/calendars/:calendarId/export/languages',
      ExpressHelper.loggedInOnly,
      limitWidgetConfigByAccount,
      this.listLanguages.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * GET /api/v1/calendars/:calendarId/export?lang=<code>
   * The calendar's own events as one .ics attachment in `lang`. The
   * X-Pavillion-Event-Count header says how many events the file holds, so
   * an empty calendar's empty file is not mistaken for a failure.
   *
   * DEC-011 boundary: this is a logged-in owner's one-time download, and it
   * is free. A tokenized, anonymous or subscribable URL to the same output
   * would be the "ICS feed export" DEC-011 funding-gates, so this route must
   * never gain one.
   */
  async exportCalendar(req: Request, res: Response): Promise<void> {
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
      const result = await this.service.exportCalendarIcs(account, calendarId, req.query.lang);
      res.set('Content-Disposition', attachmentDisposition(result.filename));
      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.set('X-Pavillion-Event-Count', String(result.eventCount));
      res.set('Cache-Control', 'no-store');
      res.send(result.ics);
    }
    catch (error) {
      this.handleError(res, error, 'Error exporting calendar');
    }
  }

  /**
   * GET /api/v1/calendars/:calendarId/export/languages
   * The languages the calendar can be exported in: `{ languages }`.
   */
  async listLanguages(req: Request, res: Response): Promise<void> {
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
      const languages = await this.service.listCalendarExportLanguages(account, calendarId);
      res.json({ languages });
    }
    catch (error) {
      this.handleError(res, error, 'Error listing calendar export languages');
    }
  }

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
    if (error instanceof CalendarEditorPermissionError) {
      res.status(403).json({
        error: 'Permission denied',
        errorName: error.name,
      });
      return;
    }
    if (error instanceof CalendarExportError) {
      // Fixed message: the failing event and the cause are in the server log.
      res.status(500).json({
        error: 'Calendar export failed',
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
 * `attachment; filename="..."`, always quoted. A name with anything outside
 * printable ASCII, a quote or a backslash gets an underscored ASCII fallback
 * plus the exact name RFC 5987-encoded in `filename*`. The export's names
 * are safe by construction; this keeps the header safe if that changes.
 */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const header = `attachment; filename="${fallback}"`;
  if (fallback === filename) {
    return header;
  }
  const encoded = encodeURIComponent(filename)
    .replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${header}; filename*=UTF-8''${encoded}`;
}

export default CalendarExportRoutes;
