import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import { EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarInterface from '@/server/calendar/interface';

describe('Delete Event API Tests', () => {
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

  describe('deleteEvent API endpoint', () => {
    it('should fail without account', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      router.delete('/handler/:id', (req, res) => { routes.deleteEvent(req, res); });

      const response = await request(testApp(router))
        .delete('/handler/test-event');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for event deletion. Not logged in?');
      expect(deleteEventStub.called).toBe(false);
    });

    it('should reject malformed UUID with 400 error', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler/not-a-valid-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid UUID format in event ID');
      expect(deleteEventStub.called).toBe(false);
    });

    it('should reject malformed UUID with special characters', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler/123e4567-e89b-12d3-a456-42661417400@invalid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid UUID format in event ID');
      expect(deleteEventStub.called).toBe(false);
    });

    it('should reject UUID with incorrect version', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      // UUID v3 instead of v4 (has '3' in version position)
      const response = await request(testApp(router))
        .delete('/handler/123e4567-e89b-32d3-a456-426614174000');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid UUID format in event ID');
      expect(deleteEventStub.called).toBe(false);
    });

    it('should accept valid UUID v4', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      deleteEventStub.resolves();

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      // Valid UUID v4 with correct format
      const response = await request(testApp(router))
        .delete('/handler/123e4567-e89b-42d3-a456-426614174000');

      expect(response.status).toBe(204);
      expect(deleteEventStub.called).toBe(true);
    });

    it('should fail without event ID', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      router.delete('/handler', addRequestUser, (req, res) => {
        // No event ID in params
        routes.deleteEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing event ID');
      expect(deleteEventStub.called).toBe(false);
    });

    it('should return 404 when event not found', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      const testEventId = '123e4567-e89b-42d3-a456-426614174000';
      deleteEventStub.throws(new EventNotFoundError(`Event with ID ${testEventId} not found`));

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete(`/handler/${testEventId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe(`Event with ID ${testEventId} not found`);
      expect(response.body.errorName).toBe('EventNotFoundError');
      expect(deleteEventStub.called).toBe(true);
    });

    it('should return 403 when user lacks permissions', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      deleteEventStub.throws(new InsufficientCalendarPermissionsError('User does not have permission to delete events in this calendar'));

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const restrictedEventId = '223e4567-e89b-42d3-a456-426614174000';
      const response = await request(testApp(router))
        .delete(`/handler/${restrictedEventId}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('User does not have permission to delete events in this calendar');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
      expect(deleteEventStub.called).toBe(true);
    });

    it('should return 500 for unexpected errors', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      deleteEventStub.throws(new Error('Database connection failed'));

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const errorEventId = '323e4567-e89b-42d3-a456-426614174000';
      const response = await request(testApp(router))
        .delete(`/handler/${errorEventId}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('An error occurred while deleting the event');
      expect(deleteEventStub.called).toBe(true);
    });

    it('should return 204 on successful deletion', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      deleteEventStub.resolves();

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const validEventId = '423e4567-e89b-42d3-a456-426614174000';
      const response = await request(testApp(router))
        .delete(`/handler/${validEventId}`);

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(deleteEventStub.called).toBe(true);
    });

    it('should pass correct parameters to service', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      deleteEventStub.resolves();

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const testEventId = '523e4567-e89b-42d3-a456-426614174000';
      await request(testApp(router))
        .delete(`/handler/${testEventId}`);

      expect(deleteEventStub.called).toBe(true);
      expect(deleteEventStub.firstCall.args[1]).toBe(testEventId); // Event ID
      expect(typeof deleteEventStub.firstCall.args[0]).toBe('object'); // Account object
    });
  });
});
