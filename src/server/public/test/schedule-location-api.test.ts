/**
 * Tests for recurrence + location projection in the public API.
 *
 * The public API strips schedules[] from every event response and replaces
 * them with two presentation-ready fields:
 *   - isRecurring: boolean
 *   - recurrenceSummary: { key, params } | null
 *
 * It also projects media to { id, mimeType } only and never emits the legacy
 * English-only `recurrenceText` field. These tests pin that shape down for
 * both the list handler (/calendar/:calendar/events) and the detail handler
 * (/instances/:id).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventLocation, EventLocationContent } from '@/common/model/location';
import { testApp } from '@/server/common/test/lib/express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '@/server/public/interface';
import CalendarInterface from '@/server/calendar/interface';

describe('Public API - Schedule + Location data', () => {
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

  describe('GET /events/:eventId/instances/:startTime - detail endpoint', () => {
    // Valid UUID v4 used across detail-route tests.
    const EVENT_UUID = '11111111-1111-4111-8111-111111111111';
    const VALID_SLUG = '20260508-1800';

    it('should return 404 for non-existent instance', async () => {
      const instanceStub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails');
      instanceStub.resolves(null);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('instance not found');
    });

    it('should project recurring schedules into isRecurring + recurrenceSummary and strip schedules[]', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.byDay = ['SA'];
      schedule.isExclusion = false;
      event.schedules = [schedule];

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);
      const instanceStub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails');
      instanceStub.resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('inst-1');
      // schedules[] and recurrenceText must not leak on the public shape
      expect(response.body.event.schedules).toBeUndefined();
      expect(response.body.event.recurrenceText).toBeUndefined();
      // Presentation-ready fields are present instead
      expect(response.body.event.isRecurring).toBe(true);
      expect(response.body.event.recurrenceSummary).toEqual({
        key: 'recurrence.weekly_on_days',
        params: { days: ['SA'] },
      });
    });

    it('should return instance with location and accessibility info when available', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      const location = new EventLocation('loc-1', 'Community Center', '123 Main St', 'Anytown', 'OR', '97401', 'US');
      const locationContent = new EventLocationContent('en', 'Wheelchair accessible, elevator available.');
      location.addContent(locationContent);
      event.location = location;
      event.locationId = 'loc-1';

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);
      const instanceStub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails');
      instanceStub.resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      expect(response.body.event.location).toBeDefined();
      expect(response.body.event.location.name).toBe('Community Center');
      // location.toObject() includes content with accessibilityInfo
      expect(response.body.event.location.content).toBeDefined();
      expect(response.body.event.location.content.en).toBeDefined();
      expect(response.body.event.location.content.en.accessibilityInfo).toBe('Wheelchair accessible, elevator available.');
    });

    it('should expose isRecurring=false and recurrenceSummary=null for non-recurring events', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);
      const instanceStub = apiSandbox.stub(publicInterface, 'findOrMaterializeInstanceWithDetails');
      instanceStub.resolves(instance);

      router.get('/handler/:eventId/:startTime', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get(`/handler/${EVENT_UUID}/${VALID_SLUG}`);

      expect(response.status).toBe(200);
      // schedules[] and recurrenceText must not appear on the public shape
      expect(response.body.event.schedules).toBeUndefined();
      expect(response.body.event.recurrenceText).toBeUndefined();
      expect(response.body.event.isRecurring).toBe(false);
      expect(response.body.event.recurrenceSummary).toBeNull();
    });
  });

  describe('GET /calendar/:calendar/events - isRecurring flag + shape', () => {
    it('derives isRecurring=true + recurrenceSummary and strips schedules[] on list results', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');

      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.byDay = ['MO'];
      schedule.isExclusion = false;
      event.schedules = [schedule];

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');
      calendarStub.resolves(calendar);
      filterStub.resolves([instance]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'test';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].event.isRecurring).toBe(true);
      expect(response.body[0].event.recurrenceSummary).toEqual({
        key: 'recurrence.weekly_on_days',
        params: { days: ['MO'] },
      });
      // Internal fields must not leak
      expect(response.body[0].event.schedules).toBeUndefined();
      expect(response.body[0].event.recurrenceText).toBeUndefined();
      expect(filterStub.calledOnce).toBe(true);
    });

    it('derives isRecurring=false + recurrenceSummary=null on non-recurring events', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const instancesStub = apiSandbox.stub(publicInterface, 'listEventInstances');
      calendarStub.resolves(calendar);
      instancesStub.resolves([instance]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].event.isRecurring).toBe(false);
      expect(response.body[0].event.recurrenceSummary).toBeNull();
      expect(response.body[0].event.schedules).toBeUndefined();
      expect(response.body[0].event.recurrenceText).toBeUndefined();
      expect(instancesStub.calledOnce).toBe(true);
    });
  });
});
