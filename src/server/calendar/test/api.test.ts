import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { CalendarEditor } from '@/common/model/calendar_editor';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { noAccountExistsError } from '@/server/accounts/exceptions';
import { testApp, countRoutes, addRequestUser } from '@/server/common/test/lib/express';
import CalendarAPI from '@/server/calendar/api/v1';
import EventRoutes from '@/server/calendar/api/v1/events';
import EditorRoutes from '@/server/calendar/api/v1/editors';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';

describe('API v1', () => {

  it('should load routes properly', () => {
    let app = express();
    let calendarInterface = new CalendarInterface(new EventEmitter());
    expect(countRoutes(app)).toBe(0);
    CalendarAPI.install(app, calendarInterface);
    expect(countRoutes(app)).toBeGreaterThan(0);
  });
});

describe('Event API', () => {
  let routes: EventRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let eventSandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new EventRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    eventSandbox.restore();
  });

  it('listEvents: should fail without calendar', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'listEvents');
    router.get('/handler', addRequestUser, (req, res) => { routes.listEvents(req,res); });
    eventStub.resolves([]);

    const response = await request(testApp(router))
      .get('/handler');

    expect(response.status).toBe(400);
    expect(eventStub.called).toBe(false);
  });

  it('listEvents: should succeed', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'listEvents');
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');
    calendarStub.resolves(new Calendar('id', 'test'));
    router.get('/handler', addRequestUser, (req, res) => {
      req.params.calendar = 'test';
      routes.listEvents(req,res);
    });
    eventStub.resolves([]);

    const response = await request(testApp(router))
      .get('/handler');

    expect(response.status).toBe(200);
    expect(eventStub.called).toBe(true);
  });

  it('createEvent: should fail without account', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    router.post('/handler', (req,res) => { routes.createEvent(req,res); });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should fail without calendar name', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    router.post('/handler', addRequestUser, (req,res) => { routes.createEvent(req,res); });
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(calendarStub.called).toBe(false);
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should fail without calendar', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    router.post('/handler', addRequestUser, (req,res) => {
      req.params.calendar = 'nonexistent';
      routes.createEvent(req,res);
    });
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');
    calendarStub.resolves(null);

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('createEvent: should succeed', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');

    const calendar = new Calendar('id', 'testme');
    calendarStub.resolves(calendar);

    router.post('/handler', addRequestUser, (req,res) => {
      req.params.calendar = 'testme';
      routes.createEvent(req,res);
    });
    eventStub.resolves(new CalendarEvent('id', 'testme'));

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(eventStub.called).toBe(true);
  });

  it('createEvent: should fail without edit permissions', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'createEvent');
    let calendarStub = eventSandbox.stub(calendarInterface, 'getCalendarByName');

    const calendar = new Calendar('id', 'testme');
    calendarStub.resolves(calendar);
    eventStub.throws(new InsufficientCalendarPermissionsError('Insufficient permissions to create events in this calendar'));

    router.post('/handler', addRequestUser, (req,res) => {
      req.params.calendar = 'testme';
      routes.createEvent(req,res);
    });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Insufficient permissions to create events in this calendar");
    expect(response.body.errorName).toBe("InsufficientCalendarPermissionsError");
    expect(eventStub.called).toBe(true);
  });

  it('updateEvent: should fail without account', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');
    router.post('/handler', (req,res) => { routes.updateEvent(req,res); });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(eventStub.called).toBe(false);
  });

  it('updateEvent: should fail without event ID', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');
    router.post('/handler', addRequestUser, (req,res) => {
      // No event ID in params
      routes.updateEvent(req,res);
    });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("missing event ID");
    expect(eventStub.called).toBe(false);
  });

  it('updateEvent: should fail when event not found', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');

    eventStub.throws(new EventNotFoundError('Event not found'));

    router.post('/handler', addRequestUser, (req,res) => {
      req.params.id = 'nonexistent-event';
      routes.updateEvent(req,res);
    });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Event not found");
    expect(response.body.errorName).toBe("EventNotFoundError");
    expect(eventStub.called).toBe(true);
  });

  it('updateEvent: should fail when calendar for event not found', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');

    eventStub.throws(new CalendarNotFoundError('Calendar for event does not exist'));

    router.post('/handler', addRequestUser, (req,res) => {
      req.params.id = 'event-id';
      routes.updateEvent(req,res);
    });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Calendar for event does not exist");
    expect(response.body.errorName).toBe("CalendarNotFoundError");
    expect(eventStub.called).toBe(true);
  });

  it('updateEvent: should fail without edit permissions', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');

    eventStub.throws(new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar'));

    router.post('/handler', addRequestUser, (req,res) => {
      req.params.id = 'event-id';
      routes.updateEvent(req,res);
    });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Insufficient permissions to modify events in this calendar");
    expect(response.body.errorName).toBe("InsufficientCalendarPermissionsError");
    expect(eventStub.called).toBe(true);
  });

  it('updateEvent: should succeed', async () => {
    let eventStub = eventSandbox.stub(calendarInterface, 'updateEvent');

    const updatedEvent = new CalendarEvent('event-id', 'calendar-id');
    eventStub.resolves(updatedEvent);

    router.post('/handler', addRequestUser, (req,res) => {
      req.params.id = 'event-id';
      routes.updateEvent(req,res);
    });

    const response = await request(testApp(router))
      .post('/handler');

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(eventStub.called).toBe(true);
  });
});

describe('Editor API', () => {
  let routes: EditorRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let editorSandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    accountsInterface = new AccountsInterface(new EventEmitter(), {} as any);
    routes = new EditorRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    editorSandbox.restore();
  });

  describe('listEditors', () => {
    it('should fail without authentication', async () => {
      let editorStub = editorSandbox.stub(calendarInterface, 'getCalendarEditors');
      router.get('/handler', (req, res) => { routes.listEditors(req, res); });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
      expect(editorStub.called).toBe(false);
    });

    it('should fail with calendar not found', async () => {
      let canViewStub = editorSandbox.stub(calendarInterface, 'canViewCalendarEditors');
      let editorStub = editorSandbox.stub(calendarInterface, 'getCalendarEditors');
      canViewStub.rejects(new CalendarNotFoundError('Calendar not found'));
      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'nonexistent';
        routes.listEditors(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(editorStub.called).toBe(false);
    });

    it('should fail without modify permission', async () => {
      let calendarStub = editorSandbox.stub(calendarInterface, 'getCalendar');
      let canViewStub = editorSandbox.stub(calendarInterface, 'canViewCalendarEditors');
      let editorStub = editorSandbox.stub(calendarInterface, 'getCalendarEditors');
      calendarStub.resolves(new Calendar('cal-id', 'test'));
      canViewStub.resolves(false);
      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        routes.listEditors(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied: only calendar owner can view editors');
      expect(editorStub.called).toBe(false);
    });

    it('should succeed and return editors list', async () => {
      let calendarStub = editorSandbox.stub(calendarInterface, 'getCalendar');
      let canViewStub = editorSandbox.stub(calendarInterface, 'canViewCalendarEditors');
      let editorStub = editorSandbox.stub(calendarInterface, 'getCalendarEditors');
      const calendar = new Calendar('cal-id', 'test');
      const editor = new CalendarEditor('editor-id', 'cal-id', 'user-id');
      calendarStub.resolves(calendar);
      canViewStub.resolves(true);
      editorStub.resolves([editor]);
      router.get('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        routes.listEditors(req, res);
      });

      const response = await request(testApp(router))
        .get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([editor.toObject()]);
      expect(editorStub.called).toBe(true);
    });
  });

  describe('grantEditAccess', () => {
    it('should fail without authentication', async () => {
      let grantStub = editorSandbox.stub(calendarInterface, 'grantEditAccess');
      router.post('/handler', (req, res) => { routes.grantEditAccess(req, res); });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ accountId: 'user-id' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
      expect(grantStub.called).toBe(false);
    });

    it('should fail without accountId', async () => {
      let grantStub = editorSandbox.stub(calendarInterface, 'grantEditAccess');
      let accountStub = editorSandbox.stub(accountsInterface, 'getAccountById');
      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        routes.grantEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing accountId in request body');
      expect(grantStub.called).toBe(false);
      expect(accountStub.called).toBe(false);
    });

    it('should fail with calendar not found', async () => {
      let grantStub = editorSandbox.stub(calendarInterface, 'grantEditAccess');
      grantStub.rejects(new CalendarNotFoundError('Calendar not found'));
      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'nonexistent';
        routes.grantEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ accountId: 'user-id' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
    });

    it('should fail with account not found', async () => {
      let grantStub = editorSandbox.stub(calendarInterface, 'grantEditAccess');
      grantStub.rejects(new noAccountExistsError());
      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        routes.grantEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ accountId: 'nonexistent-user' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Account does not exist');
    });

    it('should fail with permission denied error', async () => {
      let grantStub = editorSandbox.stub(calendarInterface, 'grantEditAccess');
      grantStub.rejects(new CalendarEditorPermissionError('Permission denied: cannot grant edit access'));
      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        routes.grantEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ accountId: 'user-id' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied: cannot grant edit access');
    });

    it('should fail with editor already exists error', async () => {
      let grantStub = editorSandbox.stub(calendarInterface, 'grantEditAccess');
      grantStub.rejects(new EditorAlreadyExistsError('Editor relationship already exists'));
      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        routes.grantEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ accountId: 'user-id' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Editor relationship already exists');
    });

    it('should succeed and return editor relationship', async () => {
      let grantStub = editorSandbox.stub(calendarInterface, 'grantEditAccess');
      const editor = new CalendarEditor('editor-id', 'cal-id', 'user-id');
      grantStub.resolves(editor);
      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        routes.grantEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ accountId: 'user-id' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(editor.toObject());
    });
  });

  describe('revokeEditAccess', () => {
    it('should fail without authentication', async () => {
      let revokeStub = editorSandbox.stub(calendarInterface, 'revokeEditAccess');
      router.delete('/handler', (req, res) => { routes.revokeEditAccess(req, res); });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
      expect(revokeStub.called).toBe(false);
    });

    it('should fail with calendar not found', async () => {
      let revokeStub = editorSandbox.stub(calendarInterface, 'revokeEditAccess');
      revokeStub.rejects(new CalendarNotFoundError('Calendar not found'));
      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'nonexistent';
        req.params.accountId = 'user-id';
        routes.revokeEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
    });

    it('should fail with account not found', async () => {
      let revokeStub = editorSandbox.stub(calendarInterface, 'revokeEditAccess');
      revokeStub.rejects(new noAccountExistsError());
      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        req.params.accountId = 'nonexistent-user';
        routes.revokeEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Account does not exist');
    });

    it('should fail with permission denied error', async () => {
      let revokeStub = editorSandbox.stub(calendarInterface, 'revokeEditAccess');
      revokeStub.rejects(new CalendarEditorPermissionError('Permission denied: cannot revoke edit access'));
      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        req.params.accountId = 'user-id';
        routes.revokeEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied: cannot revoke edit access');
      expect(revokeStub.called).toBe(true);
    });

    it('should succeed and return 204 when editor was revoked', async () => {
      let revokeStub = editorSandbox.stub(calendarInterface, 'revokeEditAccess');
      revokeStub.resolves(true);
      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        req.params.accountId = 'user-id';
        routes.revokeEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(204);
      expect(revokeStub.called).toBe(true);
    });

    it('should return 404 when editor relationship not found', async () => {
      let revokeStub = editorSandbox.stub(calendarInterface, 'revokeEditAccess');
      revokeStub.rejects(new EditorNotFoundError('Editor relationship not found'));
      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'cal-id';
        req.params.accountId = 'user-id';
        routes.revokeEditAccess(req, res);
      });

      const response = await request(testApp(router))
        .delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Editor relationship not found');
      expect(revokeStub.called).toBe(true);
    });
  });
});
