import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import FundingSettings from '@/client/components/admin/funding.vue';
import FundingPlanManagement from '@/client/components/account/funding-plan.vue';
import FundingService from '@/client/service/funding';

/**
 * Test suite for funding plan UI components
 */
describe('Funding Plan UI Components', () => {

  let fundingStubs: Record<string, MockInstance>;
  let router: any;

  beforeEach(() => {
    // The components construct their own FundingService, so stub its
    // prototype: every load on mount resolves in-process, and flushPromises
    // settles it without reaching the network.
    fundingStubs = {
      getSettings: vi.spyOn(FundingService.prototype, 'getSettings').mockResolvedValue({
        enabled: false, monthlyPrice: 0, yearlyPrice: 0, currency: 'USD', payWhatYouCan: false, gracePeriodDays: 7,
      } as any),
      getProviders: vi.spyOn(FundingService.prototype, 'getProviders').mockResolvedValue([]),
      listFundingPlans: vi.spyOn(FundingService.prototype, 'listFundingPlans')
        .mockResolvedValue({ fundingPlans: [], pagination: { totalCount: 0 } }),
      getOptions: vi.spyOn(FundingService.prototype, 'getOptions').mockResolvedValue({ enabled: false } as any),
      getStatus: vi.spyOn(FundingService.prototype, 'getStatus').mockResolvedValue(null),
      getCalendarsInFundingPlan: vi.spyOn(FundingService.prototype, 'getCalendarsInFundingPlan').mockResolvedValue([]),
      cancel: vi.spyOn(FundingService.prototype, 'cancel').mockResolvedValue(true),
    };

    // Create router for component testing
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings/admin/funding', component: FundingSettings, name: 'funding' },
        { path: '/settings/account', component: {}, name: 'profile' },
        { path: '/settings/account/funding', component: FundingPlanManagement, name: 'funding_plan' },
      ],
    });

    // Initialize i18next
    i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          admin: {
            funding: {
              title: 'Funding Settings',
              enabled_label: 'Enable Funding',
              monthly_price_label: 'Monthly Price',
              yearly_price_label: 'Yearly Price',
              currency_label: 'Currency',
              pwyc_label: 'Pay What You Can',
              grace_period_label: 'Grace Period (days)',
            },
          },
          funding: {
            title: 'Funding Plan',
            no_funding_plan: 'No Active Funding Plan',
            cancel_funding_plan_button: 'Cancel Plan',
            cancel_button: 'Cancel',
            manage_payment_button: 'Manage Payment Method',
            status_active: 'Active',
            billing_cycle_monthly: 'Monthly',
            billing_cycle_yearly: 'Yearly',
            cancel_success: 'Your funding plan has been cancelled',
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const mountAdmin = async () => {
    const wrapper = mount(FundingSettings, {
      global: {
        plugins: [router, [I18NextVue, { i18next }]],
      },
    });
    await flushPromises();
    return wrapper;
  };

  const mountAccount = async () => {
    const wrapper = mount(FundingPlanManagement, {
      global: {
        plugins: [router, [I18NextVue, { i18next }], createPinia()],
      },
    });
    await flushPromises();
    return wrapper;
  };

  const enabledSettings = {
    enabled: true,
    monthlyPrice: 1250000, // 12.50 in millicents; not the form's 10.00 default
    yearlyPrice: 12000000, // 120.00 in millicents; not the form's 100.00 default
    currency: 'USD',
    payWhatYouCan: true,
    gracePeriodDays: 7,
  };

  const stripe = (configured: boolean) => ({
    provider_type: 'stripe', enabled: configured, display_name: 'Credit Card', configured,
  });

  const activePlan = {
    id: 'plan-1',
    status: 'active' as const,
    billingCycle: 'monthly' as const,
    amount: 1000000,
    currency: 'USD',
    currentPeriodStart: '2026-10-01T00:00:00Z',
    currentPeriodEnd: '2026-11-01T00:00:00Z',
  };

  it('renders the admin pricing form with the loaded prices', async () => {
    fundingStubs.getSettings.mockResolvedValue(enabledSettings);
    fundingStubs.getProviders.mockResolvedValue([stripe(true)]);

    const wrapper = await mountAdmin();
    await wrapper.find('[aria-controls="settings-panel"]').trigger('click');

    expect(Number((wrapper.find('#funding-monthly').element as HTMLInputElement).value)).toBe(12.5);
    expect(Number((wrapper.find('#funding-yearly').element as HTMLInputElement).value)).toBe(120);
  });

  it('offers to add a provider when the supported provider is not configured', async () => {
    fundingStubs.getSettings.mockResolvedValue(enabledSettings);
    fundingStubs.getProviders.mockResolvedValue([stripe(false)]);

    const wrapper = await mountAdmin();

    const card = wrapper.find('.providers-card');
    expect(card.find('.provider-item').exists()).toBe(false);
    expect(card.find('.empty-card-inline button').exists()).toBe(true);
    expect(card.find('.card-header button').attributes('disabled')).toBeUndefined();
    // Pricing waits for a configured provider.
    expect(wrapper.find('#funding-monthly').exists()).toBe(false);
  });

  it('shows a configured provider as connected and hides providers this release does not support', async () => {
    fundingStubs.getSettings.mockResolvedValue(enabledSettings);
    fundingStubs.getProviders.mockResolvedValue([
      stripe(true),
      { provider_type: 'paypal', enabled: false, display_name: 'PayPal', configured: true },
    ]);

    const wrapper = await mountAdmin();

    const items = wrapper.findAll('.provider-item');
    expect(items).toHaveLength(1);
    expect(items[0].find('.provider-name').text()).toBe('Credit Card');
    expect(items[0].find('.connected-badge').exists()).toBe(true);
    expect((items[0].find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
    // Every supported provider is configured, so there is nothing left to add.
    expect(wrapper.find('.providers-card .card-header button').attributes('disabled')).toBeDefined();
  });

  it('points an account with no plan at calendar management when funding is enabled', async () => {
    fundingStubs.getOptions.mockResolvedValue({ enabled: true });

    const wrapper = await mountAccount();

    expect(wrapper.find('.no-funding-plan h2').text()).toBe('No Active Funding Plan');
    expect(wrapper.find('.funding-plan-status').exists()).toBe(false);
    expect(wrapper.find('.funding-disabled').exists()).toBe(false);
  });

  it('shows the current plan status, cycle and amount', async () => {
    fundingStubs.getOptions.mockResolvedValue({ enabled: true });
    fundingStubs.getStatus.mockResolvedValue(activePlan);

    const wrapper = await mountAccount();

    const card = wrapper.find('.funding-plan-status .status-card');
    expect(card.find('.status-badge.status-active').text()).toBe('Active');
    expect(card.text()).toContain('Monthly');
    expect(card.text()).toContain('$10.00');
    expect(wrapper.find('.no-funding-plan').exists()).toBe(false);
  });

  it('cancels the plan after confirmation and stops offering to cancel', async () => {
    fundingStubs.getOptions.mockResolvedValue({ enabled: true });
    fundingStubs.getStatus
      .mockResolvedValueOnce(activePlan)
      .mockResolvedValue({ ...activePlan, cancelAt: '2026-11-01T00:00:00Z' });
    vi.stubGlobal('confirm', vi.fn(() => true));

    const wrapper = await mountAccount();
    const cancelButton = wrapper.find('.funding-plan-actions button.danger');
    expect(cancelButton.text()).toBe('Cancel Plan');

    await cancelButton.trigger('click');
    await flushPromises();

    expect(fundingStubs.cancel).toHaveBeenCalledOnce();
    expect(wrapper.find('.success-message').text()).toBe('Your funding plan has been cancelled');
    expect(wrapper.find('.funding-plan-actions button.danger').exists()).toBe(false);
  });

});
