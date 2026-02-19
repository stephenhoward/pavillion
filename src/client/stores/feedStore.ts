import { defineStore } from 'pinia';
import { useCalendarStore } from './calendarStore';
import FeedService, {
  type FollowRelationship,
  type FollowerRelationship,
  type FeedEvent,
  type CategoryEntry,
  type CategoryMappingEntry,
} from '@/client/service/feed';

/**
 * State representing a pending repost that requires the user to select categories.
 */
interface PendingRepost {
  eventId: string;
  preSelectedIds: string[];
  sourceCategories: CategoryEntry[];
  allLocalCategories: CategoryEntry[];
}

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
  pendingRepost: PendingRepost | null;
}

/**
 * Attempt to find which follow relationship corresponds to a given feed event.
 * Uses a domain-based heuristic for remote events, or falls back to single-follow detection.
 *
 * @param follows - List of follow relationships
 * @param event - The feed event to match
 * @returns The matching follow relationship, or null if not determinable
 */
function findFollowForEvent(follows: FollowRelationship[], event: FeedEvent): FollowRelationship | null {
  if (follows.length === 0) {
    return null;
  }

  // For remote events: try to match by domain extracted from eventSourceUrl
  if (!event.calendarId && event.eventSourceUrl) {
    try {
      const eventDomain = new URL(event.eventSourceUrl).hostname;
      const match = follows.find((f) => {
        const parts = f.calendarActorId.split('@');
        return parts.length === 2 && parts[1] === eventDomain;
      });
      if (match) {
        return match;
      }
    }
    catch {
      // URL parse failed; fall through to single-follow fallback
    }
  }

  // Fallback: if there is exactly one follow, assume it is the source
  if (follows.length === 1) {
    return follows[0];
  }

  return null;
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
      pendingRepost: null,
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
     * @returns The calendarActorId of the newly added follow, or null if not found
     */
    async followCalendar(
      identifier: string,
      autoRepostOriginals: boolean = false,
      autoRepostReposts: boolean = false,
    ): Promise<string | null> {
      if (!this.selectedCalendarId) {
        return null;
      }

      const previousFollowIds = new Set(this.follows.map((f) => f.id));

      const feedService = new FeedService();
      await feedService.followCalendar(this.selectedCalendarId, identifier, autoRepostOriginals, autoRepostReposts);

      // Refresh follows list
      await this.loadFollows();

      // Find the newly added follow by comparing with the previous set of IDs
      const newFollow = this.follows.find((f) => !previousFollowIds.has(f.id));
      return newFollow?.calendarActorUuid ?? null;
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
     * Execute the actual repost API call with optional category IDs.
     * Applies an optimistic update before the call and rolls back on error.
     *
     * @param eventId - The ID of the event to repost
     * @param categoryIds - Local category IDs to assign to the reposted event
     */
    async _doRepost(eventId: string, categoryIds: string[]) {
      if (!this.selectedCalendarId) {
        return;
      }

      const eventIndex = this.events.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) {
        return;
      }

      // Use the event's ActivityPub source URL for the repost API call
      const eventSourceUrl = this.events[eventIndex].eventSourceUrl;

      // Optimistic update
      const previousStatus = this.events[eventIndex].repostStatus;
      this.events[eventIndex].repostStatus = 'manual';

      try {
        const feedService = new FeedService();
        await feedService.shareEvent(this.selectedCalendarId, eventSourceUrl, categoryIds);
      }
      catch (error) {
        // Rollback on error
        this.events[eventIndex].repostStatus = previousStatus;
        console.error('Error reposting event:', error);
        throw error;
      }
    },

    /**
     * Repost an event from the feed to the current calendar.
     *
     * Checks source categories and existing mappings before reposting:
     * - If source follow cannot be identified: reposts silently
     * - If source has no categories: reposts silently
     * - If all source categories are mapped: applies mappings silently
     * - If any source category is unmapped: sets pendingRepost state so the
     *   component can open the category selection modal
     *
     * @param eventId - The ID of the event to repost
     */
    async repostEvent(eventId: string) {
      if (!this.selectedCalendarId) {
        return;
      }

      const event = this.events.find((e) => e.id === eventId);
      if (!event) {
        return;
      }

      // Find the follow relationship for this event
      const follow = findFollowForEvent(this.follows, event);

      // If we cannot determine the source follow, repost silently
      if (!follow) {
        return this._doRepost(eventId, []);
      }

      const feedService = new FeedService();

      // Fetch source categories for this followed calendar
      let sourceCategories: CategoryEntry[] = [];
      try {
        sourceCategories = await feedService.getSourceCategories(this.selectedCalendarId, follow.calendarActorUuid);
      }
      catch {
        // If we can't fetch source categories, repost silently
        return this._doRepost(eventId, []);
      }

      // If the source calendar has no categories, repost silently
      if (sourceCategories.length === 0) {
        return this._doRepost(eventId, []);
      }

      // Fetch existing category mappings
      let mappings: CategoryMappingEntry[] = [];
      try {
        mappings = await feedService.getCategoryMappings(this.selectedCalendarId, follow.calendarActorUuid);
      }
      catch {
        // If we can't fetch mappings, fall through to show modal with empty pre-selection
      }

      // Build the list of pre-selected local category IDs from existing mappings
      const preSelectedIds = sourceCategories
        .map((src) => mappings.find((m) => m.sourceCategoryId === src.id)?.localCategoryId)
        .filter((id): id is string => id !== undefined);

      const allMapped = preSelectedIds.length === sourceCategories.length;

      if (allMapped) {
        // All source categories are mapped: apply silently
        return this._doRepost(eventId, preSelectedIds);
      }

      // Some categories are unmapped: fetch local categories and open the modal
      let allLocalCategories: CategoryEntry[] = [];
      try {
        allLocalCategories = await feedService.getCalendarCategories(this.selectedCalendarId);
      }
      catch {
        // If we can't load local categories, repost silently with partial mappings
        return this._doRepost(eventId, preSelectedIds);
      }

      // Signal to the component that a pending repost needs user input
      this.pendingRepost = {
        eventId,
        preSelectedIds,
        sourceCategories,
        allLocalCategories,
      };
    },

    /**
     * Confirm a pending repost with the user-selected category IDs.
     * Called by the component when the user confirms the modal.
     *
     * @param categoryIds - The category IDs selected by the user
     */
    async confirmPendingRepost(categoryIds: string[]) {
      if (!this.pendingRepost) {
        return;
      }

      const { eventId } = this.pendingRepost;
      this.pendingRepost = null;
      await this._doRepost(eventId, categoryIds);
    },

    /**
     * Cancel a pending repost, dismissing the modal without reposting.
     */
    cancelPendingRepost() {
      this.pendingRepost = null;
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
