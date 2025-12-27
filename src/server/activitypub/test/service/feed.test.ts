import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import {
  FollowingCalendarEntity,
  FollowerCalendarEntity,
  SharedEventEntity,
  AutoRepostPolicy,
} from '@/server/activitypub/entity/activitypub';

describe("ActivityPub Feed Service Methods", () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox;
  let account: Account;
  let calendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);

    account = Account.fromObject({ id: 'test-account-id' });
    calendar = Calendar.fromObject({ id: 'test-calendar-id', urlName: 'testcalendar' });

    // Stub calendar service methods
    sandbox.stub(service.calendarService, 'userCanModifyCalendar').resolves(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('SharedEventEntity auto_posted field', () => {
    it('should create SharedEventEntity with auto_posted true for auto-posts', async () => {
      const createStub = sandbox.stub(SharedEventEntity, 'create');
      createStub.resolves(SharedEventEntity.build({
        id: 'test-share-id',
        event_id: 'https://remote.com/event/123',
        calendar_id: calendar.id,
        auto_posted: true,
      }) as any);

      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);
      sandbox.stub(service, 'actorUrl').resolves('https://local.com/o/testcalendar');
      sandbox.stub(service, 'addToOutbox').resolves();

      await service.shareEvent(account, calendar, 'https://remote.com/event/123', true);

      expect(createStub.calledOnce).toBe(true);
      const createArgs = createStub.getCall(0).args[0];
      expect(createArgs.auto_posted).toBe(true);
    });

    it('should create SharedEventEntity with auto_posted false for manual reposts', async () => {
      const createStub = sandbox.stub(SharedEventEntity, 'create');
      createStub.resolves(SharedEventEntity.build({
        id: 'test-share-id',
        event_id: 'https://remote.com/event/123',
        calendar_id: calendar.id,
        auto_posted: false,
      }) as any);

      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);
      sandbox.stub(service, 'actorUrl').resolves('https://local.com/o/testcalendar');
      sandbox.stub(service, 'addToOutbox').resolves();

      await service.shareEvent(account, calendar, 'https://remote.com/event/123', false);

      expect(createStub.calledOnce).toBe(true);
      const createArgs = createStub.getCall(0).args[0];
      expect(createArgs.auto_posted).toBe(false);
    });
  });

  describe('getFollowing', () => {
    it('should return list of followed calendars with policies', async () => {
      const mockFollowings = [
        FollowingCalendarEntity.build({
          id: 'follow-1',
          calendar_id: calendar.id,
          remote_calendar_id: 'remote1@example.com',
          repost_policy: AutoRepostPolicy.MANUAL,
        }),
        FollowingCalendarEntity.build({
          id: 'follow-2',
          calendar_id: calendar.id,
          remote_calendar_id: 'remote2@example.com',
          repost_policy: AutoRepostPolicy.ALL,
        }),
      ];

      sandbox.stub(FollowingCalendarEntity, 'findAll').resolves(mockFollowings as any);

      const result = await service.getFollowing(calendar);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('follow-1');
      expect(result[0].remoteCalendarId).toBe('remote1@example.com');
      expect(result[0].repostPolicy).toBe(AutoRepostPolicy.MANUAL);
      expect(result[1].repostPolicy).toBe(AutoRepostPolicy.ALL);
    });

    it('should return empty array when not following any calendars', async () => {
      sandbox.stub(FollowingCalendarEntity, 'findAll').resolves([]);

      const result = await service.getFollowing(calendar);

      expect(result).toHaveLength(0);
    });
  });

  describe('getFollowers', () => {
    it('should return list of followers', async () => {
      const mockFollowers = [
        FollowerCalendarEntity.build({
          id: 'follower-1',
          calendar_id: calendar.id,
          remote_calendar_id: 'follower1@example.com',
        }),
        FollowerCalendarEntity.build({
          id: 'follower-2',
          calendar_id: calendar.id,
          remote_calendar_id: 'follower2@example.com',
        }),
      ];

      sandbox.stub(FollowerCalendarEntity, 'findAll').resolves(mockFollowers as any);

      const result = await service.getFollowers(calendar);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('follower-1');
      expect(result[0].remoteCalendarId).toBe('follower1@example.com');
      expect(result[1].id).toBe('follower-2');
    });

    it('should return empty array when calendar has no followers', async () => {
      sandbox.stub(FollowerCalendarEntity, 'findAll').resolves([]);

      const result = await service.getFollowers(calendar);

      expect(result).toHaveLength(0);
    });
  });

  describe('updateFollowPolicy', () => {
    it('should update repost policy on existing follow relationship', async () => {
      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_id: calendar.id,
        remote_calendar_id: 'remote@example.com',
        repost_policy: AutoRepostPolicy.MANUAL,
      }) as any;

      const saveStub = sandbox.stub(mockFollow, 'save').resolves();
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      await service.updateFollowPolicy(calendar, 'follow-1', AutoRepostPolicy.ALL);

      expect(mockFollow.repost_policy).toBe(AutoRepostPolicy.ALL);
      expect(saveStub.calledOnce).toBe(true);
    });

    it('should throw error if follow relationship not found', async () => {
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);

      await expect(
        service.updateFollowPolicy(calendar, 'non-existent', AutoRepostPolicy.ALL)
      ).rejects.toThrow('Follow relationship not found');
    });

    it('should validate policy is a valid AutoRepostPolicy value', async () => {
      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_id: calendar.id,
        remote_calendar_id: 'remote@example.com',
        repost_policy: AutoRepostPolicy.MANUAL,
      }) as any;

      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      await expect(
        service.updateFollowPolicy(calendar, 'follow-1', 'invalid-policy' as any)
      ).rejects.toThrow('Invalid repost policy');
    });
  });

  describe('getFeed with repost status', () => {
    it('should include repost status for each event', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          event_url: 'https://remote.com/event/1',
          title: 'Test Event 1',
        },
        {
          id: 'event-2',
          event_url: 'https://remote.com/event/2',
          title: 'Test Event 2',
        },
        {
          id: 'event-3',
          event_url: 'https://remote.com/event/3',
          title: 'Test Event 3',
        },
      ];

      // Event 1: manually reposted
      // Event 2: auto-posted
      // Event 3: not reposted
      const mockShares = [
        SharedEventEntity.build({
          id: 'share-1',
          event_id: 'https://remote.com/event/1',
          calendar_id: calendar.id,
          auto_posted: false,
        }),
        SharedEventEntity.build({
          id: 'share-2',
          event_id: 'https://remote.com/event/2',
          calendar_id: calendar.id,
          auto_posted: true,
        }),
      ];

      sandbox.stub(service, 'getFeed').callsFake(async () => {
        return mockEvents.map((event, index) => {
          const share = mockShares.find(s => s.event_id === event.event_url);
          let repostStatus: 'none' | 'manual' | 'auto' = 'none';

          if (share) {
            repostStatus = share.auto_posted ? 'auto' : 'manual';
          }

          return {
            ...event,
            repostStatus,
          };
        });
      });

      const result = await service.getFeed(calendar);

      expect(result).toHaveLength(3);
      expect(result[0].repostStatus).toBe('manual');
      expect(result[1].repostStatus).toBe('auto');
      expect(result[2].repostStatus).toBe('none');
    });
  });
});
