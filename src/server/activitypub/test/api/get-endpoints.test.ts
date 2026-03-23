import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    sandbox.stub(calendarAPI, 'getEventById').resolves(null as any);

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

    // Verify items are serialized via toActivityPubObject, not raw instances
    expect(result.orderedItems[0].name).toBe('First Series');
    expect(result.orderedItems[1].name).toBe('Second Series');
    expect(result.orderedItems[0]['pavillion:content']).toBeDefined();
  });
});
