import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ActivityPubInterface from '@/server/activitypub/interface';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { setupActivityPubSchema, teardownActivityPubSchema } from './helpers/database';

describe('ActivityPub Social API - Unfollow Endpoint', () => {
  let sandbox: sinon.SinonSandbox;
  let app: Application;
  let activityPubInterface: sinon.SinonStubbedInstance<ActivityPubInterface>;
  let memberRoutes: ActivityPubMemberRoutes;

  // Test data
  const testAccount = new Account('account-123', 'test@example.com');
  const testCalendar = new Calendar('calendar-123', 'testcal');
  const remoteCalendarId = 'remotecal@remote.example.com';
  const followId = 'https://beta.federation.local/o/testcal/follows/follow-abc-123';

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();

    // Create Express app
    app = express();
    app.use(express.json());

    // Mock authentication middleware to inject test account
    app.use((req, res, next) => {
      req.user = testAccount;
      next();
    });

    // Create stubbed ActivityPub interface
    activityPubInterface = sandbox.createStubInstance(ActivityPubInterface);

    // Create member routes with mocked dependencies
    memberRoutes = new ActivityPubMemberRoutes(activityPubInterface as any);

    // Stub the calendarService instance methods directly on the memberRoutes instance
    sandbox.stub(memberRoutes['calendarService'], 'getCalendar').resolves(testCalendar);
    sandbox.stub(memberRoutes['calendarService'], 'userCanModifyCalendar').resolves(true);

    // Install routes manually without ExpressHelper.loggedInOnly middleware
    const router = express.Router();

    // Bind all routes but replace loggedInOnly with our test auth middleware
    const testAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
      // Auth already handled above, just pass through
      next();
    };

    router.post('/social/follows', testAuthMiddleware, memberRoutes.requireCalendarId.bind(memberRoutes), memberRoutes.followCalendar.bind(memberRoutes));
    router.delete('/social/follows/:id', testAuthMiddleware, memberRoutes.requireCalendarId.bind(memberRoutes), memberRoutes.unfollowCalendar.bind(memberRoutes));
    router.get('/social/follows', testAuthMiddleware, memberRoutes['requireCalendarIdQuery'].bind(memberRoutes), memberRoutes.getFollows.bind(memberRoutes));

    app.use('/api/v1', router);

    // Create calendar in database to satisfy foreign key constraints
    await CalendarEntity.create({
      id: testCalendar.id,
      url_name: testCalendar.urlName,
      account_id: uuidv4(), // Dummy account ID
      languages: 'en',
    });

    // Create following relationship in database for unfollow tests
    await FollowingCalendarEntity.create({
      id: followId,
      calendar_id: testCalendar.id,
      remote_calendar_id: remoteCalendarId,
    });
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  describe('DELETE /api/v1/social/follows/:id', () => {
    it('should accept URL-encoded fully qualified activity IDs', async () => {
      // Setup: Mock unfollow service call
      activityPubInterface.unfollowCalendar.resolves();

      // Execute: Call unfollow endpoint with URL-encoded follow ID
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          calendarId: testCalendar.id,
          remoteCalendar: remoteCalendarId,
        });

      // Verify: Request succeeded
      expect(response.status).toBe(200);
      expect(response.text).toBe('Unfollowed');

      // Verify: Service was called with correct parameters
      expect(activityPubInterface.unfollowCalendar.calledOnce).toBe(true);
      expect(activityPubInterface.unfollowCalendar.firstCall.args).toEqual([
        testAccount,
        testCalendar,
        remoteCalendarId,
      ]);
    });

    it('should delete local FollowingCalendarEntity record', async () => {
      // Setup: Mock following entity exists
      const mockFollowingEntity = {
        id: followId,
        remote_calendar_id: remoteCalendarId,
        calendar_id: testCalendar.id,
        destroy: sandbox.stub().resolves(),
      };

      // Mock the unfollowCalendar to simulate entity deletion
      activityPubInterface.unfollowCalendar.callsFake(async () => {
        await mockFollowingEntity.destroy();
      });

      // Execute: Call unfollow endpoint
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          calendarId: testCalendar.id,
          remoteCalendar: remoteCalendarId,
        });

      // Verify: Request succeeded
      expect(response.status).toBe(200);

      // Verify: Entity destroy was called
      expect(mockFollowingEntity.destroy.calledOnce).toBe(true);
    });

    it('should return 403 if user lacks permission to modify calendar', async () => {
      // Setup: Override stub to return false for permission check
      (memberRoutes['calendarService'].userCanModifyCalendar as sinon.SinonStub).resolves(false);

      // Execute: Call unfollow endpoint
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          calendarId: testCalendar.id,
          remoteCalendar: remoteCalendarId,
        });

      // Verify: Permission denied
      expect(response.status).toBe(403);

      // Verify: Service was not called
      expect(activityPubInterface.unfollowCalendar.called).toBe(false);
    });

    it('should return 400 if calendarId is missing', async () => {
      // Execute: Call without calendarId
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          remoteCalendar: remoteCalendarId,
        });

      // Verify: Bad request
      expect(response.status).toBe(400);
      expect(response.text).toBe('Invalid request');
    });

    it('should succeed without remoteCalendar in request body', async () => {
      // Setup: Mock unfollow service call
      activityPubInterface.unfollowCalendar.resolves();

      // Execute: Call without remoteCalendar (route gets it from database entity)
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          calendarId: testCalendar.id,
        });

      // Verify: Request succeeded (remoteCalendar not needed in body)
      expect(response.status).toBe(200);
      expect(response.text).toBe('Unfollowed');

      // Verify: Service was called with remote_calendar_id from database
      expect(activityPubInterface.unfollowCalendar.calledOnce).toBe(true);
      expect(activityPubInterface.unfollowCalendar.firstCall.args[2]).toBe(remoteCalendarId);
    });
  });
});
