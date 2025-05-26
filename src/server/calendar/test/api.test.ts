import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { testApp, countRoutes, addRequestUser } from '@/server/common/test/lib/express';
import CalendarAPI from '@/server/calendar/api/v1';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarInterface from '@/server/calendar/interface';

describe('API v1', () => {

  it('should load routes properly', () => {
    let app = express();
    let calendarInterface = new CalendarInterface(new EventEmitter());
    expect(countRoutes(app)).toBe(0);
    CalendarAPI.install(app, calendarInterface);
    expect(countRoutes(app)).toBeGreaterThan(0);
  });
});

describe('Event API', () => {
  let routes: EventRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let eventSandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new EventRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    eventSandbox.restore();
  });

  it('listEvents: should fail without calendar', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'listEvents');
    router.get('/handler', addRequestUser, (req, res) => { routes.listEvents(req,res); });
    eventStub.resolves([]);

    const response = await request(testApp(router))
      .get('/handler');

    expect(response.status).toBe(400);
    expect(eventStub.called).toBe(false);
  });

  it('listEvents: should succeed', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'listEvents');
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');
    calendarStub.resolves(new Calendar('id', 'test'));
    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test';
      routes.listEvents(req,res);
    });
    eventStub.resolves([]);

    const response = await request(testApp(router))
      .get('/handler');

    expect(response.status).toBe(200);
    expect(eventStub.called).toBe(true);
  });

  it('createEvent: should fail without account', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    router.post('/handler', (req,res) => { routes.createEvent(req,res); });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should fail without calendar name', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    router.post('/handler', addRequestUser, (req,res) => { routes.createEvent(req,res); });
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(calendarStub.called).toBe(false);
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should fail without calendar', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    router.post('/handler', addRequestUser, (req,res) => {
      req.params.calendar = 'nonexistent';
      routes.createEvent(req,res);
    });
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');
    calendarStub.resolves(null);

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should succeed', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');
    calendarStub.resolves(new Calendar('id', 'testme'));
    router.post('/handler', addRequestUser, (req,res) => {
      req.params.calendar = 'testme';
      routes.createEvent(req,res);
    });
    eventStub.resolves(new CalendarEvent('id', 'testme'));

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(eventStub.called).toBe(true);
  });

  it('updateEvent: should fail without account', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');
    router.post('/handler', (req,res) => { routes.updateEvent(req,res); });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('updateEvent: should succeed', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');
    router.post('/handler', addRequestUser, (req,res) => { routes.updateEvent(req,res); });
    eventStub.resolves(new CalendarEvent('id', 'testme'));

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(eventStub.called).toBe(true);
  });
});
