import type { Ref } from 'vue';
import FeedService from '@/client/service/feed';
import { useFeedStore } from '@/client/stores/feedStore';
import { useLatestRequest } from '@/client/composables/useLatestRequest';

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
  const { isLoading, startRequest, finishRequest, isInFlightFor } = useLatestRequest();

  /**
   * Load the initial page of feed events for the selected calendar.
   * Guarded: skips if no calendar is selected or a load for the same
   * calendar is in flight. A load for a calendar switched away from does
   * not block the new calendar's load.
   */
  const loadFeed = async () => {
    const calendarId = feedStore.selectedCalendarId;
    if (!calendarId || isInFlightFor(calendarId)) {
      return;
    }

    const request = startRequest(calendarId);
    try {
      await feedService.loadFeed(calendarId);
    }
    catch (error) {
      console.error('Error loading feed:', error);
      throw error;
    }
    finally {
      finishRequest(request);
    }
  };

  /**
   * Load the next page of feed events for infinite scroll.
   * Guarded: skips if already loading, no more pages, or no calendar selected.
   */
  const loadMore = async () => {
    const calendarId = feedStore.selectedCalendarId;
    if (!calendarId || isLoading.value || !feedStore.eventsHasMore) {
      return;
    }

    const request = startRequest(calendarId);
    try {
      await feedService.loadMoreFeed(calendarId, feedStore.eventsPage + 1);
    }
    catch (error) {
      console.error('Error loading more feed events:', error);
      throw error;
    }
    finally {
      finishRequest(request);
    }
  };

  return { isLoading, loadFeed, loadMore };
}
