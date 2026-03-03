import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import AddProviderWizard from '@/client/components/admin/AddProviderWizard.vue';
import type { ProviderConfig } from '@/client/service/subscription';
import enAdmin from '@/client/locales/en/admin.json';

describe('AddProviderWizard', () => {
  const mockUnconfiguredProviders: ProviderConfig[] = [
    {
      provider_type: 'stripe',
      enabled: false,
      display_name: 'Stripe',
      configured: false,
    },
    {
      provider_type: 'paypal',
      enabled: false,
      display_name: 'PayPal',
      configured: false,
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Initialize i18next
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          admin: enAdmin,
        },
      },
    });
  });

  function mountWithI18n(options: any = {}) {
    return mount(AddProviderWizard, {
      ...options,
      global: {
        plugins: [[I18NextVue, { i18next }]],
      },
    });
  }

  it('should render wizard when show prop is true', () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    expect(wrapper.find('dialog.modal').exists()).toBe(true);
    expect(wrapper.text()).toContain('Add Payment Provider');
  });

  it('should not render wizard when show prop is false', () => {
    const wrapper = mountWithI18n({
      props: {
        show: false,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
  });

  it('should update selected provider when provider card is clicked', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    const stripeCard = wrapper.findAll('.provider-card').at(0);
    await stripeCard?.trigger('click');
    await nextTick();

    expect(stripeCard?.classes()).toContain('selected');
    expect(wrapper.find('.continue-button').attributes('disabled')).toBeUndefined();
  });

  it('should navigate from step 1 to step 2 when Continue is clicked', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    // Select Stripe
    const stripeCard = wrapper.findAll('.provider-card').at(0);
    await stripeCard?.trigger('click');
    await nextTick();

    // Click continue
    const continueButton = wrapper.find('.continue-button');
    await continueButton.trigger('click');
    await nextTick();

    // Should now be on step 2
    expect(wrapper.text()).toContain('Step 2 of 3');
    expect(wrapper.text()).toContain('Connect Stripe');
  });

  it('should navigate back from step 2 to step 1 when Back is clicked', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    // Get to step 2
    const stripeCard = wrapper.findAll('.provider-card').at(0);
    await stripeCard?.trigger('click');
    const continueButton = wrapper.find('.continue-button');
    await continueButton.trigger('click');
    await nextTick();

    // Click back
    const backButton = wrapper.find('.back-button');
    await backButton.trigger('click');
    await nextTick();

    // Should be back on step 1
    expect(wrapper.text()).toContain('Step 1 of 3');
    expect(wrapper.text()).toContain('Select a Payment Provider');
  });

  it('should emit close event when Cancel is clicked', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    const cancelButton = wrapper.find('.cancel-button');
    await cancelButton.trigger('click');

    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('should emit provider-connected event when Done is clicked on step 3', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    // Manually set component to step 3 success state
    const vm = wrapper.vm as any;
    vm.currentStep = 3;
    vm.selectedProvider = 'stripe';
    await nextTick();

    const doneButton = wrapper.find('.done-button');
    await doneButton.trigger('click');

    expect(wrapper.emitted('provider-connected')).toBeTruthy();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('should display error message on step 2 without closing wizard', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    // Manually set error state on step 2
    const vm = wrapper.vm as any;
    vm.currentStep = 2;
    vm.selectedProvider = 'stripe';
    vm.error = 'Failed to connect Stripe. Please try again.';
    await nextTick();

    expect(wrapper.find('.error-message').exists()).toBe(true);
    expect(wrapper.text()).toContain('Failed to connect Stripe');
    expect(wrapper.find('dialog.modal').exists()).toBe(true); // Still open
  });
});
