import { defineStore } from 'pinia';
import { useCalendarStore } from './calendarStore';
import FeedService, {
  type FollowRelationship,
  type FollowerRelationship,
  type FeedEvent,
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
  loading: {
    follows: boolean;
    followers: boolean;
    events: boolean;
  };
}

/**
 * Pinia store for managing feed state and operations
 */
export const useFeedStore = defineStore('feed', {
  state: (): FeedState => {
    return {
      follows: [],
      followers: [],
      events: [],
      eventsPage: 0,
      eventsHasMore: false,
      loading: {
        follows: false,
        followers: false,
        events: false,
      },
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

    /**
     * Check if events are currently loading
     */
    isLoadingEvents(): boolean {
      return this.loading.events;
    },

    /**
     * Check if follows are currently loading
     */
    isLoadingFollows(): boolean {
      return this.loading.follows;
    },

    /**
     * Check if followers are currently loading
     */
    isLoadingFollowers(): boolean {
      return this.loading.followers;
    },
  },

  actions: {
    /**
     * Set the selected calendar and clear cached feed data
     *
     * @param calendarId - The ID of the calendar to select
     */
    setSelectedCalendar(calendarId: string) {
      const calendarStore = useCalendarStore();
      const previousCalendarId = calendarStore.selectedCalendarId;

      if (previousCalendarId !== calendarId) {
        // Update the calendar store's selected calendar
        calendarStore.setSelectedCalendar(calendarId);

        // Clear cached feed data when calendar changes
        this.follows = [];
        this.followers = [];
        this.events = [];
        this.eventsPage = 0;
        this.eventsHasMore = false;
      }
    },

    /**
     * Load list of calendars the user follows
     */
    async loadFollows() {
      if (!this.selectedCalendarId) {
        return;
      }

      this.loading.follows = true;
      try {
        const feedService = new FeedService();
        this.follows = await feedService.getFollows(this.selectedCalendarId);
      }
      catch (error) {
        console.error('Error loading follows:', error);
        throw error;
      }
      finally {
        this.loading.follows = false;
      }
    },

    /**
     * Load list of calendars following the user
     */
    async loadFollowers() {
      if (!this.selectedCalendarId) {
        return;
      }

      this.loading.followers = true;
      try {
        const feedService = new FeedService();
        this.followers = await feedService.getFollowers(this.selectedCalendarId);
      }
      catch (error) {
        console.error('Error loading followers:', error);
        throw error;
      }
      finally {
        this.loading.followers = false;
      }
    },

    /**
     * Load feed events from followed calendars
     *
     * @param append - If true, append to existing events (for infinite scroll)
     */
    async loadFeed(append: boolean = false) {
      if (!this.selectedCalendarId) {
        return;
      }

      this.loading.events = true;
      try {
        const feedService = new FeedService();
        const page = append ? this.eventsPage + 1 : 0;
        const response = await feedService.getFeed(this.selectedCalendarId, page, 20);

        if (append) {
          this.events = [...this.events, ...response.events];
          this.eventsPage = page;
        }
        else {
          this.events = response.events;
          this.eventsPage = 0;
        }

        this.eventsHasMore = response.hasMore;
      }
      catch (error) {
        console.error('Error loading feed:', error);
        throw error;
      }
      finally {
        this.loading.events = false;
      }
    },

    /**
     * Follow a remote calendar
     *
     * @param identifier - The remote calendar identifier (e.g., calendar@domain.com)
     * @param autoRepostOriginals - Whether to auto-repost original events (default: false)
     * @param autoRepostReposts - Whether to auto-repost shared events (default: false)
     */
    async followCalendar(
      identifier: string,
      autoRepostOriginals: boolean = false,
      autoRepostReposts: boolean = false,
    ) {
      if (!this.selectedCalendarId) {
        return;
      }

      const feedService = new FeedService();
      await feedService.followCalendar(this.selectedCalendarId, identifier, autoRepostOriginals, autoRepostReposts);

      // Refresh follows list
      await this.loadFollows();
    },

    /**
     * Unfollow a remote calendar with optimistic update
     *
     * @param followId - The follow relationship ID to remove
     */
    async unfollowCalendar(followId: string) {
      if (!this.selectedCalendarId) {
        return;
      }

      // Optimistic update
      const previousFollows = [...this.follows];
      this.follows = this.follows.filter((f) => f.id !== followId);

      try {
        const feedService = new FeedService();
        await feedService.unfollowCalendar(this.selectedCalendarId, followId);
      }
      catch (error) {
        // Rollback on error
        this.follows = previousFollows;
        throw error;
      }
    },

    /**
     * Update the auto-repost policy for a follow relationship
     *
     * @param followId - The follow relationship ID
     * @param autoRepostOriginals - Whether to auto-repost original events
     * @param autoRepostReposts - Whether to auto-repost shared events
     */
    async updateFollowPolicy(
      followId: string,
      autoRepostOriginals: boolean,
      autoRepostReposts: boolean,
    ) {
      if (!this.selectedCalendarId) {
        return;
      }

      const followIndex = this.follows.findIndex((f) => f.id === followId);
      if (followIndex === -1) {
        return;
      }

      // Optimistic update
      const previousOriginals = this.follows[followIndex].autoRepostOriginals;
      const previousReposts = this.follows[followIndex].autoRepostReposts;
      this.follows[followIndex].autoRepostOriginals = autoRepostOriginals;
      this.follows[followIndex].autoRepostReposts = autoRepostReposts;

      try {
        const feedService = new FeedService();
        const updated = await feedService.updateFollowPolicy(
          followId,
          autoRepostOriginals,
          autoRepostReposts,
          this.selectedCalendarId,
        );
        this.follows[followIndex] = updated;
      }
      catch (error) {
        // Rollback on error
        this.follows[followIndex].autoRepostOriginals = previousOriginals;
        this.follows[followIndex].autoRepostReposts = previousReposts;
        throw error;
      }
    },

    /**
     * Repost an event from the feed to the current calendar
     *
     * @param eventId - The ID of the event to repost
     */
    async repostEvent(eventId: string) {
      if (!this.selectedCalendarId) {
        return;
      }

      const eventIndex = this.events.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) {
        return;
      }

      // Optimistic update
      const previousStatus = this.events[eventIndex].repostStatus;
      this.events[eventIndex].repostStatus = 'manual';

      try {
        const feedService = new FeedService();
        await feedService.shareEvent(this.selectedCalendarId, eventId);
      }
      catch (error) {
        // Rollback on error
        this.events[eventIndex].repostStatus = previousStatus;
        console.error('Error reposting event:', error);
        throw error;
      }
    },

    /**
     * Un-repost an event (remove repost from current calendar)
     *
     * @param eventId - The ID of the event to un-repost
     */
    async unrepostEvent(eventId: string) {
      if (!this.selectedCalendarId) {
        return;
      }

      const eventIndex = this.events.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) {
        return;
      }

      // Optimistic update
      const previousStatus = this.events[eventIndex].repostStatus;
      this.events[eventIndex].repostStatus = 'none';

      try {
        const feedService = new FeedService();
        await feedService.unshareEvent(this.selectedCalendarId, eventId);
      }
      catch (error) {
        // Rollback on error
        this.events[eventIndex].repostStatus = previousStatus;
        console.error('Error unreposting event:', error);
        throw error;
      }
    },
  },
});
