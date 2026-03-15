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
      vi.spyOn(SubscriptionService.prototype, 'getFundingStatus').mockReturnValue(
        new Promise(() => {}), // never resolves
      );

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await wrapper.vm.$nextTick();

      expect(wrapper.find('.loading-message').exists()).toBe(true);
    });
  });

  describe('Funded status', () => {
    it('renders funded badge and remove button', async () => {
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
      const removeSpy = vi.spyOn(SubscriptionService.prototype, 'removeCalendarFromSubscription')
        .mockResolvedValue();

      // getFundingStatus: first call returns funded, second returns unfunded (after removal)
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
      // Should have reloaded the status
      expect(getFundingSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Unfunded status', () => {
    it('renders unfunded badge and add button', async () => {
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

  describe('Admin-exempt status', () => {
    it('renders admin-exempt badge without action buttons', async () => {
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

      const wrapper = await mountFundingTab();
      currentWrapper = wrapper;

      await flushPromises();

      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });

    it('shows error alert when add action fails', async () => {
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

      // Button should be disabled while action is in progress
      expect(addButton.attributes('disabled')).toBeDefined();

      // Resolve the promise to clean up
      resolveAdd!();
      await flushPromises();
    });
  });
});
