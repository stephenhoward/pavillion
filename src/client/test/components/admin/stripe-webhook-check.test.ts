import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import StripeWebhookCheck from '@/client/components/admin/stripe-webhook-check.vue';
import { STRIPE_WEBHOOK_EVENTS } from '@/common/model/funding-plan';
import type { StripeWebhookCheck as StripeWebhookCheckResult } from '@/common/model/funding-plan';
import enAdmin from '@/client/locales/en/admin.json';

const WEBHOOK_URL = 'https://events.example.org/api/funding/webhooks/stripe';

describe('StripeWebhookCheck', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      resources: { en: { admin: enAdmin } },
      // As the app configures it (src/common/i18n/config.ts): Vue escapes
      interpolation: { escapeValue: false },
    });
  });

  function mountCheck(check: StripeWebhookCheckResult, props: { webhookUrl?: string } = { webhookUrl: WEBHOOK_URL }) {
    return mount(StripeWebhookCheck, {
      props: { check, ...props },
      global: { plugins: [[I18NextVue, { i18next }]] },
    });
  }

  function listedEvents(wrapper: ReturnType<typeof mountCheck>): string[] {
    return wrapper.findAll('.webhook-check__events code').map(code => code.text());
  }

  it('renders nothing when the destination sends every required event', () => {
    const wrapper = mountCheck({ status: 'ok', missingEvents: [] });

    expect(wrapper.find('.webhook-check').exists()).toBe(false);
  });

  it('names the webhook URL and lists only the events the destination omits', () => {
    const wrapper = mountCheck({
      status: 'missing_events',
      missingEvents: ['checkout.session.completed', 'customer.subscription.deleted'],
    });

    expect(wrapper.text()).toContain(WEBHOOK_URL);
    expect(wrapper.text()).toContain('does not send the events below');
    expect(listedEvents(wrapper)).toEqual(['checkout.session.completed', 'customer.subscription.deleted']);
  });

  it('lists every required event when no destination exists for the URL', () => {
    const wrapper = mountCheck({ status: 'no_destination', missingEvents: [] });

    expect(wrapper.text()).toContain(`Stripe has no webhook destination for ${WEBHOOK_URL}`);
    expect(listedEvents(wrapper)).toEqual([...STRIPE_WEBHOOK_EVENTS]);
  });

  it('lists every required event when the destinations could not be read', () => {
    const wrapper = mountCheck({ status: 'unchecked', missingEvents: [] });

    expect(wrapper.text()).toContain('could not read');
    expect(listedEvents(wrapper)).toEqual([...STRIPE_WEBHOOK_EVENTS]);
  });

  it('says a disabled destination must be enabled, with no event list', () => {
    const wrapper = mountCheck({ status: 'disabled', missingEvents: [] });

    expect(wrapper.text()).toContain('is disabled');
    expect(wrapper.find('.webhook-check__events').exists()).toBe(false);
  });

  it('falls back to a generic phrase when no webhook URL is known', () => {
    const wrapper = mountCheck({ status: 'no_destination', missingEvents: [] }, {});

    expect(wrapper.text()).toContain('Stripe has no webhook destination for this instance');
  });
});
