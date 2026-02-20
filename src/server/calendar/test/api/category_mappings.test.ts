import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import CategoryMappingRoutes from '@/server/calendar/api/v1/category_mappings';
import CalendarInterface from '@/server/calendar/interface';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { CalendarCategoryMappingEntity } from '@/server/calendar/entity/category_mapping';

describe('CategoryMappingRoutes - GET /calendars/:calendarId/following/:actorId/category-mappings', () => {
  let routes: CategoryMappingRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox;

  const calendarId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  const mockCalendar = new Calendar(calendarId, 'test-calendar');
  const mockActor = CalendarActorEntity.build({
    id: actorId,
    actor_type: 'local',
    calendar_id: '33333333-3333-4333-8333-333333333333',
    actor_uri: 'https://example.com/calendars/sourcecal',
  });
  const mockFollow = FollowingCalendarEntity.build({
    id: '44444444-4444-4444-8444-444444444444',
    calendar_actor_id: actorId,
    calendar_id: calendarId,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new CategoryMappingRoutes(calendarInterface);
    router = express.Router();

    // Default stubs for auth/calendar/follow checks
    sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
    sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);
    sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);
    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('authentication and authorization', () => {
    it('should return 401 when not logged in', async () => {
      router.get('/handler', (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(401);
    });

    it('should return 404 when calendar not found', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(404);
    });

    it('should return 403 when user cannot modify calendar', async () => {
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(403);
    });

    it('should return 404 when actor not found', async () => {
      (CalendarActorEntity.findByPk as sinon.SinonStub).resolves(null);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('actor not found');
    });

    it('should return 404 when actor is not in calendar following list', async () => {
      (FollowingCalendarEntity.findOne as sinon.SinonStub).resolves(null);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('actor is not in the following list for this calendar');
    });
  });

  describe('successful retrieval', () => {
    it('should return empty array when no mappings configured', async () => {
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return mapped format with camelCase keys', async () => {
      const mockMappings = [
        CalendarCategoryMappingEntity.build({
          id: 'map-1',
          following_calendar_id: calendarId,
          source_calendar_actor_id: actorId,
          source_category_id: '55555555-5555-4555-8555-555555555555',
          source_category_name: 'Music',
          local_category_id: '66666666-6666-4666-8666-666666666666',
        }),
        CalendarCategoryMappingEntity.build({
          id: 'map-2',
          following_calendar_id: calendarId,
          source_calendar_actor_id: actorId,
          source_category_id: '77777777-7777-4777-8777-777777777777',
          source_category_name: 'Art',
          local_category_id: '88888888-8888-4888-8888-888888888888',
        }),
      ];

      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves(mockMappings);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toEqual({
        sourceCategoryId: '55555555-5555-4555-8555-555555555555',
        sourceCategoryName: 'Music',
        localCategoryId: '66666666-6666-4666-8666-666666666666',
      });
      expect(response.body[1]).toEqual({
        sourceCategoryId: '77777777-7777-4777-8777-777777777777',
        sourceCategoryName: 'Art',
        localCategoryId: '88888888-8888-4888-8888-888888888888',
      });
    });
  });
});

describe('CategoryMappingRoutes - PUT /calendars/:calendarId/following/:actorId/category-mappings', () => {
  let routes: CategoryMappingRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox;

  const calendarId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';
  const localCategoryId = '66666666-6666-4666-8666-666666666666';
  const sourceCategoryId = '55555555-5555-4555-8555-555555555555';

  const mockCalendar = new Calendar(calendarId, 'test-calendar');
  const mockActor = CalendarActorEntity.build({
    id: actorId,
    actor_type: 'local',
    calendar_id: '33333333-3333-4333-8333-333333333333',
    actor_uri: 'https://example.com/calendars/sourcecal',
  });
  const mockFollow = FollowingCalendarEntity.build({
    id: '44444444-4444-4444-8444-444444444444',
    calendar_actor_id: actorId,
    calendar_id: calendarId,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new CategoryMappingRoutes(calendarInterface);
    router = express.Router();

    // Default stubs for auth/calendar/follow checks
    sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
    sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);
    sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);
    sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);
  });

  afterEach(() => {
    sandbox.restore();
  });

  const setupPutHandler = () => {
    router.put('/handler', addRequestUser, (req, res) => {
      req.params.calendarId = calendarId;
      req.params.actorId = actorId;
      routes.setCategoryMappings(req, res);
    });
  };

  describe('authentication and authorization', () => {
    it('should return 401 when not logged in', async () => {
      router.put('/handler', (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.setCategoryMappings(req, res);
      });

      const response = await request(testApp(router)).put('/handler').send({ mappings: [] });
      expect(response.status).toBe(401);
    });

    it('should return 403 when user cannot modify calendar', async () => {
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);
      setupPutHandler();

      const response = await request(testApp(router)).put('/handler').send({ mappings: [] });
      expect(response.status).toBe(403);
    });

    it('should return 404 when calendar not found', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);
      setupPutHandler();

      const response = await request(testApp(router)).put('/handler').send({ mappings: [] });
      expect(response.status).toBe(404);
    });

    it('should return 404 when actor not found', async () => {
      (CalendarActorEntity.findByPk as sinon.SinonStub).resolves(null);
      setupPutHandler();

      const response = await request(testApp(router)).put('/handler').send({ mappings: [] });
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('actor not found');
    });

    it('should return 404 when actor is not in following list', async () => {
      (FollowingCalendarEntity.findOne as sinon.SinonStub).resolves(null);
      setupPutHandler();

      const response = await request(testApp(router)).put('/handler').send({ mappings: [] });
      expect(response.status).toBe(404);
    });
  });

  describe('input validation', () => {
    it('should return 400 when mappings is not an array', async () => {
      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({ mappings: 'not-an-array' });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('array');
    });

    it('should return 400 when mappings property is missing', async () => {
      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({});
      expect(response.status).toBe(400);
    });

    it('should return 422 when mappings array has more than 100 entries', async () => {
      setupPutHandler();

      const mappings = Array.from({ length: 101 }, (_, i) => ({
        sourceCategoryId: `${i.toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
        sourceCategoryName: `Category ${i}`,
        localCategoryId: localCategoryId,
      }));

      const response = await request(testApp(router))
        .put('/handler')
        .send({ mappings });
      expect(response.status).toBe(422);
    });

    it('should return 400 when sourceCategoryId is not a valid UUID', async () => {
      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({
          mappings: [{
            sourceCategoryId: 'not-a-uuid',
            sourceCategoryName: 'Music',
            localCategoryId: localCategoryId,
          }],
        });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sourceCategoryId');
    });

    it('should return 400 when localCategoryId is not a valid UUID', async () => {
      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({
          mappings: [{
            sourceCategoryId: sourceCategoryId,
            sourceCategoryName: 'Music',
            localCategoryId: 'not-a-uuid',
          }],
        });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('localCategoryId');
    });

    it('should return 400 when localCategoryId belongs to a different calendar', async () => {
      const foreignCategory = EventCategoryEntity.build({
        id: localCategoryId,
        calendar_id: 'different-calendar-uuid',
      });
      sandbox.stub(EventCategoryEntity, 'findAll').resolves([foreignCategory]);
      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({
          mappings: [{
            sourceCategoryId: sourceCategoryId,
            sourceCategoryName: 'Music',
            localCategoryId: localCategoryId,
          }],
        });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Category does not belong to this calendar');
    });

    it('should return 400 when localCategoryId does not exist', async () => {
      // findAll returns empty (no matching categories found)
      sandbox.stub(EventCategoryEntity, 'findAll').resolves([]);
      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({
          mappings: [{
            sourceCategoryId: sourceCategoryId,
            sourceCategoryName: 'Music',
            localCategoryId: localCategoryId,
          }],
        });
      expect(response.status).toBe(400);
    });
  });

  describe('successful updates', () => {
    it('should accept exactly 100 entries without rejecting', async () => {
      const localCategoryEntityId = localCategoryId;
      const localCat = EventCategoryEntity.build({
        id: localCategoryEntityId,
        calendar_id: calendarId,
      });
      sandbox.stub(EventCategoryEntity, 'findAll').resolves([localCat]);

      const destroyStub = sandbox.stub(CalendarCategoryMappingEntity, 'destroy').resolves(0 as any);
      const createStub = sandbox.stub(CalendarCategoryMappingEntity, 'create').resolves({} as any);
      const findAllStub = sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      const mappings = Array.from({ length: 100 }, (_, i) => ({
        sourceCategoryId: `${i.toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
        sourceCategoryName: `Category ${i}`,
        localCategoryId: localCategoryEntityId,
      }));

      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({ mappings });
      expect(response.status).toBe(200);
      expect(destroyStub.calledOnce).toBe(true);
      expect(createStub.callCount).toBe(100);
      expect(findAllStub.calledOnce).toBe(true);
    });

    it('should replace all mappings atomically and return updated list', async () => {
      const localCat = EventCategoryEntity.build({
        id: localCategoryId,
        calendar_id: calendarId,
      });
      sandbox.stub(EventCategoryEntity, 'findAll').resolves([localCat]);

      sandbox.stub(CalendarCategoryMappingEntity, 'destroy').resolves(1 as any);
      sandbox.stub(CalendarCategoryMappingEntity, 'create').resolves({} as any);

      const updatedMapping = CalendarCategoryMappingEntity.build({
        id: 'new-map-1',
        following_calendar_id: calendarId,
        source_calendar_actor_id: actorId,
        source_category_id: sourceCategoryId,
        source_category_name: 'Music',
        local_category_id: localCategoryId,
      });
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([updatedMapping]);

      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({
          mappings: [{
            sourceCategoryId: sourceCategoryId,
            sourceCategoryName: 'Music',
            localCategoryId: localCategoryId,
          }],
        });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toEqual({
        sourceCategoryId: sourceCategoryId,
        sourceCategoryName: 'Music',
        localCategoryId: localCategoryId,
      });
    });

    it('should accept empty mappings array (clears all mappings)', async () => {
      const destroyStub = sandbox.stub(CalendarCategoryMappingEntity, 'destroy').resolves(2 as any);
      const createStub = sandbox.stub(CalendarCategoryMappingEntity, 'create').resolves({} as any);
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      setupPutHandler();

      const response = await request(testApp(router))
        .put('/handler')
        .send({ mappings: [] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(destroyStub.calledOnce).toBe(true);
      expect(createStub.called).toBe(false);
    });

    it('should truncate sourceCategoryName to 255 characters', async () => {
      const localCat = EventCategoryEntity.build({
        id: localCategoryId,
        calendar_id: calendarId,
      });
      sandbox.stub(EventCategoryEntity, 'findAll').resolves([localCat]);

      sandbox.stub(CalendarCategoryMappingEntity, 'destroy').resolves(0 as any);
      const createStub = sandbox.stub(CalendarCategoryMappingEntity, 'create').resolves({} as any);
      sandbox.stub(CalendarCategoryMappingEntity, 'findAll').resolves([]);

      const longName = 'A'.repeat(300);
      setupPutHandler();

      await request(testApp(router))
        .put('/handler')
        .send({
          mappings: [{
            sourceCategoryId: sourceCategoryId,
            sourceCategoryName: longName,
            localCategoryId: localCategoryId,
          }],
        });

      expect(createStub.calledOnce).toBe(true);
      const createArgs = createStub.firstCall.args[0];
      expect(createArgs.source_category_name.length).toBe(255);
    });
  });
});
