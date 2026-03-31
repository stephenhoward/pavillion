import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CategoriesNotFoundError } from '@/common/exceptions/calendar';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarInterface from '@/server/calendar/interface';
import { CalendarEvent } from '@/common/model/events';

describe('Replace Event Categories API Tests', () => {
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

  describe('PUT /events/:id/categories', () => {
    const validEventId = '123e4567-e89b-42d3-a456-426614174000';
    const validCategoryIds = [
      '223e4567-e89b-42d3-a456-426614174000',
      '323e4567-e89b-42d3-a456-426614174000',
    ];

    it('should return 200 with updated event on success', async () => {
      const mockEvent = new CalendarEvent(validEventId, '423e4567-e89b-42d3-a456-426614174000');
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');
      replaceStub.resolves(mockEvent);

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: validCategoryIds });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(validEventId);
      expect(replaceStub.called).toBe(true);
      expect(replaceStub.firstCall.args[1]).toBe(validEventId);
      expect(replaceStub.firstCall.args[2]).toEqual(validCategoryIds);
    });

    it('should return 400 when not authenticated', async () => {
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');

      router.put('/handler/:id/categories', (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: validCategoryIds });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for category replacement. Not logged in?');
      expect(replaceStub.called).toBe(false);
    });

    it('should return 400 for malformed event ID (non-UUID)', async () => {
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler/not-a-valid-uuid/categories')
        .send({ categoryIds: validCategoryIds });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid UUID format in event ID');
      expect(replaceStub.called).toBe(false);
    });

    it('should return 400 when categoryIds is not an array', async () => {
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('categoryIds must be an array');
      expect(replaceStub.called).toBe(false);
    });

    it('should return 404 when service throws EventNotFoundError', async () => {
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');
      replaceStub.throws(new EventNotFoundError(`Event with ID ${validEventId} not found`));

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: validCategoryIds });

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('NotFoundError');
      expect(response.body.error).toBe('Event not found');
      expect(replaceStub.called).toBe(true);
    });

    it('should return 404 when service throws InsufficientCalendarPermissionsError', async () => {
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');
      replaceStub.throws(new InsufficientCalendarPermissionsError('User does not have permission'));

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: validCategoryIds });

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('NotFoundError');
      expect(response.body.error).toBe('Event not found');
      expect(replaceStub.called).toBe(true);
    });

    it('should return 404 when service throws CategoriesNotFoundError', async () => {
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');
      replaceStub.throws(new CategoriesNotFoundError('Categories not found'));

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: validCategoryIds });

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('NotFoundError');
      expect(response.body.error).toBe('Event not found');
      expect(replaceStub.called).toBe(true);
    });

    it('should return identical 404 responses for all not-found error types', async () => {
      const errors = [
        new EventNotFoundError('Event not found'),
        new InsufficientCalendarPermissionsError('No permission'),
        new CategoriesNotFoundError('Categories not found'),
      ];

      for (const error of errors) {
        const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');
        replaceStub.throws(error);

        router.put('/handler/:id/categories', addRequestUser, (req, res) => {
          routes.replaceEventCategories(req, res);
        });

        const response = await request(testApp(router))
          .put(`/handler/${validEventId}/categories`)
          .send({ categoryIds: validCategoryIds });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Event not found');
        expect(response.body.errorName).toBe('NotFoundError');

        sandbox.restore();
        sandbox = sinon.createSandbox();
        calendarInterface = new CalendarInterface(new EventEmitter());
        routes = new EventRoutes(calendarInterface);
        router = express.Router();
      }
    });

    it('should return 500 for unexpected errors', async () => {
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');
      replaceStub.throws(new Error('Database connection failed'));

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: validCategoryIds });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('An error occurred while replacing categories');
      expect(replaceStub.called).toBe(true);
    });

    it('should accept empty categoryIds array', async () => {
      const mockEvent = new CalendarEvent(validEventId, '423e4567-e89b-42d3-a456-426614174000');
      const replaceStub = sandbox.stub(calendarInterface, 'replaceEventCategories');
      replaceStub.resolves(mockEvent);

      router.put('/handler/:id/categories', addRequestUser, (req, res) => {
        routes.replaceEventCategories(req, res);
      });

      const response = await request(testApp(router))
        .put(`/handler/${validEventId}/categories`)
        .send({ categoryIds: [] });

      expect(response.status).toBe(200);
      expect(replaceStub.called).toBe(true);
      expect(replaceStub.firstCall.args[2]).toEqual([]);
    });
  });
});
