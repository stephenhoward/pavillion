import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ActivityPubInterface from '@/server/activitypub/interface';
import { FollowingCalendar } from '@/common/model/follow';

/**
 * Creates a mock CalendarInterface with stubbed methods needed by member routes.
 */
function createMockCalendarInterface() {
  return {
    getCalendar: sinon.stub().resolves(null),
    userCanModifyCalendar: sinon.stub().resolves(true),
  };
}

describe('ActivityPub Repost Policy API Routes', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox;
  let activityPubInterface: ActivityPubInterface;

  const testAccount = Account.fromObject({ id: 'test-account-id', email: 'test@example.com' });
  const testCalendar = new Calendar('test-calendar-id', 'testcalendar');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus) as any;

    const mockCalendarAPI = createMockCalendarInterface();
    routes = new ActivityPubMemberRoutes(activityPubInterface, mockCalendarAPI as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('POST /social/follows - accepts new boolean fields', () => {
    it('should accept autoRepostOriginals and autoRepostReposts fields', async () => {
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
      const [account, calendar, remoteId, autoOriginals, autoReposts] = followStub.firstCall.args;
      expect(autoOriginals).toBe(true);
      expect(autoReposts).toBe(false);
    });

    it('should default to false when fields not provided', async () => {
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
      expect(followStub.calledOnce).toBe(true);
      const [account, calendar, remoteId, autoOriginals, autoReposts] = followStub.firstCall.args;
      expect(autoOriginals).toBe(false);
      expect(autoReposts).toBe(false);
    });
  });

  describe('PATCH /social/follows/:id - accepts new boolean fields', () => {
    it('should accept autoRepostOriginals and autoRepostReposts fields', async () => {
      const mockUpdatedFollow = new FollowingCalendar(
        'follow-1',
        'remote@example.com',
        testCalendar.id,
        true,
        true,
      );

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
  });

  describe('API validation - rejects invalid policy combinations', () => {
    // TODO: Re-enable when validation is restored in bead pv-5fk
    it.skip('should reject autoRepostReposts=true when autoRepostOriginals=false', async () => {
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
  });

  describe('GET /social/follows - returns new boolean fields', () => {
    it('should return data with autoRepostOriginals and autoRepostReposts fields', async () => {
      const mockFollows = [
        new FollowingCalendar('follow-1', 'remote@example.com', testCalendar.id, false, false),
        new FollowingCalendar('follow-2', 'another@example.org', testCalendar.id, true, true),
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
      expect(response[0].autoRepostOriginals).toBe(false);
      expect(response[0].autoRepostReposts).toBe(false);
      expect(response[1].autoRepostOriginals).toBe(true);
      expect(response[1].autoRepostReposts).toBe(true);
      // Ensure old repostPolicy field is not present
      expect(response[0].repostPolicy).toBeUndefined();
      expect(response[1].repostPolicy).toBeUndefined();
    });
  });

  describe('Service layer - stores and retrieves new fields', () => {
    it('should properly pass boolean fields through interface to service', async () => {
      const updateStub = sandbox.stub(activityPubInterface, 'updateFollowPolicy').resolves();

      const mockUpdatedFollow = new FollowingCalendar(
        'follow-1',
        'remote@example.com',
        testCalendar.id,
        true,
        false,
      );
      sandbox.stub(activityPubInterface, 'getFollowing').resolves([mockUpdatedFollow]);

      const req = {
        user: testAccount,
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
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.updateFollowPolicy(req as any, res as any);

      expect(updateStub.calledOnce).toBe(true);
      const [calendar, followId, originals, reposts] = updateStub.firstCall.args;
      expect(originals).toBe(true);
      expect(reposts).toBe(false);
    });
  });
});
