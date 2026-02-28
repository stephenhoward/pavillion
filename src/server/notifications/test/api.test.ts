import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import NotificationRoutes from '@/server/notifications/api/v1/notification';
import NotificationsInterface from '@/server/notifications/interface';
import NotificationService from '@/server/notifications/service/notification';
import { Notification } from '@/common/model/notification';

/**
 * Unit/integration tests for the Notification API endpoints.
 *
 * These tests stub NotificationsInterface methods and verify that the HTTP layer
 * correctly handles authentication, parameter parsing, response headers, and
 * error cases — without requiring a live database.
 */
describe('Notification API', () => {
  let routes: NotificationRoutes;
  let router: express.Router;
  let notificationsInterface: NotificationsInterface;
  let sandbox: sinon.SinonSandbox;

  const makeNotification = (overrides: Partial<Notification> = {}): Notification => {
    const n = new Notification('test-id-1');
    n.type = 'follow';
    n.calendarId = 'cal-id-1';
    n.eventId = null;
    n.actorName = 'Test Actor';
    n.actorUrl = 'https://example.com/actor';
    n.seen = false;
    n.createdAt = new Date('2026-01-01T00:00:00Z');
    Object.assign(n, overrides);
    return n;
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const service = new NotificationService();
    notificationsInterface = new NotificationsInterface(service);
    routes = new NotificationRoutes(notificationsInterface);
    router = express.Router();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /notifications', () => {
    describe('authentication', () => {
      it('should return 403 when not authenticated', async () => {
        // Route without addRequestUser — no req.user
        router.get('/notifications', (req, res) => {
          routes.getNotifications(req, res);
        });

        const response = await request(testApp(router)).get('/notifications');

        expect(response.status).toBe(403);
      });
    });

    describe('happy path', () => {
      it('should return notifications for authenticated user', async () => {
        const notifications = [
          makeNotification({ id: 'n-1', type: 'follow' }),
          makeNotification({ id: 'n-2', type: 'repost', eventId: 'event-id-1' }),
        ];

        sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves(notifications);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        const response = await request(testApp(router)).get('/notifications');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
        expect(response.body[0].type).toBe('follow');
        expect(response.body[1].type).toBe('repost');
      });

      it('should exclude account_id from response objects', async () => {
        const notification = makeNotification();
        sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([notification]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        const response = await request(testApp(router)).get('/notifications');

        expect(response.status).toBe(200);
        expect(response.body[0]).not.toHaveProperty('accountId');
        expect(response.body[0]).not.toHaveProperty('account_id');
        expect(response.body[0]).toHaveProperty('id');
        expect(response.body[0]).toHaveProperty('type');
        expect(response.body[0]).toHaveProperty('calendarId');
        expect(response.body[0]).toHaveProperty('seen');
      });

      it('should include Cache-Control: private, max-age=25 header', async () => {
        sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        const response = await request(testApp(router)).get('/notifications');

        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('private, max-age=25');
      });

      it('should return empty array when user has no notifications', async () => {
        sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        const response = await request(testApp(router)).get('/notifications');

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });
    });

    describe('limit parameter', () => {
      it('should pass default limit of 50 when no limit provided', async () => {
        const stub = sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        await request(testApp(router)).get('/notifications');

        expect(stub.calledOnce).toBe(true);
        expect(stub.firstCall.args[1]).toBe(50);
      });

      it('should pass provided limit when ?limit=N is given', async () => {
        const stub = sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        await request(testApp(router)).get('/notifications?limit=25');

        expect(stub.calledOnce).toBe(true);
        expect(stub.firstCall.args[1]).toBe(25);
      });

      it('should cap limit at 100 when ?limit exceeds max', async () => {
        const stub = sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        await request(testApp(router)).get('/notifications?limit=999');

        expect(stub.calledOnce).toBe(true);
        expect(stub.firstCall.args[1]).toBe(100);
      });

      it('should use default limit when ?limit is not a valid number', async () => {
        const stub = sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        await request(testApp(router)).get('/notifications?limit=abc');

        expect(stub.calledOnce).toBe(true);
        expect(stub.firstCall.args[1]).toBe(50);
      });

      it('should use default limit when ?limit=0', async () => {
        const stub = sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        await request(testApp(router)).get('/notifications?limit=0');

        expect(stub.calledOnce).toBe(true);
        expect(stub.firstCall.args[1]).toBe(50);
      });
    });

    describe('error handling', () => {
      it('should return 500 when service throws', async () => {
        sandbox.stub(notificationsInterface, 'getNotificationsForAccount').rejects(new Error('DB failure'));

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        const response = await request(testApp(router)).get('/notifications');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('An error occurred while fetching notifications');
      });
    });

    describe('account scoping', () => {
      it('should call service with the authenticated user account ID', async () => {
        const stub = sandbox.stub(notificationsInterface, 'getNotificationsForAccount').resolves([]);

        router.get('/notifications', addRequestUser, (req, res) => {
          routes.getNotifications(req, res);
        });

        await request(testApp(router)).get('/notifications');

        // addRequestUser sets account id to 'id'
        expect(stub.calledOnce).toBe(true);
        expect(stub.firstCall.args[0]).toBe('id');
      });
    });
  });

  describe('POST /notifications/mark-all-seen', () => {
    describe('authentication', () => {
      it('should return 403 when not authenticated', async () => {
        router.post('/notifications/mark-all-seen', (req, res) => {
          routes.markAllSeen(req, res);
        });

        const response = await request(testApp(router))
          .post('/notifications/mark-all-seen');

        expect(response.status).toBe(403);
      });
    });

    describe('happy path', () => {
      it('should return 200 with success: true when authenticated', async () => {
        sandbox.stub(notificationsInterface, 'markAllSeenForAccount').resolves();

        router.post('/notifications/mark-all-seen', addRequestUser, (req, res) => {
          routes.markAllSeen(req, res);
        });

        const response = await request(testApp(router))
          .post('/notifications/mark-all-seen');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it('should scope mark-all-seen to the authenticated user only (IDOR prevention)', async () => {
        const stub = sandbox.stub(notificationsInterface, 'markAllSeenForAccount').resolves();

        router.post('/notifications/mark-all-seen', addRequestUser, (req, res) => {
          routes.markAllSeen(req, res);
        });

        await request(testApp(router))
          .post('/notifications/mark-all-seen');

        // addRequestUser sets account id to 'id'
        expect(stub.calledOnce).toBe(true);
        expect(stub.firstCall.args[0]).toBe('id');
      });
    });

    describe('error handling', () => {
      it('should return 500 when service throws', async () => {
        sandbox.stub(notificationsInterface, 'markAllSeenForAccount').rejects(new Error('DB failure'));

        router.post('/notifications/mark-all-seen', addRequestUser, (req, res) => {
          routes.markAllSeen(req, res);
        });

        const response = await request(testApp(router))
          .post('/notifications/mark-all-seen');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('An error occurred while marking notifications as seen');
      });
    });
  });
});
