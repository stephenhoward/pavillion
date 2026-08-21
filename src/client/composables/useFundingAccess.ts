import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import FundingService, { fundingGateDenial } from '@/client/service/funding';
import { useFundingStore } from '@/client/stores/fundingStore';
import type { FundingGatedFeature, FundingStatus } from '@/common/model/funding-plan';

/**
 * What the client knows about one feature's gate on one calendar.
 *
 * Three values, not two, because there are three things we can be in: the
 * server said the gate is open, the server said it is not, or we could not
 * read the server at all. The third is `unknown`, and it must render as
 * neither of the others — an operator whose database hiccuped is not shown an
 * upsell.
 *
 * `denied` carries less than its name suggests. The wire only has two values,
 * and `false` there means "no source produced an allow", not "determinately
 * not covered": `FundingService.readAccessSource` on the server catches an
 * unreadable grants table or plan lookup, logs it, and contributes `false`
 * (only the instance-settings read throws). So a calendar genuinely covered by
 * a grant, on an instance whose grant table is momentarily unreadable, arrives
 * here as `denied`. That server-side tradeoff is deliberate — an unreadable
 * source can only ever cost access it could not justify — but it means the
 * client cannot recover the distinction, and `denied` is the weaker claim
 * "nothing we can see grants this".
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
  /** True only when the gate is known to be closed. The upsell predicate. */
  isDenied: (feature: FundingGatedFeature) => boolean;
  /** Load the summary unless it is already cached. */
  ensureLoaded: () => Promise<void>;
  /** Load the summary, cached or not. */
  refresh: () => Promise<void>;
  /** Fold a caught error into the cache if it was a funding refusal. */
  recordAccessDenial: (error: unknown) => boolean;
}

/**
 * Loads currently in flight, keyed by calendar id.
 *
 * Module scope on purpose. The point of the guarantee on `ensureLoaded` is
 * that two components each holding their own `useFundingAccess(id)` issue one
 * request between them, so a ref inside the composable is the wrong lifetime —
 * it dedupes an instance against itself, which nothing was doing. The store is
 * the other candidate and is worse: it documents itself as a data cache
 * holding only what is on the wire, and a pending promise is neither.
 *
 * Holds no user data, and each entry deletes itself when its load settles, so
 * there is nothing here for logout to clear.
 */
const inFlightLoads = new Map<string, Promise<void>>();

/**
 * Composable exposing a calendar's funding-gate answers to components.
 *
 * The gate answer is the per-feature `features` map from
 * `GET /calendars/:calendarId/funding`, and `hasAccess` reads it. `status` is
 * published alongside for display — "covered", "on a grant" — and is
 * deliberately not what any capability decision reads. The two answer
 * different questions and are allowed to disagree, so branching on
 * `status === 'covered'` to decide what a calendar may do is a bug even on the
 * days it happens to give the same answer.
 *
 * Reads and writes take different routes, as they do in useFeedFollows and
 * useFeedEvents. Reads (`status`, `accessState`, `hasAccess`, `isDenied`) come
 * straight off the fundingStore cache — no request, no service. Writes go
 * through FundingService, which owns the request and is the only thing that
 * writes an authoritative summary into the cache; the one exception is
 * `recordAccessDenial`, which folds a 402 the component already caught into
 * the cache without a round trip. The composable itself owns only loading
 * state and the interpretation of a cached decision as a gate answer.
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
   * upsell" — `!hasAccess` is also true while access is unknown. Use
   * `isDenied` for that branch.
   */
  const hasAccess = (feature: FundingGatedFeature): boolean => {
    return accessState(feature) === 'granted';
  };

  /**
   * Whether the calendar is known to be shut out of a feature.
   *
   * The predicate an upsell branches on. It exists because `!hasAccess()` is
   * the shorter and more obvious way to write that and is wrong: `hasAccess`
   * folds `unknown` in with `denied`, so negating it offers funding during our
   * own outage to an operator who may already have paid. Only `denied` is a
   * reason to sell anything, and only this returns true for it.
   *
   * Read `accessState` directly for any third branch — a "we cannot tell right
   * now" notice, say. These two predicates are deliberately not exhaustive.
   */
  const isDenied = (feature: FundingGatedFeature): boolean => {
    return accessState(feature) === 'denied';
  };

  /**
   * Fetch the summary through the service, which caches it.
   *
   * A failed read is swallowed after logging, on purpose: it leaves every
   * feature exactly as it was — unknown if nothing was loaded, still granted
   * if something was. Rejecting here would push each caller into an error
   * branch whose only correct behaviour is to change nothing.
   */
  const startLoad = (): Promise<void> => {
    const request = fundingService.loadFundingSummary(calendarId)
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error('Error loading funding access:', error);
      })
      .finally(() => {
        inFlightLoads.delete(calendarId);
      });

    inFlightLoads.set(calendarId, request);
    return request;
  };

  /**
   * Await this calendar's load, starting one only if none is running.
   *
   * A caller that arrives mid-flight joins the request already out rather than
   * issuing its own, and reports `isLoading` for as long as it waits.
   */
  const load = async (): Promise<void> => {
    isLoading.value = true;
    try {
      await (inFlightLoads.get(calendarId) ?? startLoad());
    }
    finally {
      isLoading.value = false;
    }
  };

  /**
   * Load the calendar's funding summary unless it is already cached.
   *
   * Safe to call from every consumer's mount; only one request goes out
   * however many consumers call it, whether they arrive after the first load
   * settled (served from the cache) or during it (joined to the request in
   * flight).
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
   *
   * If a load is already in flight this joins it instead of racing a second
   * one, so a refresh triggered while the initial mount is still loading
   * resolves with that load's answer.
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

  return { status, isLoading, accessState, hasAccess, isDenied, ensureLoaded, refresh, recordAccessDenial };
}
