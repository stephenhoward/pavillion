import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { createPinia, setActivePinia } from 'pinia';
import { useFundingAccess } from '@/client/composables/useFundingAccess';
import { useFundingStore } from '@/client/stores/fundingStore';
import FundingService from '@/client/service/funding';

vi.mock('axios');

const CALENDAR_ID = 'cal-1';
const FUNDING_URL = `/api/funding/v1/calendars/${CALENDAR_ID}/funding`;

/**
 * Body of GET /calendars/:calendarId/funding, with the feature decision under
 * test. `status` is varied independently so the tests can hold the display
 * label and the entitlement apart.
 */
function summaryResponse(widgetEmbedding: boolean, status = 'funded') {
  return {
    data: {
      status,
      currentPeriodEnd: null,
      accessExpiresAt: null,
      features: { widget_embedding: widgetEmbedding },
    },
  };
}

/**
 * An axios-shaped rejection, as a component would catch it from a write that
 * the funding gate refused.
 */
function apiError(status: number, data: Record<string, unknown>) {
  return { response: { status, data } };
}

describe('useFundingAccess', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('ensureLoaded', () => {
    it('loads the calendar summary through FundingService and caches it', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      const serviceCall = vi.spyOn(FundingService.prototype, 'loadFundingSummary');

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(serviceCall).toHaveBeenCalledWith(CALENDAR_ID);
      expect(axios.get).toHaveBeenCalledWith(FUNDING_URL);
      expect(funding.status.value).toBe('funded');
      expect(funding.hasAccess('widget_embedding')).toBe(true);
      expect(useFundingStore().statusFor(CALENDAR_ID)).toBe('funded');
    });

    it('serves a second consumer from the cache without a second request', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      await useFundingAccess(CALENDAR_ID).ensureLoaded();

      const second = useFundingAccess(CALENDAR_ID);
      await second.ensureLoaded();

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(second.status.value).toBe('funded');
      expect(second.hasAccess('widget_embedding')).toBe(true);
    });

    it('does not report a loading state once the load settles', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));

      const funding = useFundingAccess(CALENDAR_ID);
      const pending = funding.ensureLoaded();
      expect(funding.isLoading.value).toBe(true);
      await pending;

      expect(funding.isLoading.value).toBe(false);
    });
  });

  describe('refresh', () => {
    it('refetches even when the calendar is already cached', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      vi.mocked(axios.get).mockResolvedValue(summaryResponse(false, 'unfunded'));
      await funding.refresh();

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(funding.status.value).toBe('unfunded');
      expect(funding.accessState('widget_embedding')).toBe('denied');
    });

    it('leaves access unknown when the funding state cannot be read', async () => {
      // A 5xx means the instance funding state is indeterminate. Rendering
      // that as "unfunded" would sell an upsell to an operator whose database
      // merely hiccuped.
      vi.mocked(axios.get).mockRejectedValue(apiError(500, { error: 'Internal server error' }));

      const funding = useFundingAccess(CALENDAR_ID);
      await expect(funding.refresh()).resolves.toBeUndefined();

      expect(funding.accessState('widget_embedding')).toBe('unknown');
      expect(funding.hasAccess('widget_embedding')).toBe(false);
      expect(funding.status.value).toBeNull();
    });

    it('keeps a previously granted feature granted when a later read fails', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      vi.mocked(axios.get).mockRejectedValue(apiError(503, { error: 'Service unavailable' }));
      await funding.refresh();

      expect(funding.accessState('widget_embedding')).toBe('granted');
    });
  });

  describe('hasAccess', () => {
    it('answers from the features map, not from the display status', async () => {
      // The gate and the label disagree in real cases (an expiring plan, an
      // instance with funding disabled). features is the entitlement.
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(false, 'funded'));

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(funding.status.value).toBe('funded');
      expect(funding.hasAccess('widget_embedding')).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('denied');
    });

    it('grants access when the features map says so whatever the label reads', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true, 'unfunded'));

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(funding.status.value).toBe('unfunded');
      expect(funding.hasAccess('widget_embedding')).toBe(true);
    });

    it('is false before anything has been loaded, while access stays unknown', () => {
      const funding = useFundingAccess(CALENDAR_ID);

      expect(funding.hasAccess('widget_embedding')).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('unknown');
    });
  });

  describe('recordAccessDenial', () => {
    it('flips the feature to denied on a 402 SubscriptionRequiredError', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      const recognised = funding.recordAccessDenial(apiError(402, {
        error: 'subscription_required',
        errorName: 'SubscriptionRequiredError',
        feature: 'widget_embedding',
      }));

      expect(recognised).toBe(true);
      expect(funding.accessState('widget_embedding')).toBe('denied');
      expect(funding.hasAccess('widget_embedding')).toBe(false);
    });

    it('records the denial for a calendar whose summary was never loaded', () => {
      const funding = useFundingAccess(CALENDAR_ID);

      expect(funding.recordAccessDenial(apiError(402, {
        errorName: 'SubscriptionRequiredError',
        feature: 'widget_embedding',
      }))).toBe(true);
      expect(funding.accessState('widget_embedding')).toBe('denied');
    });

    it('does not recognise a 5xx, and leaves a granted feature granted', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      const recognised = funding.recordAccessDenial(apiError(500, { error: 'Internal server error' }));

      expect(recognised).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('granted');
    });

    it('does not recognise an unrelated error at another status', () => {
      const funding = useFundingAccess(CALENDAR_ID);

      expect(funding.recordAccessDenial(apiError(400, { errorName: 'InvalidDomainFormatError' }))).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('unknown');
    });

    it('does not recognise a 402 naming a feature that is not in the registry', () => {
      const funding = useFundingAccess(CALENDAR_ID);

      expect(funding.recordAccessDenial(apiError(402, {
        errorName: 'SubscriptionRequiredError',
        feature: 'some_unregistered_feature',
      }))).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('unknown');
    });
  });
});
