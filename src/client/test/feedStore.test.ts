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
    it('should set and persist selected calendar ID', () => {
      expect(feedStore.selectedCalendarId).toBeNull();

      feedStore.setSelectedCalendar('cal-1');

      expect(feedStore.selectedCalendarId).toBe('cal-1');
    });

    it('should get selected calendar from calendar store', () => {
      feedStore.setSelectedCalendar('cal-1');

      const calendar = feedStore.selectedCalendar;

      expect(calendar).toBeDefined();
      expect(calendar?.id).toBe('cal-1');
    });

    it('should clear cached data when calendar selection changes', () => {
      feedStore.follows = [
        { id: 'follow-1', remoteCalendarId: 'remote@example.com', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: false },
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

  describe('follows/followers/events state management', () => {
    it('should store follows list with new boolean fields', () => {
      const follows = [
        { id: 'follow-1', remoteCalendarId: 'remote1@example.com', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: false },
        { id: 'follow-2', remoteCalendarId: 'remote2@example.com', calendarId: 'cal-1', autoRepostOriginals: true, autoRepostReposts: true },
      ];

      feedStore.follows = follows;

      expect(feedStore.follows).toEqual(follows);
      expect(feedStore.follows).toHaveLength(2);
    });

    it('should store followers list', () => {
      const followers = [
        { id: 'follower-1', remoteCalendarId: 'follower1@example.com' },
        { id: 'follower-2', remoteCalendarId: 'follower2@example.com' },
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
      feedStore.setSelectedCalendar('cal-1');
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
      feedStore.setSelectedCalendar('cal-1');
      feedStore.events = [
        { id: 'event-1', title: 'Event 1', repostStatus: 'none' },
        { id: 'event-2', title: 'Event 2', repostStatus: 'manual' },
      ];
    });

    it('should optimistically update repost status on shareEvent', async () => {
      mockFeedService.shareEvent.mockResolvedValue(undefined);

      const promise = feedStore.repostEvent('event-1');

      // Check optimistic update
      expect(feedStore.events[0].repostStatus).toBe('manual');

      await promise;

      expect(mockFeedService.shareEvent).toHaveBeenCalledWith('cal-1', 'event-1');
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
