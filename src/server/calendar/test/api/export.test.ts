// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import config from 'config';

// Under test config every limiter is the same no-op, so the export limiter is
// swapped for a reference of its own to tell it apart in the route stack.
const { exportLimiter } = vi.hoisted(() => ({
  exportLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('@/server/common/middleware/rate-limiters', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/common/middleware/rate-limiters')>(),
  limitCalendarExportByAccount: exportLimiter,
}));

import { Account } from '@/common/model/account';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarExportError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { testApp } from '@/server/common/test/lib/express';
import CalendarExportRoutes, { attachmentDisposition } from '@/server/calendar/api/v1/export';
import CalendarInterface from '@/server/calendar/interface';

/**
 * Handler tests for CalendarExportRoutes with a stubbed interface: status
 * codes, bodies and headers. Ownership, the language set and the file itself
 * are covered against a real database in integration/calendar_export.test.ts.
 */
describe('CalendarExportRoutes', () => {
  const CALENDAR_ID = '550e8400-e29b-41d4-a716-446655440000';
  const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

  let routes: CalendarExportRoutes;
  let router: express.Router;
  let exportCalendarIcs: sinon.SinonStub;
  let listCalendarExportLanguages: sinon.SinonStub;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    exportCalendarIcs = sandbox.stub();
    listCalendarExportLanguages = sandbox.stub();
    routes = new CalendarExportRoutes({ exportCalendarIcs, listCalendarExportLanguages } as unknown as CalendarInterface);
    router = express.Router();
    router.get('/calendars/:calendarId/export', (req, res) => {
      req.user = new Account('account-id', 'owner', 'owner@example.com');
      routes.exportCalendar(req, res);
    });
    router.get('/calendars/:calendarId/export/languages', (req, res) => {
      req.user = new Account('account-id', 'owner', 'owner@example.com');
      routes.listLanguages(req, res);
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /calendars/:calendarId/export', () => {
    it('sends the file as a calendar attachment with its event count', async () => {
      exportCalendarIcs.resolves({ ics: ICS, eventCount: 3, filename: 'townhall-es.ics' });

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=es`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
      expect(response.headers['content-disposition']).toBe('attachment; filename="townhall-es.ics"');
      expect(response.headers['x-pavillion-event-count']).toBe('3');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).toBe(ICS);
      expect(exportCalendarIcs.calledOnce).toBe(true);
      expect(exportCalendarIcs.firstCall.args[0].id).toBe('account-id');
      expect(exportCalendarIcs.firstCall.args.slice(1)).toEqual([CALENDAR_ID, 'es']);
    });

    it('sends an empty calendar\'s file with a count of 0', async () => {
      exportCalendarIcs.resolves({ ics: ICS, eventCount: 0, filename: 'townhall-en.ics' });

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=en`);

      expect(response.status).toBe(200);
      expect(response.headers['x-pavillion-event-count']).toBe('0');
      expect(response.text).toBe(ICS);
    });

    it('passes a repeated lang through unparsed, for the service to refuse', async () => {
      exportCalendarIcs.rejects(new ValidationError('lang must be one of the calendar\'s export languages'));

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=en&lang=es`);

      expect(exportCalendarIcs.firstCall.args[2]).toEqual(['en', 'es']);
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('answers 400 for a calendar id that is not a UUID, without calling the service', async () => {
      const response = await request(testApp(router)).get('/calendars/not-a-uuid/export?lang=en');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'invalid calendarId format', errorName: 'ValidationError' });
      expect(exportCalendarIcs.called).toBe(false);
    });

    it('answers 400 with the validation fields for a language outside the set', async () => {
      exportCalendarIcs.rejects(new ValidationError(
        'lang must be one of the calendar\'s export languages',
        { lang: ['must be one of the calendar\'s export languages'] },
      ));

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=xx`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'lang must be one of the calendar\'s export languages',
        errorName: 'ValidationError',
        fields: { lang: ['must be one of the calendar\'s export languages'] },
      });
    });

    it('answers 404 for an unknown calendar', async () => {
      exportCalendarIcs.rejects(new CalendarNotFoundError());

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=en`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
    });

    it('answers 403 for an account that does not own the calendar', async () => {
      exportCalendarIcs.rejects(new CalendarEditorPermissionError('Permission denied'));

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=en`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Permission denied', errorName: 'CalendarEditorPermissionError' });
    });

    it('answers 500 with a fixed message and no file when an event cannot be serialized', async () => {
      exportCalendarIcs.rejects(new CalendarExportError('event 1234 has a bad zone'));

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=en`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Calendar export failed', errorName: 'CalendarExportError' });
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(response.headers['x-pavillion-event-count']).toBeUndefined();
    });

    it('answers 500 with a generic body for an unexpected error', async () => {
      exportCalendarIcs.rejects(new Error('database is down'));

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export?lang=en`);

      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('database');
    });
  });

  describe('rate limiter wiring', () => {
    function routeHandlers(path: string): unknown[] {
      const app = express();
      routes.installHandlers(app, '/api/v1');

      const layers = (app as any).router.stack
        .filter((layer: any) => layer.name === 'router')
        .flatMap((layer: any) => layer.handle.stack)
        .filter((layer: any) => layer.route?.path === path && layer.route.methods.get);

      expect(layers).toHaveLength(1);
      return layers[0].route.stack.map((layer: any) => layer.handle);
    }

    it.each([
      '/calendars/:calendarId/export',
      '/calendars/:calendarId/export/languages',
    ])('puts the dedicated export limiter on GET %s', (path) => {
      expect(routeHandlers(path)).toContain(exportLimiter);
    });

    it('allows 10 export requests per account per 15 minutes by default', () => {
      expect(config.get<number>('rateLimit.calendarExport.byAccount.max')).toBe(10);
      expect(config.get<number>('rateLimit.calendarExport.byAccount.windowMs')).toBe(15 * 60 * 1000);
    });
  });

  describe('attachmentDisposition', () => {
    it('quotes a safe name as it is', () => {
      expect(attachmentDisposition('town-hall_2-en.ics')).toBe('attachment; filename="town-hall_2-en.ics"');
    });

    it('gives a name outside the safe set an ASCII fallback and an RFC 5987 filename*', () => {
      expect(attachmentDisposition('café "x".ics')).toBe(
        'attachment; filename="caf_ _x_.ics"; filename*=UTF-8\'\'caf%C3%A9%20%22x%22.ics',
      );
    });

    it('never lets a line break or quote out of the quoted string', () => {
      const header = attachmentDisposition('a\r\nSet-Cookie: x=1".ics');

      expect(header).not.toMatch(/[\r\n]/);
      expect(header.startsWith('attachment; filename="a__Set-Cookie: x=1_.ics";')).toBe(true);
    });
  });

  describe('GET /calendars/:calendarId/export/languages', () => {
    it('returns the export languages in the service\'s order', async () => {
      listCalendarExportLanguages.resolves(['fr', 'en', 'es']);

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export/languages`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ languages: ['fr', 'en', 'es'] });
      expect(listCalendarExportLanguages.firstCall.args[1]).toBe(CALENDAR_ID);
    });

    it('answers 400 for a calendar id that is not a UUID, without calling the service', async () => {
      const response = await request(testApp(router)).get('/calendars/not-a-uuid/export/languages');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'invalid calendarId format', errorName: 'ValidationError' });
      expect(listCalendarExportLanguages.called).toBe(false);
    });

    it('answers 404 for an unknown calendar', async () => {
      listCalendarExportLanguages.rejects(new CalendarNotFoundError());

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export/languages`);

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('answers 403 for an account that does not own the calendar', async () => {
      listCalendarExportLanguages.rejects(new CalendarEditorPermissionError('Permission denied'));

      const response = await request(testApp(router)).get(`/calendars/${CALENDAR_ID}/export/languages`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Permission denied', errorName: 'CalendarEditorPermissionError' });
    });
  });
});
