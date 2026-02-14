import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { CalendarMember } from '@/common/model/calendar_member';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import EditorPermissionRoutes from '@/server/calendar/api/v1/editor-permissions';
import CalendarInterface from '@/server/calendar/interface';
import { CalendarEditorPermissionError, EditorNotFoundError } from '@/common/exceptions/editor';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';

describe('Editor Permissions API - PUT /calendars/:calendarId/editors/:editorId/permissions', () => {
  let routes: EditorPermissionRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new EditorPermissionRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('successful permission update', () => {
    it('should return 200 with updated member when owner updates canReviewReports to true', async () => {
      const updatedMember = new CalendarMember(
        'member-id-1',
        'calendar-id-1',
        null,
        'editor',
        'editor-account-id',
        null,
        'owner-account-id',
        true,
      );

      const updateStub = sandbox.stub(calendarInterface, 'updateEditorPermissions').resolves(updatedMember);

      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-account-id/permissions')
        .send({ canReviewReports: true });

      expect(response.status).toBe(200);
      expect(response.body.canReviewReports).toBe(true);
      expect(response.body.id).toBe('member-id-1');
      expect(response.body.role).toBe('editor');
      expect(updateStub.calledOnce).toBe(true);

      const callArgs = updateStub.firstCall.args;
      expect(callArgs[1]).toBe('calendar-id-1');
      expect(callArgs[2]).toBe('editor-account-id');
      expect(callArgs[3]).toEqual({ canReviewReports: true });
    });

    it('should return 200 with updated member when owner updates canReviewReports to false', async () => {
      const updatedMember = new CalendarMember(
        'member-id-1',
        'calendar-id-1',
        null,
        'editor',
        'editor-account-id',
        null,
        'owner-account-id',
        false,
      );

      sandbox.stub(calendarInterface, 'updateEditorPermissions').resolves(updatedMember);

      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-account-id/permissions')
        .send({ canReviewReports: false });

      expect(response.status).toBe(200);
      expect(response.body.canReviewReports).toBe(false);
    });
  });

  describe('unauthenticated requests - 401', () => {
    it('should return 401 when no user is present', async () => {
      router.put('/calendars/:calendarId/editors/:editorId/permissions', (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-id/permissions')
        .send({ canReviewReports: true });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('authorization - 403', () => {
    it('should return 403 when non-owner tries to update permissions', async () => {
      sandbox.stub(calendarInterface, 'updateEditorPermissions').rejects(
        new CalendarEditorPermissionError('Permission denied: only calendar owner can update editor permissions'),
      );

      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-id/permissions')
        .send({ canReviewReports: true });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('not found - 404', () => {
    it('should return 404 when calendar does not exist', async () => {
      sandbox.stub(calendarInterface, 'updateEditorPermissions').rejects(
        new CalendarNotFoundError(),
      );

      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/nonexistent-calendar/editors/editor-id/permissions')
        .send({ canReviewReports: true });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('should return 404 when editor does not exist', async () => {
      sandbox.stub(calendarInterface, 'updateEditorPermissions').rejects(
        new EditorNotFoundError(),
      );

      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/nonexistent-editor/permissions')
        .send({ canReviewReports: true });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('request validation - 400 errors', () => {
    it('should return 400 when canReviewReports is missing from body', async () => {
      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-id/permissions')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('canReviewReports');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when canReviewReports is not a boolean (string)', async () => {
      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-id/permissions')
        .send({ canReviewReports: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('canReviewReports');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when canReviewReports is not a boolean (number)', async () => {
      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-id/permissions')
        .send({ canReviewReports: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('canReviewReports');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when canReviewReports is null', async () => {
      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-id/permissions')
        .send({ canReviewReports: null });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('canReviewReports');
      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  describe('server error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      sandbox.stub(calendarInterface, 'updateEditorPermissions').rejects(
        new Error('Database connection failed'),
      );

      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      const response = await request(testApp(router))
        .put('/calendars/calendar-id-1/editors/editor-id/permissions')
        .send({ canReviewReports: true });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('route installation', () => {
    it('should install the permissions route handler', () => {
      const app = express();
      routes.installHandlers(app, '/api/v1');

      let routeCount = 0;
      if (app._router && app._router.stack) {
        app._router.stack.forEach((middleware: any) => {
          if (middleware.name === 'router') {
            middleware.handle.stack.forEach((handler: any) => {
              if (handler.route) {
                routeCount++;
              }
            });
          }
        });
      }
      expect(routeCount).toBeGreaterThan(0);
    });
  });

  describe('persistence verification', () => {
    it('should pass the correct permissions object to the service', async () => {
      const updatedMember = new CalendarMember(
        'member-id-1',
        'calendar-id-1',
        null,
        'editor',
        'editor-account-id',
        null,
        'owner-account-id',
        true,
      );

      const updateStub = sandbox.stub(calendarInterface, 'updateEditorPermissions').resolves(updatedMember);

      router.put('/calendars/:calendarId/editors/:editorId/permissions', addRequestUser, (req, res) => {
        routes.updatePermissions(req, res);
      });

      await request(testApp(router))
        .put('/calendars/cal-123/editors/editor-456/permissions')
        .send({ canReviewReports: true });

      expect(updateStub.calledOnce).toBe(true);
      const [account, calendarId, editorId, permissions] = updateStub.firstCall.args;
      expect(account).toBeDefined();
      expect(calendarId).toBe('cal-123');
      expect(editorId).toBe('editor-456');
      expect(permissions).toEqual({ canReviewReports: true });
    });
  });
});
