import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import AnalyticsRoutes from '@/server/moderation/api/v1/analytics-routes';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import ActivityPubInterface from '@/server/activitypub/interface';

/**
 * Analytics API integration tests.
 *
 * Verifies GET /admin/moderation/analytics endpoint
 * including authorization, date validation, and data retrieval.
 */
describe('Analytics API', () => {
  let routes: AnalyticsRoutes;
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

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface(eventBus);
    const emailInterface = new EmailInterface();
    const configurationInterface = new ConfigurationInterface();
    const activityPubInterface = new ActivityPubInterface(eventBus);

    moderationInterface = new ModerationInterface(
      eventBus,
      calendarInterface,
      accountsInterface,
      emailInterface,
      configurationInterface,
      activityPubInterface,
    );

    routes = new AnalyticsRoutes(moderationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // =========================================================================
  // GET /admin/moderation/analytics
  // =========================================================================
  describe('GET /admin/moderation/analytics', () => {

    describe('authorization', () => {
      it('should return 403 when user is not authenticated', async () => {
        const app = createAppNoAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-01', endDate: '2024-01-31' });

        expect(response.status).toBe(403);
        expect(response.body.message).toBe('forbidden');
      });

      it('should return 403 when user is not admin', async () => {
        const app = createAppWithAuth(false);

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-01', endDate: '2024-01-31' });

        expect(response.status).toBe(403);
        expect(response.body.message).toBe('forbidden');
      });
    });

    describe('parameter validation', () => {
      it('should return 400 when startDate is missing', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ endDate: '2024-01-31' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('startDate');
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when endDate is missing', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-01' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('endDate');
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when startDate is invalid', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: 'invalid-date', endDate: '2024-01-31' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid startDate');
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when endDate is invalid', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-01', endDate: 'not-a-date' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid endDate');
        expect(response.body.errorName).toBe('ValidationError');
      });

      it('should return 400 when endDate is before startDate', async () => {
        const app = createAppWithAuth();

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-31', endDate: '2024-01-01' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('endDate must be after startDate');
        expect(response.body.errorName).toBe('ValidationError');
      });
    });

    describe('successful retrieval', () => {
      it('should return 200 with combined analytics data', async () => {
        const app = createAppWithAuth();

        // Stub all analytics service methods
        const analyticsService = moderationInterface.getAnalyticsService();

        sandbox.stub(analyticsService, 'getTotalReportsByStatus').resolves({
          submitted: 10,
          resolved: 5,
          dismissed: 2,
        });

        sandbox.stub(analyticsService, 'getResolutionRate').resolves({
          ownerResolutionRate: 0.7,
          escalationRate: 0.3,
          totalReports: 10,
          ownerResolved: 7,
          escalated: 3,
        });

        sandbox.stub(analyticsService, 'getAverageResolutionTime').resolves({
          anonymous: 24,
          authenticated: 18,
          administrator: 12,
          federation: 20,
          overall: 19,
        });

        sandbox.stub(analyticsService, 'getReportsTrend').resolves([
          { date: '2024-01-01', count: 3 },
          { date: '2024-01-02', count: 5 },
          { date: '2024-01-03', count: 2 },
        ]);

        sandbox.stub(analyticsService, 'getTopReportedEvents').resolves([
          { eventId: 'event-1', reportCount: 5 },
          { eventId: 'event-2', reportCount: 3 },
        ]);

        sandbox.stub(analyticsService, 'getReporterVolume').resolves({
          anonymous: 15,
          authenticated: 10,
          administrator: 5,
          federation: 3,
        });

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-01', endDate: '2024-01-31' });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          reportsByStatus: {
            submitted: 10,
            resolved: 5,
            dismissed: 2,
          },
          resolutionRate: {
            ownerResolutionRate: 0.7,
            escalationRate: 0.3,
            totalReports: 10,
            ownerResolved: 7,
            escalated: 3,
          },
          averageResolutionTime: {
            anonymous: 24,
            authenticated: 18,
            administrator: 12,
            federation: 20,
            overall: 19,
          },
          reportsTrend: [
            { date: '2024-01-01', count: 3 },
            { date: '2024-01-02', count: 5 },
            { date: '2024-01-03', count: 2 },
          ],
          topReportedEvents: [
            { eventId: 'event-1', reportCount: 5 },
            { eventId: 'event-2', reportCount: 3 },
          ],
          reporterVolume: {
            anonymous: 15,
            authenticated: 10,
            administrator: 5,
            federation: 3,
          },
        });
      });

      it('should call analytics service with parsed Date objects', async () => {
        const app = createAppWithAuth();

        const analyticsService = moderationInterface.getAnalyticsService();

        const getTotalReportsByStatusStub = sandbox.stub(analyticsService, 'getTotalReportsByStatus').resolves({});
        sandbox.stub(analyticsService, 'getResolutionRate').resolves({
          ownerResolutionRate: 0,
          escalationRate: 0,
          totalReports: 0,
          ownerResolved: 0,
          escalated: 0,
        });
        sandbox.stub(analyticsService, 'getAverageResolutionTime').resolves({
          anonymous: 0,
          authenticated: 0,
          administrator: 0,
          federation: 0,
          overall: 0,
        });
        sandbox.stub(analyticsService, 'getReportsTrend').resolves([]);
        sandbox.stub(analyticsService, 'getTopReportedEvents').resolves([]);
        sandbox.stub(analyticsService, 'getReporterVolume').resolves({
          anonymous: 0,
          authenticated: 0,
          administrator: 0,
          federation: 0,
        });

        await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-01', endDate: '2024-01-31' });

        expect(getTotalReportsByStatusStub.calledOnce).toBe(true);

        const [startDate, endDate] = getTotalReportsByStatusStub.firstCall.args;
        expect(startDate).toBeInstanceOf(Date);
        expect(endDate).toBeInstanceOf(Date);
        expect(startDate.toISOString()).toContain('2024-01-01');
        expect(endDate.toISOString()).toContain('2024-01-31');
      });
    });

    describe('error handling', () => {
      it('should return 500 when analytics service throws unexpected error', async () => {
        const app = createAppWithAuth();

        const analyticsService = moderationInterface.getAnalyticsService();
        sandbox.stub(analyticsService, 'getTotalReportsByStatus').rejects(new Error('Database connection failed'));

        const response = await request(app)
          .get('/api/v1/admin/moderation/analytics')
          .query({ startDate: '2024-01-01', endDate: '2024-01-31' });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to retrieve analytics');
      });
    });
  });
});
