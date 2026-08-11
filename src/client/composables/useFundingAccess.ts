import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import FundingService, { fundingGateDenial } from '@/client/service/funding';
import { useFundingStore } from '@/client/stores/fundingStore';
import type { FundingGatedFeature, FundingStatus } from '@/common/model/funding-plan';

/**
 * What the client knows about one feature's gate on one calendar.
 *
 * Three values, not two, because the server has three answers: the gate is
 * open, the gate is closed, or the instance funding state could not be read.
 * The third is `unknown`, and it must render as neither of the others — an
 * operator whose database hiccuped is not shown an upsell.
 */
export type FundingAccessState = 'unknown' | 'granted' | 'denied';

/**
 * Return type for the useFundingAccess composable.
 */
export interface UseFundingAccessReturn {
  /** The calendar's funding relationship label, for display only. */
  status: ComputedRef<FundingStatus | null>;
  /** Whether a load is in flight. */
  isLoading: Ref<boolean>;
  /** The full gate answer for a feature, including "not known". */
  accessState: (feature: FundingGatedFeature) => FundingAccessState;
  /** True only when the gate is known to be open. */
  hasAccess: (feature: FundingGatedFeature) => boolean;
  /** Load the summary unless it is already cached. */
  ensureLoaded: () => Promise<void>;
  /** Load the summary, cached or not. */
  refresh: () => Promise<void>;
  /** Fold a caught error into the cache if it was a funding refusal. */
  recordAccessDenial: (error: unknown) => boolean;
}

/**
 * Composable exposing a calendar's funding-gate answers to components.
 *
 * The gate answer is the per-feature `features` map from
 * `GET /calendars/:calendarId/funding`, and `hasAccess` reads it. `status` is
 * published alongside for display — "funded", "on a grant" — and is
 * deliberately not what any capability decision reads. The two answer
 * different questions and are allowed to disagree, so branching on
 * `status === 'funded'` to decide what a calendar may do is a bug even on the
 * days it happens to give the same answer.
 *
 * Data flows Components -> useFundingAccess -> FundingService -> fundingStore:
 * the composable owns loading state and gate interpretation, the service owns
 * the request and the cache write, and the store holds nothing else.
 *
 * @param calendarId - The calendar whose funding is being asked about
 * @returns Funding-gate state and the operations that change it
 */
export function useFundingAccess(calendarId: string): UseFundingAccessReturn {
  const fundingService = new FundingService();
  const fundingStore = useFundingStore();
  const isLoading = ref(false);

  const status = computed(() => fundingStore.statusFor(calendarId));

  /**
   * Read a feature's gate decision from the cache.
   *
   * `null` from the store means nothing has told us yet — either nothing has
   * been loaded, or the load failed. Both are `unknown`, never `denied`.
   */
  const accessState = (feature: FundingGatedFeature): FundingAccessState => {
    const access = fundingStore.featureAccess(calendarId, feature);
    if (access === null) {
      return 'unknown';
    }
    return access ? 'granted' : 'denied';
  };

  /**
   * Whether the calendar may use a feature.
   *
   * True only for a known-open gate. This is not the inverse of "show the
   * upsell": a UI that offers funding must test for `denied` explicitly, or an
   * unreadable funding state would sell to someone who may already have access.
   */
  const hasAccess = (feature: FundingGatedFeature): boolean => {
    return accessState(feature) === 'granted';
  };

  /**
   * Fetch the summary through the service, which caches it.
   *
   * A failed read is swallowed after logging, on purpose: it leaves every
   * feature exactly as it was — unknown if nothing was loaded, still granted
   * if something was. Rejecting here would push each caller into an error
   * branch whose only correct behaviour is to change nothing.
   */
  const load = async (): Promise<void> => {
    if (isLoading.value) {
      return;
    }

    isLoading.value = true;
    try {
      await fundingService.loadFundingSummary(calendarId);
    }
    catch (error) {
      console.error('Error loading funding access:', error);
    }
    finally {
      isLoading.value = false;
    }
  };

  /**
   * Load the calendar's funding summary unless it is already cached.
   * Safe to call from every consumer's mount; only the first one requests.
   */
  const ensureLoaded = async (): Promise<void> => {
    if (fundingStore.statusFor(calendarId) !== null) {
      return;
    }
    await load();
  };

  /**
   * Re-read the calendar's funding summary, cached or not. Call after anything
   * that could have changed it — a completed checkout, a cancelled plan.
   */
  const refresh = async (): Promise<void> => {
    await load();
  };

  /**
   * Fold a caught error into the cache when it is a funding refusal.
   *
   * This is the shared replacement for per-component 402 sniffing. It returns
   * whether the error was a funding refusal, so a caller can hand anything
   * else to its ordinary error handling.
   *
   * @param error - An error caught from any request against this calendar
   * @returns True if the error was a funding refusal and was recorded
   */
  const recordAccessDenial = (error: unknown): boolean => {
    const feature = fundingGateDenial(error);
    if (!feature) {
      return false;
    }

    fundingStore.denyFeature(calendarId, feature);
    return true;
  };

  return { status, isLoading, accessState, hasAccess, ensureLoaded, refresh, recordAccessDenial };
}
