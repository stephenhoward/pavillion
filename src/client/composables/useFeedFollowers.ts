import { ref } from 'vue';
import type { Ref } from 'vue';
import FeedService from '@/client/service/feed';
import { useFeedStore } from '@/client/stores/feedStore';

/**
 * Return type for the useFeedFollowers composable
 */
export interface UseFeedFollowersReturn {
  isLoading: Ref<boolean>;
  loadFollowers: () => Promise<void>;
}

/**
 * Composable for managing follower data loading.
 *
 * @returns Followers loading state and methods
 */
export function useFeedFollowers(): UseFeedFollowersReturn {
  const feedService = new FeedService();
  const feedStore = useFeedStore();
  const isLoading = ref(false);

  /**
   * Load the list of calendars following the user.
   */
  const loadFollowers = async () => {
    if (!feedStore.selectedCalendarId) {
      return;
    }

    isLoading.value = true;
    try {
      await feedService.loadFollowers(feedStore.selectedCalendarId);
    }
    catch (error) {
      console.error('Error loading followers:', error);
      throw error;
    }
    finally {
      isLoading.value = false;
    }
  };

  return { isLoading, loadFollowers };
}
