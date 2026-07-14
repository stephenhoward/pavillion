import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from '@/common/model/events';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import { EventNotFoundError } from '@/common/exceptions/calendar';

describe('GET /calendars/:urlname/events/:eventid', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let calendarAPI: CalendarInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const activityPubInterface = new ActivityPubInterface(eventBus);
    calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(activityPubInterface, calendarAPI);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return 404 when calendar not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(null);

    const req = { params: { urlname: 'nonexistent', eventid: 'event-1' } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getEvent(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Calendar not found')).toBe(true);
  });

  it('should return 404 when event not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(new Calendar('cal-id', 'mycal'));
    // Regression: getEventById throws EventNotFoundError, not null — stub must reject (pv-ttak)
    sandbox.stub(calendarAPI, 'getEventById').rejects(new EventNotFoundError('nonexistent'));

    const req = { params: { urlname: 'mycal', eventid: 'nonexistent' } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getEvent(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Event not found')).toBe(true);
  });

  it('should return a properly serialized ActivityPub event object', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const event = new CalendarEvent('event-uuid', 'cal-id');
    event.addContent(new CalendarEventContent('en', 'Test Event', 'A description'));
    const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
    event.schedules = [new CalendarEventSchedule('s1', startDt)];

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(calendarAPI, 'getEventById').resolves(event);

    const req = { params: { urlname: 'mycal', eventid: 'event-uuid' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.getEvent(req as any, res as any);

    expect(res.setHeader.calledWith('Content-Type', 'application/activity+json')).toBe(true);
    expect(res.json.calledOnce).toBe(true);

    const result = res.json.firstCall.args[0];
    expect(result.type).toBe('Event');
    expect(result.name).toBe('Test Event');
    expect(result.summary).toBe('A description');
    expect(result.startTime).toBe(startDt.toISO());
    expect(result.attributedTo).toContain('/calendars/mycal');
    expect(result.id).toContain('/calendars/mycal/events/event-uuid');
    // Standalone object response must declare a full @context including the
    // pavillion namespace so the pavillion:* extension terms expand for
    // JSON-LD-strict peers instead of being silently dropped.
    expect(result['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/fep/8a8e',
      { pavillion: 'https://pavillion.social/ns/activitypub#' },
    ]);
    // Verify pavillion extensions are present
    expect(result['pavillion:content']).toBeDefined();
    expect(result['pavillion:schedules']).toBeDefined();
  });

  it('should include multilingual maps when event has multiple languages', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const event = new CalendarEvent('event-uuid', 'cal-id');
    event.addContent(new CalendarEventContent('en', 'English Title', 'English desc'));
    event.addContent(new CalendarEventContent('fr', 'Titre Francais', 'Description francaise'));
    const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
    event.schedules = [new CalendarEventSchedule('s1', startDt)];

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(calendarAPI, 'getEventById').resolves(event);

    const req = { params: { urlname: 'mycal', eventid: 'event-uuid' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.getEvent(req as any, res as any);

    const result = res.json.firstCall.args[0];
    expect(result.nameMap).toBeDefined();
    expect(result.nameMap.en).toBe('English Title');
    expect(result.nameMap.fr).toBe('Titre Francais');
    expect(result.summaryMap).toBeDefined();
    expect(result.contentMap).toBeDefined();
  });
});

describe('GET /calendars/:urlname/events/:eventid/note', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let calendarAPI: CalendarInterface;

  const validEventId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const activityPubInterface = new ActivityPubInterface(eventBus);
    calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(activityPubInterface, calendarAPI);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return 400 when eventid is not a valid UUID', async () => {
    const req = { params: { urlname: 'mycal', eventid: 'not-a-uuid' } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getNote(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
  });

  it('should return 404 when calendar not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(null);

    const req = { params: { urlname: 'nonexistent', eventid: validEventId } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getNote(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Calendar not found')).toBe(true);
  });

  it('should return 404 when event not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(new Calendar('cal-id', 'mycal'));
    sandbox.stub(calendarAPI, 'getEventById').rejects(new EventNotFoundError(validEventId));

    const req = { params: { urlname: 'mycal', eventid: validEventId } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getNote(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Event not found')).toBe(true);
  });

  it('should return 404 when getEventById resolves to null', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(new Calendar('cal-id', 'mycal'));
    sandbox.stub(calendarAPI, 'getEventById').resolves(null as any);

    const req = { params: { urlname: 'mycal', eventid: validEventId } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getNote(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Event not found')).toBe(true);
  });

  it('should return a properly serialized ActivityPub Note object', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const event = new CalendarEvent(validEventId, 'cal-id');
    event.addContent(new CalendarEventContent('en', 'Test Event', 'A description'));
    const startDt = DateTime.fromISO('2026-04-15T09:00:00.000Z');
    event.schedules = [new CalendarEventSchedule('s1', startDt)];

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(calendarAPI, 'getEventById').resolves(event);

    const req = { params: { urlname: 'mycal', eventid: validEventId } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.getNote(req as any, res as any);

    expect(res.setHeader.calledWith('Content-Type', 'application/activity+json')).toBe(true);
    expect(res.json.calledOnce).toBe(true);

    const result = res.json.firstCall.args[0];
    expect(result.type).toBe('Note');
    expect(result.id).toMatch(/\/note$/);
    expect(result.id).toContain(`/calendars/mycal/events/${validEventId}/note`);
    expect(result.attributedTo).toContain('/calendars/mycal');
    // Standalone object response must declare its own JSON-LD @context.
    expect(result['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/fep/8a8e',
      { pavillion: 'https://pavillion.social/ns/activitypub#' },
    ]);
  });
});

describe('GET /calendars/:urlname/series/:seriesid', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let calendarAPI: CalendarInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const activityPubInterface = new ActivityPubInterface(eventBus);
    calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(activityPubInterface, calendarAPI);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return 404 when calendar not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(null);

    const req = { params: { urlname: 'nonexistent', seriesid: 'series-1' } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getSeries(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
  });

  it('should return 404 when series not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(new Calendar('cal-id', 'mycal'));
    sandbox.stub(calendarAPI, 'getSeries').resolves(null as any);

    const req = { params: { urlname: 'mycal', seriesid: 'nonexistent' } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getSeries(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Series not found')).toBe(true);
  });

  it('should return a properly serialized ActivityPub series object', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const series = new EventSeries('series-uuid', 'cal-id', 'myseries');
    series.addContent(new EventSeriesContent('en', 'Concert Series', 'Weekly concerts'));

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(calendarAPI, 'getSeries').resolves(series);

    const req = { params: { urlname: 'mycal', seriesid: 'series-uuid' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.getSeries(req as any, res as any);

    expect(res.setHeader.calledWith('Content-Type', 'application/activity+json')).toBe(true);
    expect(res.json.calledOnce).toBe(true);

    const result = res.json.firstCall.args[0];
    expect(result.type).toBe('OrderedCollection');
    expect(result.name).toBe('Concert Series');
    expect(result.attributedTo).toContain('/calendars/mycal');
    expect(result.id).toContain('/calendars/mycal/series/series-uuid');
    // Standalone object response must declare a full @context including the
    // pavillion namespace for the pavillion:content term.
    expect(result['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/fep/8a8e',
      { pavillion: 'https://pavillion.social/ns/activitypub#' },
    ]);
    expect(result['pavillion:content']).toBeDefined();
  });

  it('should include nameMap when series has multiple languages', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const series = new EventSeries('series-uuid', 'cal-id', 'myseries');
    series.addContent(new EventSeriesContent('en', 'Concert Series', ''));
    series.addContent(new EventSeriesContent('fr', 'Serie de Concerts', ''));

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(calendarAPI, 'getSeries').resolves(series);

    const req = { params: { urlname: 'mycal', seriesid: 'series-uuid' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.getSeries(req as any, res as any);

    const result = res.json.firstCall.args[0];
    expect(result.nameMap).toBeDefined();
    expect(result.nameMap.en).toBe('Concert Series');
    expect(result.nameMap.fr).toBe('Serie de Concerts');
  });
});

describe('GET /calendars/:urlname/series (collection)', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let calendarAPI: CalendarInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const activityPubInterface = new ActivityPubInterface(eventBus);
    calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(activityPubInterface, calendarAPI);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return 404 when calendar not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(null);

    const req = { params: { urlname: 'nonexistent' } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.getSeriesCollection(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
  });

  it('should return properly serialized series items in the collection', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const series1 = new EventSeries('series-1', 'cal-id', 'first');
    series1.addContent(new EventSeriesContent('en', 'First Series', ''));
    const series2 = new EventSeries('series-2', 'cal-id', 'second');
    series2.addContent(new EventSeriesContent('en', 'Second Series', ''));

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(calendarAPI, 'getSeriesForCalendar').resolves([series1, series2]);

    const req = { params: { urlname: 'mycal' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.getSeriesCollection(req as any, res as any);

    expect(res.json.calledOnce).toBe(true);

    const result = res.json.firstCall.args[0];
    expect(result.type).toBe('OrderedCollection');
    expect(result.totalItems).toBe(2);
    expect(result.orderedItems).toHaveLength(2);
    // The collection is the top-level JSON-LD document; its @context must
    // declare the pavillion namespace so the pavillion:content term carried by
    // each nested series item expands for strict processors.
    expect(result['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/fep/8a8e',
      { pavillion: 'https://pavillion.social/ns/activitypub#' },
    ]);

    // Verify items are serialized via toActivityPubObject, not raw instances
    expect(result.orderedItems[0].name).toBe('First Series');
    expect(result.orderedItems[1].name).toBe('Second Series');
    expect(result.orderedItems[0]['pavillion:content']).toBeDefined();
  });
});

describe('GET /calendars/:urlname/outbox', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let calendarAPI: CalendarInterface;
  let apInterface: ActivityPubInterface;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    apInterface = new ActivityPubInterface(eventBus);
    calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(apInterface, calendarAPI);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  it('should return 400 for invalid urlname', async () => {
    const req = { params: { urlname: '!!invalid!!' }, query: {} };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.readOutbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
    expect(res.send.calledWith('Invalid calendar name')).toBe(true);
  });

  it('should return 404 when calendar not found', async () => {
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(null);

    const req = { params: { urlname: 'nonexistent' }, query: {} };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.readOutbox(req as any, res as any);

    expect(res.status.calledWith(404)).toBe(true);
    expect(res.send.calledWith('Calendar not found')).toBe(true);
  });

  it('should return OrderedCollection summary without page param', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(apInterface, 'readOutbox').resolves({ items: [], totalItems: 5 });

    const req = { params: { urlname: 'mycal' }, query: {} };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.readOutbox(req as any, res as any);

    expect(res.setHeader.calledWith('Content-Type', 'application/activity+json')).toBe(true);
    expect(res.json.calledOnce).toBe(true);

    const result = res.json.firstCall.args[0];
    expect(result['@context']).toBe('https://www.w3.org/ns/activitystreams');
    expect(result.type).toBe('OrderedCollection');
    expect(result.totalItems).toBe(5);
    expect(result.first).toContain('?page=true');
    expect(result.orderedItems).toBeUndefined();
    // The outbox collection's `id` and `first` URL must match the path the
    // actor JSON advertises (`/calendars/:urlname/outbox`). A mismatch
    // (e.g. an /api/ap/v1/ prefix) sends federation peers to a 404 when
    // they walk the collection — exactly how follow-backfill silently
    // failed against PR #322's federation harness.
    expect(result.id).toContain('/calendars/mycal/outbox');
    expect(result.id).not.toContain('/api/ap/v1/');
    expect(result.first).toContain('/calendars/mycal/outbox?page=true');
    expect(result.first).not.toContain('/api/ap/v1/');
  });

  it('should return OrderedCollectionPage with page=true', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const mockItems = [
      { message: { type: 'Announce', id: 'act-1', actor: 'https://ex.com/calendars/mycal' }, message_time: new Date('2026-03-20T10:00:00Z') },
      { message: { type: 'Update', id: 'act-2', actor: 'https://ex.com/calendars/mycal' }, message_time: new Date('2026-03-19T10:00:00Z') },
    ];

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(apInterface, 'readOutbox').resolves({ items: mockItems as any, totalItems: 2 });

    const req = { params: { urlname: 'mycal' }, query: { page: 'true' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.readOutbox(req as any, res as any);

    const result = res.json.firstCall.args[0];
    expect(result.type).toBe('OrderedCollectionPage');
    expect(result.partOf).toContain('/outbox');
    expect(result.orderedItems).toHaveLength(2);
    expect(result.orderedItems[0].type).toBe('Announce');
    expect(result.next).toBeUndefined(); // Less than 20 items, no next
  });

  it('should include next link when page is full', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const mockItems = Array.from({ length: 20 }, (_, i) => ({
      message: { type: 'Announce', id: `act-${i}` },
      message_time: new Date(`2026-03-${String(20 - i).padStart(2, '0')}T10:00:00Z`),
    }));

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(apInterface, 'readOutbox').resolves({ items: mockItems as any, totalItems: 30 });

    const req = { params: { urlname: 'mycal' }, query: { page: 'true' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.readOutbox(req as any, res as any);

    const result = res.json.firstCall.args[0];
    expect(result.next).toBeDefined();
    expect(result.next).toContain('max_time=');
    expect(result.totalItems).toBe(30);
  });

  it('should return 400 for invalid cursor', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);

    const req = { params: { urlname: 'mycal' }, query: { page: 'true', max_time: 'not-a-date' } };
    const res = { status: sinon.stub(), send: sinon.stub(), setHeader: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);

    await routes.readOutbox(req as any, res as any);

    expect(res.status.calledWith(400)).toBe(true);
  });

  it('should strip bcc and bto from served messages', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    const mockItems = [{
      message: {
        type: 'Announce',
        id: 'act-1',
        actor: 'https://ex.com/calendars/mycal',
        bcc: ['https://private.example/inbox'],
        bto: ['https://secret.example/inbox'],
        to: ['https://www.w3.org/ns/activitystreams#Public'],
      },
      message_time: new Date('2026-03-20T10:00:00Z'),
    }];

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(apInterface, 'readOutbox').resolves({ items: mockItems as any, totalItems: 1 });

    const req = { params: { urlname: 'mycal' }, query: { page: 'true' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.readOutbox(req as any, res as any);

    const result = res.json.firstCall.args[0];
    expect(result.orderedItems[0].bcc).toBeUndefined();
    expect(result.orderedItems[0].bto).toBeUndefined();
    expect(result.orderedItems[0].to).toBeDefined();
  });

  it('should treat non-true page values as collection summary', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    sandbox.stub(apInterface, 'readOutbox').resolves({ items: [], totalItems: 3 });

    const req = { params: { urlname: 'mycal' }, query: { page: 'false' } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.readOutbox(req as any, res as any);

    const result = res.json.firstCall.args[0];
    expect(result.type).toBe('OrderedCollection');
  });

  it('should pass cursor to service when max_time provided', async () => {
    const calendar = new Calendar('cal-id', 'mycal');
    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(calendar);
    const readOutboxStub = sandbox.stub(apInterface, 'readOutbox').resolves({ items: [], totalItems: 0 });

    const cursorDate = '2026-03-15T10:00:00.000Z';
    const req = { params: { urlname: 'mycal' }, query: { page: 'true', max_time: cursorDate } };
    const res = { setHeader: sinon.stub(), json: sinon.stub() };

    await routes.readOutbox(req as any, res as any);

    expect(readOutboxStub.calledOnce).toBe(true);
    const [calendarId, cursor] = readOutboxStub.firstCall.args;
    expect(calendarId).toBe('cal-id');
    expect(cursor).toBeInstanceOf(Date);
    expect(cursor.toISOString()).toBe(cursorDate);
  });
});
