import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { testApp, countRoutes } from '@/server/common/test/lib/express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '@/server/public/interface';
import CalendarInterface from '@/server/calendar/interface';

describe('Public API v1', () => {
  it('should load routes properly', () => {
    let app = express();
    let calendarInterface = new CalendarInterface(new EventEmitter());
    let publicInterface = new PublicCalendarInterface(new EventEmitter(), calendarInterface);
    expect(countRoutes(app)).toBe(0);

    let routes = new CalendarRoutes(publicInterface);
    routes.installHandlers(app, '/api/public/v1');
    expect(countRoutes(app)).toBeGreaterThan(0);
  });
});

describe('Public Calendar API', () => {
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

  describe('GET /calendars/:urlName/categories', () => {
    it('should return 404 for non-existent calendar', async () => {
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      calendarStub.resolves(null);
      router.get('/handler', (req, res) => {
        req.params.urlName = 'nonexistent';
        routes.listCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('calendar not found');
      expect(calendarStub.called).toBe(true);
    });

    it('should return categories array for existing calendar', async () => {
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let categoriesStub = apiSandbox.stub(publicInterface, 'listCategoriesForCalendar');

      const calendar = new Calendar('cal-id', 'test-calendar');
      const category1 = new EventCategory('cat-1', 'cal-id');
      const category2 = new EventCategory('cat-2', 'cal-id');

      calendarStub.resolves(calendar);
      categoriesStub.resolves([
        { category: category1, eventCount: 5 },
        { category: category2, eventCount: 3 },
      ]);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        routes.listCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].eventCount).toBe(5);
      expect(response.body[1].eventCount).toBe(3);
      expect(calendarStub.called).toBe(true);
      expect(categoriesStub.called).toBe(true);
    });

    it('should return empty array for calendar with no categories', async () => {
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let categoriesStub = apiSandbox.stub(publicInterface, 'listCategoriesForCalendar');

      const calendar = new Calendar('cal-id', 'test-calendar');
      calendarStub.resolves(calendar);
      categoriesStub.resolves([]);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        routes.listCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(calendarStub.called).toBe(true);
      expect(categoriesStub.called).toBe(true);
    });
  });

  describe('GET /calendars/:calendar/events with category filtering', () => {
    it('should filter events by single category', async () => {
      // Setup stubs for this specific test
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let instancesStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      instancesStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.category = 'category-1';
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      if (response.status !== 200) {
        console.log('Response body:', response.body);
      }
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(instancesStub.calledWith(
        calendar,
        sinon.match({ categories: ['category-1'] }),
      )).toBe(true);
    });

    it('should filter events by multiple categories', async () => {
      // Setup stubs for this specific test
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let instancesStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const event2 = new CalendarEvent('event-2', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);
      const instance2 = new CalendarEventInstance('inst-2', event2, DateTime.now(), null);

      calendarStub.resolves(calendar);
      instancesStub.resolves([instance1, instance2]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.category = ['category-1', 'category-3', 'category-5'];
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(instancesStub.calledWith(
        calendar,
        sinon.match({ categories: ['category-1', 'category-3', 'category-5'] }),
      )).toBe(true);
    });

    it('should return 400 for invalid category names', async () => {
      // Setup stubs for this specific test
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let instancesStub = apiSandbox.stub(publicInterface, 'listEventInstancesWithFilters');

      calendarStub.resolves(calendar);
      instancesStub.throws(new Error('Invalid category IDs provided'));

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        req.query.category = ['invalid-category', 'non-existent'];
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid category IDs provided');
    });

    it('should work without category filtering (existing functionality)', async () => {
      // Setup stubs for this specific test
      const calendar = new Calendar('cal-id', 'test-calendar');
      let calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      let instancesStub = apiSandbox.stub(publicInterface, 'listEventInstances');

      const event1 = new CalendarEvent('event-1', 'cal-id');
      const instance1 = new CalendarEventInstance('inst-1', event1, DateTime.now(), null);

      calendarStub.resolves(calendar);
      instancesStub.resolves([instance1]);

      router.get('/handler', (req, res) => {
        req.params.calendar = 'test-calendar';
        // No categories query parameter
        routes.listInstances(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(instancesStub.called).toBe(true);
    });
  });
});
