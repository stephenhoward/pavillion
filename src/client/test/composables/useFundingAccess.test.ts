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
function summaryResponse(widgetEmbedding: boolean, status = 'covered') {
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
      expect(funding.status.value).toBe('covered');
      expect(funding.hasAccess('widget_embedding')).toBe(true);
      expect(useFundingStore().statusFor(CALENDAR_ID)).toBe('covered');
    });

    it('serves a second consumer from the cache without a second request', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      await useFundingAccess(CALENDAR_ID).ensureLoaded();

      const second = useFundingAccess(CALENDAR_ID);
      await second.ensureLoaded();

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(second.status.value).toBe('covered');
      expect(second.hasAccess('widget_embedding')).toBe(true);
    });

    it('issues one request when two consumers load concurrently', async () => {
      // The deduplication guarantee, as two components mounting on the same
      // tick would exercise it: neither awaits before the other starts, so
      // both see an empty cache. Awaiting the first load in between would only
      // demonstrate cache reuse, which is a different mechanism.
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));

      const first = useFundingAccess(CALENDAR_ID);
      const second = useFundingAccess(CALENDAR_ID);
      await Promise.all([first.ensureLoaded(), second.ensureLoaded()]);

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(first.hasAccess('widget_embedding')).toBe(true);
      expect(second.hasAccess('widget_embedding')).toBe(true);
    });

    it('reports loading on the consumer that joined a request already in flight', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));

      const first = useFundingAccess(CALENDAR_ID);
      const firstPending = first.ensureLoaded();
      const second = useFundingAccess(CALENDAR_ID);
      const secondPending = second.ensureLoaded();

      expect(second.isLoading.value).toBe(true);
      await Promise.all([firstPending, secondPending]);

      expect(second.isLoading.value).toBe(false);
    });

    it('requests again once an earlier load has settled and left nothing cached', async () => {
      // The in-flight entry must not outlive its request, or a calendar whose
      // first load failed could never be loaded again.
      vi.mocked(axios.get).mockRejectedValue(apiError(500, { error: 'Internal server error' }));
      await useFundingAccess(CALENDAR_ID).ensureLoaded();

      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      const second = useFundingAccess(CALENDAR_ID);
      await second.ensureLoaded();

      expect(axios.get).toHaveBeenCalledTimes(2);
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

      vi.mocked(axios.get).mockResolvedValue(summaryResponse(false, 'not_covered'));
      await funding.refresh();

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(funding.status.value).toBe('not_covered');
      expect(funding.accessState('widget_embedding')).toBe('denied');
    });

    it('leaves access unknown when the funding state cannot be read', async () => {
      // A 5xx means the instance funding state is indeterminate. Rendering
      // that as "not covered" would sell an upsell to an operator whose database
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
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(false, 'covered'));

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(funding.status.value).toBe('covered');
      expect(funding.hasAccess('widget_embedding')).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('denied');
    });

    it('grants access when the features map says so whatever the label reads', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true, 'not_covered'));

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(funding.status.value).toBe('not_covered');
      expect(funding.hasAccess('widget_embedding')).toBe(true);
    });

    it('is false before anything has been loaded, while access stays unknown', () => {
      const funding = useFundingAccess(CALENDAR_ID);

      expect(funding.hasAccess('widget_embedding')).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('unknown');
    });
  });

  describe('isDenied', () => {
    it('is false while access is unknown, where !hasAccess would be true', async () => {
      // The reason this predicate exists. `!hasAccess` folds unknown in with
      // denied, so an upsell branching on it would offer funding during our
      // own outage to an operator who may already have paid.
      vi.mocked(axios.get).mockRejectedValue(apiError(500, { error: 'Internal server error' }));

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(funding.accessState('widget_embedding')).toBe('unknown');
      expect(funding.hasAccess('widget_embedding')).toBe(false);
      expect(funding.isDenied('widget_embedding')).toBe(false);
    });

    it('is false before anything has been loaded at all', () => {
      const funding = useFundingAccess(CALENDAR_ID);

      expect(funding.isDenied('widget_embedding')).toBe(false);
    });

    it('is true only once the server has said the gate is closed', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(false, 'not_covered'));

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(funding.isDenied('widget_embedding')).toBe(true);
    });

    it('is false when the gate is open, whatever the display label reads', async () => {
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true, 'not_covered'));

      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      expect(funding.isDenied('widget_embedding')).toBe(false);
    });

    it('becomes true when a 402 refusal is recorded', () => {
      const funding = useFundingAccess(CALENDAR_ID);

      funding.recordAccessDenial(apiError(402, {
        errorName: 'SubscriptionRequiredError',
        feature: 'widget_embedding',
      }));

      expect(funding.isDenied('widget_embedding')).toBe(true);
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

    it('does not recognise a 5xx that names a feature, and leaves a granted feature granted', async () => {
      // A 500 body carrying `feature` is the case that separates "recognises a
      // funding refusal" from "recognises anything mentioning a feature". An
      // operator on an instance that never enabled funding must not lose a
      // granted feature because our database hiccuped mid-sentence.
      vi.mocked(axios.get).mockResolvedValue(summaryResponse(true));
      const funding = useFundingAccess(CALENDAR_ID);
      await funding.ensureLoaded();

      const recognised = funding.recordAccessDenial(apiError(500, { feature: 'widget_embedding' }));

      expect(recognised).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('granted');
    });

    it('does not recognise a 503 carrying the funding errorName and a feature', () => {
      // Everything a real refusal carries except the 402.
      const funding = useFundingAccess(CALENDAR_ID);

      expect(funding.recordAccessDenial(apiError(503, {
        error: 'subscription_required',
        errorName: 'SubscriptionRequiredError',
        feature: 'widget_embedding',
      }))).toBe(false);
      expect(funding.accessState('widget_embedding')).toBe('unknown');
      expect(funding.isDenied('widget_embedding')).toBe(false);
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
