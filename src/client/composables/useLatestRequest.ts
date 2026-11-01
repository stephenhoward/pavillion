import { ref } from 'vue';
import type { Ref } from 'vue';

/** One request tracked by useLatestRequest, scoped to the calendar it loads. */
export interface TrackedRequest {
  calendarId: string;
}

/**
 * Return type for the useLatestRequest composable
 */
export interface UseLatestRequestReturn {
  isLoading: Ref<boolean>;
  startRequest: (calendarId: string) => TrackedRequest;
  finishRequest: (request: TrackedRequest) => void;
  isInFlightFor: (calendarId: string) => boolean;
}

/**
 * Loading state that follows only the latest request. Switching calendars
 * starts a new request while the previous one may still be in flight; the
 * older one finishing must not clear isLoading for the newer one.
 *
 * @returns Loading flag and the functions that start and finish a request
 */
export function useLatestRequest(): UseLatestRequestReturn {
  const isLoading = ref(false);
  let activeRequest: TrackedRequest | null = null;

  const startRequest = (calendarId: string): TrackedRequest => {
    const request = { calendarId };
    activeRequest = request;
    isLoading.value = true;
    return request;
  };

  const finishRequest = (request: TrackedRequest) => {
    if (activeRequest === request) {
      activeRequest = null;
      isLoading.value = false;
    }
  };

  const isInFlightFor = (calendarId: string) => activeRequest?.calendarId === calendarId;

  return { isLoading, startRequest, finishRequest, isInFlightFor };
}
