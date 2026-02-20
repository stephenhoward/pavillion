import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import axios from 'axios';

import { Calendar } from '@/common/model/calendar';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import CategoryMappingRoutes from '@/server/calendar/api/v1/category_mappings';
import CalendarInterface from '@/server/calendar/interface';
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { EventCategoryEntity, EventCategoryContentEntity } from '@/server/calendar/entity/event_category';

describe('CategoryMappingRoutes - GET /calendars/:calendarId/following/:actorId/source-categories', () => {
  let routes: CategoryMappingRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox;

  const calendarId = 'calendar-uuid-1';
  const actorId = 'actor-uuid-1';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new CategoryMappingRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('authentication and authorization', () => {
    it('should return 401 when not logged in', async () => {
      router.get('/handler', (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(401);
    });

    it('should return 404 when calendar not found', async () => {
      const getCalendarStub = sandbox.stub(calendarInterface, 'getCalendar').resolves(null);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(404);
      expect(getCalendarStub.calledOnce).toBe(true);
    });

    it('should return 403 when user cannot modify calendar', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(false);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(403);
    });

    it('should return 404 when actor not found', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);
      sandbox.stub(CalendarActorEntity, 'findByPk').resolves(null);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('actor not found');
    });

    it('should return 404 when actor is not in calendar following list', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);

      const mockActor = CalendarActorEntity.build({
        id: actorId,
        actor_type: 'local',
        calendar_id: 'source-cal-id',
        actor_uri: 'https://example.com/calendars/sourcecal',
      });
      sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('actor is not in the following list for this calendar');
    });
  });

  describe('local actor branch', () => {
    it('should return categories from source calendar for local actor', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);

      const mockActor = CalendarActorEntity.build({
        id: actorId,
        actor_type: 'local',
        calendar_id: 'source-cal-id',
        actor_uri: 'https://local.example.com/calendars/sourcecal',
      });
      sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);

      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_actor_id: actorId,
        calendar_id: calendarId,
      });
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      const mockContent = EventCategoryContentEntity.build({
        id: 'content-1',
        category_id: 'cat-1',
        language: 'en',
        name: 'Music',
      });
      const mockCategory = EventCategoryEntity.build({
        id: 'cat-1',
        calendar_id: 'source-cal-id',
      });
      (mockCategory as any).content = [mockContent];

      sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockCategory]);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('cat-1');
      expect(response.body[0].name).toBe('Music');
    });

    it('should use first content entry name for local actor categories', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);

      const mockActor = CalendarActorEntity.build({
        id: actorId,
        actor_type: 'local',
        calendar_id: 'source-cal-id',
        actor_uri: 'https://local.example.com/calendars/sourcecal',
      });
      sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);

      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_actor_id: actorId,
        calendar_id: calendarId,
      });
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      const mockCategory = EventCategoryEntity.build({
        id: 'cat-no-content',
        calendar_id: 'source-cal-id',
      });
      (mockCategory as any).content = [];

      sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockCategory]);

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(200);
      expect(response.body[0].name).toBe('');
    });
  });

  describe('remote actor branch', () => {
    it('should proxy to stored actor_uri for remote actor', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);

      const mockActor = CalendarActorEntity.build({
        id: actorId,
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: 'https://remote.example.com/calendars/remotecal',
      });
      sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);

      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_actor_id: actorId,
        calendar_id: calendarId,
      });
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      const remoteCategories = [
        { id: 'remote-cat-1', content: { en: { name: 'Art' } } },
        { id: 'remote-cat-2', content: { en: { name: 'Music' } } },
      ];
      const axiosGetStub = sandbox.stub(axios, 'get').resolves({ data: remoteCategories });

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe('remote-cat-1');
      expect(response.body[0].name).toBe('Art');
      expect(response.body[1].id).toBe('remote-cat-2');
      expect(response.body[1].name).toBe('Music');

      // Verify URL is derived from stored actor_uri, not from request input
      expect(axiosGetStub.calledOnce).toBe(true);
      const calledUrl = axiosGetStub.firstCall.args[0];
      expect(calledUrl).toBe('https://remote.example.com/api/public/v1/calendar/remotecal/categories');
    });

    it('should return 502 when remote proxy request fails', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);

      const mockActor = CalendarActorEntity.build({
        id: actorId,
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: 'https://remote.example.com/calendars/remotecal',
      });
      sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);

      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_actor_id: actorId,
        calendar_id: calendarId,
      });
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      sandbox.stub(axios, 'get').rejects(new Error('Connection refused'));

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Could not reach source calendar');
    });

    it('should handle missing content gracefully for remote categories', async () => {
      const mockCalendar = new Calendar(calendarId, 'test-calendar');
      sandbox.stub(calendarInterface, 'getCalendar').resolves(mockCalendar);
      sandbox.stub(calendarInterface, 'userCanModifyCalendar').resolves(true);

      const mockActor = CalendarActorEntity.build({
        id: actorId,
        actor_type: 'remote',
        calendar_id: null,
        actor_uri: 'https://remote.example.com/calendars/remotecal',
      });
      sandbox.stub(CalendarActorEntity, 'findByPk').resolves(mockActor);

      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_actor_id: actorId,
        calendar_id: calendarId,
      });
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      const remoteCategories = [
        { id: 'remote-cat-1' }, // no content field
      ];
      sandbox.stub(axios, 'get').resolves({ data: remoteCategories });

      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = calendarId;
        req.params.actorId = actorId;
        routes.getSourceCategories(req, res);
      });

      const response = await request(testApp(router)).get('/handler');
      expect(response.status).toBe(200);
      expect(response.body[0].name).toBe('');
    });
  });
});
