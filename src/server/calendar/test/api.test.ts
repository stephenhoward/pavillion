import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';

import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { testApp, countRoutes, addRequestUser } from '@/server/common/test/lib/express';
import MemberAPI from '@/server/calendar/api/v1';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarService from '@/server/calendar/service/calendar';

describe('API v1', () => {

  it('should load routes properly', () => {
    let app = express();
    expect(countRoutes(app)).toBe(0);
    new MemberAPI(app);
    expect(countRoutes(app)).toBeGreaterThan(0);
  });
});

describe('Event API', () => {
  let routes: EventRoutes;
  let router: express.Router;
  let eventSandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    routes = new EventRoutes();
    router = express.Router();
  });

  afterEach(() => {
    eventSandbox.restore();
  });

  it('listEvents: should fail without calendar', async () => {
    let eventStub = eventSandbox.stub(routes.service, 'listEvents');
    router.get('/handler', addRequestUser, (req, res) => { routes.listEvents(req,res); });
    eventStub.resolves([]);

    const response = await request(testApp(router))
      .get('/handler');

    expect(response.status).toBe(400);
    expect(eventStub.called).toBe(false);
  });

  it('listEvents: should succeed', async () => {
    let eventStub = eventSandbox.stub(routes.service, 'listEvents');
    let calendarStub = eventSandbox.stub(CalendarService, 'getCalendarByName');
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
    let eventStub = eventSandbox.stub(routes.service, 'createEvent');
    router.post('/handler', (req,res) => { routes.createEvent(req,res); });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should fail without calendar id', async () => {
    let eventStub = eventSandbox.stub(routes.service, 'createEvent');
    router.post('/handler', addRequestUser, (req,res) => { routes.createEvent(req,res); });
    let calendarStub = eventSandbox.stub(CalendarService, 'getCalendar');

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(calendarStub.called).toBe(false);
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should fail without calendar', async () => {
    let eventStub = eventSandbox.stub(routes.service, 'createEvent');
    router.post('/handler', addRequestUser, (req,res) => { routes.createEvent(req,res); });
    let calendarStub = eventSandbox.stub(CalendarService, 'getCalendar');
    calendarStub.resolves(null);

    const response = await request(testApp(router))
      .post('/handler')
      .send({calendarId: 'id'});

    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should succeed', async () => {
    let eventStub = eventSandbox.stub(routes.service, 'createEvent');
    let calendarStub = eventSandbox.stub(CalendarService, 'getCalendar');
    calendarStub.resolves(new Calendar('id', 'testme'));
    router.post('/handler', addRequestUser, (req,res) => { routes.createEvent(req,res); });
    eventStub.resolves(new CalendarEvent('id', 'testme'));

    const response = await request(testApp(router))
      .post('/handler')
      .send({calendarId: 'id'});

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(eventStub.called).toBe(true);
  });

  it('updateEvent: should fail without account', async () => {
    let eventStub = eventSandbox.stub(routes.service, 'updateEvent');
    router.post('/handler', (req,res) => { routes.updateEvent(req,res); });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('updateEvent: should succeed', async () => {
    let eventStub = eventSandbox.stub(routes.service, 'updateEvent');
    router.post('/handler', addRequestUser, (req,res) => { routes.updateEvent(req,res); });
    eventStub.resolves(new CalendarEvent('id', 'testme'));

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(eventStub.called).toBe(true);
  });
});
