import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarService from '@/server/calendar/service/calendar';
import { FollowingCalendar, FollowerCalendar } from '@/common/model/follow';

describe('ActivityPub Social API Routes', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox;
  let activityPubInterface: ActivityPubInterface;

  const testAccount = Account.fromObject({ id: 'test-account-id', email: 'test@example.com' });
  const testCalendar = new Calendar('test-calendar-id', 'testcalendar');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);

    // Stub CalendarService prototype methods before creating routes
    sandbox.stub(CalendarService.prototype, 'userCanModifyCalendar').resolves(true);

    routes = new ActivityPubMemberRoutes(activityPubInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getFollows', () => {
    it('should return list of followed calendars with new boolean fields', async () => {
      const mockFollows = [
        new FollowingCalendar('follow-1', 'remote@example.com', testCalendar.id, false, false),
        new FollowingCalendar('follow-2', 'another@example.org', testCalendar.id, true, false),
      ];

      sandbox.stub(activityPubInterface, 'getFollowing').resolves(mockFollows);

      const req = {
        user: testAccount,
        query: { calendarId: testCalendar.id },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFollows(req as any, res as any);

      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response).toHaveLength(2);
      expect(response[0].id).toBe('follow-1');
      expect(response[0].calendarActorId).toBe('remote@example.com');
      expect(response[0].autoRepostOriginals).toBe(false);
      expect(response[0].autoRepostReposts).toBe(false);
      expect(response[1].autoRepostOriginals).toBe(true);
      expect(response[1].autoRepostReposts).toBe(false);
    });

    it('should require authenticated user', async () => {
      const req = {
        query: { calendarId: testCalendar.id },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFollows(req as any, res as any);

      expect(res.status.calledWith(403)).toBe(true);
      expect(res.send.calledWith('Not logged in')).toBe(true);
    });

    it('should verify user has calendar access', async () => {
      // Override the default stub for this test
      (CalendarService.prototype.userCanModifyCalendar as any).resolves(false);

      const req = {
        user: testAccount,
        query: { calendarId: testCalendar.id },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFollows(req as any, res as any);

      expect(res.status.calledWith(403)).toBe(true);
      expect(res.send.calledWith('Permission denied')).toBe(true);
    });
  });

  describe('getFollowers', () => {
    it('should return list of followers', async () => {
      const mockFollowers = [
        new FollowerCalendar('follower-1', 'follower1@example.com', testCalendar.id),
        new FollowerCalendar('follower-2', 'follower2@example.org', testCalendar.id),
      ];

      sandbox.stub(activityPubInterface, 'getFollowers').resolves(mockFollowers);

      const req = {
        user: testAccount,
        query: { calendarId: testCalendar.id },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFollowers(req as any, res as any);

      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response).toHaveLength(2);
      expect(response[0].id).toBe('follower-1');
      expect(response[0].calendarActorId).toBe('follower1@example.com');
    });

    it('should require authenticated user', async () => {
      const req = {
        query: { calendarId: testCalendar.id },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFollowers(req as any, res as any);

      expect(res.status.calledWith(403)).toBe(true);
      expect(res.send.calledWith('Not logged in')).toBe(true);
    });
  });

  describe('updateFollowPolicy', () => {
    it('should update repost policy with new boolean fields', async () => {
      const mockUpdatedFollow = new FollowingCalendar('follow-1', 'remote@example.com', testCalendar.id, true, true);

      sandbox.stub(activityPubInterface, 'updateFollowPolicy').resolves();
      sandbox.stub(activityPubInterface, 'getFollowing').resolves([mockUpdatedFollow]);

      const req = {
        user: testAccount,
        params: { id: 'follow-1' },
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          autoRepostOriginals: true,
          autoRepostReposts: true,
        },
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.updateFollowPolicy(req as any, res as any);

      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.id).toBe('follow-1');
      expect(response.autoRepostOriginals).toBe(true);
      expect(response.autoRepostReposts).toBe(true);
    });

    it('should reject when autoRepostReposts is true but autoRepostOriginals is false', async () => {
      const req = {
        user: testAccount,
        params: { id: 'follow-1' },
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          autoRepostOriginals: false,
          autoRepostReposts: true,
        },
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.updateFollowPolicy(req as any, res as any);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.errorName).toBe('InvalidRepostPolicySettingsError');
    });

    it('should require authenticated user', async () => {
      const req = {
        params: { id: 'follow-1' },
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          autoRepostOriginals: true,
          autoRepostReposts: false,
        },
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.updateFollowPolicy(req as any, res as any);

      expect(res.status.calledWith(403)).toBe(true);
      expect(res.send.calledWith('Not logged in')).toBe(true);
    });
  });

  describe('getFeed', () => {
    it('should return events with repost status', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          title: 'Test Event 1',
          repostStatus: 'none',
        },
        {
          id: 'event-2',
          title: 'Test Event 2',
          repostStatus: 'manual',
        },
        {
          id: 'event-3',
          title: 'Test Event 3',
          repostStatus: 'auto',
        },
      ];

      sandbox.stub(activityPubInterface, 'getFeed').resolves(mockEvents as any);

      const req = {
        user: testAccount,
        query: {
          calendarId: testCalendar.id,
          page: '0',
          pageSize: '10',
        },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFeed(req as any, res as any);

      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.events).toHaveLength(3);
      expect(response.events[0].repostStatus).toBe('none');
      expect(response.events[1].repostStatus).toBe('manual');
      expect(response.events[2].repostStatus).toBe('auto');
      expect(response.hasMore).toBe(false);
    });

    it('should handle pagination parameters', async () => {
      const getFeedStub = sandbox.stub(activityPubInterface, 'getFeed').resolves([]);

      const req = {
        user: testAccount,
        query: {
          calendarId: testCalendar.id,
          page: '2',
          pageSize: '20',
        },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFeed(req as any, res as any);

      expect(getFeedStub.calledOnce).toBe(true);
      const [calendar, page, pageSize] = getFeedStub.firstCall.args;
      expect(page).toBe(2);
      expect(pageSize).toBe(20);
    });

    it('should require authenticated user', async () => {
      const req = {
        query: {
          calendarId: testCalendar.id,
          page: '0',
          pageSize: '10',
        },
        calendar: testCalendar,
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.getFeed(req as any, res as any);

      expect(res.status.calledWith(403)).toBe(true);
      expect(res.send.calledWith('Not logged in')).toBe(true);
    });
  });

  describe('followCalendar', () => {
    it('should accept autoRepostOriginals and autoRepostReposts parameters', async () => {
      const followStub = sandbox.stub(activityPubInterface, 'followCalendar').resolves();

      const req = {
        user: testAccount,
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          remoteCalendar: 'remote@example.com',
          autoRepostOriginals: true,
          autoRepostReposts: false,
        },
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.followCalendar(req as any, res as any);

      expect(res.status.calledWith(200)).toBe(true);
      expect(res.send.calledWith('Followed')).toBe(true);
      expect(followStub.calledOnce).toBe(true);
      const [account, calendar, remoteId, originals, reposts] = followStub.firstCall.args;
      expect(originals).toBe(true);
      expect(reposts).toBe(false);
    });

    it('should default to false for both boolean fields if not specified', async () => {
      const followStub = sandbox.stub(activityPubInterface, 'followCalendar').resolves();

      const req = {
        user: testAccount,
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          remoteCalendar: 'remote@example.com',
        },
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.followCalendar(req as any, res as any);

      expect(res.status.calledWith(200)).toBe(true);
      expect(res.send.calledWith('Followed')).toBe(true);
      expect(followStub.calledOnce).toBe(true);
      const [account, calendar, remoteId, originals, reposts] = followStub.firstCall.args;
      expect(originals).toBe(false);
      expect(reposts).toBe(false);
    });

    it('should require authenticated user', async () => {
      const req = {
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          remoteCalendar: 'remote@example.com',
        },
      };
      const res = {
        status: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.followCalendar(req as any, res as any);

      expect(res.status.calledWith(403)).toBe(true);
      expect(res.send.calledWith('Not logged in')).toBe(true);
    });
  });
});
