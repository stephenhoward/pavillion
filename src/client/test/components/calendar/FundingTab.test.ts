import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';

import FundingTab from '@/client/components/logged_in/calendar-management/FundingTab.vue';
import FundingService from '@/client/service/funding';
import { mountComponent } from '@/client/test/lib/vue';

// Mock stripe-loader to avoid actual Stripe loading in tests
vi.mock('@/client/service/stripe-loader', () => ({
  loadStripe: vi.fn().mockResolvedValue({
    initEmbeddedCheckout: vi.fn().mockResolvedValue({
      mount: vi.fn(),
      destroy: vi.fn(),
    }),
  }),
}));

const routes: RouteRecordRaw[] = [
  { path: '/manage/:calendar', component: {}, name: 'manage' },
  { path: '/funding', component: {}, name: 'funding_plan' },
];

const defaultOptions = {
  enabled: true,
  providers: [{ providerType: 'stripe', displayName: 'Stripe', publishableKey: 'pk_test_fake' }],
  monthlyPrice: 500000,
  yearlyPrice: 5000000,
  currency: 'USD',
  payWhatYouCan: false,
  payWhatYouCanYearlyDiscount: 0,
};

const activeSubscription = {
  id: 'sub-1',
  status: 'active' as const,
  billing_cycle: 'monthly' as const,
  amount: 500000,
  currency: 'USD',
  current_period_start: '2026-03-01',
  current_period_end: '2026-04-01',
  provider_type: 'stripe',
};

/**
 * Set up default mocks for getStatus, getOptions, and getCalendarsInFundingPlan.
 * Individual tests can override these before mounting.
 */
function setupDefaultMocks(overrides?: {
  status?: any;
  options?: any;
}) {
  vi.spyOn(FundingService.prototype, 'getStatus')
    .mockResolvedValue('status' in (overrides || {}) ? overrides!.status : activeSubscription);
  vi.spyOn(FundingService.prototype, 'getOptions')
    .mockResolvedValue(overrides?.options ?? defaultOptions);
  vi.spyOn(FundingService.prototype, 'getCalendarsInFundingPlan')
    .mockResolvedValue([]);
}

const mountFundingTab = async (calendarId: string = 'cal-uuid-1') => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push({ name: 'manage', params: { calendar: 'test-calendar' } });
  await router.isReady();

  const wrapper = mountComponent(FundingTab, router, {
    props: { calendarId },
    stubs: {
      LoadingMessage: {
        template: '<div class="loading-message"><slot /></div>',
        props: ['description'],
      },
    },
  });

  return wrapper;
};

describe('FundingTab', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  describe('Loading state', () => {
    it('shows loading message while fetching funding status', async () => {
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockReturnValue(
        new Promise(() => {}), // never resolves
      );
      vi.spyOn(FundingService.prototype, 'getStatus').mockReturnValue(
        new Promise(() => {}),
      );
      vi.spyOn(FundingService.prototype, 'getOptions').mockReturnValue(
        new Promise(() => {}),
      );

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      expect(wrapper.find('.loading-message').exists()).toBe(true);
    });
  });

  describe('Funded status', () => {
    it('renders funded badge and remove button', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'funded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--funded').exists()).toBe(true);
      const removeButton = wrapper.find('.funding-button--secondary');
      expect(removeButton.exists()).toBe(true);
    });

    it('calls removeCalendarFromFundingPlan when remove button is clicked', async () => {
      setupDefaultMocks();
      const removeSpy = vi.spyOn(FundingService.prototype, 'removeCalendarFromFundingPlan')
        .mockResolvedValue();

      const getFundingSpy = vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockResolvedValueOnce({ status: 'funded' })
        .mockResolvedValueOnce({ status: 'unfunded' });

      const wrapper = await mountFundingTab('cal-123');
      currentWrapper = wrapper;

      await flushPromises();

      const removeButton = wrapper.find('.funding-button--secondary');
      await removeButton.trigger('click');
      await flushPromises();

      expect(removeSpy).toHaveBeenCalledWith('cal-123');
      expect(getFundingSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Unfunded status with active subscription', () => {
    it('renders unfunded badge and add button when user has subscription', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--unfunded').exists()).toBe(true);
      const addButton = wrapper.find('.funding-button--primary');
      expect(addButton.exists()).toBe(true);
    });

    it('calls addCalendarToFundingPlan when add button is clicked', async () => {
      setupDefaultMocks();
      const addSpy = vi.spyOn(FundingService.prototype, 'addCalendarToFundingPlan')
        .mockResolvedValue();

      vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockResolvedValueOnce({ status: 'unfunded' })
        .mockResolvedValueOnce({ status: 'funded' });

      const wrapper = await mountFundingTab('cal-456');
      currentWrapper = wrapper;

      await flushPromises();

      const addButton = wrapper.find('.funding-button--primary');
      await addButton.trigger('click');
      await flushPromises();

      expect(addSpy).toHaveBeenCalledWith('cal-456', 500000);
    });
  });

  describe('Unfunded status without subscription', () => {
    it('shows subscribe prompt when user has no subscription', async () => {
      setupDefaultMocks({ status: null });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--unfunded').exists()).toBe(true);
      const subscribeButton = wrapper.find('.funding-button--primary');
      expect(subscribeButton.exists()).toBe(true);
      expect(wrapper.text()).toContain('Fund This Calendar');
    });

    it('calls createCheckoutSession when fund button is clicked', async () => {
      setupDefaultMocks({ status: null });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });
      const checkoutSpy = vi.spyOn(FundingService.prototype, 'createCheckoutSession')
        .mockResolvedValue({ clientSecret: 'cs_test', sessionId: 'sess_test' });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const subscribeButton = wrapper.find('.funding-button--primary');
      await subscribeButton.trigger('click');
      await flushPromises();

      expect(checkoutSpy).toHaveBeenCalled();
    });
  });

  describe('Subscriptions disabled', () => {
    it('hides funding UI when subscriptions are disabled', async () => {
      setupDefaultMocks({ options: { ...defaultOptions, enabled: false } });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-content').exists()).toBe(false);
      expect(wrapper.find('.funding-status-badge').exists()).toBe(false);
    });
  });

  describe('Admin-exempt status', () => {
    it('renders admin-exempt badge without action buttons', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'admin-exempt',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--exempt').exists()).toBe(true);
      expect(wrapper.find('.funding-button--primary').exists()).toBe(false);
      expect(wrapper.find('.funding-button--secondary').exists()).toBe(false);
    });
  });

  describe('Grant status', () => {
    it('renders grant badge without action buttons', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'grant',
        grantInfo: { reason: 'Beta tester' },
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--grant').exists()).toBe(true);
      expect(wrapper.find('.funding-button--primary').exists()).toBe(false);
      expect(wrapper.find('.funding-button--secondary').exists()).toBe(false);
    });

    it('displays grant reason when provided', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'grant',
        grantInfo: { reason: 'Beta tester reward' },
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.grant-details').exists()).toBe(true);
      expect(wrapper.text()).toContain('Beta tester reward');
    });
  });

  describe('Error handling', () => {
    it('shows error alert when loading fails', async () => {
      vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockRejectedValue(new Error('Network error'));
      vi.spyOn(FundingService.prototype, 'getStatus')
        .mockResolvedValue(activeSubscription);
      vi.spyOn(FundingService.prototype, 'getOptions')
        .mockResolvedValue(defaultOptions);

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });

    it('shows error alert when add action fails', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockResolvedValue({ status: 'unfunded' });
      vi.spyOn(FundingService.prototype, 'addCalendarToFundingPlan')
        .mockRejectedValue(new Error('Add failed'));

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const addButton = wrapper.find('.funding-button--primary');
      await addButton.trigger('click');
      await flushPromises();

      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });

    it('shows error alert when remove action fails', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockResolvedValue({ status: 'funded' });
      vi.spyOn(FundingService.prototype, 'removeCalendarFromFundingPlan')
        .mockRejectedValue(new Error('Remove failed'));

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const removeButton = wrapper.find('.funding-button--secondary');
      await removeButton.trigger('click');
      await flushPromises();

      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });
  });

  describe('Success messages', () => {
    it('shows success alert after successful add', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'addCalendarToFundingPlan')
        .mockResolvedValue();
      vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockResolvedValueOnce({ status: 'unfunded' })
        .mockResolvedValueOnce({ status: 'funded' });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const addButton = wrapper.find('.funding-button--primary');
      await addButton.trigger('click');
      await flushPromises();

      expect(wrapper.find('.alert--success').exists()).toBe(true);
    });

    it('shows success alert after successful remove', async () => {
      setupDefaultMocks();
      vi.spyOn(FundingService.prototype, 'removeCalendarFromFundingPlan')
        .mockResolvedValue();
      vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockResolvedValueOnce({ status: 'funded' })
        .mockResolvedValueOnce({ status: 'unfunded' });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const removeButton = wrapper.find('.funding-button--secondary');
      await removeButton.trigger('click');
      await flushPromises();

      expect(wrapper.find('.alert--success').exists()).toBe(true);
    });
  });

  describe('Button disabled state during actions', () => {
    it('disables add button while action is in progress', async () => {
      setupDefaultMocks();
      let resolveAdd: () => void;
      const addPromise = new Promise<void>((resolve) => {
        resolveAdd = resolve;
      });

      vi.spyOn(FundingService.prototype, 'addCalendarToFundingPlan')
        .mockReturnValue(addPromise);
      vi.spyOn(FundingService.prototype, 'getFundingStatus')
        .mockResolvedValue({ status: 'unfunded' });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const addButton = wrapper.find('.funding-button--primary');
      await addButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(addButton.attributes('disabled')).toBeDefined();

      resolveAdd!();
      await flushPromises();
    });
  });

  describe('PWYC mode (no existing funding plan)', () => {
    const pwycOptions = {
      ...defaultOptions,
      payWhatYouCan: true,
      payWhatYouCanYearlyDiscount: 15,
    };

    it('renders monthly amount input instead of pricing cards', async () => {
      setupDefaultMocks({ status: null, options: pwycOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#pwyc-new-monthly').exists()).toBe(true);
      expect(wrapper.find('.pricing-cards').exists()).toBe(false);
    });

    it('prefills monthly input from admin suggested price', async () => {
      // monthlyPrice = 500000 millicents = $5.00
      setupDefaultMocks({ status: null, options: pwycOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const input = wrapper.find('#pwyc-new-monthly');
      expect((input.element as HTMLInputElement).value).toBe('5');
    });

    it('shows yearly opt-in checkbox with computed discounted amount', async () => {
      // monthlyPrice = 500000 millicents = $5.00
      // yearly = 5 * 12 * (1 - 15/100) = 5 * 12 * 0.85 = $51.00
      setupDefaultMocks({ status: null, options: pwycOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const yearlyLabel = wrapper.find('.yearly-opt-in span');
      expect(yearlyLabel.exists()).toBe(true);
      expect(yearlyLabel.text()).toContain('$51.00');
    });

    it('shows discount note when discount is greater than 0', async () => {
      setupDefaultMocks({ status: null, options: pwycOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const discountNote = wrapper.find('.yearly-discount-note');
      expect(discountNote.exists()).toBe(true);
      expect(discountNote.text()).toContain('15');
    });

    it('hides discount note when discount is 0', async () => {
      const noPwycDiscount = { ...pwycOptions, payWhatYouCanYearlyDiscount: 0 };
      setupDefaultMocks({ status: null, options: noPwycDiscount });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.yearly-discount-note').exists()).toBe(false);
    });
  });

  describe('PWYC mode (with existing funding plan)', () => {
    const pwycOptions = {
      ...defaultOptions,
      payWhatYouCan: true,
      payWhatYouCanYearlyDiscount: 15,
    };

    it('renders monthly amount input in unfunded-with-plan state', async () => {
      setupDefaultMocks({ options: pwycOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('#pwyc-add-monthly').exists()).toBe(true);
      expect(wrapper.find('.pricing-cards').exists()).toBe(false);
    });

    it('shows yearly opt-in with correct discounted amount', async () => {
      // monthlyPrice = 500000 millicents = $5.00
      // yearly = 5 * 12 * 0.85 = $51.00
      setupDefaultMocks({ options: pwycOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const yearlyLabel = wrapper.find('.yearly-opt-in span');
      expect(yearlyLabel.exists()).toBe(true);
      expect(yearlyLabel.text()).toContain('$51.00');
    });
  });

  describe('PWYC discount precision', () => {
    it('computes yearly = monthly * 12 * (1 - discount/100) precisely', async () => {
      // monthlyPrice = 1000000 millicents = $10.00
      // discount = 15% => yearly = 10 * 12 * 0.85 = $102.00
      const precisionOptions = {
        ...defaultOptions,
        monthlyPrice: 1000000,
        payWhatYouCan: true,
        payWhatYouCanYearlyDiscount: 15,
      };
      setupDefaultMocks({ status: null, options: precisionOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const yearlyLabel = wrapper.find('.yearly-opt-in span');
      expect(yearlyLabel.text()).toContain('$102.00');
    });

    it('computes yearly as monthly * 12 when discount is 0%', async () => {
      // monthlyPrice = 1000000 millicents = $10.00
      // discount = 0% => yearly = 10 * 12 = $120.00
      const noDiscountOptions = {
        ...defaultOptions,
        monthlyPrice: 1000000,
        payWhatYouCan: true,
        payWhatYouCanYearlyDiscount: 0,
      };
      setupDefaultMocks({ status: null, options: noDiscountOptions });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const yearlyLabel = wrapper.find('.yearly-opt-in span');
      expect(yearlyLabel.text()).toContain('$120.00');
    });
  });

  describe('Non-PWYC regression guard', () => {
    it('renders pricing cards when payWhatYouCan is false', async () => {
      setupDefaultMocks({ status: null });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.pricing-cards').exists()).toBe(true);
      expect(wrapper.findAll('.pricing-card')).toHaveLength(2);
      expect(wrapper.find('#pwyc-new-monthly').exists()).toBe(false);
      expect(wrapper.find('.yearly-opt-in').exists()).toBe(false);
    });

    it('displays formatted monthly and yearly prices on pricing cards', async () => {
      setupDefaultMocks({ status: null });
      vi.spyOn(FundingService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const cards = wrapper.findAll('.pricing-card');
      expect(cards[0].text()).toContain('$5.00');
      expect(cards[1].text()).toContain('$50.00');
    });
  });
});
