import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';

import FundingTab from '@/client/components/logged_in/calendar-management/FundingTab.vue';
import SubscriptionService from '@/client/service/subscription';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/manage/:calendar', component: {}, name: 'manage' },
];

const defaultOptions = {
  enabled: true,
  providers: [{ provider_type: 'stripe', display_name: 'Stripe' }],
  monthly_price: 500000,
  yearly_price: 5000000,
  currency: 'USD',
  pay_what_you_can: false,
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
 * Set up default mocks for getStatus and getOptions.
 * Individual tests can override these before mounting.
 */
function setupDefaultMocks(overrides?: {
  status?: any;
  options?: any;
}) {
  vi.spyOn(SubscriptionService.prototype, 'getStatus')
    .mockResolvedValue('status' in (overrides || {}) ? overrides!.status : activeSubscription);
  vi.spyOn(SubscriptionService.prototype, 'getOptions')
    .mockResolvedValue(overrides?.options ?? defaultOptions);
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
      SubscribeSheet: {
        template: '<div class="subscribe-sheet-stub"><slot /></div>',
        props: ['calendarId'],
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockReturnValue(
        new Promise(() => {}), // never resolves
      );
      vi.spyOn(SubscriptionService.prototype, 'getStatus').mockReturnValue(
        new Promise(() => {}),
      );
      vi.spyOn(SubscriptionService.prototype, 'getOptions').mockReturnValue(
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'funded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--funded').exists()).toBe(true);
      const removeButton = wrapper.find('.funding-button--secondary');
      expect(removeButton.exists()).toBe(true);
    });

    it('calls removeCalendarFromSubscription when remove button is clicked', async () => {
      setupDefaultMocks();
      const removeSpy = vi.spyOn(SubscriptionService.prototype, 'removeCalendarFromSubscription')
        .mockResolvedValue();

      const getFundingSpy = vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--unfunded').exists()).toBe(true);
      const addButton = wrapper.find('.funding-button--primary');
      expect(addButton.exists()).toBe(true);
    });

    it('calls addCalendarToSubscription when add button is clicked', async () => {
      setupDefaultMocks();
      const addSpy = vi.spyOn(SubscriptionService.prototype, 'addCalendarToSubscription')
        .mockResolvedValue();

      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
        .mockResolvedValueOnce({ status: 'unfunded' })
        .mockResolvedValueOnce({ status: 'funded' });

      const wrapper = await mountFundingTab('cal-456');
      currentWrapper = wrapper;

      await flushPromises();

      const addButton = wrapper.find('.funding-button--primary');
      await addButton.trigger('click');
      await flushPromises();

      expect(addSpy).toHaveBeenCalledWith('cal-456', 0);
    });
  });

  describe('Unfunded status without subscription', () => {
    it('shows subscribe prompt when user has no subscription', async () => {
      setupDefaultMocks({ status: null });
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.funding-status-badge--unfunded').exists()).toBe(true);
      const subscribeButton = wrapper.find('.funding-button--primary');
      expect(subscribeButton.exists()).toBe(true);
      expect(wrapper.text()).toContain('Subscribe');
    });

    it('opens subscribe sheet when subscribe button is clicked', async () => {
      setupDefaultMocks({ status: null });
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
        status: 'unfunded',
      });

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      const subscribeButton = wrapper.find('.funding-button--primary');
      await subscribeButton.trigger('click');
      await flushPromises();

      expect(wrapper.find('.subscribe-sheet-stub').exists()).toBe(true);
    });
  });

  describe('Subscriptions disabled', () => {
    it('hides funding UI when subscriptions are disabled', async () => {
      setupDefaultMocks({ options: { ...defaultOptions, enabled: false } });
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockResolvedValue({
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
        .mockRejectedValue(new Error('Network error'));
      vi.spyOn(SubscriptionService.prototype, 'getStatus')
        .mockResolvedValue(activeSubscription);
      vi.spyOn(SubscriptionService.prototype, 'getOptions')
        .mockResolvedValue(defaultOptions);

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });

    it('shows error alert when add action fails', async () => {
      setupDefaultMocks();
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
        .mockResolvedValue({ status: 'unfunded' });
      vi.spyOn(SubscriptionService.prototype, 'addCalendarToSubscription')
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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
        .mockResolvedValue({ status: 'funded' });
      vi.spyOn(SubscriptionService.prototype, 'removeCalendarFromSubscription')
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
      vi.spyOn(SubscriptionService.prototype, 'addCalendarToSubscription')
        .mockResolvedValue();
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
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
      vi.spyOn(SubscriptionService.prototype, 'removeCalendarFromSubscription')
        .mockResolvedValue();
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
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

      vi.spyOn(SubscriptionService.prototype, 'addCalendarToSubscription')
        .mockReturnValue(addPromise);
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus')
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
});
