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
 * distinction is what keeps an unreadable instance funding state from being
 * displayed as an unfunded one.
 */
export interface CalendarFundingCache {
  /** How the calendar is funded. Display vocabulary, null until loaded. */
  status: FundingStatus | null;
  /** End of the paid-through period of the funding plan, ISO-8601. */
  currentPeriodEnd: string | null;
  /** When funding stops granting access, ISO-8601. */
  accessExpiresAt: string | null;
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
    calendars: {},
  }),

  getters: {
    /**
     * Everything cached for a calendar, or null if it has never been loaded.
     */
    summaryFor: (state) => (calendarId: string): CalendarFundingCache | null => {
      return state.calendars[calendarId] ?? null;
    },

    /**
     * A calendar's display status, or null while it is unknown.
     *
     * This is a relationship label. It answers "how is this calendar funded",
     * never "may this calendar do X" — that is featureAccess.
     */
    statusFor: (state) => (calendarId: string): FundingStatus | null => {
      return state.calendars[calendarId]?.status ?? null;
    },

    /**
     * The gate decision for one feature on one calendar: true (open), false
     * (closed) or null (not known — never to be shown as closed).
     */
    featureAccess: (state) => (calendarId: string, feature: FundingGatedFeature): boolean | null => {
      return state.calendars[calendarId]?.features[feature] ?? null;
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
        currentPeriodEnd: summary.currentPeriodEnd,
        accessExpiresAt: summary.accessExpiresAt,
        features: { ...summary.features },
      };
    },

    /**
     * Record that the server refused one feature for this calendar.
     *
     * Only that feature moves. The display status is left alone because the
     * two can legitimately disagree — a calendar reported as `funded` can still
     * be refused a feature whose access has expired — and rewriting the label
     * from a refusal would invent a relationship the server never described.
     *
     * @param {string} calendarId - The calendar that was refused
     * @param {FundingGatedFeature} feature - The feature named by the refusal
     */
    denyFeature(calendarId: string, feature: FundingGatedFeature) {
      const cached = this.calendars[calendarId];
      if (cached) {
        cached.features[feature] = false;
        return;
      }

      this.calendars[calendarId] = {
        status: null,
        currentPeriodEnd: null,
        accessExpiresAt: null,
        features: { [feature]: false },
      };
    },
  },
});
