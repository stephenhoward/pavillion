import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { SpaceLocationMismatchError } from '@/common/exceptions/calendar';
import { CalendarEvent } from '@/common/model/events';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarInterface from '@/server/calendar/interface';

describe('Event API spaceId handling', () => {
  let routes: EventRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new EventRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('POST /events with spaceId', () => {
    it('passes spaceId through to the service when both placeId and spaceId are valid', async () => {
      const createEventStub = sandbox.stub(calendarInterface, 'createEvent');
      const fakeEvent = new CalendarEvent('event-1', 'cal-1', '/cal/event-1');
      createEventStub.resolves(fakeEvent);

      router.post('/handler', addRequestUser, (req, res) => { routes.createEvent(req, res); });

      const placeId = '11111111-1111-4111-8111-111111111111';
      const spaceId = '22222222-2222-4222-8222-222222222222';

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          calendarId: 'cal-1',
          locationId: placeId,
          spaceId: spaceId,
        });

      expect(response.status).toBe(201);
      expect(createEventStub.called).toBe(true);
      const params = createEventStub.firstCall.args[1] as Record<string, any>;
      expect(params.locationId).toBe(placeId);
      expect(params.spaceId).toBe(spaceId);
    });

    it('returns 400 with errorName SpaceLocationMismatchError when service rejects mismatched (placeId, spaceId)', async () => {
      const createEventStub = sandbox.stub(calendarInterface, 'createEvent');
      const placeId = '11111111-1111-4111-8111-111111111111';
      const spaceId = '22222222-2222-4222-8222-222222222222';
      const actualPlaceId = '99999999-9999-4999-8999-999999999999';
      createEventStub.throws(new SpaceLocationMismatchError(spaceId, placeId, actualPlaceId));

      router.post('/handler', addRequestUser, (req, res) => { routes.createEvent(req, res); });

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          calendarId: 'cal-1',
          locationId: placeId,
          spaceId: spaceId,
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('SpaceLocationMismatchError');
      // Privacy binding: the response body must NOT leak the actualPlaceId
      // (the real parent Place of the supplied Space). The handler returns a
      // fixed string instead of error.message.
      expect(response.body.error).toBe('Space does not belong to the specified Place');
      expect(JSON.stringify(response.body)).not.toContain(actualPlaceId);
      expect(createEventStub.called).toBe(true);
    });
  });

  describe('PUT /events/:id with spaceId', () => {
    const eventId = '33333333-3333-4333-8333-333333333333';

    it('passes spaceId through to the service when both placeId and spaceId are valid', async () => {
      const updateEventStub = sandbox.stub(calendarInterface, 'updateEvent');
      const fakeEvent = new CalendarEvent(eventId, 'cal-1', '/cal/' + eventId);
      updateEventStub.resolves(fakeEvent);

      router.put('/handler/:id', addRequestUser, (req, res) => { routes.updateEvent(req, res); });

      const placeId = '11111111-1111-4111-8111-111111111111';
      const spaceId = '22222222-2222-4222-8222-222222222222';

      const response = await request(testApp(router))
        .put(`/handler/${eventId}`)
        .send({
          locationId: placeId,
          spaceId: spaceId,
        });

      expect(response.status).toBe(200);
      expect(updateEventStub.called).toBe(true);
      const params = updateEventStub.firstCall.args[2] as Record<string, any>;
      expect(params.locationId).toBe(placeId);
      expect(params.spaceId).toBe(spaceId);
    });

    it('returns 400 with errorName SpaceLocationMismatchError when service rejects mismatched (placeId, spaceId)', async () => {
      const updateEventStub = sandbox.stub(calendarInterface, 'updateEvent');
      const placeId = '11111111-1111-4111-8111-111111111111';
      const spaceId = '22222222-2222-4222-8222-222222222222';
      const actualPlaceId = '99999999-9999-4999-8999-999999999999';
      updateEventStub.throws(new SpaceLocationMismatchError(spaceId, placeId, actualPlaceId));

      router.put('/handler/:id', addRequestUser, (req, res) => { routes.updateEvent(req, res); });

      const response = await request(testApp(router))
        .put(`/handler/${eventId}`)
        .send({
          locationId: placeId,
          spaceId: spaceId,
        });

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('SpaceLocationMismatchError');
      // Privacy binding: the response body must NOT leak the actualPlaceId
      // (the real parent Place of the supplied Space). The handler returns a
      // fixed string instead of error.message.
      expect(response.body.error).toBe('Space does not belong to the specified Place');
      expect(JSON.stringify(response.body)).not.toContain(actualPlaceId);
      expect(updateEventStub.called).toBe(true);
    });

    it('passes locationId through with spaceId omitted, treating omitted spaceId as clear (advisor-required)', async () => {
      // When the user re-picks to a different Place and does not provide spaceId,
      // the API should pass through the change so the service can clear space_id.
      // This pins down the "omitted spaceId means clear" behaviour at the API boundary.
      const updateEventStub = sandbox.stub(calendarInterface, 'updateEvent');
      const fakeEvent = new CalendarEvent(eventId, 'cal-1', '/cal/' + eventId);
      updateEventStub.resolves(fakeEvent);

      router.put('/handler/:id', addRequestUser, (req, res) => { routes.updateEvent(req, res); });

      const newPlaceId = '44444444-4444-4444-8444-444444444444';

      const response = await request(testApp(router))
        .put(`/handler/${eventId}`)
        .send({
          locationId: newPlaceId,
          // spaceId intentionally omitted
        });

      expect(response.status).toBe(200);
      expect(updateEventStub.called).toBe(true);
      const params = updateEventStub.firstCall.args[2] as Record<string, any>;
      expect(params.locationId).toBe(newPlaceId);
      // Omitted spaceId stays omitted (or is null) — service treats this as "clear".
      expect(params.spaceId === undefined || params.spaceId === null).toBe(true);
    });
  });
});
