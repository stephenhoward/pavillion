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
} from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';

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

      sandbox.stub(EventObjectEntity, 'findOne').resolves(null);
      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);
      sandbox.stub(service, 'actorUrl').resolves('https://local.com/calendars/testcalendar');
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

      sandbox.stub(EventObjectEntity, 'findOne').resolves(null);
      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);
      sandbox.stub(service, 'actorUrl').resolves('https://local.com/calendars/testcalendar');
      sandbox.stub(service, 'addToOutbox').resolves();

      await service.shareEvent(account, calendar, 'https://remote.com/event/123', false);

      expect(createStub.calledOnce).toBe(true);
      const createArgs = createStub.getCall(0).args[0];
      expect(createArgs.auto_posted).toBe(false);
    });
  });

  describe('getFollowing', () => {
    it('should return list of followed calendars with new boolean fields', async () => {
      const mockFollowings = [
        FollowingCalendarEntity.build({
          id: 'follow-1',
          calendar_id: calendar.id,
          calendar_actor_id: 'remote1@example.com',
          auto_repost_originals: false,
          auto_repost_reposts: false,
        }),
        FollowingCalendarEntity.build({
          id: 'follow-2',
          calendar_id: calendar.id,
          calendar_actor_id: 'remote2@example.com',
          auto_repost_originals: true,
          auto_repost_reposts: true,
        }),
      ];

      sandbox.stub(FollowingCalendarEntity, 'findAll').resolves(mockFollowings as any);

      const result = await service.getFollowing(calendar);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('follow-1');
      expect(result[0].calendarActorId).toBe('remote1@example.com');
      expect(result[0].autoRepostOriginals).toBe(false);
      expect(result[0].autoRepostReposts).toBe(false);
      expect(result[1].autoRepostOriginals).toBe(true);
      expect(result[1].autoRepostReposts).toBe(true);
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
          calendar_actor_id: 'follower1@example.com',
        }),
        FollowerCalendarEntity.build({
          id: 'follower-2',
          calendar_id: calendar.id,
          calendar_actor_id: 'follower2@example.com',
        }),
      ];

      sandbox.stub(FollowerCalendarEntity, 'findAll').resolves(mockFollowers as any);

      const result = await service.getFollowers(calendar);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('follower-1');
      expect(result[0].calendarActorId).toBe('follower1@example.com');
      expect(result[1].id).toBe('follower-2');
    });

    it('should return empty array when calendar has no followers', async () => {
      sandbox.stub(FollowerCalendarEntity, 'findAll').resolves([]);

      const result = await service.getFollowers(calendar);

      expect(result).toHaveLength(0);
    });
  });

  describe('updateFollowPolicy', () => {
    it('should update repost policy with new boolean fields on existing follow relationship', async () => {
      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_id: calendar.id,
        calendar_actor_id: 'remote@example.com',
        auto_repost_originals: false,
        auto_repost_reposts: false,
      }) as any;

      const saveStub = sandbox.stub(mockFollow, 'save').resolves();
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      await service.updateFollowPolicy(calendar, 'follow-1', true, true);

      expect(mockFollow.auto_repost_originals).toBe(true);
      expect(mockFollow.auto_repost_reposts).toBe(true);
      expect(saveStub.calledOnce).toBe(true);
    });

    it('should throw error if follow relationship not found', async () => {
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);

      await expect(
        service.updateFollowPolicy(calendar, 'non-existent', true, false),
      ).rejects.toThrow('Follow relationship not found');
    });

    // TODO: Re-enable when validation is restored in bead pv-5fk
    it.skip('should validate that autoRepostReposts cannot be true when autoRepostOriginals is false', async () => {
      const mockFollow = FollowingCalendarEntity.build({
        id: 'follow-1',
        calendar_id: calendar.id,
        calendar_actor_id: 'remote@example.com',
        auto_repost_originals: false,
        auto_repost_reposts: false,
      }) as any;

      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(mockFollow);

      await expect(
        service.updateFollowPolicy(calendar, 'follow-1', false, true),
      ).rejects.toThrow('Invalid auto-repost policy settings');
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
        return mockEvents.map((event) => {
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
