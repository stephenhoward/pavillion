import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { testApp } from '@/server/common/test/lib/express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '@/server/public/interface';
import CalendarInterface from '@/server/calendar/interface';

describe('Public Events API - Search and Filtering', () => {
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

  describe('GET /calendars/:calendar/events - Text Search', () => {
    it('should filter events by text search in title and description', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'yoga';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({ search: 'yoga' }),
      )).toBe(true);
    });

    it('should handle empty search query', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let instancesStub = apiSandbox.stub(publicInterface, 'listEventInstances');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      instancesStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = '';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(instancesStub.called).toBe(true);
    });
  });

  describe('GET /calendars/:calendar/events - Category Filtering', () => {
    it('should filter events by multiple category IDs with OR logic', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const event2 = new CalendarEvent('event-2', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);
      const instance2 = new CalendarEventInstance('inst-2', event2, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1, instance2]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.categories = ['cat-id-1', 'cat-id-2'];
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({ categories: ['cat-id-1', 'cat-id-2'] }),
      )).toBe(true);
    });
  });

  describe('GET /calendars/:calendar/events - Date Range Filtering', () => {
    it('should filter events by date range (startDate and endDate)', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.startDate = '2025-11-15';
        req.query.endDate = '2025-11-21';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({ startDate: '2025-11-15', endDate: '2025-11-21' }),
      )).toBe(true);
    });

    it('should handle invalid date format gracefully', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      calendarStub.resolves(calendar);
      filterStub.throws(new Error('Invalid date format'));

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.startDate = 'invalid-date';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid date format');
    });
  });

  describe('GET /calendars/:calendar/events - Combined Filters', () => {
    it('should combine search, categories, and date range with AND logic', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      filterStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'yoga';
        req.query.categories = ['cat-id-1', 'cat-id-2'];
        req.query.startDate = '2025-11-15';
        req.query.endDate = '2025-11-21';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(filterStub.calledWith(
        calendar,
        sinon.match({
          search: 'yoga',
          categories: ['cat-id-1', 'cat-id-2'],
          startDate: '2025-11-15',
          endDate: '2025-11-21',
        }),
      )).toBe(true);
    });

    it('should return empty array when no events match filters', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      calendarStub.resolves(calendar);
      filterStub.resolves([]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'nonexistent';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('GET /calendars/:calendar/events - Error Handling', () => {
    it('should return 404 for missing calendar', async () => {
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      calendarStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'nonexistent';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('calendar not found');
    });

    it('should return 500 for service errors', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let filterStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      calendarStub.resolves(calendar);
      filterStub.throws(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.search = 'test';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve events');
    });
  });
});
