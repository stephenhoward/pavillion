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
      deleteEventStub.throws(new EventNotFoundError('Event with ID test-event not found'));

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler/test-event');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Event with ID test-event not found');
      expect(response.body.errorName).toBe('EventNotFoundError');
      expect(deleteEventStub.called).toBe(true);
    });

    it('should return 403 when user lacks permissions', async () => {
      const deleteEventStub = sandbox.stub(calendarInterface, 'deleteEvent');
      deleteEventStub.throws(new InsufficientCalendarPermissionsError('User does not have permission to delete events in this calendar'));

      router.delete('/handler/:id', addRequestUser, (req, res) => {
        routes.deleteEvent(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler/restricted-event');

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

      const response = await request(testApp(router))
        .delete('/handler/db-error-event');

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

      const response = await request(testApp(router))
        .delete('/handler/valid-event');

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

      await request(testApp(router))
        .delete('/handler/test-event-id');

      expect(deleteEventStub.called).toBe(true);
      expect(deleteEventStub.firstCall.args[1]).toBe('test-event-id'); // Event ID
      expect(typeof deleteEventStub.firstCall.args[0]).toBe('object'); // Account object
    });
  });
});
