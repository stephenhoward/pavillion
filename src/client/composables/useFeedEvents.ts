import { ref } from 'vue';
import type { Ref } from 'vue';
import FeedService from '@/client/service/feed';
import { useFeedStore } from '@/client/stores/feedStore';

/**
 * Return type for the useFeedEvents composable
 */
export interface UseFeedEventsReturn {
  isLoading: Ref<boolean>;
  loadFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/**
 * Composable for managing feed event loading and infinite scroll.
 * Guards against duplicate loadFeed() calls while loading.
 *
 * @returns Feed events loading state and methods
 */
export function useFeedEvents(): UseFeedEventsReturn {
  const feedService = new FeedService();
  const feedStore = useFeedStore();
  const isLoading = ref(false);

  /**
   * Load the initial page of feed events for the selected calendar.
   * Guarded: skips if already loading or no calendar selected.
   */
  const loadFeed = async () => {
    if (!feedStore.selectedCalendarId || isLoading.value) {
      return;
    }

    isLoading.value = true;
    try {
      await feedService.loadFeed(feedStore.selectedCalendarId);
    }
    catch (error) {
      console.error('Error loading feed:', error);
      throw error;
    }
    finally {
      isLoading.value = false;
    }
  };

  /**
   * Load the next page of feed events for infinite scroll.
   * Guarded: skips if already loading, no more pages, or no calendar selected.
   */
  const loadMore = async () => {
    if (!feedStore.selectedCalendarId || isLoading.value || !feedStore.eventsHasMore) {
      return;
    }

    isLoading.value = true;
    try {
      await feedService.loadMoreFeed(feedStore.selectedCalendarId, feedStore.eventsPage + 1);
    }
    catch (error) {
      console.error('Error loading more feed events:', error);
      throw error;
    }
    finally {
      isLoading.value = false;
    }
  };

  return { isLoading, loadFeed, loadMore };
}
