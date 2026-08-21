import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useFundingStore } from '@/client/stores/fundingStore';
import type { CalendarFundingSummaryResponse } from '@/client/service/funding';

const coveredSummary: CalendarFundingSummaryResponse = {
  status: 'covered',
  features: { widget_embedding: true },
};

describe('FundingStore', () => {
  let store: ReturnType<typeof useFundingStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useFundingStore();
  });

  describe('before anything is cached', () => {
    it('reports an unknown status for a calendar it has never seen', () => {
      expect(store.statusFor('cal-1')).toBeNull();
    });

    it('reports unknown — not denied — feature access for a calendar it has never seen', () => {
      // null is "we have not been told", which must stay distinguishable from
      // false ("the gate is closed"). A 5xx read failure leaves us here.
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBeNull();
    });

    it('has no summary for a calendar it has never seen', () => {
      expect(store.summaryFor('cal-1')).toBeNull();
    });
  });

  describe('setSummary', () => {
    it('caches the status and the feature decisions', () => {
      store.setSummary('cal-1', coveredSummary);

      expect(store.statusFor('cal-1')).toBe('covered');
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(true);
    });

    it('keeps each calendar independent', () => {
      store.setSummary('cal-1', coveredSummary);

      expect(store.statusFor('cal-2')).toBeNull();
      expect(store.featureAccess('cal-2', 'widget_embedding')).toBeNull();
    });

    it('replaces a previously cached entry rather than merging into it', () => {
      // The cached entry carries a feature key the next response does not
      // mention — a client that outlived a change to the registry. Restating
      // every key in the second summary would make merge and replace agree,
      // and the assertion would pass either way.
      store.setSummary('cal-1', {
        ...coveredSummary,
        features: { widget_embedding: true, retired_feature: true },
      } as unknown as CalendarFundingSummaryResponse);

      store.setSummary('cal-1', {
        status: 'not_covered',
        features: { widget_embedding: false },
      });

      expect(store.statusFor('cal-1')).toBe('not_covered');
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(false);
      expect(store.summaryFor('cal-1')?.features).toEqual({ widget_embedding: false });
    });
  });

  describe('denyFeature', () => {
    it('closes the gate on one feature without touching the display status', () => {
      // status is a relationship label and features are the entitlement: a
      // calendar can be 'covered' and still be refused a feature, so a denial
      // must not rewrite the label.
      store.setSummary('cal-1', coveredSummary);

      store.denyFeature('cal-1', 'widget_embedding');

      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(false);
      expect(store.statusFor('cal-1')).toBe('covered');
    });

    it('records a denial for a calendar whose summary has never been loaded', () => {
      store.denyFeature('cal-1', 'widget_embedding');

      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(false);
      expect(store.statusFor('cal-1')).toBeNull();
    });
  });

  describe('calendar ids that name an inherited property', () => {
    // The cache is keyed by a string it does not choose. A plain object would
    // resolve these through Object.prototype to a function — not nullish, so
    // `?.` does not short-circuit — and the feature lookup behind it would
    // throw, making featureAccess (and accessState above it) partial over its
    // inputs. The whole tri-state safety argument assumes it is total.
    const inheritedNames = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

    // `hasOwnProperty` cannot round-trip: Vue's reactive get trap returns its
    // own instrumented function for that key before the target is consulted,
    // so a value stored under it is unreadable. Unknown is the safe answer, and
    // no calendar id is ever that string — but the getters still have to reach
    // it without throwing, which the case above covers.
    const storableNames = inheritedNames.filter((name) => name !== 'hasOwnProperty');

    it.each(inheritedNames)('answers null rather than throwing for %s', (calendarId) => {
      expect(store.summaryFor(calendarId)).toBeNull();
      expect(store.statusFor(calendarId)).toBeNull();
      expect(store.featureAccess(calendarId, 'widget_embedding')).toBeNull();
    });

    it.each(inheritedNames)('still answers, rather than throwing, after a write under %s', (calendarId) => {
      store.setSummary(calendarId, coveredSummary);
      store.denyFeature(calendarId, 'widget_embedding');

      expect(store.featureAccess(calendarId, 'widget_embedding')).not.toBeUndefined();
      expect(store.statusFor('cal-1')).toBeNull();
    });

    it.each(storableNames)('caches and reads back a summary stored under %s', (calendarId) => {
      store.setSummary(calendarId, coveredSummary);

      expect(store.statusFor(calendarId)).toBe('covered');
      expect(store.featureAccess(calendarId, 'widget_embedding')).toBe(true);
      expect(store.statusFor('cal-1')).toBeNull();
    });

    it.each(storableNames)('records a denial under %s without disturbing other calendars', (calendarId) => {
      store.setSummary('cal-1', coveredSummary);

      store.denyFeature(calendarId, 'widget_embedding');

      expect(store.featureAccess(calendarId, 'widget_embedding')).toBe(false);
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(true);
    });
  });

  describe('$reset', () => {
    it('drops every cached calendar so a logout leaks nothing to the next session', () => {
      store.setSummary('cal-1', coveredSummary);

      store.$reset();

      expect(store.statusFor('cal-1')).toBeNull();
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBeNull();
    });
  });
});
