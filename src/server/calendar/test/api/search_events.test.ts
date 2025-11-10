import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarInterface from '@/server/calendar/interface';

describe('Event Search API', () => {
  let routes: EventRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new EventRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should parse search parameter from query string', async () => {
    const listEventsStub = sandbox.stub(calendarInterface, 'listEvents');
    const calendarStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    const testCalendar = new Calendar('cal-id', 'test-calendar');

    calendarStub.resolves(testCalendar);
    listEventsStub.resolves([]);

    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test-calendar';
      routes.listEvents(req, res);
    });

    await request(testApp(router))
      .get('/handler?search=workshop');

    expect(listEventsStub.calledOnce).toBe(true);

    // Verify the service was called with search parameter
    const callArgs = listEventsStub.firstCall.args;
    expect(callArgs[0]).toEqual(testCalendar);
    expect(callArgs[1]).toHaveProperty('search', 'workshop');
  });

  it('should parse categories parameter from query string', async () => {
    const listEventsStub = sandbox.stub(calendarInterface, 'listEvents');
    const calendarStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    const testCalendar = new Calendar('cal-id', 'test-calendar');

    calendarStub.resolves(testCalendar);
    listEventsStub.resolves([]);

    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test-calendar';
      routes.listEvents(req, res);
    });

    await request(testApp(router))
      .get('/handler?categories=cat1,cat2');

    expect(listEventsStub.calledOnce).toBe(true);

    // Verify the service was called with categories array
    const callArgs = listEventsStub.firstCall.args;
    expect(callArgs[1]).toHaveProperty('categories');
    expect(callArgs[1].categories).toEqual(['cat1', 'cat2']);
  });

  it('should parse both search and categories parameters', async () => {
    const listEventsStub = sandbox.stub(calendarInterface, 'listEvents');
    const calendarStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    const testCalendar = new Calendar('cal-id', 'test-calendar');

    calendarStub.resolves(testCalendar);
    listEventsStub.resolves([]);

    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test-calendar';
      routes.listEvents(req, res);
    });

    await request(testApp(router))
      .get('/handler?search=conference&categories=tech,business');

    expect(listEventsStub.calledOnce).toBe(true);

    // Verify both parameters were parsed correctly
    const callArgs = listEventsStub.firstCall.args;
    expect(callArgs[1]).toHaveProperty('search', 'conference');
    expect(callArgs[1]).toHaveProperty('categories');
    expect(callArgs[1].categories).toEqual(['tech', 'business']);
  });

  it('should trim search query whitespace', async () => {
    const listEventsStub = sandbox.stub(calendarInterface, 'listEvents');
    const calendarStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    const testCalendar = new Calendar('cal-id', 'test-calendar');

    calendarStub.resolves(testCalendar);
    listEventsStub.resolves([]);

    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test-calendar';
      routes.listEvents(req, res);
    });

    await request(testApp(router))
      .get('/handler?search=  workshop  ');

    expect(listEventsStub.calledOnce).toBe(true);

    // Verify search query was trimmed
    const callArgs = listEventsStub.firstCall.args;
    expect(callArgs[1]).toHaveProperty('search', 'workshop');
  });

  it('should handle empty search parameter', async () => {
    const listEventsStub = sandbox.stub(calendarInterface, 'listEvents');
    const calendarStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    const testCalendar = new Calendar('cal-id', 'test-calendar');

    calendarStub.resolves(testCalendar);
    listEventsStub.resolves([]);

    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test-calendar';
      routes.listEvents(req, res);
    });

    await request(testApp(router))
      .get('/handler?search=');

    expect(listEventsStub.calledOnce).toBe(true);

    // Verify search parameter is not included when empty
    const callArgs = listEventsStub.firstCall.args;
    expect(callArgs[1]).toEqual({});
  });

  it('should filter out empty category IDs', async () => {
    const listEventsStub = sandbox.stub(calendarInterface, 'listEvents');
    const calendarStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    const testCalendar = new Calendar('cal-id', 'test-calendar');

    calendarStub.resolves(testCalendar);
    listEventsStub.resolves([]);

    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test-calendar';
      routes.listEvents(req, res);
    });

    await request(testApp(router))
      .get('/handler?categories=cat1,,cat2');

    expect(listEventsStub.calledOnce).toBe(true);

    // Verify empty category IDs were filtered out
    const callArgs = listEventsStub.firstCall.args;
    expect(callArgs[1].categories).toEqual(['cat1', 'cat2']);
  });

  it('should return filtered results when search matches events', async () => {
    const listEventsStub = sandbox.stub(calendarInterface, 'listEvents');
    const calendarStub = sandbox.stub(calendarInterface, 'getCalendarByName');
    const testCalendar = new Calendar('cal-id', 'test-calendar');

    const mockEvents = [
      new CalendarEvent('cal-id', 'event1'),
      new CalendarEvent('cal-id', 'event2'),
    ];

    calendarStub.resolves(testCalendar);
    listEventsStub.resolves(mockEvents);

    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test-calendar';
      routes.listEvents(req, res);
    });

    const response = await request(testApp(router))
      .get('/handler?search=workshop');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(2);
  });
});
