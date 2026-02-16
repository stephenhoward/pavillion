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
import { setupActivityPubSchema, teardownActivityPubSchema, getOrCreateRemoteCalendarActor } from '@/server/test/helpers/database';

describe('ActivityPub Social API - Unfollow Endpoint', () => {
  let sandbox: sinon.SinonSandbox;
  let app: Application;
  let activityPubInterface: sinon.SinonStubbedInstance<ActivityPubInterface>;
  let memberRoutes: ActivityPubMemberRoutes;

  // Test data
  const testAccount = new Account('account-123', 'test@example.com');
  const testCalendar = new Calendar('calendar-123', 'testcal');
  const remoteActorUri = 'https://remote.example.com/calendars/remotecal';
  const followId = 'https://beta.federation.local/calendars/testcal/follows/follow-abc-123';

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

    // Create mock CalendarInterface for constructor injection
    const mockCalendarAPI = {
      getCalendar: sandbox.stub().resolves(testCalendar),
      userCanModifyCalendar: sandbox.stub().resolves(true),
    };

    // Create member routes with mocked dependencies
    memberRoutes = new ActivityPubMemberRoutes(activityPubInterface as any, mockCalendarAPI as any);

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

    // Create CalendarActorEntity (remote type) first, then following relationship
    const calendarActor = await getOrCreateRemoteCalendarActor(remoteActorUri);

    // Create following relationship in database for unfollow tests
    await FollowingCalendarEntity.create({
      id: followId,
      calendar_id: testCalendar.id,
      calendar_actor_id: calendarActor.id,
    });
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  describe('DELETE /api/v1/social/follows/:id', () => {
    it('should accept URL-encoded fully qualified activity IDs', async () => {
      // Setup: Mock unfollowCalendarById service call
      activityPubInterface.unfollowCalendarById.resolves();

      // Execute: Call unfollow endpoint with URL-encoded follow ID
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          calendarId: testCalendar.id,
          remoteCalendar: remoteActorUri,
        });

      // Verify: Request succeeded
      expect(response.status).toBe(200);
      expect(response.text).toBe('Unfollowed');

      // Verify: Service was called with correct parameters
      expect(activityPubInterface.unfollowCalendarById.calledOnce).toBe(true);
      expect(activityPubInterface.unfollowCalendarById.firstCall.args).toEqual([
        testAccount,
        testCalendar,
        followId,
      ]);
    });

    it('should delete local FollowingCalendarEntity record', async () => {
      // Setup: Mock following entity exists
      const mockFollowingEntity = {
        id: followId,
        calendar_actor_id: remoteActorUri,
        calendar_id: testCalendar.id,
        destroy: sandbox.stub().resolves(),
      };

      // Mock the unfollowCalendarById to simulate entity deletion
      activityPubInterface.unfollowCalendarById.callsFake(async () => {
        await mockFollowingEntity.destroy();
      });

      // Execute: Call unfollow endpoint
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          calendarId: testCalendar.id,
          remoteCalendar: remoteActorUri,
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
          remoteCalendar: remoteActorUri,
        });

      // Verify: Permission denied
      expect(response.status).toBe(403);

      // Verify: Service was not called
      expect(activityPubInterface.unfollowCalendarById.called).toBe(false);
    });

    it('should return 400 if calendarId is missing', async () => {
      // Execute: Call without calendarId
      const encodedFollowId = encodeURIComponent(followId);
      const response = await request(app)
        .delete(`/api/v1/social/follows/${encodedFollowId}`)
        .set('Content-Type', 'application/json')
        .send({
          remoteCalendar: remoteActorUri,
        });

      // Verify: Bad request with structured error response
      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('InvalidRequestError');
      expect(response.body.error).toContain('calendarId');
    });

    it('should succeed without remoteCalendar in request body', async () => {
      // Setup: Mock unfollowCalendarById service call
      activityPubInterface.unfollowCalendarById.resolves();

      // Execute: Call without remoteCalendar (route gets it from service layer via followId)
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
    });
  });
});
