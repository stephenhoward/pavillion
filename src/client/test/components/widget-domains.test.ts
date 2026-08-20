import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import WidgetDomains from '@/client/components/logged_in/calendar-management/widget-domains.vue';
import { useFundingStore } from '@/client/stores/fundingStore';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const CALENDAR_ID = 'test-calendar-id';
const DOMAIN_URL = `/api/v1/calendars/${CALENDAR_ID}/widget/domain`;
const FUNDING_URL = `/api/funding/v1/calendars/${CALENDAR_ID}/funding`;

/**
 * Body of GET /calendars/:calendarId/funding with the widget gate open or shut.
 */
function summaryResponse(widgetEmbedding: boolean) {
  return {
    data: {
      status: widgetEmbedding ? 'funded' : 'unfunded',
      currentPeriodEnd: null,
      accessExpiresAt: null,
      features: { widget_embedding: widgetEmbedding },
    },
  };
}

/**
 * An axios-shaped rejection, as the component catches it from a refused write.
 */
function apiError(status: number, data: Record<string, unknown>) {
  return { response: { status, data } };
}

describe('WidgetDomains', () => {
  let pinia: Pinia;
  let wrapper: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // GETs the component and its funding card issue on mount. The gate starts
    // open unless a test says otherwise, so nothing is being sold by default.
    vi.mocked(axios.get).mockImplementation((url: string) => {
      if (url === FUNDING_URL) {
        return Promise.resolve(summaryResponse(true));
      }
      if (url === DOMAIN_URL) {
        return Promise.resolve({ data: { domain: null } });
      }
      return Promise.resolve({ data: { siteTitle: 'Example Instance' } });
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.restoreAllMocks();
  });

  const createWrapper = async () => {
    const mounted = mount(WidgetDomains, {
      props: { calendarId: CALENDAR_ID },
      global: {
        plugins: [pinia],
        provide: { authn: {} },
        stubs: {
          PillButton: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
          LoadingMessage: {
            template: '<div>Loading...</div>',
          },
          FundingSheet: {
            template: '<div class="funding-sheet-stub"></div>',
            props: ['calendarId', 'instanceName'],
            emits: ['close', 'plan-started'],
          },
        },
      },
    });

    await flushPromises();
    return mounted;
  };

  describe('funding refusals', () => {
    it('answers a 402 with the shared upsell instead of a one-off error alert', async () => {
      wrapper = await createWrapper();
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);

      vi.mocked(axios.put).mockRejectedValue(
        apiError(402, { errorName: 'SubscriptionRequiredError', feature: 'widget_embedding' }),
      );

      wrapper.vm.state.newDomain = 'example.com';
      await wrapper.vm.addDomain();
      await flushPromises();

      // The refusal moved into the shared funding cache, and the upsell — not
      // an alert this component composes for itself — is what the reader sees.
      expect(useFundingStore().featureAccess(CALENDAR_ID, 'widget_embedding')).toBe(false);
      expect(wrapper.find('.funding-upsell').exists()).toBe(true);
      expect(wrapper.find('.alert--error').exists()).toBe(false);
      expect(wrapper.vm.state.error).toBe('');
    });

    it('shows the upsell on load when the gate is already known to be shut', async () => {
      vi.mocked(axios.get).mockImplementation((url: string) => {
        if (url === FUNDING_URL) {
          return Promise.resolve(summaryResponse(false));
        }
        if (url === DOMAIN_URL) {
          return Promise.resolve({ data: { domain: null } });
        }
        return Promise.resolve({ data: { siteTitle: 'Example Instance' } });
      });

      wrapper = await createWrapper();

      expect(wrapper.find('.funding-upsell').exists()).toBe(true);
    });

    it('does not sell anything when the funding state cannot be read', async () => {
      vi.mocked(axios.get).mockImplementation((url: string) => {
        if (url === FUNDING_URL) {
          return Promise.reject(new Error('funding lookup failed'));
        }
        if (url === DOMAIN_URL) {
          return Promise.resolve({ data: { domain: null } });
        }
        return Promise.resolve({ data: { siteTitle: 'Example Instance' } });
      });

      wrapper = await createWrapper();

      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });

    it('treats a 5xx as an ordinary failure, never as a closed gate', async () => {
      wrapper = await createWrapper();

      vi.mocked(axios.put).mockRejectedValue(
        apiError(500, { errorName: 'InternalServerError' }),
      );

      wrapper.vm.state.newDomain = 'example.com';
      await wrapper.vm.addDomain();
      await flushPromises();

      expect(wrapper.vm.state.error).toBe('error_adding');
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
      expect(useFundingStore().featureAccess(CALENDAR_ID, 'widget_embedding')).toBe(true);
    });
  });

  describe('domain errors', () => {
    it('shows the invalid-domain error for InvalidDomainFormatError', async () => {
      wrapper = await createWrapper();

      vi.mocked(axios.put).mockRejectedValue(
        apiError(400, { errorName: 'InvalidDomainFormatError' }),
      );

      wrapper.vm.state.newDomain = 'invalid domain';
      await wrapper.vm.addDomain();
      await flushPromises();

      expect(wrapper.vm.state.error).toBe('error_invalid_domain');
    });

    it('rejects a malformed domain before any request', async () => {
      wrapper = await createWrapper();

      wrapper.vm.state.newDomain = 'https://example.com/path';
      await wrapper.vm.addDomain();
      await flushPromises();

      expect(wrapper.vm.state.error).toBe('error_invalid_domain');
      expect(axios.put).not.toHaveBeenCalled();
    });
  });

  describe('adding a domain', () => {
    it('records the new domain on success', async () => {
      wrapper = await createWrapper();

      vi.mocked(axios.put).mockResolvedValue({ data: { domain: 'example.com' } });

      wrapper.vm.state.newDomain = 'example.com';
      await wrapper.vm.addDomain();
      await flushPromises();

      expect(wrapper.vm.state.success).toBe('add_success');
      expect(wrapper.vm.state.error).toBe('');
      expect(wrapper.vm.state.currentDomain).toBe('example.com');
    });
  });
});
