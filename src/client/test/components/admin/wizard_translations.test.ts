import { describe, it, expect, beforeEach } from 'vitest';
import i18next from 'i18next';
import enAdmin from '@/client/locales/en/admin.json';

describe('Wizard Translation Keys', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          admin: enAdmin,
        },
      },
    });
  });

  it('should have all wizard base translation keys accessible', () => {
    expect(i18next.t('admin:funding.wizard.title')).toBe('Add Payment Provider');
    expect(i18next.t('admin:funding.wizard.cancel_button')).toBe('Cancel');
    expect(i18next.t('admin:funding.wizard.back_button')).toBe('Back');
    expect(i18next.t('admin:funding.wizard.continue_button')).toBe('Continue');
    expect(i18next.t('admin:funding.wizard.done_button')).toBe('Done');
  });

  it('should render step indicator with interpolation correctly', () => {
    const translated = i18next.t('admin:funding.wizard.step_indicator', { current: 1, total: 3 });
    expect(translated).toBe('Step 1 of 3');
  });

  it('should have provider description translation keys', () => {
    expect(i18next.t('admin:funding.wizard.providers.stripe_name')).toBe('Stripe');
    expect(i18next.t('admin:funding.wizard.providers.stripe_description')).toBe('Credit card payments');
    expect(i18next.t('admin:funding.wizard.providers.paypal_name')).toBe('PayPal');
    expect(i18next.t('admin:funding.wizard.providers.paypal_description')).toBe('Credit cards or PayPal payments');
  });

  it('should have step 3 success message with interpolation', () => {
    const translated = i18next.t('admin:funding.wizard.step3.success_message', { provider: 'Stripe' });
    expect(translated).toBe('Stripe has been successfully connected.');
  });

  it('should have funding page Add Provider button translations', () => {
    expect(i18next.t('admin:funding.add_provider_button')).toBe('Add Provider');
    expect(i18next.t('admin:funding.add_provider_tooltip_disabled')).toBe('All available providers are already connected');
  });
});
