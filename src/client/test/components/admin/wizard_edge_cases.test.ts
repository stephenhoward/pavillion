import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import AddProviderWizard from '@/client/components/admin/AddProviderWizard.vue';
import type { ProviderConfig } from '@/client/service/subscription';
import enAdmin from '@/client/locales/en/admin.json';

/**
 * Edge Case and Critical Flow Tests
 *
 * These tests complement the main AddProviderWizard tests by covering:
 * - Cancel flow
 * - Back navigation behavior
 * - Form validation edge cases
 */

describe('AddProviderWizard Edge Cases and Critical Flows', () => {
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

  it('should close wizard and emit close event when cancel button is clicked', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    const cancelButton = wrapper.find('button.cancel-button');
    await cancelButton.trigger('click');
    await nextTick();

    // Should emit close event
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('close')?.length).toBe(1);
  });

  it('should navigate back to step 1 from step 2 and preserve selection', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    // Select a provider
    const stripeCard = wrapper.findAll('.provider-card').at(0);
    await stripeCard?.trigger('click');
    await nextTick();

    const continueButton = wrapper.find('button.continue-button');
    await continueButton.trigger('click');
    await nextTick();

    // Verify we're on step 2
    expect(wrapper.text()).toContain('Connect Stripe');

    // Click Back button
    const backButton = wrapper.find('button.back-button');
    await backButton.trigger('click');
    await nextTick();

    // Should be back on step 1
    expect(wrapper.text()).toContain('Select a Payment Provider');

    // Original selection should still be present
    const selectedCards = wrapper.findAll('.provider-card.selected');
    expect(selectedCards.length).toBe(1);
    expect(selectedCards[0].text()).toContain('Stripe');
  });

  it('should disable PayPal submit button when form is incomplete', async () => {
    const wrapper = mountWithI18n({
      props: {
        show: true,
        unconfiguredProviders: mockUnconfiguredProviders,
      },
    });

    // Select PayPal
    const paypalCard = wrapper.findAll('.provider-card').at(1);
    await paypalCard?.trigger('click');
    await nextTick();

    const continueButton = wrapper.find('button.continue-button');
    await continueButton.trigger('click');
    await nextTick();

    // Submit button should be disabled initially (empty form)
    const submitButton = wrapper.find('button.connect-button');
    expect(submitButton.attributes('disabled')).toBeDefined();

    // Fill only client ID
    const clientIdInput = wrapper.find('input#paypal-client-id');
    await clientIdInput.setValue('test-id');
    await nextTick();

    // Should still be disabled (missing secret)
    expect(submitButton.attributes('disabled')).toBeDefined();

    // Fill client secret
    const clientSecretInput = wrapper.find('input#paypal-client-secret');
    await clientSecretInput.setValue('test-secret');
    await nextTick();

    // Should now be enabled (all required fields filled)
    expect(submitButton.attributes('disabled')).toBeUndefined();
  });
});
