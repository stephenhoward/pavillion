/**
 * Tests for schedule and location data in the public API.
 * Covers:
 * - isRecurring flag on list endpoint (via interface stub)
 * - getEventInstanceById detail endpoint exposing schedule and location content
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

  describe('GET /instances/:id - detail endpoint', () => {
    it('should return 404 for non-existent instance', async () => {
      const instanceStub = apiSandbox.stub(publicInterface, 'getEventInstanceById');
      instanceStub.resolves(null);

      router.get('/handler/:id', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler/nonexistent-id');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('instance not found');
    });

    it('should return instance with schedule data when schedules are present', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      const schedule = new CalendarEventSchedule();
      schedule.frequency = EventFrequency.WEEKLY;
      schedule.interval = 1;
      schedule.byDay = ['SA'];
      schedule.isExclusion = false;
      event.schedules = [schedule];

      // Attach recurrenceText as the service would
      (event as any).recurrenceText = 'Every Saturday';
      (event as any).isRecurring = true;

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);
      const instanceStub = apiSandbox.stub(publicInterface, 'getEventInstanceById');
      instanceStub.resolves(instance);

      router.get('/handler/:id', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler/inst-1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('inst-1');
      expect(Array.isArray(response.body.event.schedules)).toBe(true);
      expect(response.body.event.schedules).toHaveLength(1);
      expect(response.body.event.schedules[0].frequency).toBe('weekly');
      expect(response.body.event.recurrenceText).toBe('Every Saturday');
    });

    it('should return instance with location and accessibility info when available', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      const location = new EventLocation('loc-1', 'Community Center', '123 Main St', 'Anytown', 'OR', '97401', 'US');
      const locationContent = new EventLocationContent('en', 'Wheelchair accessible, elevator available.');
      location.addContent(locationContent);
      event.location = location;
      event.locationId = 'loc-1';

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);
      const instanceStub = apiSandbox.stub(publicInterface, 'getEventInstanceById');
      instanceStub.resolves(instance);

      router.get('/handler/:id', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler/inst-1');

      expect(response.status).toBe(200);
      expect(response.body.event.location).toBeDefined();
      expect(response.body.event.location.name).toBe('Community Center');
      // location.toObject() includes content with accessibilityInfo
      expect(response.body.event.location.content).toBeDefined();
      expect(response.body.event.location.content.en).toBeDefined();
      expect(response.body.event.location.content.en.accessibilityInfo).toBe('Wheelchair accessible, elevator available.');
    });

    it('should return instance with empty schedules when event has no recurrence', async () => {
      const event = new CalendarEvent('event-1', 'cal-id');
      event.schedules = [];
      (event as any).recurrenceText = '';

      const instance = new CalendarEventInstance('inst-1', event, DateTime.now(), null);
      const instanceStub = apiSandbox.stub(publicInterface, 'getEventInstanceById');
      instanceStub.resolves(instance);

      router.get('/handler/:id', (req, res) => {
        routes.getEventInstance(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler/inst-1');

      expect(response.status).toBe(200);
      expect(response.body.event.schedules).toEqual([]);
      expect(response.body.event.recurrenceText).toBe('');
    });
  });

  describe('GET /calendar/:calendar/events - isRecurring flag', () => {
    it('should expose isRecurring=true on events returned from list endpoint', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');

      // Simulate the service adding isRecurring to the event
      (event as any).isRecurring = true;

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
      expect(filterStub.calledOnce).toBe(true);
    });

    it('should expose isRecurring=false on non-recurring events', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const event = new CalendarEvent('event-1', 'cal-id');
      (event as any).isRecurring = false;

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
      expect(instancesStub.calledOnce).toBe(true);
    });
  });
});
