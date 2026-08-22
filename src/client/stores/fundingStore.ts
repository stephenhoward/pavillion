import { defineStore } from 'pinia';
import type { CalendarFundingSummaryResponse } from '@/client/service/funding';
import type { FundingGatedFeature, FundingStatus } from '@/common/model/funding-plan';

/**
 * What is currently known about one calendar's funding.
 *
 * Every field is nullable or partial because knowledge arrives in pieces: a
 * 402 refusal names one feature and says nothing about the status, while the
 * funding endpoint answers all of it at once. An absent feature key means "not
 * asked yet", which is a different thing from a `false` decision — the
 * distinction is what keeps a funding state we could not read from being
 * displayed as an uncovered one.
 *
 * A cached `false` is the narrower claim "no source produced an allow". The
 * server contributes `false` for a source it could not read as well as for one
 * that answered no (see FundingService.readAccessSource), so a grant-covered
 * calendar on an instance with an unreadable grant table lands here as `false`
 * too. Nothing on the wire separates the two.
 */
export interface CalendarFundingCache {
  /**
   * How the calendar is covered. Display vocabulary, null until loaded — or
   * null from the server when the status was unreadable while `features`
   * was not, in which case ensureLoaded simply re-reads on the next mount.
   */
  status: FundingStatus | null;
  /** Known per-feature gate decisions. A missing key is not a denial. */
  features: Partial<Record<FundingGatedFeature, boolean>>;
}

/**
 * State interface for the funding store.
 */
interface FundingState {
  calendars: Record<string, CalendarFundingCache>;
}

/**
 * Build a record with no prototype, for the objects this cache keys by a
 * string it did not choose.
 *
 * A `{}` inherits from Object.prototype, and neither reading nor writing stops
 * at own properties: `calendars['toString']` resolves to a function, and
 * `calendars['__proto__'] = entry` runs the inherited setter, reparenting the
 * record instead of adding a key. Dropping the prototype closes both, at
 * construction, rather than by a guard at each site that has to be remembered
 * when the next one is added.
 *
 * Nothing here could pollute Object.prototype. What is at stake is
 * `featureAccess` — and `accessState` above it — being *total* over the ids
 * and keys it accepts: the tri-state safety argument assumes it always returns
 * one of its three answers rather than throwing on the way.
 *
 * @param source - Entries to copy in, if any
 * @returns The same shape, with a null prototype
 */
function prototypeFreeRecord<T extends object>(source?: T): T {
  const record = Object.create(null) as T;
  return source ? Object.assign(record, source) : record;
}

/**
 * Look up one calendar's cache entry, by own property only.
 *
 * A null prototype is not quite enough on its own. Vue's reactive `get` trap
 * shadows one key unconditionally — `proxy['hasOwnProperty']` returns Vue's
 * instrumented function whatever the target holds, before Reflect.get is
 * reached — so a calendar id of `hasOwnProperty` reads back as a non-nullish
 * value with no `features` on it. The two tests here answer null instead: an
 * own key, holding an object. A calendar cached under that one id is therefore
 * unreadable rather than wrong, which is the safe direction — unknown, never
 * denied — and no calendar id is ever that string.
 *
 * The read comes first and is discarded on the guarded path. The `get` trap is
 * what registers the reactive dependency, and `Object.hasOwn` goes through no
 * trap Vue defines, so testing before reading would leave a component that
 * asked about an uncached calendar with nothing to re-render on.
 *
 * @param calendars - The keyed cache from store state
 * @param calendarId - The calendar being asked about
 * @returns The cached entry, or null if the cache has no own entry for it
 */
function cacheEntry(
  calendars: Record<string, CalendarFundingCache>,
  calendarId: string,
): CalendarFundingCache | null {
  const entry: unknown = calendars[calendarId];
  if (!Object.hasOwn(calendars, calendarId) || typeof entry !== 'object' || entry === null) {
    return null;
  }
  return entry as CalendarFundingCache;
}

/**
 * Pinia store caching what the client knows about calendar funding.
 *
 * Data cache only: it holds no loading state, performs no requests, and is
 * written by FundingService (reads) and by useFundingAccess (402 refusals).
 * Components reach it through useFundingAccess, never directly.
 *
 * In-memory only — no persistence plugin. A reload starts empty, and
 * logout.vue calls `$reset()` so one session's funding answers cannot describe
 * the next session's account.
 */
export const useFundingStore = defineStore('funding', {
  state: (): FundingState => ({
    calendars: prototypeFreeRecord<Record<string, CalendarFundingCache>>(),
  }),

  getters: {
    /**
     * Everything cached for a calendar, or null if it has never been loaded.
     */
    summaryFor: (state) => (calendarId: string): CalendarFundingCache | null => {
      return cacheEntry(state.calendars, calendarId);
    },

    /**
     * A calendar's display status, or null while it is unknown.
     *
     * This is a relationship label. It answers "how is this calendar covered",
     * never "may this calendar do X" — that is featureAccess.
     */
    statusFor: (state) => (calendarId: string): FundingStatus | null => {
      return cacheEntry(state.calendars, calendarId)?.status ?? null;
    },

    /**
     * The gate decision for one feature on one calendar: true (some source
     * allowed it), false (none did) or null (we have not been told — never to
     * be shown as closed).
     */
    featureAccess: (state) => (calendarId: string, feature: FundingGatedFeature): boolean | null => {
      return cacheEntry(state.calendars, calendarId)?.features?.[feature] ?? null;
    },
  },

  actions: {
    /**
     * Cache a freshly read summary, replacing anything held for the calendar.
     *
     * A replace rather than a merge: the response is the complete answer for
     * every registered feature, so merging could only preserve a stale
     * decision the server has just contradicted.
     *
     * @param {string} calendarId - The calendar the summary describes
     * @param {CalendarFundingSummaryResponse} summary - The funding endpoint's response
     */
    setSummary(calendarId: string, summary: CalendarFundingSummaryResponse) {
      this.calendars[calendarId] = {
        status: summary.status,
        features: prototypeFreeRecord({ ...summary.features }),
      };
    },

    /**
     * Record that the server refused one feature for this calendar.
     *
     * Only that feature moves. The display status is left alone because the
     * two can legitimately disagree — a calendar reported as `covered` can still
     * be refused a feature whose access has expired — and rewriting the label
     * from a refusal would invent a relationship the server never described.
     *
     * @param {string} calendarId - The calendar that was refused
     * @param {FundingGatedFeature} feature - The feature named by the refusal
     */
    denyFeature(calendarId: string, feature: FundingGatedFeature) {
      const cached = cacheEntry(this.calendars, calendarId);
      if (cached) {
        cached.features[feature] = false;
        return;
      }

      this.calendars[calendarId] = {
        status: null,
        features: prototypeFreeRecord({ [feature]: false }),
      };
    },
  },
});
