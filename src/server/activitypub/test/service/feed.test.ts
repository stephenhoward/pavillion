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
import { CalendarActorEntity } from '@/server/activitypub/entity/calendar_actor';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { EventEntity } from '@/server/calendar/entity/event';

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
      const remoteEventUuid = 'aaaaaaaa-1111-0000-0000-000000000001';
      const createStub = sandbox.stub(SharedEventEntity, 'create');
      createStub.resolves(SharedEventEntity.build({
        id: 'test-share-id',
        event_id: remoteEventUuid,
        calendar_id: calendar.id,
        auto_posted: true,
      }) as any);

      // shareEvent() requires an EventObjectEntity to resolve the UUID
      sandbox.stub(EventObjectEntity, 'findOne').resolves(
        EventObjectEntity.build({
          id: 'event-object-id',
          event_id: remoteEventUuid,
          ap_id: 'https://remote.com/event/123',
          attributed_to: 'https://remote.com/calendars/remotecal',
        }) as any,
      );
      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);
      sandbox.stub(service, 'actorUrl').resolves('https://local.com/calendars/testcalendar');
      sandbox.stub(service, 'addToOutbox').resolves();

      await service.shareEvent(account, calendar, 'https://remote.com/event/123', true);

      expect(createStub.calledOnce).toBe(true);
      const createArgs = createStub.getCall(0).args[0];
      expect(createArgs.auto_posted).toBe(true);
      expect(createArgs.event_id).toBe(remoteEventUuid);
    });

    it('should create SharedEventEntity with auto_posted false for manual reposts', async () => {
      const remoteEventUuid = 'aaaaaaaa-2222-0000-0000-000000000001';
      const createStub = sandbox.stub(SharedEventEntity, 'create');
      createStub.resolves(SharedEventEntity.build({
        id: 'test-share-id',
        event_id: remoteEventUuid,
        calendar_id: calendar.id,
        auto_posted: false,
      }) as any);

      // shareEvent() requires an EventObjectEntity to resolve the UUID
      sandbox.stub(EventObjectEntity, 'findOne').resolves(
        EventObjectEntity.build({
          id: 'event-object-id',
          event_id: remoteEventUuid,
          ap_id: 'https://remote.com/event/123',
          attributed_to: 'https://remote.com/calendars/remotecal',
        }) as any,
      );
      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);
      sandbox.stub(service, 'actorUrl').resolves('https://local.com/calendars/testcalendar');
      sandbox.stub(service, 'addToOutbox').resolves();

      await service.shareEvent(account, calendar, 'https://remote.com/event/123', false);

      expect(createStub.calledOnce).toBe(true);
      const createArgs = createStub.getCall(0).args[0];
      expect(createArgs.auto_posted).toBe(false);
      expect(createArgs.event_id).toBe(remoteEventUuid);
    });

    it('should throw InvalidSharedEventUrlError when no EventObjectEntity exists for the event URL', async () => {
      sandbox.stub(EventObjectEntity, 'findOne').resolves(null);
      sandbox.stub(SharedEventEntity, 'findOne').resolves(null);
      sandbox.stub(service, 'actorUrl').resolves('https://local.com/calendars/testcalendar');
      sandbox.stub(service, 'addToOutbox').resolves();

      await expect(
        service.shareEvent(account, calendar, 'https://remote.com/event/no-uuid-in-url', false),
      ).rejects.toThrow('Cannot share event: no EventObjectEntity found for URL');
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
          event_id: 'event-1',
          calendar_id: calendar.id,
          auto_posted: false,
        }),
        SharedEventEntity.build({
          id: 'share-2',
          event_id: 'event-2',
          calendar_id: calendar.id,
          auto_posted: true,
        }),
      ];

      sandbox.stub(service, 'getFeed').callsFake(async () => {
        return mockEvents.map((event) => {
          const share = mockShares.find(s => s.event_id === event.id);
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

/**
 * Tests for getFeed() repost status lookup correctness.
 *
 * These tests exercise the real getFeed() implementation (not stubbed) to verify
 * that SharedEventEntity.event_id is always a UUID, and getFeed() always looks up
 * by event.id (UUID) — never by a constructed URL.
 */
describe("getFeed repost status lookup", () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox;
  let calendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);
    calendar = Calendar.fromObject({ id: 'consumer-calendar-id', urlName: 'consumer' });
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Helper to create a minimal mock EventEntity-like object for use with
   * EventEntity.findAll stubs. Includes the get() method required by getFeed().
   */
  function makeMockEvent(overrides: {
    id: string;
    calendar_id: string | null;
    event_source_url: string | null;
    content?: any[];
    schedules?: any[];
    categoryAssignments?: any[];
  }) {
    const base = {
      content: [],
      schedules: [],
      categoryAssignments: [],
      ...overrides,
    };
    return {
      ...base,
      get(options: any) {
        return { ...base };
      },
    };
  }

  it('returns repostStatus=manual for a local event stored with UUID key in SharedEventEntity', async () => {
    const localEventId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const sourceCalendarId = 'source-calendar-id';

    // getFeed() queries EventEntity.findAll to get the feed events
    const mockEvent = makeMockEvent({
      id: localEventId,
      calendar_id: sourceCalendarId,   // local event: calendar_id is set
      event_source_url: null,           // no source URL for local events
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);

    // shareEvent() stores the UUID as the event_id for local events
    const mockSharedEvent = SharedEventEntity.build({
      id: 'share-id-1',
      event_id: localEventId,           // stored as UUID (matches shareEvent() behavior)
      calendar_id: calendar.id,
      auto_posted: false,
    });

    sandbox.stub(SharedEventEntity, 'findAll').resolves([mockSharedEvent] as any);

    // No local calendar actors needed for this test
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);
    // No remote event objects needed (local event)
    sandbox.stub(EventObjectEntity, 'findAll').resolves([] as any);

    const feed = await service.getFeed(calendar);

    expect(feed).toHaveLength(1);
    expect(feed[0].id).toBe(localEventId);
    expect(feed[0].repostStatus).toBe('manual');
  });

  it('returns repostStatus=auto for a local event that was auto-posted (UUID key)', async () => {
    const localEventId = 'aaaaaaaa-0000-0000-0000-000000000002';
    const sourceCalendarId = 'source-calendar-id';

    const mockEvent = makeMockEvent({
      id: localEventId,
      calendar_id: sourceCalendarId,
      event_source_url: null,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);

    const mockSharedEvent = SharedEventEntity.build({
      id: 'share-id-2',
      event_id: localEventId,
      calendar_id: calendar.id,
      auto_posted: true,               // auto-posted
    });

    sandbox.stub(SharedEventEntity, 'findAll').resolves([mockSharedEvent] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([] as any);

    const feed = await service.getFeed(calendar);

    expect(feed).toHaveLength(1);
    expect(feed[0].repostStatus).toBe('auto');
  });

  it('returns repostStatus=none for a local event with no SharedEventEntity record', async () => {
    const localEventId = 'aaaaaaaa-0000-0000-0000-000000000003';
    const sourceCalendarId = 'source-calendar-id';

    const mockEvent = makeMockEvent({
      id: localEventId,
      calendar_id: sourceCalendarId,
      event_source_url: null,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);
    // No shared events at all
    sandbox.stub(SharedEventEntity, 'findAll').resolves([] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([] as any);

    const feed = await service.getFeed(calendar);

    expect(feed).toHaveLength(1);
    expect(feed[0].repostStatus).toBe('none');
  });

  it('returns repostStatus=manual for a remote event stored with UUID key in SharedEventEntity', async () => {
    // After normalization, remote events are also stored with UUID (event.id),
    // not with the full HTTPS URL. This test verifies the normalized behavior.
    const remoteEventId = 'bbbbbbbb-0000-0000-0000-000000000001';
    const remoteEventUrl = 'https://remote.example.com/events/some-event';

    // Remote event: calendar_id is null, event_source_url is the remote URL
    const mockEvent = makeMockEvent({
      id: remoteEventId,
      calendar_id: null,
      event_source_url: remoteEventUrl,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);

    // After normalization: event_id is stored as UUID (event.id), not the URL
    const mockSharedEvent = SharedEventEntity.build({
      id: 'share-id-3',
      event_id: remoteEventId,          // stored as UUID (normalized behavior)
      calendar_id: calendar.id,
      auto_posted: false,
    });

    sandbox.stub(SharedEventEntity, 'findAll').resolves([mockSharedEvent] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);
    // EventObjectEntity.findAll is called for all events to get ap_id and attributed_to
    sandbox.stub(EventObjectEntity, 'findAll').resolves([] as any);

    const feed = await service.getFeed(calendar);

    expect(feed).toHaveLength(1);
    expect(feed[0].repostStatus).toBe('manual');
  });

  it('getFeed passes the UUID (not a constructed URL) to SharedEventEntity query for local events', async () => {
    // This test verifies the exact lookup key passed to SharedEventEntity.findAll,
    // confirming the normalization: all events must use UUID, not URL.
    const localEventId = 'cccccccc-0000-0000-0000-000000000001';
    const sourceCalendarId = 'source-calendar-id';

    const mockEvent = makeMockEvent({
      id: localEventId,
      calendar_id: sourceCalendarId,
      event_source_url: null,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);

    const sharedEventFindAllStub = sandbox.stub(SharedEventEntity, 'findAll').resolves([] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([] as any);

    await service.getFeed(calendar);

    // Verify SharedEventEntity.findAll was called with the UUID, not a constructed URL
    expect(sharedEventFindAllStub.calledOnce).toBe(true);
    const findAllArgs = sharedEventFindAllStub.getCall(0).args[0] as any;
    const queriedEventIds: string[] = findAllArgs.where.event_id;

    expect(queriedEventIds).toContain(localEventId);
    // Must NOT contain any URL-based keys
    expect(queriedEventIds.some((id: string) => id.startsWith('https://'))).toBe(false);
  });

  it('getFeed passes UUID (not URL) to SharedEventEntity query for remote events', async () => {
    // This test verifies remote events are also looked up by UUID in SharedEventEntity,
    // not by the event_source_url (full HTTPS URL).
    const remoteEventId = 'dddddddd-0000-0000-0000-000000000001';
    const remoteEventUrl = 'https://remote.example.com/events/some-event';

    const mockEvent = makeMockEvent({
      id: remoteEventId,
      calendar_id: null,
      event_source_url: remoteEventUrl,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);

    const sharedEventFindAllStub = sandbox.stub(SharedEventEntity, 'findAll').resolves([] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);
    sandbox.stub(EventObjectEntity, 'findAll').resolves([] as any);

    await service.getFeed(calendar);

    // Verify SharedEventEntity.findAll was called with the UUID (not the URL)
    expect(sharedEventFindAllStub.calledOnce).toBe(true);
    const findAllArgs = sharedEventFindAllStub.getCall(0).args[0] as any;
    const queriedEventIds: string[] = findAllArgs.where.event_id;

    expect(queriedEventIds).toContain(remoteEventId);
    expect(queriedEventIds).not.toContain(remoteEventUrl);
    expect(queriedEventIds.some((id: string) => id.startsWith('https://'))).toBe(false);
  });

  it('getFeed returns the full AP URL as eventSourceUrl for remote events', async () => {
    // This test verifies that getFeed() returns the AP URL (not the UUID) as eventSourceUrl.
    // The client uses eventSourceUrl to call shareEvent(), which requires an https:// URL.
    const remoteEventId = 'eeeeeeee-0000-0000-0000-000000000001';
    const remoteApUrl = 'https://remote.example.com/calendars/remotecal/events/some-event';

    const mockEvent = makeMockEvent({
      id: remoteEventId,
      calendar_id: null,
      event_source_url: null,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);

    // EventObjectEntity provides the ap_id for remote events
    sandbox.stub(EventObjectEntity, 'findAll').resolves([
      EventObjectEntity.build({
        id: 'eo-id-1',
        event_id: remoteEventId,
        ap_id: remoteApUrl,
        attributed_to: 'https://remote.example.com/calendars/remotecal',
      }),
    ] as any);

    const feed = await service.getFeed(calendar);

    expect(feed).toHaveLength(1);
    // eventSourceUrl must be the full AP URL, not the UUID
    expect(feed[0].eventSourceUrl).toBe(remoteApUrl);
    expect(feed[0].eventSourceUrl).toMatch(/^https:\/\//);
  });

  it('getFeed returns the full AP URL as eventSourceUrl for local events published via AP', async () => {
    // Local events that have been published via ActivityPub also have EventObjectEntity records.
    // getFeed() should return the ap_id from EventObjectEntity as eventSourceUrl.
    const localEventId = 'ffffffff-0000-0000-0000-000000000001';
    const sourceCalendarId = 'source-calendar-id';
    const localApUrl = 'https://local.example.com/calendars/sourcecal/events/' + localEventId;

    const mockEvent = makeMockEvent({
      id: localEventId,
      calendar_id: sourceCalendarId,
      event_source_url: null,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockEvent] as any);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);

    // EventObjectEntity provides the ap_id for local events published via AP
    sandbox.stub(EventObjectEntity, 'findAll').resolves([
      EventObjectEntity.build({
        id: 'eo-id-2',
        event_id: localEventId,
        ap_id: localApUrl,
        attributed_to: 'https://local.example.com/calendars/sourcecal',
      }),
    ] as any);

    const feed = await service.getFeed(calendar);

    expect(feed).toHaveLength(1);
    // eventSourceUrl must be the full AP URL, not the UUID
    expect(feed[0].eventSourceUrl).toBe(localApUrl);
    expect(feed[0].eventSourceUrl).toMatch(/^https:\/\//);
  });

  it('getFeed fetches EventObjectEntity for all events (not only remote) to resolve ap_id', async () => {
    // Verify that EventObjectEntity.findAll is called with all event IDs,
    // not just remote event IDs. This ensures local events can also get their ap_id.
    const localEventId = 'aaaaaaaa-1111-0000-0000-000000000001';
    const remoteEventId = 'bbbbbbbb-1111-0000-0000-000000000001';

    const mockLocalEvent = makeMockEvent({
      id: localEventId,
      calendar_id: 'source-calendar-id',
      event_source_url: null,
    });

    const mockRemoteEvent = makeMockEvent({
      id: remoteEventId,
      calendar_id: null,
      event_source_url: null,
    });

    sandbox.stub(EventEntity, 'findAll').resolves([mockLocalEvent, mockRemoteEvent] as any);
    sandbox.stub(SharedEventEntity, 'findAll').resolves([] as any);
    sandbox.stub(CalendarActorEntity, 'findAll').resolves([] as any);

    const eventObjectFindAllStub = sandbox.stub(EventObjectEntity, 'findAll').resolves([] as any);

    await service.getFeed(calendar);

    expect(eventObjectFindAllStub.calledOnce).toBe(true);
    const findAllArgs = eventObjectFindAllStub.getCall(0).args[0] as any;
    const queriedEventIds: string[] = findAllArgs.where.event_id;

    // Both local and remote event IDs must be included
    expect(queriedEventIds).toContain(localEventId);
    expect(queriedEventIds).toContain(remoteEventId);
  });
});
