import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import axios from 'axios';

import FundingUpsellCard from '@/client/components/common/FundingUpsellCard.vue';
import { useFundingStore } from '@/client/stores/fundingStore';
import { mountComponent } from '@/client/test/lib/vue';

vi.mock('axios');

const CALENDAR_ID = 'cal-uuid-1';
const FUNDING_URL = `/api/funding/v1/calendars/${CALENDAR_ID}/funding`;
const SITE_CONFIG_URL = '/api/config/v1/site';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

/**
 * Body of GET /calendars/:calendarId/funding. `status` varies independently of
 * the feature decision so the tests can hold the display label and the
 * entitlement apart — the card must read only the latter.
 */
function summaryResponse(widgetEmbedding: boolean, status = 'not_covered') {
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
 * Route the two GETs the card issues on mount. Anything else is a failure —
 * the card is not supposed to reach for the funding options endpoint.
 */
function mockRequests(funding: unknown) {
  vi.mocked(axios.get).mockImplementation((url: string) => {
    if (url === FUNDING_URL) {
      return funding instanceof Error ? Promise.reject(funding) : Promise.resolve(funding);
    }
    if (url === SITE_CONFIG_URL) {
      return Promise.resolve({ data: { siteTitle: 'Example Instance' } });
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
}

const mountCard = async (pinia: Pinia) => {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  await router.isReady();

  const wrapper = mountComponent(FundingUpsellCard, router, {
    pinia,
    props: { calendarId: CALENDAR_ID, feature: 'widget_embedding' },
    stubs: {
      FundingSheet: {
        template: '<div class="funding-sheet-stub"></div>',
        props: ['calendarId', 'instanceName'],
        emits: ['close', 'plan-started'],
      },
    },
  });

  await flushPromises();
  return wrapper;
};

describe('FundingUpsellCard', () => {
  let pinia: Pinia;
  let wrapper: ReturnType<typeof mountComponent> | null = null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('what it renders', () => {
    it('offers funding when the gate is known to be closed', async () => {
      mockRequests(summaryResponse(false));

      wrapper = await mountCard(pinia);

      const upsell = wrapper.find('.funding-upsell');
      expect(upsell.exists()).toBe(true);
      expect(upsell.text()).toContain('Example Instance');
      expect(wrapper.find('.funding-upsell__action').text()).toBe('Contribute to enable');
    });

    it('stays silent when the gate is open', async () => {
      mockRequests(summaryResponse(true));

      wrapper = await mountCard(pinia);

      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });

    it('stays silent when the funding state could not be read', async () => {
      // The DEC-001 case. A failed read leaves every feature unknown, and an
      // operator whose instance is having a bad minute must not be told their
      // community owes money. `!hasAccess()` would render the upsell here.
      mockRequests(new Error('network down'));

      wrapper = await mountCard(pinia);

      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });

    it('reads the feature gate, not the display status', async () => {
      // The two are allowed to disagree: a calendar reported as funded can
      // still be refused a feature whose access has expired.
      mockRequests(summaryResponse(false, 'covered'));

      wrapper = await mountCard(pinia);

      expect(wrapper.find('.funding-upsell').exists()).toBe(true);
    });

    it('stays silent for a feature key that is not in the registry', async () => {
      mockRequests(summaryResponse(false));
      const router: Router = createRouter({ history: createMemoryHistory(), routes });
      await router.push('/');
      await router.isReady();

      wrapper = mountComponent(FundingUpsellCard, router, {
        pinia,
        props: { calendarId: CALENDAR_ID, feature: 'not_a_registered_feature' },
      });
      await flushPromises();

      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });
  });

  describe('answering a refusal recorded elsewhere', () => {
    it('appears when another component records a 402 for the calendar', async () => {
      // This is the widget-domains.vue path: the component catches the
      // refusal, the composable records it, and the upsell — which knows
      // nothing about that request — answers it.
      mockRequests(summaryResponse(true));
      wrapper = await mountCard(pinia);
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);

      useFundingStore().denyFeature(CALENDAR_ID, 'widget_embedding');
      await flushPromises();

      expect(wrapper.find('.funding-upsell').exists()).toBe(true);
    });
  });

  describe('the funding sheet', () => {
    it('opens the existing FundingSheet on the action, carrying the instance name', async () => {
      mockRequests(summaryResponse(false));
      wrapper = await mountCard(pinia);

      expect(wrapper.find('.funding-sheet-stub').exists()).toBe(false);

      await wrapper.find('.funding-upsell__action').trigger('click');
      await flushPromises();

      const sheet = wrapper.findComponent('.funding-sheet-stub');
      expect(sheet.exists()).toBe(true);
      expect(sheet.props('calendarId')).toBe(CALENDAR_ID);
      expect(sheet.props('instanceName')).toBe('Example Instance');
    });

    it('re-reads access and reports funded once a plan is taken out', async () => {
      mockRequests(summaryResponse(false));
      wrapper = await mountCard(pinia);

      await wrapper.find('.funding-upsell__action').trigger('click');
      await flushPromises();

      // The gate is open by the time the sheet reports success.
      mockRequests(summaryResponse(true, 'covered'));
      wrapper.findComponent('.funding-sheet-stub').vm.$emit('plan-started');
      await flushPromises();

      expect(wrapper.emitted('plan-started')).toBeTruthy();
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
      expect(wrapper.find('.funding-sheet-stub').exists()).toBe(false);
      expect(useFundingStore().featureAccess(CALENDAR_ID, 'widget_embedding')).toBe(true);
    });
  });
});
