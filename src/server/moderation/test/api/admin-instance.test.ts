import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { BlockedInstance } from '@/common/model/blocked_instance';
import ExpressHelper from '@/server/common/helper/express';
import AdminInstanceRoutes from '@/server/moderation/api/v1/admin-instance-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Admin instance blocking API tests.
 *
 * Verifies POST, GET, and DELETE endpoints for blocking instances,
 * including authorization, validation, and conflict handling.
 */
describe('Admin Instance Blocking API', () => {
  let routes: AdminInstanceRoutes;
  let moderationInterface: ModerationInterface;
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
    const configurationInterface = new ConfigurationInterface();

    moderationInterface = new ModerationInterface(
      new EventEmitter(),
      calendarInterface,
      accountsInterface,
      emailInterface,
      configurationInterface,
    );

    routes = new AdminInstanceRoutes(moderationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // =========================================================================
  // POST /admin/moderation/block-instance
  // =========================================================================
  describe('POST /admin/moderation/block-instance', () => {

    describe('successful blocking - 201', () => {
      it('should return 201 with blocked instance record when blocking new domain', async () => {
        const blockedInstance = new BlockedInstance('block-id');
        blockedInstance.domain = 'bad-instance.example.com';
        blockedInstance.reason = 'Repeated policy violations';
        blockedInstance.blockedAt = new Date();
        blockedInstance.blockedBy = 'admin-id';

        sandbox.stub(moderationInterface, 'blockInstance').resolves(blockedInstance);

        const app = createAppWithAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: 'bad-instance.example.com',
            reason: 'Repeated policy violations',
          });

        expect(response.status).toBe(201);
        expect(response.body.id).toBe('block-id');
        expect(response.body.domain).toBe('bad-instance.example.com');
        expect(response.body.reason).toBe('Repeated policy violations');
        expect(response.body.blockedBy).toBe('admin-id');
      });

      it('should pass admin account ID to service', async () => {
        const blockStub = sandbox.stub(moderationInterface, 'blockInstance').resolves(
          new BlockedInstance('block-id'),
        );

        const app = createAppWithAuth();

        await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: 'bad-instance.example.com',
            reason: 'Policy violation',
          });

        expect(blockStub.calledOnce).toBe(true);
        expect(blockStub.firstCall.args[0]).toBe('bad-instance.example.com');
        expect(blockStub.firstCall.args[1]).toBe('Policy violation');
        expect(blockStub.firstCall.args[2]).toBe('admin-id');
      });
    });

    describe('validation errors - 400', () => {
      it('should return 400 when domain is missing', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({ reason: 'Policy violation' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Domain is required');
      });

      it('should return 400 when domain is empty string', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: '',
            reason: 'Policy violation',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Domain is required');
      });

      it('should return 400 when reason is missing', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({ domain: 'bad.example.com' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Reason is required');
      });

      it('should return 400 when reason is empty string', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: 'bad.example.com',
            reason: '',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Reason is required');
      });
    });

    describe('conflict - 409', () => {
      it('should return 409 when domain is already blocked', async () => {
        const error = new Error('Domain already blocked');
        error.name = 'InstanceAlreadyBlockedError';
        sandbox.stub(moderationInterface, 'blockInstance').rejects(error);

        const app = createAppWithAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: 'bad-instance.example.com',
            reason: 'Policy violation',
          });

        expect(response.status).toBe(409);
        expect(response.body.error).toContain('already blocked');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when user is not an admin', async () => {
        const app = createAppWithAuth(false);

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: 'bad.example.com',
            reason: 'Policy violation',
          });

        expect(response.status).toBe(403);
      });

      it('should return 403 when no user is present', async () => {
        const app = createAppNoAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: 'bad.example.com',
            reason: 'Policy violation',
          });

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'blockInstance').rejects(
          new Error('Database write failed'),
        );

        const app = createAppWithAuth();

        const response = await request(app)
          .post('/api/v1/admin/moderation/block-instance')
          .send({
            domain: 'bad.example.com',
            reason: 'Policy violation',
          });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to block instance');
      });
    });
  });

  // =========================================================================
  // GET /admin/moderation/blocked-instances
  // =========================================================================
  describe('GET /admin/moderation/blocked-instances', () => {

    describe('successful retrieval - 200', () => {
      it('should return 200 with empty array when no instances are blocked', async () => {
        sandbox.stub(moderationInterface, 'listBlockedInstances').resolves([]);

        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/blocked-instances');

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });

      it('should return 200 with array of blocked instances', async () => {
        const blocked1 = new BlockedInstance('id-1');
        blocked1.domain = 'bad1.example.com';
        blocked1.reason = 'Spam';
        blocked1.blockedAt = new Date('2024-01-01');
        blocked1.blockedBy = 'admin-1';

        const blocked2 = new BlockedInstance('id-2');
        blocked2.domain = 'bad2.example.com';
        blocked2.reason = 'Harassment';
        blocked2.blockedAt = new Date('2024-01-02');
        blocked2.blockedBy = 'admin-2';

        sandbox.stub(moderationInterface, 'listBlockedInstances').resolves([
          blocked1,
          blocked2,
        ]);

        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/blocked-instances');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
        expect(response.body[0].domain).toBe('bad1.example.com');
        expect(response.body[1].domain).toBe('bad2.example.com');
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when user is not an admin', async () => {
        const app = createAppWithAuth(false);

        const response = await request(app)
          .get('/api/v1/admin/moderation/blocked-instances');

        expect(response.status).toBe(403);
      });

      it('should return 403 when no user is present', async () => {
        const app = createAppNoAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/blocked-instances');

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'listBlockedInstances').rejects(
          new Error('Database connection failed'),
        );

        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/blocked-instances');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to retrieve blocked instances');
      });
    });
  });

  // =========================================================================
  // DELETE /admin/moderation/blocked-instances/:domain
  // =========================================================================
  describe('DELETE /admin/moderation/blocked-instances/:domain', () => {

    describe('successful unblock - 204', () => {
      it('should return 204 when unblocking an existing domain', async () => {
        sandbox.stub(moderationInterface, 'unblockInstance').resolves();

        const app = createAppWithAuth();

        const response = await request(app)
          .delete('/api/v1/admin/moderation/blocked-instances/bad.example.com');

        expect(response.status).toBe(204);
        expect(response.body).toEqual({});
      });

      it('should pass domain to service', async () => {
        const unblockStub = sandbox.stub(moderationInterface, 'unblockInstance').resolves();

        const app = createAppWithAuth();

        await request(app)
          .delete('/api/v1/admin/moderation/blocked-instances/bad.example.com');

        expect(unblockStub.calledOnce).toBe(true);
        expect(unblockStub.firstCall.args[0]).toBe('bad.example.com');
      });

      it('should return 204 even if domain was not blocked (idempotent)', async () => {
        sandbox.stub(moderationInterface, 'unblockInstance').resolves();

        const app = createAppWithAuth();

        const response = await request(app)
          .delete('/api/v1/admin/moderation/blocked-instances/not-blocked.example.com');

        expect(response.status).toBe(204);
      });
    });

    describe('authorization - 403', () => {
      it('should return 403 when user is not an admin', async () => {
        const app = createAppWithAuth(false);

        const response = await request(app)
          .delete('/api/v1/admin/moderation/blocked-instances/bad.example.com');

        expect(response.status).toBe(403);
      });

      it('should return 403 when no user is present', async () => {
        const app = createAppNoAuth();

        const response = await request(app)
          .delete('/api/v1/admin/moderation/blocked-instances/bad.example.com');

        expect(response.status).toBe(403);
      });
    });

    describe('server error - 500', () => {
      it('should return 500 for unexpected errors', async () => {
        sandbox.stub(moderationInterface, 'unblockInstance').rejects(
          new Error('Database write failed'),
        );

        const app = createAppWithAuth();

        const response = await request(app)
          .delete('/api/v1/admin/moderation/blocked-instances/bad.example.com');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to unblock instance');
      });
    });
  });

  // =========================================================================
  // Route installation
  // =========================================================================
  describe('route installation', () => {
    it('should install POST, GET, and DELETE route handlers', () => {
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

      // 3 routes: POST block, GET list, DELETE unblock
      expect(routeCount).toBe(3);
    });
  });
});
