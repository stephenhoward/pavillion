import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

/**
 * How the account funding-plan screen presents a cancellation.
 *
 * `status` alone cannot answer this. A cancel-at-period-end deliberately leaves
 * the plan `active` until its boundary — the customer paid through it — so the
 * only thing separating "continuing" from "ending on a known date" is
 * `cancelAt`. These mount the real component against the payload shape the
 * endpoint actually sends, which is also what pins the camelCase fix: the
 * client type used to name these fields in snake_case, so every date read back
 * `undefined` and the screen rendered "Invalid Date".
 *
 * The service is mocked at the module boundary because the component
 * constructs its own FundingService; without that, every mount here would 401
 * against a real axios call and the assertions would be about an empty screen.
 */
const serviceMocks = vi.hoisted(() => ({
  getOptions: vi.fn(),
  getStatus: vi.fn(),
  getCalendarsInFundingPlan: vi.fn(),
  cancel: vi.fn(),
  getPortalUrl: vi.fn(),
}));

vi.mock('@/client/service/funding', () => {
  class MockFundingService {
    getOptions = serviceMocks.getOptions;
    getStatus = serviceMocks.getStatus;
    getCalendarsInFundingPlan = serviceMocks.getCalendarsInFundingPlan;
    cancel = serviceMocks.cancel;
    getPortalUrl = serviceMocks.getPortalUrl;

    static formatCurrency(amount: number, currency: string): string {
      return `${currency} ${(amount / 100000).toFixed(2)}`;
    }
  }

  return { default: MockFundingService };
});

import FundingPlanManagement from '@/client/components/account/funding-plan.vue';

/** A continuing monthly plan, keyed exactly as GET /v1/status keys it. */
const continuingPlan = {
  id: 'plan-1',
  status: 'active',
  billingCycle: 'monthly',
  amount: 1000000,
  currency: 'USD',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  cancelledAt: null,
  cancelAt: null,
  suspendedAt: null,
};

describe('funding-plan.vue cancellation states', () => {
  let router: any;

  beforeEach(() => {
    serviceMocks.getOptions.mockResolvedValue({
      enabled: true,
      providers: [],
      monthlyPrice: 1000000,
      yearlyPrice: 10000000,
      currency: 'USD',
      payWhatYouCan: false,
      payWhatYouCanYearlyDiscount: 0,
    });
    serviceMocks.getCalendarsInFundingPlan.mockResolvedValue([]);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/account/funding', component: FundingPlanManagement }],
    });

    i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      // Matches createI18nConfig (src/common/i18n/config.ts): Vue's mustache
      // already escapes, so i18next escaping again turns the slashes in a
      // formatted date into literal &#x2F; entities. Leaving it on here would
      // make the assertions below pass against a string the app never renders.
      interpolation: { escapeValue: false },
      resources: {
        en: {
          funding: {
            title: 'Funding Plan',
            status_active: 'Active',
            status_cancelled: 'Cancelled',
            billing_cycle_monthly: 'Monthly',
            cancelled_at_label: 'Cancelled on',
            current_period_label: 'Current period',
            cancel_funding_plan_button: 'Cancel Plan',
            manage_payment_button: 'Manage Payment Method',
            cancellation_info: 'Your funding plan will remain active until {{date}}',
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Mount the screen with a given plan payload and let its onMounted load
   * settle.
   *
   * @param status - Body GET /v1/status would return
   * @returns The mounted wrapper
   */
  async function mountWithStatus(status: Record<string, unknown>) {
    serviceMocks.getStatus.mockResolvedValue(status);

    const wrapper = mount(FundingPlanManagement, {
      global: { plugins: [router, [I18NextVue, { i18next }], createPinia()] },
    });

    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    return wrapper;
  }

  it('should announce the boundary and withdraw the cancel button for a scheduled cancellation', async () => {
    const wrapper = await mountWithStatus({
      ...continuingPlan,
      cancelAt: '2026-02-01T00:00:00.000Z',
    });

    const expectedDate = new Date('2026-02-01T00:00:00.000Z').toLocaleDateString('en');
    expect(wrapper.find('.status-message.info').text()).toContain(expectedDate);
    // The plan is still 'active', so a screen keyed on status alone would show
    // nothing here and keep offering a cancel button for an already-cancelled
    // plan.
    expect(wrapper.text()).not.toContain('Cancel Plan');
  });

  it('should offer cancellation and announce no boundary for a continuing plan', async () => {
    const wrapper = await mountWithStatus(continuingPlan);

    expect(wrapper.find('.status-message.info').exists()).toBe(false);
    expect(wrapper.text()).toContain('Cancel Plan');
  });

  it('should still report the paid-through date once the plan is fully cancelled', async () => {
    const wrapper = await mountWithStatus({
      ...continuingPlan,
      status: 'cancelled',
      cancelledAt: '2026-01-10T00:00:00.000Z',
      cancelAt: null,
    });

    const cancelledOn = new Date('2026-01-10T00:00:00.000Z').toLocaleDateString('en');
    const periodEnd = new Date('2026-02-01T00:00:00.000Z').toLocaleDateString('en');
    expect(wrapper.text()).toContain(cancelledOn);
    expect(wrapper.find('.status-message.info').text()).toContain(periodEnd);
    expect(wrapper.text()).not.toContain('Cancel Plan');
  });

  it('should render real dates and a resolved billing cycle from the camelCase payload', async () => {
    // The regression guard proper: with the fields named as the server names
    // them, nothing on this screen falls back to "Invalid Date" or to an
    // unresolved billing_cycle_undefined key.
    const wrapper = await mountWithStatus(continuingPlan);

    const text = wrapper.text();
    expect(text).not.toContain('Invalid Date');
    expect(text).toContain('Monthly');
    expect(text).toContain(new Date('2026-01-01T00:00:00.000Z').toLocaleDateString('en'));
  });
});
