import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';

// Create mock service instance
const mockFeedService = {
  getFollows: vi.fn(),
  getFollowers: vi.fn(),
  getFeed: vi.fn(),
  followCalendar: vi.fn(),
  unfollowCalendar: vi.fn(),
  shareEvent: vi.fn(),
  unshareEvent: vi.fn(),
  updateFollowPolicy: vi.fn(),
  getSourceCategories: vi.fn(),
  getCategoryMappings: vi.fn(),
  getCalendarCategories: vi.fn(),
};

// Mock the FeedService module
vi.mock('@/client/service/feed', async () => {
  const actual = await vi.importActual('@/client/service/feed');
  return {
    ...actual,
    default: vi.fn(() => mockFeedService),
  };
});

describe('FeedStore', () => {
  let feedStore: ReturnType<typeof useFeedStore>;
  let calendarStore: ReturnType<typeof useCalendarStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    feedStore = useFeedStore();
    calendarStore = useCalendarStore();

    // Reset all mocks
    vi.clearAllMocks();

    // Setup calendars in calendar store
    const calendar1 = new Calendar('cal-1', 'calendar-one');
    calendar1.addContent({ language: 'en', title: 'Calendar One' });
    const calendar2 = new Calendar('cal-2', 'calendar-two');
    calendar2.addContent({ language: 'en', title: 'Calendar Two' });

    calendarStore.setCalendars([calendar1, calendar2]);
  });

  describe('selectedCalendarId selection and persistence', () => {
    it('should delegate selectedCalendarId to calendarStore', () => {
      expect(feedStore.selectedCalendarId).toBeNull();

      calendarStore.setSelectedCalendar('cal-1');

      expect(feedStore.selectedCalendarId).toBe('cal-1');
    });

    it('should get selected calendar from calendar store', () => {
      calendarStore.setSelectedCalendar('cal-1');

      const calendar = feedStore.selectedCalendar;

      expect(calendar).toBeDefined();
      expect(calendar?.id).toBe('cal-1');
    });

    it('should not call calendarStore.setSelectedCalendar', () => {
      const spy = vi.spyOn(calendarStore, 'setSelectedCalendar');

      feedStore.setSelectedCalendar('cal-1');

      expect(spy).not.toHaveBeenCalled();
    });

    it('should call clearFeedData when setSelectedCalendar is called', () => {
      const spy = vi.spyOn(feedStore, 'clearFeedData');

      feedStore.setSelectedCalendar('cal-2');

      expect(spy).toHaveBeenCalled();
    });

    it('should clear cached data when setSelectedCalendar is called', () => {
      feedStore.follows = [
        { id: 'follow-1', calendarActorId: 'remote@example.com', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: false },
      ];
      feedStore.events = [
        { id: 'event-1', title: 'Test Event', repostStatus: 'none' },
      ];
      feedStore.eventsPage = 2;

      feedStore.setSelectedCalendar('cal-2');

      expect(feedStore.follows).toEqual([]);
      expect(feedStore.events).toEqual([]);
      expect(feedStore.eventsPage).toBe(0);
    });
  });

  describe('clearFeedData action', () => {
    it('should clear all feed state when data is populated', () => {
      // Populate all state fields
      feedStore.follows = [
        { id: 'follow-1', calendarActorId: 'remote@example.com', calendarId: 'cal-1', autoRepostOriginals: true, autoRepostReposts: false },
        { id: 'follow-2', calendarActorId: 'remote2@example.com', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: true },
      ];
      feedStore.followers = [
        { id: 'follower-1', calendarActorId: 'follower1@example.com' },
        { id: 'follower-2', calendarActorId: 'follower2@example.com' },
      ];
      feedStore.events = [
        { id: 'event-1', title: 'Event 1', repostStatus: 'none' },
        { id: 'event-2', title: 'Event 2', repostStatus: 'manual' },
      ];
      feedStore.eventsPage = 3;
      feedStore.eventsHasMore = true;

      feedStore.clearFeedData();

      expect(feedStore.follows).toEqual([]);
      expect(feedStore.followers).toEqual([]);
      expect(feedStore.events).toEqual([]);
      expect(feedStore.eventsPage).toBe(0);
      expect(feedStore.eventsHasMore).toBe(false);
    });

    it('should be idempotent when state is already empty', () => {
      // State starts empty by default from beforeEach
      expect(feedStore.follows).toEqual([]);
      expect(feedStore.followers).toEqual([]);
      expect(feedStore.events).toEqual([]);
      expect(feedStore.eventsPage).toBe(0);
      expect(feedStore.eventsHasMore).toBe(false);

      feedStore.clearFeedData();

      expect(feedStore.follows).toEqual([]);
      expect(feedStore.followers).toEqual([]);
      expect(feedStore.events).toEqual([]);
      expect(feedStore.eventsPage).toBe(0);
      expect(feedStore.eventsHasMore).toBe(false);
    });
  });

  describe('follows/followers/events state management', () => {
    it('should store follows list with new boolean fields', () => {
      const follows = [
        { id: 'follow-1', calendarActorId: 'remote1@example.com', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: false },
        { id: 'follow-2', calendarActorId: 'remote2@example.com', calendarId: 'cal-1', autoRepostOriginals: true, autoRepostReposts: true },
      ];

      feedStore.follows = follows;

      expect(feedStore.follows).toEqual(follows);
      expect(feedStore.follows).toHaveLength(2);
    });

    it('should store followers list', () => {
      const followers = [
        { id: 'follower-1', calendarActorId: 'follower1@example.com' },
        { id: 'follower-2', calendarActorId: 'follower2@example.com' },
      ];

      feedStore.followers = followers;

      expect(feedStore.followers).toEqual(followers);
      expect(feedStore.followers).toHaveLength(2);
    });

    it('should store events list', () => {
      const events = [
        { id: 'event-1', title: 'Event 1', repostStatus: 'none' },
        { id: 'event-2', title: 'Event 2', repostStatus: 'auto' },
      ];

      feedStore.events = events;

      expect(feedStore.events).toEqual(events);
      expect(feedStore.events).toHaveLength(2);
    });
  });

  describe('loadFeed action fetches and stores events', () => {
    beforeEach(() => {
      calendarStore.setSelectedCalendar('cal-1');
    });

    it('should fetch and store feed events', async () => {
      const mockEvents = [
        { id: 'event-1', title: 'Event 1', repostStatus: 'none' },
        { id: 'event-2', title: 'Event 2', repostStatus: 'manual' },
      ];
      mockFeedService.getFeed.mockResolvedValue({
        events: mockEvents,
        hasMore: true,
      });

      await feedStore.loadFeed();

      expect(mockFeedService.getFeed).toHaveBeenCalledWith('cal-1', 0, 20);
      expect(feedStore.events).toEqual(mockEvents);
      expect(feedStore.eventsHasMore).toBe(true);
      expect(feedStore.eventsPage).toBe(0);
    });

    it('should append events when append=true', async () => {
      feedStore.events = [{ id: 'event-1', title: 'Event 1', repostStatus: 'none' }];
      feedStore.eventsPage = 0;

      const mockNewEvents = [
        { id: 'event-2', title: 'Event 2', repostStatus: 'none' },
      ];
      mockFeedService.getFeed.mockResolvedValue({
        events: mockNewEvents,
        hasMore: false,
      });

      await feedStore.loadFeed(true);

      expect(mockFeedService.getFeed).toHaveBeenCalledWith('cal-1', 1, 20);
      expect(feedStore.events).toHaveLength(2);
      expect(feedStore.events[1]).toEqual(mockNewEvents[0]);
      expect(feedStore.eventsPage).toBe(1);
      expect(feedStore.eventsHasMore).toBe(false);
    });

    it('should handle errors during feed loading', async () => {
      mockFeedService.getFeed.mockRejectedValue(new Error('Network error'));

      await expect(feedStore.loadFeed()).rejects.toThrow('Network error');
      expect(feedStore.loading.events).toBe(false);
    });
  });

  describe('optimistic updates for repost actions with rollback', () => {
    beforeEach(() => {
      calendarStore.setSelectedCalendar('cal-1');
      feedStore.events = [
        { id: 'event-1', calendarId: null, eventSourceUrl: 'https://remote.example/events/event-1', categories: [], repostStatus: 'none' },
        { id: 'event-2', calendarId: null, eventSourceUrl: 'https://remote.example/events/event-2', categories: [], repostStatus: 'manual' },
      ];
    });

    it('should optimistically update repost status when no follow is found', async () => {
      // No follows set means _doRepost is called directly (silent path)
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      const promise = feedStore.repostEvent('event-1');

      // Check optimistic update
      expect(feedStore.events[0].repostStatus).toBe('manual');

      await promise;

      expect(mockFeedService.shareEvent).toHaveBeenCalledWith('cal-1', 'https://remote.example/events/event-1', []);
      expect(feedStore.events[0].repostStatus).toBe('manual');
    });

    it('should rollback on shareEvent error', async () => {
      mockFeedService.shareEvent.mockRejectedValue(new Error('API Error'));

      await expect(feedStore.repostEvent('event-1')).rejects.toThrow('API Error');

      // Should rollback to original status
      expect(feedStore.events[0].repostStatus).toBe('none');
    });

    it('should optimistically update on unrepostEvent', async () => {
      mockFeedService.unshareEvent.mockResolvedValue(undefined);

      const promise = feedStore.unrepostEvent('event-2');

      // Check optimistic update
      expect(feedStore.events[1].repostStatus).toBe('none');

      await promise;

      expect(mockFeedService.unshareEvent).toHaveBeenCalledWith('cal-1', 'event-2');
      expect(feedStore.events[1].repostStatus).toBe('none');
    });

    it('should rollback on unrepostEvent error', async () => {
      mockFeedService.unshareEvent.mockRejectedValue(new Error('API Error'));

      await expect(feedStore.unrepostEvent('event-2')).rejects.toThrow('API Error');

      // Should rollback to original status
      expect(feedStore.events[1].repostStatus).toBe('manual');
    });
  });

  describe('smart repost flow', () => {
    beforeEach(() => {
      calendarStore.setSelectedCalendar('cal-1');
      feedStore.follows = [
        {
          id: 'follow-1',
          calendarActorId: 'source@remote.example',
          calendarActorUuid: 'uuid-follow-1',
          calendarId: 'cal-1',
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
      ];
      feedStore.events = [
        {
          id: 'event-1',
          calendarId: null,
          eventSourceUrl: 'https://remote.example/events/abc',
          categories: [],
          repostStatus: 'none',
        },
      ];
    });

    it('should repost silently when source has no categories', async () => {
      mockFeedService.getSourceCategories.mockResolvedValue([]);
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      await feedStore.repostEvent('event-1');

      expect(mockFeedService.getSourceCategories).toHaveBeenCalledWith('cal-1', 'uuid-follow-1');
      expect(mockFeedService.shareEvent).toHaveBeenCalledWith('cal-1', 'https://remote.example/events/abc', []);
      expect(feedStore.pendingRepost).toBeNull();
    });

    it('should repost silently when all source categories are mapped', async () => {
      const sourceCategories = [
        { id: 'src-cat-1', name: 'Music' },
        { id: 'src-cat-2', name: 'Sports' },
      ];
      const mappings = [
        { sourceCategoryId: 'src-cat-1', sourceCategoryName: 'Music', localCategoryId: 'local-cat-1' },
        { sourceCategoryId: 'src-cat-2', sourceCategoryName: 'Sports', localCategoryId: 'local-cat-2' },
      ];

      mockFeedService.getSourceCategories.mockResolvedValue(sourceCategories);
      mockFeedService.getCategoryMappings.mockResolvedValue(mappings);
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      await feedStore.repostEvent('event-1');

      expect(mockFeedService.shareEvent).toHaveBeenCalledWith('cal-1', 'https://remote.example/events/abc', ['local-cat-1', 'local-cat-2']);
      expect(feedStore.pendingRepost).toBeNull();
    });

    it('should set pendingRepost when some source categories are unmapped', async () => {
      const sourceCategories = [
        { id: 'src-cat-1', name: 'Music' },
        { id: 'src-cat-2', name: 'Sports' },
      ];
      const mappings = [
        { sourceCategoryId: 'src-cat-1', sourceCategoryName: 'Music', localCategoryId: 'local-cat-1' },
        // src-cat-2 is NOT mapped
      ];
      const localCategories = [
        { id: 'local-cat-1', name: 'Arts' },
        { id: 'local-cat-2', name: 'Recreation' },
      ];

      mockFeedService.getSourceCategories.mockResolvedValue(sourceCategories);
      mockFeedService.getCategoryMappings.mockResolvedValue(mappings);
      mockFeedService.getCalendarCategories.mockResolvedValue(localCategories);

      await feedStore.repostEvent('event-1');

      // Should NOT have called shareEvent yet
      expect(mockFeedService.shareEvent).not.toHaveBeenCalled();

      // Should have set pendingRepost
      expect(feedStore.pendingRepost).not.toBeNull();
      expect(feedStore.pendingRepost?.eventId).toBe('event-1');
      expect(feedStore.pendingRepost?.preSelectedIds).toEqual(['local-cat-1']);
      expect(feedStore.pendingRepost?.sourceCategories).toEqual(sourceCategories);
      expect(feedStore.pendingRepost?.allLocalCategories).toEqual(localCategories);

      // Should NOT have applied optimistic update yet
      expect(feedStore.events[0].repostStatus).toBe('none');
    });

    it('should set pendingRepost with empty preSelectedIds when no mappings exist', async () => {
      const sourceCategories = [{ id: 'src-cat-1', name: 'Music' }];

      mockFeedService.getSourceCategories.mockResolvedValue(sourceCategories);
      mockFeedService.getCategoryMappings.mockResolvedValue([]);
      mockFeedService.getCalendarCategories.mockResolvedValue([{ id: 'local-cat-1', name: 'Arts' }]);

      await feedStore.repostEvent('event-1');

      expect(feedStore.pendingRepost?.preSelectedIds).toEqual([]);
    });

    it('confirmPendingRepost should call shareEvent with selected IDs and clear pendingRepost', async () => {
      // Set up a pending repost
      feedStore.pendingRepost = {
        eventId: 'event-1',
        preSelectedIds: ['local-cat-1'],
        sourceCategories: [{ id: 'src-cat-1', name: 'Music' }],
        allLocalCategories: [{ id: 'local-cat-1', name: 'Arts' }],
      };
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      await feedStore.confirmPendingRepost(['local-cat-1', 'local-cat-2']);

      expect(mockFeedService.shareEvent).toHaveBeenCalledWith('cal-1', 'https://remote.example/events/abc', ['local-cat-1', 'local-cat-2']);
      expect(feedStore.pendingRepost).toBeNull();
      expect(feedStore.events[0].repostStatus).toBe('manual');
    });

    it('cancelPendingRepost should clear pendingRepost without calling shareEvent', () => {
      feedStore.pendingRepost = {
        eventId: 'event-1',
        preSelectedIds: [],
        sourceCategories: [{ id: 'src-cat-1', name: 'Music' }],
        allLocalCategories: [],
      };

      feedStore.cancelPendingRepost();

      expect(feedStore.pendingRepost).toBeNull();
      expect(mockFeedService.shareEvent).not.toHaveBeenCalled();
      // Event status should be unchanged
      expect(feedStore.events[0].repostStatus).toBe('none');
    });

    it('should repost silently when follow cannot be determined (multiple follows, no domain match)', async () => {
      // Add a second follow with different domain
      feedStore.follows = [
        {
          id: 'follow-1',
          calendarActorId: 'source@remote.example',
          calendarActorUuid: 'uuid-follow-1',
          calendarId: 'cal-1',
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
        {
          id: 'follow-2',
          calendarActorId: 'other@another.example',
          calendarActorUuid: 'uuid-follow-2',
          calendarId: 'cal-1',
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
      ];
      // Event from a different domain not in follows
      feedStore.events = [
        {
          id: 'event-1',
          calendarId: null,
          eventSourceUrl: 'https://unknown.example/events/abc',
          categories: [],
          repostStatus: 'none',
        },
      ];
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      await feedStore.repostEvent('event-1');

      // Should repost silently without checking categories
      expect(mockFeedService.getSourceCategories).not.toHaveBeenCalled();
      expect(mockFeedService.shareEvent).toHaveBeenCalledWith('cal-1', 'https://unknown.example/events/abc', []);
    });

    it('should repost silently when getSourceCategories fails', async () => {
      mockFeedService.getSourceCategories.mockRejectedValue(new Error('API Error'));
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      await feedStore.repostEvent('event-1');

      expect(mockFeedService.shareEvent).toHaveBeenCalledWith('cal-1', 'https://remote.example/events/abc', []);
      expect(feedStore.pendingRepost).toBeNull();
    });

    it('should use single follow as fallback when event domain does not match', async () => {
      // Single follow, event has different domain
      feedStore.events = [
        {
          id: 'event-1',
          calendarId: null,
          eventSourceUrl: 'https://different.example/events/abc',
          categories: [],
          repostStatus: 'none',
        },
      ];
      mockFeedService.getSourceCategories.mockResolvedValue([]);
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      await feedStore.repostEvent('event-1');

      // Should still call getSourceCategories with the single follow's actorId
      expect(mockFeedService.getSourceCategories).toHaveBeenCalledWith('cal-1', 'uuid-follow-1');
    });
  });

  describe('hasMultipleCalendars getter', () => {
    it('should return true when user has multiple calendars', () => {
      expect(feedStore.hasMultipleCalendars).toBe(true);
    });

    it('should return false when user has single calendar', () => {
      const singleCalendar = new Calendar('cal-1', 'calendar-one');
      calendarStore.setCalendars([singleCalendar]);

      expect(feedStore.hasMultipleCalendars).toBe(false);
    });

    it('should return false when user has no calendars', () => {
      calendarStore.setCalendars([]);

      expect(feedStore.hasMultipleCalendars).toBe(false);
    });
  });

  describe('loading state getters', () => {
    it('should track loading state for events', () => {
      expect(feedStore.isLoadingEvents).toBe(false);

      feedStore.loading.events = true;

      expect(feedStore.isLoadingEvents).toBe(true);
    });

    it('should track loading state for follows', () => {
      expect(feedStore.isLoadingFollows).toBe(false);

      feedStore.loading.follows = true;

      expect(feedStore.isLoadingFollows).toBe(true);
    });

    it('should track loading state for followers', () => {
      expect(feedStore.isLoadingFollowers).toBe(false);

      feedStore.loading.followers = true;

      expect(feedStore.isLoadingFollowers).toBe(true);
    });
  });
});
