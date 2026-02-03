import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { EventCategory } from '@/common/model/event_category';
import { Calendar } from '@/common/model/calendar';
import {
  CategoryNotFoundError,
  CategoryAlreadyAssignedError,
  CategoryEventCalendarMismatchError,
} from '@/common/exceptions/category';
import {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
} from '@/common/exceptions/calendar';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import CategoryRoutes from '@/server/calendar/api/v1/categories';
import CalendarInterface from '@/server/calendar/interface';

// Import entities to register with Sequelize before CalendarInterface initialization
import db from '@/server/common/entity/db';
import '@/server/common/entity/account';
import '@/server/calendar/entity/calendar';
import '@/server/calendar/entity/calendar_member';
import '@/server/calendar/entity/event_category';
import '@/server/calendar/entity/event_category_content';
import '@/server/calendar/entity/event';
import '@/server/calendar/entity/event_category_assignment';
import '@/server/calendar/entity/event_instance';
import '@/server/calendar/entity/location';
import '@/server/activitypub/entity/activitypub';
import '@/server/media/entity/media';
import '@/server/configuration/entity/settings';

describe('Category API', () => {
  let routes: CategoryRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let categorySandbox: sinon.SinonSandbox = sinon.createSandbox();

  // Sync database schema before any tests run (required for CalendarInterface to work)
  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new CategoryRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    categorySandbox.restore();
  });

  describe('GET /calendars/:calendarId/categories', () => {
    it('should return categories for valid calendar', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockCategory = new EventCategory('cat-id', 'calendar-id');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let calendarStub = categorySandbox.stub(calendarInterface, 'getCalendarByName');
      let categoriesStub = categorySandbox.stub(calendarInterface, 'getCategories');
      let categoryStatsStub = categorySandbox.stub(calendarInterface, 'getCategoryStats');

      getCalendarStub.resolves(mockCalendar);
      calendarStub.resolves(mockCalendar);
      categoriesStub.resolves([mockCategory]);
      categoryStatsStub.resolves(new Map([['cat-id', 5]]));

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'test-calendar';
        routes.getCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(getCalendarStub.called).toBe(true);
      expect(categoriesStub.called).toBe(true);
    });

    it('should return 404 when calendar not found', async () => {
      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let calendarStub = categorySandbox.stub(calendarInterface, 'getCalendarByName');

      getCalendarStub.resolves(null);
      calendarStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'nonexistent';
        routes.getCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('calendar not found');
    });

    it('should handle server errors gracefully', async () => {
      let calendarStub = categorySandbox.stub(calendarInterface, 'getCalendarByName');
      calendarStub.rejects(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'test-calendar';
        routes.getCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('POST /calendars/:calendarId/categories', () => {
    it('should fail without authentication', async () => {
      router.post('/handler', (req, res) => { routes.createCategory(req, res); });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ content: { en: { name: 'Test Category' } } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for category creation. Not logged in?');
    });

    it('should create category successfully', async () => {
      const mockCategory = new EventCategory('cat-id', 'calendar-id');
      let createStub = categorySandbox.stub(calendarInterface, 'createCategory');
      createStub.resolves(mockCategory);

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.createCategory(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ content: { en: { name: 'Test Category' } } });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('cat-id');
      expect(createStub.called).toBe(true);
    });

    it('should fail with calendar not found', async () => {
      let createStub = categorySandbox.stub(calendarInterface, 'createCategory');
      createStub.rejects(new CalendarNotFoundError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'nonexistent';
        routes.createCategory(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ content: { en: { name: 'Test Category' } } });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should fail without edit permissions', async () => {
      let createStub = categorySandbox.stub(calendarInterface, 'createCategory');
      createStub.rejects(new InsufficientCalendarPermissionsError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.createCategory(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ content: { en: { name: 'Test Category' } } });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('GET /calendars/:calendarId/categories/:categoryId', () => {
    it('should return category when found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockCategory = new EventCategory('cat-id', 'calendar-id');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let getCategoryStub = categorySandbox.stub(calendarInterface, 'getCategory');

      getCalendarStub.resolves(mockCalendar);
      getCategoryStub.resolves(mockCategory);

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.getCategory(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('cat-id');
      expect(getCategoryStub.called).toBe(true);
    });

    it('should return 404 when category not found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let getCategoryStub = categorySandbox.stub(calendarInterface, 'getCategory');

      getCalendarStub.resolves(mockCalendar);
      getCategoryStub.rejects(new CategoryNotFoundError());

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'nonexistent';
        routes.getCategory(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Category not found');
    });

    it('should return 404 when category belongs to different calendar', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let getCategoryStub = categorySandbox.stub(calendarInterface, 'getCategory');

      getCalendarStub.resolves(mockCalendar);
      getCategoryStub.rejects(new CategoryNotFoundError());

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.getCategory(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Category not found');
    });
  });

  describe('PUT /calendars/:calendarId/categories/:categoryId', () => {
    it('should fail without authentication', async () => {
      router.put('/handler', (req, res) => { routes.updateCategory(req, res); });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for category update. Not logged in?');
    });

    it('should update category successfully', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockCategory = new EventCategory('cat-id', 'calendar-id');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let updateStub = categorySandbox.stub(calendarInterface, 'updateCategory');

      getCalendarStub.resolves(mockCalendar);
      updateStub.resolves(mockCategory);

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.updateCategory(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('cat-id');
      expect(updateStub.called).toBe(true);
    });

    it('should fail when category not found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let updateStub = categorySandbox.stub(calendarInterface, 'updateCategory');

      getCalendarStub.resolves(mockCalendar);
      updateStub.rejects(new CategoryNotFoundError());

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'nonexistent';
        routes.updateCategory(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Category not found');
      expect(response.body.errorName).toBe('CategoryNotFoundError');
    });

    it('should fail without edit permissions', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let updateStub = categorySandbox.stub(calendarInterface, 'updateCategory');

      getCalendarStub.resolves(mockCalendar);
      updateStub.rejects(new InsufficientCalendarPermissionsError());

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.updateCategory(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 404 when category belongs to different calendar', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let updateStub = categorySandbox.stub(calendarInterface, 'updateCategory');

      getCalendarStub.resolves(mockCalendar);
      updateStub.rejects(new CategoryNotFoundError());

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.updateCategory(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Category not found');
    });
  });

  describe('DELETE /calendars/:calendarId/categories/:categoryId', () => {
    it('should fail without authentication', async () => {
      router.delete('/handler', (req, res) => { routes.deleteCategory(req, res); });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for category deletion. Not logged in?');
    });

    it('should delete category successfully', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockCategory = new EventCategory('cat-id', 'calendar-id');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let getCategoryStub = categorySandbox.stub(calendarInterface, 'getCategory');
      let deleteStub = categorySandbox.stub(calendarInterface, 'deleteCategory');

      getCalendarStub.resolves(mockCalendar);
      getCategoryStub.resolves(mockCategory);
      deleteStub.resolves(5);

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.deleteCategory(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(200);
      expect(response.body.affectedEventCount).toBe(5);
      expect(deleteStub.called).toBe(true);
    });

    it('should return 404 when category not found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let deleteStub = categorySandbox.stub(calendarInterface, 'deleteCategory');

      getCalendarStub.resolves(mockCalendar);
      deleteStub.rejects(new CategoryNotFoundError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'nonexistent';
        routes.deleteCategory(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Category not found');
    });

    it('should return 404 when category belongs to different calendar', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let deleteStub = categorySandbox.stub(calendarInterface, 'deleteCategory');

      getCalendarStub.resolves(mockCalendar);
      deleteStub.rejects(new CategoryNotFoundError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.deleteCategory(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Category not found');
    });

    it('should fail without edit permissions', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockCategory = new EventCategory('cat-id', 'calendar-id');

      let getCalendarStub = categorySandbox.stub(calendarInterface, 'getCalendar');
      let getCategoryStub = categorySandbox.stub(calendarInterface, 'getCategory');
      let deleteStub = categorySandbox.stub(calendarInterface, 'deleteCategory');

      getCalendarStub.resolves(mockCalendar);
      getCategoryStub.resolves(mockCategory);
      deleteStub.rejects(new InsufficientCalendarPermissionsError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.categoryId = 'cat-id';
        routes.deleteCategory(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('GET /events/:eventId/categories', () => {
    it('should return categories for event', async () => {
      const mockCategory = new EventCategory('cat-id', 'calendar-id');
      let getEventCategoriesStub = categorySandbox.stub(calendarInterface, 'getEventCategories');
      getEventCategoriesStub.resolves([mockCategory]);

      router.get('/handler', (req, res) => {
        req.params.eventId = 'event-id';
        routes.getEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(getEventCategoriesStub.called).toBe(true);
    });

    it('should handle server errors gracefully', async () => {
      let getEventCategoriesStub = categorySandbox.stub(calendarInterface, 'getEventCategories');
      getEventCategoriesStub.rejects(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.eventId = 'event-id';
        routes.getEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('POST /events/:eventId/categories/:categoryId', () => {
    it('should fail without authentication', async () => {
      router.post('/handler', (req, res) => { routes.assignCategoryToEvent(req, res); });

      const response = await request(testApp(router))
        .post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for category assignment. Not logged in?');
    });

    it('should assign category successfully', async () => {
      const mockAssignment = { id: 'assignment-id', eventId: 'event-id', categoryId: 'cat-id', toObject: () => ({ id: 'assignment-id' }) };
      let assignStub = categorySandbox.stub(calendarInterface, 'assignCategoryToEvent');
      assignStub.resolves(mockAssignment as any);

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.categoryId = 'cat-id';
        routes.assignCategoryToEvent(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler');

      expect(response.status).toBe(201);
      expect(assignStub.called).toBe(true);
    });

    it('should fail when category already assigned', async () => {
      let assignStub = categorySandbox.stub(calendarInterface, 'assignCategoryToEvent');
      assignStub.rejects(new CategoryAlreadyAssignedError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.categoryId = 'cat-id';
        routes.assignCategoryToEvent(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler');

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Category is already assigned to this event');
      expect(response.body.errorName).toBe('CategoryAlreadyAssignedError');
    });

    it('should fail when event and category calendars mismatch', async () => {
      let assignStub = categorySandbox.stub(calendarInterface, 'assignCategoryToEvent');
      assignStub.rejects(new CategoryEventCalendarMismatchError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.categoryId = 'cat-id';
        routes.assignCategoryToEvent(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Event and category must belong to the same calendar');
      expect(response.body.errorName).toBe('CategoryEventCalendarMismatchError');
    });
  });

  describe('POST /events/:eventId/categories (bulk assign)', () => {
    it('should fail without authentication', async () => {
      router.post('/handler', (req, res) => { routes.setCategoriesForEvent(req, res); });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ categoryIds: ['cat-1', 'cat-2'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for category assignment. Not logged in?');
    });

    it('should assign multiple categories successfully', async () => {
      const mockEvent = {
        id: 'event-id',
        categories: [
          new EventCategory('cat-1', 'calendar-id'),
          new EventCategory('cat-2', 'calendar-id'),
        ],
        toObject: () => ({ id: 'event-id', categoryIds: ['cat-1', 'cat-2'] }),
      };

      let setCategoriesStub = categorySandbox.stub(calendarInterface, 'setCategoriesForEvent');
      setCategoriesStub.resolves(mockEvent as any);

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        routes.setCategoriesForEvent(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ categoryIds: ['cat-1', 'cat-2'] });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('event-id');
      expect(setCategoriesStub.called).toBe(true);
    });

    it('should handle empty category array (clear all categories)', async () => {
      const mockEvent = {
        id: 'event-id',
        categories: [],
        toObject: () => ({ id: 'event-id', categoryIds: [] }),
      };

      let setCategoriesStub = categorySandbox.stub(calendarInterface, 'setCategoriesForEvent');
      setCategoriesStub.resolves(mockEvent as any);

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        routes.setCategoriesForEvent(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ categoryIds: [] });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('event-id');
      expect(setCategoriesStub.called).toBe(true);
    });

    it('should fail without edit permissions', async () => {
      let setCategoriesStub = categorySandbox.stub(calendarInterface, 'setCategoriesForEvent');
      setCategoriesStub.rejects(new InsufficientCalendarPermissionsError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        routes.setCategoriesForEvent(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ categoryIds: ['cat-1'] });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('DELETE /events/:eventId/categories/:categoryId', () => {
    it('should fail without authentication', async () => {
      router.delete('/handler', (req, res) => { routes.unassignCategoryFromEvent(req, res); });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for category unassignment. Not logged in?');
    });

    it('should unassign category successfully', async () => {
      let unassignStub = categorySandbox.stub(calendarInterface, 'unassignCategoryFromEvent');
      unassignStub.resolves();

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.categoryId = 'cat-id';
        routes.unassignCategoryFromEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(204);
      expect(unassignStub.called).toBe(true);
    });

    it('should fail without edit permissions', async () => {
      let unassignStub = categorySandbox.stub(calendarInterface, 'unassignCategoryFromEvent');
      unassignStub.rejects(new InsufficientCalendarPermissionsError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.categoryId = 'cat-id';
        routes.unassignCategoryFromEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });
});
