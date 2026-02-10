import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import AdminSettingsRoutes from '@/server/moderation/api/v1/admin-settings-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Moderation settings admin API tests.
 *
 * Verifies GET and PUT /admin/moderation/settings endpoints
 * including authorization, validation, and default values.
 */
describe('Admin Moderation Settings API', () => {
  let routes: AdminSettingsRoutes;
  let moderationInterface: ModerationInterface;
  let configurationInterface: ConfigurationInterface;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  /**
   * Creates a test Express app with admin auth stubbed.
   */
  function createAppWithAuth(isAdmin: boolean = true) {
    const testApp = express();
    testApp.use(express.json());

    testApp.use((req, _res, next) => {
      const account = new Account('admin-id', 'admin', 'admin@test.com');
      if (isAdmin) {
        account.roles = ['admin'];
      }
      (req as any).user = account;
      next();
    });

    routes.installHandlers(testApp, '/api/v1');

    return testApp;
  }

  /**
   * Creates a test Express app with no user (unauthenticated).
   */
  function createAppNoAuth() {
    const testApp = express();
    testApp.use(express.json());

    routes.installHandlers(testApp, '/api/v1');

    return testApp;
  }

  beforeEach(() => {
    // Stub ExpressHelper.adminOnly to avoid Passport JWT dependency
    sandbox.stub(ExpressHelper, 'adminOnly').value([
      (req: any, res: any, next: any) => {
        if (req.user && req.user.hasRole('admin')) {
          next();
        }
        else {
          res.status(403).json({ message: 'forbidden' });
        }
      },
    ]);

    const calendarInterface = new CalendarInterface(new EventEmitter());
    const accountsInterface = new AccountsInterface(new EventEmitter());
    const emailInterface = new EmailInterface();
    configurationInterface = new ConfigurationInterface();

    moderationInterface = new ModerationInterface(
      new EventEmitter(),
      calendarInterface,
      accountsInterface,
      emailInterface,
      configurationInterface,
    );

    routes = new AdminSettingsRoutes(moderationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // =========================================================================
  // GET /admin/moderation/settings
  // =========================================================================
  describe('GET /admin/moderation/settings', () => {

    describe('successful retrieval', () => {
      it('should return 200 with default moderation settings', async () => {
        sandbox.stub(moderationInterface, 'getModerationSettings').resolves({
          autoEscalationHours: 72,
          adminReportEscalationHours: 24,
          reminderBeforeEscalationHours: 12,
        });

        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/settings');

        expect(response.status).toBe(200);
        expect(response.body.autoEscalationHours).toBe(72);
        expect(response.body.adminReportEscalationHours).toBe(24);
        expect(response.body.reminderBeforeEscalationHours).toBe(12);
      });

      it('should return custom settings when configured', async () => {
        sandbox.stub(moderationInterface, 'getModerationSettings').resolves({
          autoEscalationHours: 48,
          adminReportEscalationHours: 12,
          reminderBeforeEscalationHours: 6,
        });

        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/settings');

        expect(response.status).toBe(200);
        expect(response.body.autoEscalationHours).toBe(48);
        expect(response.body.adminReportEscalationHours).toBe(12);
        expect(response.body.reminderBeforeEscalationHours).toBe(6);
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when user is not an admin', async () => {
        const app = createAppWithAuth(false);

        const response = await request(app)
          .get('/api/v1/admin/moderation/settings');

        expect(response.status).toBe(403);
      });

      it('should return 403 when no user is present', async () => {
        const app = createAppNoAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/settings');

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'getModerationSettings').rejects(
          new Error('Database connection failed'),
        );

        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/settings');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to retrieve moderation settings');
      });
    });
  });

  // =========================================================================
  // PUT /admin/moderation/settings
  // =========================================================================
  describe('PUT /admin/moderation/settings', () => {

    describe('successful update', () => {
      it('should return 200 with updated settings when updating all fields', async () => {
        sandbox.stub(moderationInterface, 'updateModerationSettings').resolves({
          autoEscalationHours: 48,
          adminReportEscalationHours: 12,
          reminderBeforeEscalationHours: 6,
        });

        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({
            autoEscalationHours: 48,
            adminReportEscalationHours: 12,
            reminderBeforeEscalationHours: 6,
          });

        expect(response.status).toBe(200);
        expect(response.body.autoEscalationHours).toBe(48);
        expect(response.body.adminReportEscalationHours).toBe(12);
        expect(response.body.reminderBeforeEscalationHours).toBe(6);
      });

      it('should allow partial updates (single field)', async () => {
        sandbox.stub(moderationInterface, 'updateModerationSettings').resolves({
          autoEscalationHours: 48,
          adminReportEscalationHours: 24,
          reminderBeforeEscalationHours: 12,
        });

        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ autoEscalationHours: 48 });

        expect(response.status).toBe(200);
        expect(response.body.autoEscalationHours).toBe(48);
      });

      it('should pass only valid setting keys to service', async () => {
        const updateStub = sandbox.stub(moderationInterface, 'updateModerationSettings').resolves({
          autoEscalationHours: 48,
          adminReportEscalationHours: 24,
          reminderBeforeEscalationHours: 12,
        });

        const app = createAppWithAuth();

        await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({
            autoEscalationHours: 48,
            unknownField: 'should be ignored',
          });

        expect(updateStub.calledOnce).toBe(true);
        const passedSettings = updateStub.firstCall.args[0];
        expect(passedSettings).toHaveProperty('autoEscalationHours', 48);
        expect(passedSettings).not.toHaveProperty('unknownField');
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 when no valid settings are provided', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('At least one valid setting');
      });

      it('should return 400 when only unknown fields are provided', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ unknownField: 123 });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('At least one valid setting');
      });

      it('should return 400 when autoEscalationHours is not a positive number', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ autoEscalationHours: -1 });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('positive number');
      });

      it('should return 400 when autoEscalationHours is zero', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ autoEscalationHours: 0 });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('positive number');
      });

      it('should return 400 when autoEscalationHours is a string', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ autoEscalationHours: 'not-a-number' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('positive number');
      });

      it('should return 400 when adminReportEscalationHours is not a positive number', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ adminReportEscalationHours: -5 });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('positive number');
      });

      it('should return 400 when reminderBeforeEscalationHours is not a positive number', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ reminderBeforeEscalationHours: 0 });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('positive number');
      });

      it('should collect multiple validation errors', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({
            autoEscalationHours: -1,
            adminReportEscalationHours: 'bad',
          });

        expect(response.status).toBe(400);
        expect(response.body.errors).toHaveLength(2);
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when user is not an admin', async () => {
        const app = createAppWithAuth(false);

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ autoEscalationHours: 48 });

        expect(response.status).toBe(403);
      });

      it('should return 403 when no user is present', async () => {
        const app = createAppNoAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ autoEscalationHours: 48 });

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'updateModerationSettings').rejects(
          new Error('Database write failed'),
        );

        const app = createAppWithAuth();

        const response = await request(app)
          .put('/api/v1/admin/moderation/settings')
          .send({ autoEscalationHours: 48 });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to update moderation settings');
      });
    });
  });

  // =========================================================================
  // Route installation
  // =========================================================================
  describe('route installation', () => {
    it('should install GET and PUT route handlers', () => {
      const app = express();
      app.use(express.json());
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

      // 2 routes: GET settings, PUT settings
      expect(routeCount).toBe(2);
    });
  });
});
