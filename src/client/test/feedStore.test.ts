import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';

describe('FeedStore', () => {
  let feedStore: ReturnType<typeof useFeedStore>;
  let calendarStore: ReturnType<typeof useCalendarStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    feedStore = useFeedStore();
    calendarStore = useCalendarStore();

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
        { id: 'follow-1', calendarActorId: 'remote@example.com', calendarActorUuid: '', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: false },
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
      feedStore.follows = [
        { id: 'follow-1', calendarActorId: 'remote@example.com', calendarActorUuid: '', calendarId: 'cal-1', autoRepostOriginals: true, autoRepostReposts: false },
        { id: 'follow-2', calendarActorId: 'remote2@example.com', calendarActorUuid: '', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: true },
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

  describe('mutation actions', () => {
    it('should set follows via setFollows', () => {
      const follows = [
        { id: 'follow-1', calendarActorId: 'remote1@example.com', calendarActorUuid: 'uuid-1', calendarId: 'cal-1', autoRepostOriginals: false, autoRepostReposts: false },
        { id: 'follow-2', calendarActorId: 'remote2@example.com', calendarActorUuid: 'uuid-2', calendarId: 'cal-1', autoRepostOriginals: true, autoRepostReposts: true },
      ];

      feedStore.setFollows(follows);

      expect(feedStore.follows).toEqual(follows);
      expect(feedStore.follows).toHaveLength(2);
    });

    it('should set followers via setFollowers', () => {
      const followers = [
        { id: 'follower-1', calendarActorId: 'follower1@example.com', calendarId: 'cal-1' },
        { id: 'follower-2', calendarActorId: 'follower2@example.com', calendarId: 'cal-1' },
      ];

      feedStore.setFollowers(followers);

      expect(feedStore.followers).toEqual(followers);
      expect(feedStore.followers).toHaveLength(2);
    });

    it('should set events via setEvents and reset page to 0', () => {
      feedStore.eventsPage = 3;
      const events = [
        { id: 'event-1', title: 'Event 1', repostStatus: 'none' },
        { id: 'event-2', title: 'Event 2', repostStatus: 'auto' },
      ];

      feedStore.setEvents(events);

      expect(feedStore.events).toEqual(events);
      expect(feedStore.events).toHaveLength(2);
      expect(feedStore.eventsPage).toBe(0);
    });

    it('should append events via appendEvents and update page', () => {
      feedStore.events = [{ id: 'event-1', title: 'Event 1', repostStatus: 'none' }];
      feedStore.eventsPage = 0;

      const newEvents = [
        { id: 'event-2', title: 'Event 2', repostStatus: 'none' },
        { id: 'event-3', title: 'Event 3', repostStatus: 'manual' },
      ];

      feedStore.appendEvents(newEvents, 1);

      expect(feedStore.events).toHaveLength(3);
      expect(feedStore.events[0].id).toBe('event-1');
      expect(feedStore.events[1].id).toBe('event-2');
      expect(feedStore.events[2].id).toBe('event-3');
      expect(feedStore.eventsPage).toBe(1);
    });

    it('should set eventsHasMore via setEventsHasMore', () => {
      expect(feedStore.eventsHasMore).toBe(false);

      feedStore.setEventsHasMore(true);

      expect(feedStore.eventsHasMore).toBe(true);

      feedStore.setEventsHasMore(false);

      expect(feedStore.eventsHasMore).toBe(false);
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
});
