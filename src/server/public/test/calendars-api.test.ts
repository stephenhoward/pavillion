import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Calendar, CalendarContent } from '@/common/model/calendar';
import { Media } from '@/common/model/media';
import { testApp } from '@/server/common/test/lib/express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '@/server/public/interface';
import CalendarInterface from '@/server/calendar/interface';

/**
 * Integration tests for GET /api/public/v1/calendars (pv-u4ew.3).
 *
 * Exercises the discovery-page list endpoint end-to-end: route registration,
 * the allow-list projection, the rate limiter wiring, anonymous-cookie
 * hygiene, and the error path.
 *
 * The integration also covers the cross-bead requirement from pv-u4ew.1's
 * privacy-audit cross-bead note: GET /api/public/v1/calendar/:urlName must
 * NOT expose the `listed` flag now that `Calendar.toObject()` includes it.
 */
describe('Public Calendars Discovery API (pv-u4ew.3)', () => {
  let routes: CalendarRoutes;
  let publicInterface: PublicCalendarInterface;
  let calendarInterface: CalendarInterface;
  let apiSandbox: sinon.SinonSandbox;

  beforeEach(() => {
    apiSandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
    publicInterface = new PublicCalendarInterface(new EventEmitter(), calendarInterface);
    routes = new CalendarRoutes(publicInterface);
  });

  afterEach(() => {
    apiSandbox.restore();
  });

  /**
   * Mounts the full route surface via installHandlers so the route, rate
   * limiter middleware, and handler binding are exercised together — not just
   * the handler in isolation.
   */
  function buildApp(): express.Application {
    const app = express();
    app.use(express.json());
    routes.installHandlers(app, '/api/public/v1');
    return app;
  }

  /**
   * Builds a Calendar model populated with internal fields the allow-list
   * projection must drop. Each field is set with a sentinel value so the
   * negative-field assertions can verify the projection is intentional, not
   * accidentally missing because the source field happened to be falsy.
   */
  function buildLeakyCalendar(id: string, urlName: string): Calendar {
    const calendar = new Calendar(id, urlName);
    calendar.publicUrl = 'https://example.com/should-not-leak';
    calendar.languages = ['en', 'es'];
    calendar.description = 'internal description should not appear in list payload';
    calendar.defaultDateRange = '1month';
    calendar.widgetAllowedDomain = 'widget.example.com';
    calendar.defaultEventImageId = 'media-id-should-not-leak';
    calendar.defaultEventImage = new Media(
      'media-id-should-not-leak',
      id,
      'sha256-should-not-leak',
      'photo.jpg',
      'image/jpeg',
      12345,
      'approved',
    );
    calendar.listed = true;
    calendar.addContent(new CalendarContent('en', 'English Name', 'English description'));
    calendar.addContent(new CalendarContent('es', 'Nombre Español', 'Descripción en español'));
    return calendar;
  }

  describe('GET /api/public/v1/calendars - positive response shape', () => {
    it('returns a bare array of allow-listed calendar rows', async () => {
      const cal1 = buildLeakyCalendar('cal-1', 'alpha');
      const cal2 = buildLeakyCalendar('cal-2', 'beta');

      const listStub = apiSandbox.stub(publicInterface, 'listPublicCalendars');
      listStub.resolves([
        { calendar: cal1, lastEventActivity: new Date('2026-05-01T12:00:00Z') },
        { calendar: cal2, lastEventActivity: null },
      ]);

      const response = await request(buildApp()).get('/api/public/v1/calendars');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });

    it('exposes id, urlName, content[], and lastEventActivity per row', async () => {
      const cal = buildLeakyCalendar('cal-1', 'alpha');
      const listStub = apiSandbox.stub(publicInterface, 'listPublicCalendars');
      listStub.resolves([
        { calendar: cal, lastEventActivity: new Date('2026-05-01T12:00:00Z') },
      ]);

      const response = await request(buildApp()).get('/api/public/v1/calendars');

      expect(response.status).toBe(200);
      const row = response.body[0];
      expect(row.id).toBe('cal-1');
      expect(row.urlName).toBe('alpha');
      expect(Array.isArray(row.content)).toBe(true);
      // Content rows project to { language, name, description } only.
      const en = row.content.find((c: any) => c.language === 'en');
      const es = row.content.find((c: any) => c.language === 'es');
      expect(en).toEqual({ language: 'en', name: 'English Name', description: 'English description' });
      expect(es).toEqual({ language: 'es', name: 'Nombre Español', description: 'Descripción en español' });
      // lastEventActivity is serialized to ISO 8601 UTC.
      expect(row.lastEventActivity).toBe('2026-05-01T12:00:00.000Z');
    });

    it('serializes lastEventActivity=null when the calendar has no public activity', async () => {
      const cal = buildLeakyCalendar('cal-1', 'alpha');
      const listStub = apiSandbox.stub(publicInterface, 'listPublicCalendars');
      listStub.resolves([
        { calendar: cal, lastEventActivity: null },
      ]);

      const response = await request(buildApp()).get('/api/public/v1/calendars');

      expect(response.status).toBe(200);
      expect(response.body[0].lastEventActivity).toBeNull();
    });

    it('returns an empty array when there are no listed calendars', async () => {
      const listStub = apiSandbox.stub(publicInterface, 'listPublicCalendars');
      listStub.resolves([]);

      const response = await request(buildApp()).get('/api/public/v1/calendars');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  /**
   * Public discovery row projection contract: each row must allow-list only
   * `{ content, id, lastEventActivity, urlName }`. Internal/operator fields
   * (`widgetAllowedDomain`, `defaultEventImageId`, `defaultEventImage`,
   * `publicUrl`, `languages`, `defaultDateRange`, `listed`, top-level
   * `description`) and any account FKs (`accountId`, `ownerId`) must never
   * appear — they are either internal config or have no Tier-1 anonymous
   * public use case for the discovery surface.
   *
   * Mirrors the pv-3vso allow-list assertion pattern from `events-api.test.ts`
   * (assertSeriesProjection / assertCategoryProjection): bidirectional
   * `Object.keys().sort().toEqual()` plus explicit per-field absence asserts
   * for clarity / future-regression readability.
   */
  function assertDiscoveryListingProjection(row: Record<string, any>) {
    expect(row).not.toBeNull();
    // Bidirectional allow-list check — catches both an extra key (leak) and
    // a missing required key (dropped public field).
    expect(Object.keys(row).sort()).toEqual(
      ['content', 'id', 'lastEventActivity', 'urlName'],
    );
    // Spell out the disallowed fields for clarity / future regressions.
    expect(row.widgetAllowedDomain).toBeUndefined();
    expect(row.defaultEventImageId).toBeUndefined();
    expect(row.defaultEventImage).toBeUndefined();
    expect(row.publicUrl).toBeUndefined();
    expect(row.languages).toBeUndefined();
    expect(row.defaultDateRange).toBeUndefined();
    expect(row.listed).toBeUndefined();
    expect(row.description).toBeUndefined();
    expect(row.account).toBeUndefined();
    expect(row.accountId).toBeUndefined();
    expect(row.owner).toBeUndefined();
    expect(row.ownerId).toBeUndefined();
    expect(row.createdAt).toBeUndefined();
    expect(row.updatedAt).toBeUndefined();
  }

  describe('GET /api/public/v1/calendars - allow-list projection', () => {
    it('row contains only allow-listed keys and no internal/operator fields', async () => {
      const cal = buildLeakyCalendar('cal-1', 'alpha');
      const listStub = apiSandbox.stub(publicInterface, 'listPublicCalendars');
      listStub.resolves([
        { calendar: cal, lastEventActivity: new Date('2026-05-01T12:00:00Z') },
      ]);

      const response = await request(buildApp()).get('/api/public/v1/calendars');

      assertDiscoveryListingProjection(response.body[0]);
    });
  });

  describe('GET /api/public/v1/calendars - cookie hygiene (anonymous visitor)', () => {
    it('does not set any Set-Cookie header for an anonymous visitor', async () => {
      const listStub = apiSandbox.stub(publicInterface, 'listPublicCalendars');
      listStub.resolves([]);

      const response = await request(buildApp()).get('/api/public/v1/calendars');

      // express-rate-limit and the handler should never call res.cookie for
      // this endpoint; assert there is no Set-Cookie header at all.
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('GET /api/public/v1/calendars - rate limiter wired', () => {
    it('registers a middleware ahead of the handler on the /calendars route', () => {
      // In the test environment `rateLimit.enabled = false` swaps the
      // limitPublicCalendarListByIp limiter for a no-op middleware (see
      // config/test.yaml), so we cannot assert on RateLimit-* response
      // headers. Instead, assert the route has TWO handlers: the rate
      // limiter (or its no-op stand-in) wired ahead of the bound
      // listPublicCalendars handler. A regression that drops the middleware
      // would leave a single-handler stack on this route.
      const app = buildApp();
      const router = (app._router || (app as any)._router) as any;
      // Walk the mounted /api/public/v1 sub-router for the /calendars GET route.
      let stack: any[] | null = null;
      for (const layer of router.stack || []) {
        if (layer.name === 'router' && layer.handle && layer.handle.stack) {
          for (const inner of layer.handle.stack) {
            if (
              inner.route
              && inner.route.path === '/calendars'
              && inner.route.methods?.get
            ) {
              stack = inner.route.stack;
            }
          }
        }
      }
      expect(stack).not.toBeNull();
      // Two handlers: rate limiter middleware + the listPublicCalendars handler.
      expect(stack!.length).toBe(2);
    });
  });

  describe('GET /api/public/v1/calendars - error path', () => {
    it('returns 500 with a generic error body when the service throws', async () => {
      const listStub = apiSandbox.stub(publicInterface, 'listPublicCalendars');
      listStub.rejects(new Error('database boom'));

      const response = await request(buildApp()).get('/api/public/v1/calendars');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve calendars');
      // Error path MUST NOT leak the underlying error message to anonymous
      // callers — generic message only.
      expect(JSON.stringify(response.body)).not.toContain('database boom');
    });
  });
});

/**
 * Single-calendar projection contract: GET /api/public/v1/calendar/:urlName
 * must allow-list only the public-tier fields. Internal config
 * (`widgetAllowedDomain`), internal FKs (`defaultEventImageId`), and the
 * owner-discovery flag (`listed`) must never appear. Mirrors the pv-3vso
 * projection-helper assertion pattern in events-api.test.ts.
 */
describe('Public Calendar API - GET /calendar/:urlName projection', () => {
  let routes: CalendarRoutes;
  let router: express.Router;
  let publicInterface: PublicCalendarInterface;
  let calendarInterface: CalendarInterface;
  let apiSandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    publicInterface = new PublicCalendarInterface(new EventEmitter(), calendarInterface);
    routes = new CalendarRoutes(publicInterface);
    router = express.Router();
  });

  afterEach(() => {
    apiSandbox.restore();
  });

  /**
   * Public single-calendar projection contract: response allow-lists only
   * `{ content, defaultDateRange, defaultEventImage, description, id,
   *    languages, publicUrl, urlName }`. Internal/operator fields must
   * never appear.
   */
  function assertCalendarRootProjection(body: Record<string, any>) {
    expect(body).not.toBeNull();
    expect(Object.keys(body).sort()).toEqual(
      [
        'content',
        'defaultDateRange',
        'defaultEventImage',
        'description',
        'id',
        'languages',
        'publicUrl',
        'urlName',
      ],
    );
    // Spell out the disallowed fields for clarity / future regressions.
    expect(body.listed).toBeUndefined();
    expect(body.widgetAllowedDomain).toBeUndefined();
    expect(body.defaultEventImageId).toBeUndefined();
  }

  function buildCalendarWithLeakyInternals(listed: boolean): Calendar {
    const calendar = new Calendar('cal-id', 'test-calendar');
    calendar.publicUrl = 'https://pavillion.dev/view/test-calendar';
    calendar.languages = ['en'];
    calendar.description = '';
    calendar.defaultDateRange = '1month';
    calendar.widgetAllowedDomain = 'widget.example.com';
    calendar.defaultEventImageId = 'media-id-should-not-leak';
    calendar.listed = listed;
    return calendar;
  }

  it('returns the allow-listed projection for a listed calendar', async () => {
    const calendar = buildCalendarWithLeakyInternals(true);
    const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
    calendarStub.resolves(calendar);

    router.get('/handler', (req, res) => {
      req.params.urlName = 'test-calendar';
      routes.getCalendar(req, res);
    });

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    assertCalendarRootProjection(response.body);
  });

  it('returns the same allow-listed projection for an unlisted calendar reachable by direct URL', async () => {
    // An unlisted calendar reachable by direct URL must not advertise its
    // hidden-from-discovery status to anonymous visitors.
    const calendar = buildCalendarWithLeakyInternals(false);
    const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
    calendarStub.resolves(calendar);

    router.get('/handler', (req, res) => {
      req.params.urlName = 'test-calendar';
      routes.getCalendar(req, res);
    });

    const response = await request(testApp(router)).get('/handler');

    expect(response.status).toBe(200);
    assertCalendarRootProjection(response.body);
  });
});
