import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import AddProviderWizard from '@/client/components/admin/add-provider-wizard.vue';
import FundingService from '@/client/service/funding';
import type { ProviderConfig } from '@/client/service/funding';
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
    expect(wrapper.text()).toContain('Configure Stripe');
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

  describe('Stripe credential entry form', () => {
    async function navigateToStripeStep(wrapper: any) {
      const stripeCard = wrapper.findAll('.provider-card').at(0);
      await stripeCard?.trigger('click');
      await nextTick();
      const continueButton = wrapper.find('.continue-button');
      await continueButton.trigger('click');
      await nextTick();
    }

    it('should render three input fields for Stripe credentials', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      expect(wrapper.find('#stripe-publishable-key').exists()).toBe(true);
      expect(wrapper.find('#stripe-secret-key').exists()).toBe(true);
      expect(wrapper.find('#stripe-webhook-secret').exists()).toBe(true);
    });

    it('should display correct labels and placeholders for Stripe fields', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      expect(wrapper.text()).toContain('Publishable Key');
      expect(wrapper.text()).toContain('Secret Key');
      expect(wrapper.text()).toContain('Webhook Signing Secret');

      const publishableInput = wrapper.find('#stripe-publishable-key');
      expect(publishableInput.attributes('placeholder')).toBe('pk_test_...');

      const secretInput = wrapper.find('#stripe-secret-key');
      expect(secretInput.attributes('placeholder')).toBe('sk_test_...');

      const webhookInput = wrapper.find('#stripe-webhook-secret');
      expect(webhookInput.attributes('placeholder')).toBe('whsec_...');
    });

    it('should show Configure Stripe submit button', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      const submitButton = wrapper.find('.connect-button');
      expect(submitButton.exists()).toBe(true);
      expect(submitButton.text()).toBe('Configure Stripe');
    });

    it('should disable submit button when form is empty', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      const submitButton = wrapper.find('.connect-button');
      expect(submitButton.attributes('disabled')).toBeDefined();
    });

    it('should show validation errors for invalid key formats on blur', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      // Enter invalid publishable key
      const publishableInput = wrapper.find('#stripe-publishable-key');
      await publishableInput.setValue('invalid_key');
      await publishableInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).toContain('Publishable Key must start with pk_test_ or pk_live_');

      // Enter invalid secret key
      const secretInput = wrapper.find('#stripe-secret-key');
      await secretInput.setValue('invalid_key');
      await secretInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).toContain('Secret Key must start with sk_test_ or sk_live_');

      // Enter invalid webhook secret
      const webhookInput = wrapper.find('#stripe-webhook-secret');
      await webhookInput.setValue('invalid_key');
      await webhookInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).toContain('Webhook Signing Secret must start with whsec_');
    });

    it('should clear validation errors for valid key formats', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      // Enter valid publishable key
      const publishableInput = wrapper.find('#stripe-publishable-key');
      await publishableInput.setValue('pk_test_abc123');
      await publishableInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).not.toContain('Publishable Key must start with');

      // Enter valid secret key
      const secretInput = wrapper.find('#stripe-secret-key');
      await secretInput.setValue('sk_test_abc123');
      await secretInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).not.toContain('Secret Key must start with');

      // Enter valid webhook secret
      const webhookInput = wrapper.find('#stripe-webhook-secret');
      await webhookInput.setValue('whsec_abc123');
      await webhookInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).not.toContain('Webhook Signing Secret must start with');
    });

    it('should show required errors for empty fields on blur', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      // Blur empty fields
      await wrapper.find('#stripe-publishable-key').trigger('blur');
      await wrapper.find('#stripe-secret-key').trigger('blur');
      await wrapper.find('#stripe-webhook-secret').trigger('blur');
      await nextTick();

      expect(wrapper.text()).toContain('Publishable Key is required');
      expect(wrapper.text()).toContain('Secret Key is required');
      expect(wrapper.text()).toContain('Webhook Signing Secret is required');
    });

    it('should enable submit button when all fields have valid values', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      await wrapper.find('#stripe-publishable-key').setValue('pk_test_abc123');
      await wrapper.find('#stripe-publishable-key').trigger('blur');
      await wrapper.find('#stripe-secret-key').setValue('sk_test_abc123');
      await wrapper.find('#stripe-secret-key').trigger('blur');
      await wrapper.find('#stripe-webhook-secret').setValue('whsec_abc123');
      await wrapper.find('#stripe-webhook-secret').trigger('blur');
      await nextTick();

      const submitButton = wrapper.find('.connect-button');
      expect(submitButton.attributes('disabled')).toBeUndefined();
    });

    it('should call configureStripe on form submission with valid credentials', async () => {
      const mockConfigureStripe = vi.spyOn(FundingService.prototype, 'configureStripe').mockResolvedValue(true);

      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      await wrapper.find('#stripe-publishable-key').setValue('pk_test_abc123');
      await wrapper.find('#stripe-publishable-key').trigger('blur');
      await wrapper.find('#stripe-secret-key').setValue('sk_test_abc123');
      await wrapper.find('#stripe-secret-key').trigger('blur');
      await wrapper.find('#stripe-webhook-secret').setValue('whsec_abc123');
      await wrapper.find('#stripe-webhook-secret').trigger('blur');
      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit');
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockConfigureStripe).toHaveBeenCalledWith({
        publishable_key: 'pk_test_abc123',
        secret_key: 'sk_test_abc123',
        webhook_secret: 'whsec_abc123',
      });

      mockConfigureStripe.mockRestore();
    });

    it('should navigate to success step after successful configuration', async () => {
      vi.spyOn(FundingService.prototype, 'configureStripe').mockResolvedValue(true);

      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      await wrapper.find('#stripe-publishable-key').setValue('pk_test_abc123');
      await wrapper.find('#stripe-publishable-key').trigger('blur');
      await wrapper.find('#stripe-secret-key').setValue('sk_test_abc123');
      await wrapper.find('#stripe-secret-key').trigger('blur');
      await wrapper.find('#stripe-webhook-secret').setValue('whsec_abc123');
      await wrapper.find('#stripe-webhook-secret').trigger('blur');
      await nextTick();

      await wrapper.find('form').trigger('submit');
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.text()).toContain('Step 3 of 3');
      expect(wrapper.text()).toContain('Provider Connected');
    });

    it('should show error message when configuration fails', async () => {
      vi.spyOn(FundingService.prototype, 'configureStripe').mockRejectedValue(new Error('Network error'));

      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      await wrapper.find('#stripe-publishable-key').setValue('pk_test_abc123');
      await wrapper.find('#stripe-publishable-key').trigger('blur');
      await wrapper.find('#stripe-secret-key').setValue('sk_test_abc123');
      await wrapper.find('#stripe-secret-key').trigger('blur');
      await wrapper.find('#stripe-webhook-secret').setValue('whsec_abc123');
      await wrapper.find('#stripe-webhook-secret').trigger('blur');
      await nextTick();

      await wrapper.find('form').trigger('submit');
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.text()).toContain('Failed to connect Stripe');
    });

    it('should disable form inputs during submission', async () => {
      let resolvePromise: (value: boolean) => void;
      const configurePromise = new Promise<boolean>(resolve => {
        resolvePromise = resolve;
      });
      vi.spyOn(FundingService.prototype, 'configureStripe').mockReturnValue(configurePromise);

      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      await wrapper.find('#stripe-publishable-key').setValue('pk_test_abc123');
      await wrapper.find('#stripe-publishable-key').trigger('blur');
      await wrapper.find('#stripe-secret-key').setValue('sk_test_abc123');
      await wrapper.find('#stripe-secret-key').trigger('blur');
      await wrapper.find('#stripe-webhook-secret').setValue('whsec_abc123');
      await wrapper.find('#stripe-webhook-secret').trigger('blur');
      await nextTick();

      await wrapper.find('form').trigger('submit');
      await nextTick();

      // During submission, inputs should be disabled
      expect(wrapper.find('#stripe-publishable-key').attributes('disabled')).toBeDefined();
      expect(wrapper.find('#stripe-secret-key').attributes('disabled')).toBeDefined();
      expect(wrapper.find('#stripe-webhook-secret').attributes('disabled')).toBeDefined();

      // Resolve the promise to clean up
      resolvePromise!(true);
      await nextTick();
    });

    it('should accept pk_live_ prefix for publishable key', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      const publishableInput = wrapper.find('#stripe-publishable-key');
      await publishableInput.setValue('pk_live_abc123');
      await publishableInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).not.toContain('Publishable Key must start with');
    });

    it('should accept sk_live_ prefix for secret key', async () => {
      const wrapper = mountWithI18n({
        props: {
          show: true,
          unconfiguredProviders: mockUnconfiguredProviders,
        },
      });

      await navigateToStripeStep(wrapper);

      const secretInput = wrapper.find('#stripe-secret-key');
      await secretInput.setValue('sk_live_abc123');
      await secretInput.trigger('blur');
      await nextTick();

      expect(wrapper.text()).not.toContain('Secret Key must start with');
    });
  });
});
