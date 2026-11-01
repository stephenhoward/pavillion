import type { Ref } from 'vue';
import FeedService from '@/client/service/feed';
import { useFeedStore } from '@/client/stores/feedStore';
import { useLatestRequest } from '@/client/composables/useLatestRequest';

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
  const { isLoading, startRequest, finishRequest } = useLatestRequest();

  /**
   * Load the list of calendars following the user.
   */
  const loadFollowers = async () => {
    const calendarId = feedStore.selectedCalendarId;
    if (!calendarId) {
      return;
    }

    const request = startRequest(calendarId);
    try {
      await feedService.loadFollowers(calendarId);
    }
    catch (error) {
      console.error('Error loading followers:', error);
      throw error;
    }
    finally {
      finishRequest(request);
    }
  };

  return { isLoading, loadFollowers };
}
