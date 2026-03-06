import { ref } from 'vue';
import type { Ref } from 'vue';
import FeedService from '@/client/service/feed';
import { useFeedStore } from '@/client/stores/feedStore';

/**
 * Return type for the useFeedFollows composable
 */
export interface UseFeedFollowsReturn {
  isLoading: Ref<boolean>;
  loadFollows: () => Promise<void>;
  followCalendar: (
    identifier: string,
    autoRepostOriginals?: boolean,
    autoRepostReposts?: boolean,
  ) => Promise<string | null>;
  unfollowCalendar: (followId: string) => Promise<void>;
  updateFollowPolicy: (
    followId: string,
    autoRepostOriginals: boolean,
    autoRepostReposts: boolean,
  ) => Promise<void>;
}

/**
 * Composable for managing follow relationships.
 * Handles loading state and optimistic updates for unfollow/policy changes.
 *
 * @returns Follow management state and methods
 */
export function useFeedFollows(): UseFeedFollowsReturn {
  const feedService = new FeedService();
  const feedStore = useFeedStore();
  const isLoading = ref(false);

  /**
   * Load the list of calendars the user follows.
   */
  const loadFollows = async () => {
    if (!feedStore.selectedCalendarId) {
      return;
    }

    isLoading.value = true;
    try {
      await feedService.loadFollows(feedStore.selectedCalendarId);
    }
    catch (error) {
      console.error('Error loading follows:', error);
      throw error;
    }
    finally {
      isLoading.value = false;
    }
  };

  /**
   * Follow a remote calendar.
   *
   * @param identifier - The remote calendar identifier (e.g., calendar@domain.com)
   * @param autoRepostOriginals - Whether to auto-repost original events
   * @param autoRepostReposts - Whether to auto-repost shared events
   * @returns The calendarActorUuid of the newly added follow, or null if not found
   */
  const followCalendar = async (
    identifier: string,
    autoRepostOriginals: boolean = false,
    autoRepostReposts: boolean = false,
  ): Promise<string | null> => {
    if (!feedStore.selectedCalendarId) {
      return null;
    }

    const previousFollowIds = new Set(feedStore.follows.map((f) => f.id));

    await feedService.followCalendar(feedStore.selectedCalendarId, identifier, autoRepostOriginals, autoRepostReposts);

    // Refresh follows list to find the newly added follow
    await feedService.loadFollows(feedStore.selectedCalendarId);

    const newFollow = feedStore.follows.find((f) => !previousFollowIds.has(f.id));
    return newFollow?.calendarActorUuid ?? null;
  };

  /**
   * Unfollow a remote calendar with optimistic update.
   *
   * @param followId - The follow relationship ID to remove
   */
  const unfollowCalendar = async (followId: string) => {
    if (!feedStore.selectedCalendarId) {
      return;
    }

    // Optimistic update
    const previousFollows = [...feedStore.follows];
    feedStore.setFollows(feedStore.follows.filter((f) => f.id !== followId));

    try {
      await feedService.unfollowCalendar(feedStore.selectedCalendarId, followId);
    }
    catch (error) {
      // Rollback on error
      feedStore.setFollows(previousFollows);
      throw error;
    }
  };

  /**
   * Update the auto-repost policy for a follow relationship with optimistic update.
   *
   * @param followId - The follow relationship ID
   * @param autoRepostOriginals - Whether to auto-repost original events
   * @param autoRepostReposts - Whether to auto-repost shared events
   */
  const updateFollowPolicy = async (
    followId: string,
    autoRepostOriginals: boolean,
    autoRepostReposts: boolean,
  ) => {
    if (!feedStore.selectedCalendarId) {
      return;
    }

    const followIndex = feedStore.follows.findIndex((f) => f.id === followId);
    if (followIndex === -1) {
      return;
    }

    // Optimistic update
    const previousOriginals = feedStore.follows[followIndex].autoRepostOriginals;
    const previousReposts = feedStore.follows[followIndex].autoRepostReposts;
    feedStore.follows[followIndex].autoRepostOriginals = autoRepostOriginals;
    feedStore.follows[followIndex].autoRepostReposts = autoRepostReposts;

    try {
      const updated = await feedService.updateFollowPolicy(
        followId,
        autoRepostOriginals,
        autoRepostReposts,
        feedStore.selectedCalendarId,
      );
      feedStore.follows[followIndex] = updated;
    }
    catch (error) {
      // Rollback on error
      feedStore.follows[followIndex].autoRepostOriginals = previousOriginals;
      feedStore.follows[followIndex].autoRepostReposts = previousReposts;
      throw error;
    }
  };

  return { isLoading, loadFollows, followCalendar, unfollowCalendar, updateFollowPolicy };
}
