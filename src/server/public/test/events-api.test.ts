import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { EventLocation, EventLocationContent, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
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

  /**
   * Public Location projection contract: the response must expose only
   * address-display fields and translatable content. Internal fields
   * (id, originUri, spaces[]) are AP-identity hints / nested leak vectors
   * with no Tier 1 anonymous-public use case and must never appear on the
   * public surface.
   */
  function assertLocationProjection(locationBody: Record<string, any>) {
    expect(locationBody).not.toBeNull();
    // Allow-listed fields are present
    expect(locationBody.name).toBe('Community Hall');
    expect(locationBody.address).toBe('123 Main St');
    expect(locationBody.city).toBe('Springfield');
    expect(locationBody.state).toBe('IL');
    expect(locationBody.postalCode).toBe('62701');
    expect(locationBody.country).toBe('USA');
    expect(locationBody.content).toBeDefined();
    expect(locationBody.content.en).toBeDefined();
    expect(locationBody.content.en.accessibilityInfo).toBe('Wheelchair accessible; gender-neutral restrooms.');
    // The public projection must contain only the allow-listed keys.
    expect(Object.keys(locationBody).sort()).toEqual(
      ['address', 'city', 'content', 'country', 'name', 'postalCode', 'state'],
    );
    // Spell out the disallowed internal fields for clarity / future regressions.
    expect(locationBody.id).toBeUndefined();
    expect(locationBody.originUri).toBeUndefined();
    expect(locationBody.spaces).toBeUndefined();
  }

  function makeLocation(): EventLocation {
    const location = new EventLocation(
      'loc-1',
      'Community Hall',
      '123 Main St',
      'Springfield',
      'IL',
      '62701',
      'USA',
    );
    location.originUri = 'https://example.test/locations/loc-1';
    location.addContent(
      new EventLocationContent('en', 'Wheelchair accessible; gender-neutral restrooms.'),
    );
    // Nested space carries its own originUri + clientId — both must be
    // eliminated by the projection (we drop spaces[] entirely).
    const nestedSpace = new EventLocationSpace('space-nested', 'loc-1');
    nestedSpace.originUri = 'https://example.test/spaces/space-nested';
    nestedSpace.clientId = 'draft-1';
    nestedSpace.addContent(new EventLocationSpaceContent('en', 'Side Room', 'Hearing loop'));
    location.spaces = [nestedSpace];
    return location;
  }

  /**
   * Public Series projection contract: the response must allow-list only
   * `{ id, urlName, mediaFocalPointX, mediaFocalPointY, mediaZoom, content }`.
   * Internal FKs (`calendarId`, `mediaId`) must never appear on the public
   * surface — they identify internal database rows and have no Tier 1
   * anonymous-public use case.
   */
  function assertSeriesProjection(seriesBody: Record<string, any>) {
    expect(seriesBody).not.toBeNull();
    // Allow-listed fields are present
    expect(seriesBody.id).toBe('series-1');
    expect(seriesBody.urlName).toBe('yoga-classes');
    expect(seriesBody.mediaFocalPointX).toBeDefined();
    expect(seriesBody.mediaFocalPointY).toBeDefined();
    expect(seriesBody.mediaZoom).toBeDefined();
    expect(seriesBody.content).toBeDefined();
    expect(seriesBody.content.en).toBeDefined();
    expect(seriesBody.content.en.name).toBe('Yoga Classes');
    // The public projection must contain only the allow-listed keys.
    expect(Object.keys(seriesBody).sort()).toEqual(
      ['content', 'id', 'mediaFocalPointX', 'mediaFocalPointY', 'mediaZoom', 'urlName'],
    );
    // Spell out the disallowed internal FKs for clarity / future regressions.
    expect(seriesBody.calendarId).toBeUndefined();
    expect(seriesBody.mediaId).toBeUndefined();
  }

  function makeSeries(): EventSeries {
    const series = new EventSeries('series-1', 'cal-id', 'yoga-classes', 'media-99');
    series.mediaFocalPointX = 0.4;
    series.mediaFocalPointY = 0.6;
    series.mediaZoom = 1.2;
    series.addContent(new EventSeriesContent('en', 'Yoga Classes', 'Weekly yoga.'));
    return series;
  }

  /**
   * Public Category projection contract: the response must allow-list only
   * `{ id, eventCount, content }`. The internal FK `calendarId` must never
   * appear on the public surface — DEC-005 establishes that category.id is
   * the public identifier within a calendar context (the calendar is already
   * established by the API route).
   */
  function assertCategoryProjection(categoryBody: Record<string, any>) {
    expect(categoryBody).not.toBeNull();
    // Allow-listed fields are present
    expect(categoryBody.id).toBe('cat-1');
    expect(typeof categoryBody.eventCount).toBe('number');
    expect(categoryBody.content).toBeDefined();
    expect(categoryBody.content.en).toBeDefined();
    expect(categoryBody.content.en.name).toBe('Music');
    // The public projection must contain only the allow-listed keys.
    expect(Object.keys(categoryBody).sort()).toEqual(['content', 'eventCount', 'id']);
    // Spell out the disallowed internal FK for clarity / future regressions.
    expect(categoryBody.calendarId).toBeUndefined();
  }

  function makeCategory(): EventCategory {
    const category = new EventCategory('cat-1', 'cal-id');
    category.eventCount = 0;
    category.addContent(new EventCategoryContent('en', 'Music'));
    return category;
  }

  /**
   * Public Event root projection contract: response must allow-list only the
   * documented public fields. Internal FKs (`calendarId`, `locationId`,
   * `spaceId`, `mediaId`) and internal-only fields (`schedules`,
   * `recurrenceText`) must never appear on the public surface.
   *
   * Nested objects (location, space, media, series, categories) are checked
   * independently by their own `assert*Projection` helpers.
   */
  function assertEventRootProjection(eventBody: Record<string, any>) {
    expect(eventBody).not.toBeNull();

    // Positive allow-list assertion. Optional fields (media/space/location/series/
    // categories) may be present or absent depending on the fixture, but the
    // set of keys must never contain anything outside this allow-list.
    const allowed = new Set([
      'id',
      'date',
      'repostStatus',
      'isRepost',
      'sourceCalendar',
      'mediaFocalPointX',
      'mediaFocalPointY',
      'mediaZoom',
      'eventSourceUrl',
      'externalUrl',
      'urlPrompt',
      'isRecurring',
      'recurrenceSummary',
      'content',
      'location',
      'space',
      'media',
      'series',
      'categories',
    ]);
    for (const key of Object.keys(eventBody)) {
      expect(allowed.has(key)).toBe(true);
    }

    // Disallowed internal fields must be absent.
    expect(eventBody.calendarId).toBeUndefined();
    expect(eventBody.locationId).toBeUndefined();
    expect(eventBody.spaceId).toBeUndefined();
    expect(eventBody.mediaId).toBeUndefined();
    expect(eventBody.schedules).toBeUndefined();
    expect(eventBody.recurrenceText).toBeUndefined();
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
    const EVENT_UUID = '11111111-1111-4111-8111-111111111111';

    it('strips schedules[], projects media, and computes recurrenceSummary', async () => {
      const event = makeRecurringEventWithMedia();
      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}`);

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
      const event = new CalendarEvent(EVENT_UUID, 'source-cal-id');
      event.schedules = [];

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(displayCalendar);
      const eventStub = apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}?calendar=mitown`);

      expect(response.status).toBe(200);
      expect(calendarStub.calledOnceWith('mitown')).toBe(true);
      expect(eventStub.calledOnceWith(EVENT_UUID, 'display-cal-id')).toBe(true);
    });

    it('silently ignores an unknown ?calendar=<urlName> and falls back to default category scoping', async () => {
      const event = new CalendarEvent(EVENT_UUID, 'source-cal-id');
      event.schedules = [];

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(null);
      const eventStub = apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}?calendar=ghost`);

      expect(response.status).toBe(200);
      expect(eventStub.calledOnceWith(EVENT_UUID, undefined)).toBe(true);
    });

    // Regression: a request for an unknown event id used to crash
    // the backend because the handler did not catch EventNotFoundError thrown
    // by the service. The handler now translates that throw into a clean 404.
    it('returns 404 with EventNotFoundError when the service throws for an unknown id', async () => {
      apiSandbox.stub(publicInterface, 'getEventById').rejects(
        new EventNotFoundError(EVENT_UUID),
      );

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}`);

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('EventNotFoundError');
    });

    // Defense-in-depth UUID validation matching the getEventInstance handler:
    // a malformed/path-traversal id must be rejected before the service is
    // called. 404 (not 400) so format recognition cannot be probed.
    it('returns 404 for a non-UUID id without calling the service', async () => {
      const eventStub = apiSandbox.stub(publicInterface, 'getEventById').resolves(
        new CalendarEvent('unused', 'unused'),
      );

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get('/handler/not-a-uuid');

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('EventNotFoundError');
      expect(eventStub.called).toBe(false);
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
   * Public Space projection contract:
   *   - With Space attached → response.event.space === { content: {...} }
   *     and never includes id, placeId, or originUri.
   *   - Without Space → response.event.space === null.
   *   - Location is independently projected (see `describe('location projection')` below).
   *
   * Covered for every public handler that returns event objects: getEvent,
   * listInstances, getEventInstance, and getSeries.
   */
  describe('space projection', () => {
    const SPACE_PROJ_EVENT_UUID = '22222222-2222-4222-8222-222222222222';

    it('getEvent: returns space as { content } when an event has a Space', async () => {
      const event = new CalendarEvent(SPACE_PROJ_EVENT_UUID, 'cal-id');
      event.schedules = [];
      event.space = makeSpace();

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${SPACE_PROJ_EVENT_UUID}`);

      expect(response.status).toBe(200);
      assertSpaceProjection(response.body.space);
    });

    it('getEvent: returns space === null when an event has no Space', async () => {
      const event = new CalendarEvent(SPACE_PROJ_EVENT_UUID, 'cal-id');
      event.schedules = [];
      // event.space defaults to null

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${SPACE_PROJ_EVENT_UUID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('space');
      expect(response.body.space).toBeNull();
    });

    it('getEvent: strips originUri, drops spaces[], and drops id from location while still projecting space', async () => {
      const event = new CalendarEvent(SPACE_PROJ_EVENT_UUID, 'cal-id');
      event.schedules = [];
      event.location = makeLocation();
      event.space = makeSpace();

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${SPACE_PROJ_EVENT_UUID}`);

      expect(response.status).toBe(200);
      // location must be projected to address-display fields + content only.
      // originUri, spaces[], and id must all be absent.
      assertLocationProjection(response.body.location);
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

  /**
   * Public Location projection contract:
   *   - With a Location attached → response.event.location is projected to
   *     address-display fields plus `content`. `originUri`, `spaces[]`, and
   *     `id` must never appear on the public surface (originUri is an
   *     AP-dedup identity hint, spaces[] is unused on the public surface,
   *     and id parallels the space projection's id-stripping rationale).
   *   - Without a Location → response.event.location is null or absent
   *     (eventObj does not synthesize a value; the input pass-through
   *     leaves it null/undefined).
   *
   * Covered for every public handler that returns event objects: getEvent,
   * listInstances, getEventInstance, and getSeries.
   */
  describe('location projection', () => {
    const LOC_PROJ_EVENT_UUID = '33333333-3333-4333-8333-333333333333';

    it('getEvent: projects location to address-display fields + content; strips originUri, spaces, and id', async () => {
      const event = new CalendarEvent(LOC_PROJ_EVENT_UUID, 'cal-id');
      event.schedules = [];
      event.location = makeLocation();

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${LOC_PROJ_EVENT_UUID}`);

      expect(response.status).toBe(200);
      assertLocationProjection(response.body.location);
    });

    it('getEvent: returns location === null when an event has no Location', async () => {
      const event = new CalendarEvent(LOC_PROJ_EVENT_UUID, 'cal-id');
      event.schedules = [];
      // event.location defaults to null

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${LOC_PROJ_EVENT_UUID}`);

      expect(response.status).toBe(200);
      expect(response.body.location).toBeNull();
    });

    it('listInstances: projects location on each instance; strips originUri, spaces, and id', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.location = makeLocation();
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
      assertLocationProjection(response.body[0].event.location);
    });

    it('listInstances: returns location === null when an event has no Location', async () => {
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
      expect(response.body[0].event.location).toBeNull();
    });

    it('getEventInstance: projects location on the wrapped event; strips originUri, spaces, and id', async () => {
      const EVENT_UUID = '11111111-1111-4111-8111-111111111111';
      const VALID_SLUG = '20260508-1800';
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.location = makeLocation();
      const instance = new CalendarEventInstance('inst-1', event, DateTime.utc(2026, 5, 8, 18, 0), null);

      apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails').resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      assertLocationProjection(response.body.event.location);
    });

    it('getSeries: projects location on every event in events[]', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = new EventSeries('series-1', 'cal-id', 'yoga-classes');
      const content = new EventSeriesContent('en');
      content.name = 'Yoga Classes';
      series.addContent(content);

      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      event.location = makeLocation();

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
      assertLocationProjection(response.body.events[0].location);
    });
  });

  /**
   * Public Event root projection contract:
   *   - Top-level keys must be the documented allow-list only.
   *   - Internal FKs (calendarId, locationId, spaceId, mediaId) and internal
   *     fields (schedules, recurrenceText) must never appear.
   *
   * Covered for every public handler that returns event objects: getEvent,
   * listInstances (via wrapping instance), getEventInstance (via wrapping
   * instance), and getSeries (via events[]).
   */
  describe('event root projection', () => {
    const EVENT_PROJ_UUID = '44444444-4444-4444-8444-444444444444';
    const VALID_SLUG = '20260508-1800';

    function makeEventWithFkLeakSurface(): CalendarEvent {
      // Construct an event with every field set so any spread-then-leak path
      // surfaces in the response. Schedules, location, space, media, series,
      // categories all populated.
      const event = new CalendarEvent(EVENT_PROJ_UUID, 'cal-id');
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.byDay = ['MO'];
      schedule.isExclusion = false;
      event.schedules = [schedule];
      event.locationId = 'loc-row-1';
      event.location = makeLocation();
      event.space = makeSpace();
      event.media = new Media('media-1', 'cal-id', 'sha', 'photo.jpg', 'image/jpeg', 100, 'approved');
      event.mediaId = 'media-1';
      event.series = makeSeries();
      event.categories = [makeCategory()];
      return event;
    }

    it('getEvent: returns only allow-listed event-root keys; FKs and schedules absent', async () => {
      const event = makeEventWithFkLeakSurface();
      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_PROJ_UUID}`);

      expect(response.status).toBe(200);
      assertEventRootProjection(response.body);
    });

    it('listInstances: returns only allow-listed event-root keys on each instance event', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = makeEventWithFkLeakSurface();
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
      assertEventRootProjection(response.body[0].event);
      // Also: instance-row calendarId must not leak.
      expect(response.body[0].calendarId).toBeUndefined();
    });

    it('getEventInstance: returns only allow-listed event-root keys on the wrapped event', async () => {
      const event = makeEventWithFkLeakSurface();
      const instance = new CalendarEventInstance('inst-1', event, DateTime.utc(2026, 5, 8, 18, 0), null);
      apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails').resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${EVENT_PROJ_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      assertEventRootProjection(response.body.event);
    });

    it('getSeries: returns only allow-listed event-root keys on each event in events[]', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries();

      const event = makeEventWithFkLeakSurface();

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
      assertEventRootProjection(response.body.events[0]);
    });
  });

  /**
   * Public Series projection contract:
   *   - Series allow-list applies wherever a series is rendered: top-level
   *     of getSeries, each row of listSeries, and the nested
   *     event.series object inside getEvent / listInstances / getEventInstance
   *     / getSeries.events[].
   *   - `calendarId` and `mediaId` are internal FKs and must never appear.
   */
  describe('series projection', () => {
    const SERIES_PROJ_EVENT_UUID = '55555555-5555-4555-8555-555555555555';

    it('getSeries: returns the top-level series allow-list; calendarId and mediaId absent', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries();

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'getSeriesByUrlName').resolves(series);
      apiSandbox.stub(publicInterface, 'getSeriesEvents').resolves({ events: [], total: 0 });

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      // The response wraps the series projection with `events` and `pagination`.
      // Extract just the series-shaped keys for the projection assertion.
      const { events, pagination, ...seriesBody } = response.body;
      expect(events).toEqual([]);
      expect(pagination).toBeDefined();
      assertSeriesProjection(seriesBody);
    });

    it('listSeries: returns the series allow-list on each row, augmented with eventCount; calendarId and mediaId absent', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries();

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'listSeriesForCalendar').resolves([{ series, eventCount: 7 }]);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        routes.listSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const row = response.body[0];
      // Row carries an `eventCount` on top of the series allow-list.
      expect(row.eventCount).toBe(7);
      const { eventCount: _eventCount, ...seriesBody } = row;
      assertSeriesProjection(seriesBody);
    });

    it('getEvent: returns the series allow-list on event.series; calendarId and mediaId absent', async () => {
      const event = new CalendarEvent(SERIES_PROJ_EVENT_UUID, 'cal-id');
      event.schedules = [];
      event.series = makeSeries();

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${SERIES_PROJ_EVENT_UUID}`);

      expect(response.status).toBe(200);
      assertSeriesProjection(response.body.series);
    });
  });

  /**
   * Public Category projection contract:
   *   - Category allow-list applies wherever a category is rendered: each
   *     row of listCategories, and each entry in event.categories[] inside
   *     getEvent / listInstances / getEventInstance / getSeries.events[].
   *   - `calendarId` is an internal FK and must never appear (DEC-005:
   *     category.id is the public identifier within a calendar context).
   */
  describe('category projection', () => {
    const CATEGORY_PROJ_EVENT_UUID = '66666666-6666-4666-8666-666666666666';

    it('listCategories: returns the category allow-list on each row, augmented with eventCount; calendarId absent', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const category = makeCategory();

      apiSandbox.stub(publicInterface, 'getCalendarByName').resolves(calendar);
      apiSandbox.stub(publicInterface, 'listCategoriesForCalendar').resolves([{ category, eventCount: 3 }]);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        routes.listCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const row = response.body[0];
      expect(row.eventCount).toBe(3);
      assertCategoryProjection(row);
    });

    it('getEvent: returns the category allow-list on each entry of event.categories[]; calendarId absent', async () => {
      const event = new CalendarEvent(CATEGORY_PROJ_EVENT_UUID, 'cal-id');
      event.schedules = [];
      event.categories = [makeCategory()];

      apiSandbox.stub(publicInterface, 'getEventById').resolves(event);

      router.get('/handler/:id', (req, res) => {
        routes.getEvent(req, res);
      });

      const response = await request(testApp(router)).get(`/handler/${CATEGORY_PROJ_EVENT_UUID}`);

      expect(response.status).toBe(200);
      expect(response.body.categories).toHaveLength(1);
      assertCategoryProjection(response.body.categories[0]);
    });
  });
});
