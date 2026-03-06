import { defineStore } from 'pinia';
import { useCalendarStore } from './calendarStore';
import type {
  FollowRelationship,
  FollowerRelationship,
  FeedEvent,
} from '@/client/service/feed';

/**
 * State interface for the feed store
 */
interface FeedState {
  follows: FollowRelationship[];
  followers: FollowerRelationship[];
  events: FeedEvent[];
  eventsPage: number;
  eventsHasMore: boolean;
}

/**
 * Pinia store for feed data cache.
 * Contains only data state and simple mutation actions.
 * API calls and loading state are managed by composables and FeedService.
 */
export const useFeedStore = defineStore('feed', {
  state: (): FeedState => {
    return {
      follows: [],
      followers: [],
      events: [],
      eventsPage: 0,
      eventsHasMore: false,
    };
  },

  getters: {
    /**
     * Get the currently selected calendar ID from the calendar store
     */
    selectedCalendarId(): string | null {
      const calendarStore = useCalendarStore();
      return calendarStore.selectedCalendarId;
    },

    /**
     * Get the currently selected calendar from the calendar store
     */
    selectedCalendar(): any {
      const calendarStore = useCalendarStore();
      return calendarStore.selectedCalendar;
    },

    /**
     * Check if the user has multiple calendars
     */
    hasMultipleCalendars(): boolean {
      const calendarStore = useCalendarStore();
      return calendarStore.calendars.length > 1;
    },
  },

  actions: {
    /**
     * Clear all cached feed data, resetting follows, followers, events,
     * and pagination state to their initial values.
     */
    clearFeedData() {
      this.follows = [];
      this.followers = [];
      this.events = [];
      this.eventsPage = 0;
      this.eventsHasMore = false;
    },

    /**
     * Clear cached feed data when the selected calendar changes.
     * Does not mutate the calendar store; calendar selection is
     * handled by the calendar store directly.
     *
     * @param _calendarId - The ID of the calendar being selected (unused, retained for caller compatibility)
     */
    setSelectedCalendar(_calendarId: string) {
      this.clearFeedData();
    },

    /**
     * Replace the follows list.
     */
    setFollows(follows: FollowRelationship[]) {
      this.follows = follows;
    },

    /**
     * Replace the followers list.
     */
    setFollowers(followers: FollowerRelationship[]) {
      this.followers = followers;
    },

    /**
     * Replace the events list and reset pagination to page 0.
     */
    setEvents(events: FeedEvent[]) {
      this.events = events;
      this.eventsPage = 0;
    },

    /**
     * Append events to the list for infinite scroll pagination.
     *
     * @param events - New events to append
     * @param page - The page number these events correspond to
     */
    appendEvents(events: FeedEvent[], page: number) {
      this.events = [...this.events, ...events];
      this.eventsPage = page;
    },

    /**
     * Set whether more events are available for pagination.
     */
    setEventsHasMore(hasMore: boolean) {
      this.eventsHasMore = hasMore;
    },
  },
});
