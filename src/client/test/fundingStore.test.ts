import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useFundingStore } from '@/client/stores/fundingStore';
import type { CalendarFundingSummaryResponse } from '@/client/service/funding';

const fundedSummary: CalendarFundingSummaryResponse = {
  status: 'funded',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  accessExpiresAt: '2026-09-08T00:00:00.000Z',
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
    it('caches the status, the plan dates and the feature decisions', () => {
      store.setSummary('cal-1', fundedSummary);

      expect(store.statusFor('cal-1')).toBe('funded');
      expect(store.summaryFor('cal-1')?.currentPeriodEnd).toBe('2026-09-01T00:00:00.000Z');
      expect(store.summaryFor('cal-1')?.accessExpiresAt).toBe('2026-09-08T00:00:00.000Z');
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(true);
    });

    it('keeps each calendar independent', () => {
      store.setSummary('cal-1', fundedSummary);

      expect(store.statusFor('cal-2')).toBeNull();
      expect(store.featureAccess('cal-2', 'widget_embedding')).toBeNull();
    });

    it('replaces a previously cached entry rather than merging into it', () => {
      store.setSummary('cal-1', fundedSummary);

      store.setSummary('cal-1', {
        status: 'unfunded',
        currentPeriodEnd: null,
        accessExpiresAt: null,
        features: { widget_embedding: false },
      });

      expect(store.statusFor('cal-1')).toBe('unfunded');
      expect(store.summaryFor('cal-1')?.currentPeriodEnd).toBeNull();
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(false);
    });
  });

  describe('denyFeature', () => {
    it('closes the gate on one feature without touching the display status', () => {
      // status is a relationship label and features are the entitlement: a
      // calendar can be 'funded' and still be refused a feature, so a denial
      // must not rewrite the label.
      store.setSummary('cal-1', fundedSummary);

      store.denyFeature('cal-1', 'widget_embedding');

      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(false);
      expect(store.statusFor('cal-1')).toBe('funded');
    });

    it('records a denial for a calendar whose summary has never been loaded', () => {
      store.denyFeature('cal-1', 'widget_embedding');

      expect(store.featureAccess('cal-1', 'widget_embedding')).toBe(false);
      expect(store.statusFor('cal-1')).toBeNull();
    });
  });

  describe('$reset', () => {
    it('drops every cached calendar so a logout leaks nothing to the next session', () => {
      store.setSummary('cal-1', fundedSummary);

      store.$reset();

      expect(store.statusFor('cal-1')).toBeNull();
      expect(store.featureAccess('cal-1', 'widget_embedding')).toBeNull();
    });
  });
});
