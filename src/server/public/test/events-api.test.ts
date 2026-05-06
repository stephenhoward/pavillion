import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { EventLocation, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { testApp } from '@/server/common/test/lib/express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '@/server/public/interface';
import CalendarInterface from '@/server/calendar/interface';

describe('Public Events API - Search and Filtering', () => {
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

  describe('GET /calendars/:calendar/events - Text Search', () => {
    it('should filter events by text search in title and description', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'yoga';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({ search: 'yoga' }),
      )).toBe(true);
    });

    it('should handle empty search query', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let instancesStub = apiSandbox.stub(publicInterface, 'listEventInstances');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      instancesStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = '';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(instancesStub.called).toBe(true);
    });
  });

  describe('GET /calendars/:calendar/events - Category Filtering', () => {
    it('should filter events by multiple category IDs with OR logic', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const event2 = new CalendarEvent('event-2', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);
      const instance2 = new CalendarEventInstance('inst-2', event2, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1, instance2]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.categories = ['cat-id-1', 'cat-id-2'];
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({ categories: ['cat-id-1', 'cat-id-2'] }),
      )).toBe(true);
    });
  });

  describe('GET /calendars/:calendar/events - Date Range Filtering', () => {
    it('should filter events by date range (startDate and endDate)', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.startDate = '2025-11-15';
        req.query.endDate = '2025-11-21';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({ startDate: '2025-11-15', endDate: '2025-11-21' }),
      )).toBe(true);
    });

    it('should handle invalid date format gracefully', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      calendarStub.resolves(calendar);
      filterStub.throws(new Error('Invalid date format'));

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.startDate = 'invalid-date';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid date format');
    });
  });

  describe('GET /calendars/:calendar/events - Combined Filters', () => {
    it('should combine search, categories, and date range with AND logic', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'yoga';
        req.query.categories = ['cat-id-1', 'cat-id-2'];
        req.query.startDate = '2025-11-15';
        req.query.endDate = '2025-11-21';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({
          search: 'yoga',
          categories: ['cat-id-1', 'cat-id-2'],
          startDate: '2025-11-15',
          endDate: '2025-11-21',
        }),
      )).toBe(true);
    });

    it('should return empty array when no events match filters', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      calendarStub.resolves(calendar);
      filterStub.resolves([]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'nonexistent';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('GET /calendars/:calendar/events - Error Handling', () => {
    it('should return 404 for missing calendar', async () => {
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      calendarStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'nonexistent';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('calendar not found');
    });

    it('should return 500 for service errors', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      calendarStub.resolves(calendar);
      filterStub.throws(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'test';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve events');
    });
  });
});

/**
 * Verifies the privacy-first shape contract for public event responses:
 *   - `schedules[]` must be absent (cancellation/hide_from_public cannot leak)
 *   - `recurrenceText` must be absent (legacy English-only field)
 *   - `isRecurring: boolean` must be present on every event
 *   - `recurrenceSummary: { key, params } | null` must be present
 *   - `media` must be projected to exactly `{ id, mimeType }` — no
 *     calendarId, sha256, originalFilename, fileSize, or status
 *
 * All four public event handlers (listInstances, getEvent, getEventInstance,
 * getSeries) share the same shaping via `toPublicEventObject`, so the
 * contract is pinned down for each.
 */
describe('Public API - toPublicEventObject shape contract', () => {
  let routes: CalendarRoutes;
  let router: express.Router;
  let publicInterface: PublicCalendarInterface;
  let calendarInterface: CalendarInterface;
  let apiSandbox: sinon.SinonSandbox = sinon.createSandbox();

  function makeRecurringEventWithMedia(): CalendarEvent {
    const event = new CalendarEvent('event-1', 'cal-id');
    const schedule = new CalendarEventSchedule();
    schedule.frequency = EventFrequency.WEEKLY;
    schedule.interval = 2;
    schedule.byDay = ['TU'];
    schedule.isExclusion = false;
    event.schedules = [schedule];

    // Media with the full internal shape — toPublicEventObject must strip
    // everything except id and mimeType.
    event.media = new Media(
      'media-1',
      'cal-id',
      'sha256hashvalue',
      'photo.jpg',
      'image/jpeg',
      12345,
      'approved',
    );
    return event;
  }

  function assertPublicEventShape(eventBody: Record<string, any>) {
    // schedules[] and recurrenceText must never appear
    expect(eventBody.schedules).toBeUndefined();
    expect(eventBody.recurrenceText).toBeUndefined();

    // isRecurring + recurrenceSummary are required
    expect(typeof eventBody.isRecurring).toBe('boolean');
    expect(eventBody).toHaveProperty('recurrenceSummary');
  }

  function assertMediaProjection(mediaBody: Record<string, any>) {
    expect(mediaBody.id).toBe('media-1');
    expect(mediaBody.mimeType).toBe('image/jpeg');
    // All internal fields must be absent
    expect(mediaBody.calendarId).toBeUndefined();
    expect(mediaBody.sha256).toBeUndefined();
    expect(mediaBody.originalFilename).toBeUndefined();
    expect(mediaBody.fileSize).toBeUndefined();
    expect(mediaBody.status).toBeUndefined();
  }

  /**
   * Public Space projection contract: the response must expose only
   * `content`. Internal fields (id, placeId, originUri) are AP-identity
   * hints / FKs with no Tier 1 anonymous-public use case and must never
   * appear on the public surface.
   */
  function assertSpaceProjection(spaceBody: Record<string, any>) {
    expect(spaceBody).not.toBeNull();
    expect(spaceBody.content).toBeDefined();
    expect(spaceBody.content.en).toBeDefined();
    expect(spaceBody.content.en.name).toBe('Pacific Room');
    // The public projection must contain only `content` — no other keys.
    expect(Object.keys(spaceBody)).toEqual(['content']);
    // Spell out the disallowed internal fields for clarity / future regressions.
    expect(spaceBody.id).toBeUndefined();
    expect(spaceBody.placeId).toBeUndefined();
    expect(spaceBody.originUri).toBeUndefined();
  }

  function makeSpace(): EventLocationSpace {
    const space = new EventLocationSpace('space-1', 'place-1');
    space.originUri = 'https://example.test/spaces/space-1';
    space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    return space;
  }

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    publicInterface = new PublicCalendarInterface(new EventEmitter(), calendarInterface);
    routes = new CalendarRoutes(publicInterface);
    router = express.Router();
  });

  afterEach(() => {
    apiSandbox.restore();
  });

  describe('listInstances', () => {
    it('strips schedules[], projects media, and computes recurrenceSummary', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = makeRecurringEventWithMedia();
      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'listEventInstances').resolves([instance]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const eventBody = response.body[0].event;
      assertPublicEventShape(eventBody);
      expect(eventBody.isRecurring).toBe(true);
      expect(eventBody.recurrenceSummary).toEqual({
        key: 'recurrence.every_n_weeks_on_days',
        params: { n: 2, days: ['TU'] },
      });
      assertMediaProjection(eventBody.media);
    });

    it('returns null recurrenceSummary and isRecurring=false for non-recurring events', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'listEventInstances').resolves([instance]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      const eventBody = response.body[0].event;
      assertPublicEventShape(eventBody);
      expect(eventBody.isRecurring).toBe(false);
      expect(eventBody.recurrenceSummary).toBeNull();
    });
  });

  describe('getEvent', () => {
    it('strips schedules[], projects media, and computes recurrenceSummary', async () => {
      const event = makeRecurringEventWithMedia();
      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get('/handler/event-1');

      expect(response.status).toBe(200);
      assertPublicEventShape(response.body);
      expect(response.body.isRecurring).toBe(true);
      expect(response.body.recurrenceSummary).toEqual({
        key: 'recurrence.every_n_weeks_on_days',
        params: { n: 2, days: ['TU'] },
      });
      assertMediaProjection(response.body.media);
    });

    it('forwards ?calendar=<urlName> as displayCalendarId so reposted-event categories scope to the display calendar', async () => {
      const displayCalendar = new Calendar('display-cal-id', 'mitown');
      const event = new CalendarEvent('event-1', 'source-cal-id');
      event.schedules = [];

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(displayCalendar);
      const eventStub = apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get('/handler/event-1?calendar=mitown');

      expect(response.status).toBe(200);
      expect(calendarStub.calledOnceWith('mitown')).toBe(true);
      expect(eventStub.calledOnceWith('event-1', 'display-cal-id')).toBe(true);
    });

    it('silently ignores an unknown ?calendar=<urlName> and falls back to default category scoping', async () => {
      const event = new CalendarEvent('event-1', 'source-cal-id');
      event.schedules = [];

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(null);
      const eventStub = apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get('/handler/event-1?calendar=ghost');

      expect(response.status).toBe(200);
      expect(eventStub.calledOnceWith('event-1', undefined)).toBe(true);
    });
  });

  describe('getEventInstance', () => {
    const EVENT_UUID = '11111111-1111-4111-8111-111111111111';
    const VALID_SLUG = '20260508-1800';

    it('strips schedules[], projects media, and computes recurrenceSummary', async () => {
      const event = makeRecurringEventWithMedia();
      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);
      apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails').resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      assertPublicEventShape(response.body.event);
      expect(response.body.event.isRecurring).toBe(true);
      expect(response.body.event.recurrenceSummary).toEqual({
        key: 'recurrence.every_n_weeks_on_days',
        params: { n: 2, days: ['TU'] },
      });
      assertMediaProjection(response.body.event.media);
    });

    it('returns 404 for a non-UUID eventId (path traversal attempt)', async () => {
      // Should not call the service at all.
      const stub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails');

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/not-a-uuid/${VALID_SLUG}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('instance not found');
      expect(response.body.errorName).toBe('NotFoundError');
      expect(stub.called).toBe(false);
    });

    it('returns 404 for an unparseable slug', async () => {
      const stub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails');

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/${EVENT_UUID}/not-a-slug`);

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('NotFoundError');
      expect(stub.called).toBe(false);
    });

    it('returns 404 for a legacy UUID-shaped slug (DEC-006 migration guard)', async () => {
      const stub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails');

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/${EVENT_UUID}/00000000-0000-0000-0000-000000000000`);

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('NotFoundError');
      expect(stub.called).toBe(false);
    });

    it('response body contains exactly the allow-listed fields (no internal leakage)', async () => {
      const event = makeRecurringEventWithMedia();
      const start = DateTime.utc(2026, 5, 8, 18, 0);
      const end = start.plus({ hours: 1 });
      const instance = new CalendarEventInstance('inst-1', event, start, end);
      instance.isCancelled = false;
      apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails').resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      // Top-level keys must be a subset of the allow-list. Regression guard
      // against future additions to CalendarEventInstance.toObject().
      const allowed = new Set(['id', 'start', 'end', 'isCancelled', 'event']);
      for (const key of Object.keys(response.body)) {
        expect(allowed.has(key)).toBe(true);
      }
      // calendarId must not leak at the top level.
      expect(response.body.calendarId).toBeUndefined();
      // And event is public-shaped (no schedules leak)
      expect(response.body.event.schedules).toBeUndefined();
    });

    it('passes the parsed startTime (UTC) through to the service', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      const instance = new CalendarEventInstance('inst-1', event, DateTime.utc(2026, 5, 8, 18, 0), null);
      const stub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails').resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      expect(stub.calledOnce).toBe(true);
      const [eventIdArg, startArg] = stub.firstCall.args;
      expect(eventIdArg).toBe(EVENT_UUID);
      // Slug 20260508-1800 = UTC 2026-05-08T18:00Z
      expect(startArg.toUTC().toISO()).toBe('2026-05-08T18:00:00.000Z');
    });

    it('forwards ?calendar=<urlName> as displayCalendarId for reposted-event category scoping', async () => {
      const displayCalendar = new Calendar('display-cal-id', 'mitown');
      const event = new CalendarEvent('event-1', 'source-cal-id');
      event.schedules = [];
      const instance = new CalendarEventInstance('inst-1', event, DateTime.utc(2026, 5, 8, 18, 0), null);

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(displayCalendar);
      const stub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails').resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/${EVENT_UUID}/${VALID_SLUG}?calendar=mitown`);

      expect(response.status).toBe(200);
      expect(calendarStub.calledOnceWith('mitown')).toBe(true);
      expect(stub.calledOnce).toBe(true);
      const [eventIdArg, _startArg, displayCalendarIdArg] = stub.firstCall.args;
      expect(eventIdArg).toBe(EVENT_UUID);
      expect(displayCalendarIdArg).toBe('display-cal-id');
    });
  });

  describe('getSeries', () => {
    it('applies the public shape to every event in the series events[]', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = new EventSeries('series-1', 'cal-id', 'yoga-classes');
      const content = new EventSeriesContent('en');
      content.name = 'Yoga Classes';
      series.addContent(content);

      const event = makeRecurringEventWithMedia();

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'getSeriesByUrlName').resolves(series);
      apiSandbox.stub(publicInterface, 'getSeriesEvents').resolves({ events: [event], total: 1 });

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      const eventBody = response.body.events[0];
      assertPublicEventShape(eventBody);
      expect(eventBody.isRecurring).toBe(true);
      expect(eventBody.recurrenceSummary).toEqual({
        key: 'recurrence.every_n_weeks_on_days',
        params: { n: 2, days: ['TU'] },
      });
      assertMediaProjection(eventBody.media);
    });
  });

  /**
   * Public Space projection contract (pv-ix7v.3.4):
   *   - With Space attached → response.event.space === { content: {...} }
   *     and never includes id, placeId, or originUri.
   *   - Without Space → response.event.space === null.
   *   - The pre-existing `location` shape is unchanged (additive guarantee).
   *
   * Covered for every public handler that returns event objects: getEvent,
   * listInstances, getEventInstance, and getSeries.
   */
  describe('space projection (pv-ix7v.3.4)', () => {
    it('getEvent: returns space as { content } when an event has a Space', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.space = makeSpace();

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get('/handler/event-1');

      expect(response.status).toBe(200);
      assertSpaceProjection(response.body.space);
    });

    it('getEvent: returns space === null when an event has no Space', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      // event.space defaults to null

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get('/handler/event-1');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('space');
      expect(response.body.space).toBeNull();
    });

    it('getEvent: leaves the existing `location` shape unchanged (additive guarantee)', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.location = new EventLocation(
        'loc-1',
        'Community Hall',
        '123 Main St',
        'Springfield',
        'IL',
        '62701',
        'USA',
      );
      event.space = makeSpace();

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get('/handler/event-1');

      expect(response.status).toBe(200);
      // location must retain its full existing shape — adding `space`
      // (the new field) must not strip or reproject `location`.
      expect(response.body.location).toMatchObject({
        id: 'loc-1',
        name: 'Community Hall',
        address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        country: 'USA',
      });
      // And space is independently projected.
      assertSpaceProjection(response.body.space);
    });

    it('listInstances: projects space to { content } on each instance', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.space = makeSpace();
      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'listEventInstances').resolves([instance]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      assertSpaceProjection(response.body[0].event.space);
    });

    it('listInstances: returns space === null when an event has no Space', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'listEventInstances').resolves([instance]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body[0].event).toHaveProperty('space');
      expect(response.body[0].event.space).toBeNull();
    });

    it('getEventInstance: projects space to { content } on the wrapped event', async () => {
      const EVENT_UUID = '11111111-1111-4111-8111-111111111111';
      const VALID_SLUG = '20260508-1800';
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.space = makeSpace();
      const instance = new CalendarEventInstance('inst-1', event, DateTime.utc(2026, 5, 8, 18, 0), null);

      apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails').resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      assertSpaceProjection(response.body.event.space);
    });

    it('getSeries: projects space to { content } on every event in events[]', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = new EventSeries('series-1', 'cal-id', 'yoga-classes');
      const content = new EventSeriesContent('en');
      content.name = 'Yoga Classes';
      series.addContent(content);

      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.space = makeSpace();

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'getSeriesByUrlName').resolves(series);
      apiSandbox.stub(publicInterface, 'getSeriesEvents').resolves({ events: [event], total: 1 });

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      assertSpaceProjection(response.body.events[0].space);
    });
  });
});
