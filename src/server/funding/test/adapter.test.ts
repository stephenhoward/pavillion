import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import Stripe from 'stripe';

// Intercept the shared logger so the webhook-parsing tests can assert the
// level a diagnostic lands at. The adapter warns only on genuine API-shape
// drift; ordinary invoices that carry no subscription must stay at debug or
// the warning stops meaning anything. vi.hoisted lets the stubs be shared
// between the mock factory and the assertions.
const { warnStub, debugStub } = vi.hoisted(() => {
  return {
    warnStub: vi.fn(),
    debugStub: vi.fn(),
  };
});

vi.mock('@/server/common/helper/logger', () => ({
  createLogger: () => ({
    warn: warnStub,
    debug: debugStub,
    info: vi.fn(),
    error: vi.fn(),
  }),
  default: {
    warn: warnStub,
    debug: debugStub,
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { StripeAdapter } from '../service/provider/stripe';
import { capturedStripeEvent, capturedStripeEventPayload } from './fixtures/stripe';
import { buildProviderIdempotencyKey } from '../service/provider/idempotency';
import { PayPalAdapter } from '../service/provider/paypal';
import { MockStripeAdapter, MockPayPalAdapter } from '../service/provider/mock_adapters';
import { ProviderFactory } from '../service/provider/factory';

describe('Payment Provider Adapters', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
    ProviderFactory.clearAllCaches();
  });

  describe('PaymentProviderAdapter Interface Contract', () => {
    it('should define standard interface methods for all providers', () => {
      // Required properties
      const requiredProps = ['providerType'];

      // Required methods (including the 3 new checkout/price methods)
      const requiredMethods = [
        'cancelSubscription',
        'supportsAmountUpdates',
        'updateSubscriptionAmount',
        'getSubscription',
        'getBillingPortalUrl',
        'verifyWebhookSignature',
        'parseWebhookEvent',
        'validateCredentials',
        'createCheckoutSession',
        'getCheckoutSessionStatus',
        'createPrice',
      ];

      expect(requiredProps.length).toBe(1);
      expect(requiredMethods.length).toBe(11);

      // Verify StripeAdapter implements the interface
      const stripeAdapter = new StripeAdapter(
        { apiKey: 'sk_test_123' },
        'whsec_test',
      );

      expect(stripeAdapter.providerType).toBe('stripe');
      requiredMethods.forEach((method) => {
        expect(typeof (stripeAdapter as any)[method]).toBe('function');
      });

      // Verify PayPalAdapter implements the interface
      const paypalAdapter = new PayPalAdapter(
        { clientId: 'test_client', secret: 'test_secret', mode: 'sandbox' },
        'paypal_webhook_secret',
      );

      expect(paypalAdapter.providerType).toBe('paypal');
      requiredMethods.forEach((method) => {
        expect(typeof (paypalAdapter as any)[method]).toBe('function');
      });
    });
  });

  describe('StripeAdapter', () => {
    let stripeAdapter: StripeAdapter;
    let mockStripe: any;

    beforeEach(() => {
      // Create mock Stripe instance
      mockStripe = {
        customers: {
          create: sandbox.stub(),
          list: sandbox.stub(),
        },
        subscriptions: {
          create: sandbox.stub(),
          retrieve: sandbox.stub(),
          update: sandbox.stub(),
          cancel: sandbox.stub(),
        },
        prices: {
          create: sandbox.stub(),
        },
        checkout: {
          sessions: {
            create: sandbox.stub(),
            retrieve: sandbox.stub(),
          },
        },
        billingPortal: {
          sessions: {
            create: sandbox.stub(),
          },
        },
        webhooks: {
          constructEvent: sandbox.stub(),
        },
        balance: {
          retrieve: sandbox.stub(),
        },
      };

      warnStub.mockClear();
      debugStub.mockClear();

      // Create adapter
      const credentials = { apiKey: 'sk_test_123' };
      const webhookSecret = 'whsec_test_secret';
      stripeAdapter = new StripeAdapter(credentials, webhookSecret);

      // Replace the Stripe instance with our mock
      (stripeAdapter as any).stripe = mockStripe;
    });

    it('should pin the Stripe API version to the version the installed SDK types describe', () => {
      // A drifted pin makes Stripe serialize responses in an older shape than
      // the SDK types (and this adapter's field reads) expect.
      const adapter = new StripeAdapter({ apiKey: 'sk_test_123' }, 'whsec_test');
      const client = (adapter as any).stripe;

      expect(client.getApiField('version')).toBe(Stripe.API_VERSION);
    });

    it('should bound the Stripe client so a hung call cannot pin a pooled database connection', () => {
      // updateSubscriptionAmount issues three sequential Stripe round trips and
      // runs inside a database transaction, so the worst-case connection hold is
      // calls x timeout x (1 + maxNetworkRetries). On the SDK defaults (80s, 2
      // retries) that is roughly twelve minutes on one pooled connection; the
      // explicit options bring it to twenty-four seconds. This test guards the
      // inputs to that arithmetic — see the rationale comment in stripe.ts.
      //
      // getApiField returns exactly what was passed to the constructor, but it is
      // absent from Stripe's published types, hence the cast.
      const adapter = new StripeAdapter({ apiKey: 'sk_test_123' }, 'whsec_test');
      const client = (adapter as any).stripe;

      expect(client.getApiField('timeout')).toBe(8000);
      expect(client.getApiField('maxNetworkRetries')).toBe(0);

      // Fail loudly if the options object is ever dropped and the SDK defaults return.
      expect(client.getApiField('timeout')).not.toBe(80000);
      expect(client.getApiField('maxNetworkRetries')).not.toBe(2);
    });

    describe('validateCredentials', () => {
      it('should return true when balance.retrieve() resolves', async () => {
        mockStripe.balance.retrieve.resolves({ available: [], pending: [] });

        const result = await stripeAdapter.validateCredentials({ apiKey: 'sk_test_123' });

        expect(result).toBe(true);
        expect(mockStripe.balance.retrieve.calledOnce).toBe(true);
      });

      it('should return false when balance.retrieve() rejects', async () => {
        mockStripe.balance.retrieve.rejects(new Error('Invalid API Key provided'));

        const result = await stripeAdapter.validateCredentials({ apiKey: 'sk_test_invalid' });

        expect(result).toBe(false);
        expect(mockStripe.balance.retrieve.calledOnce).toBe(true);
      });
    });

    it('should update subscription amount via Stripe API', async () => {
      // Mock subscription retrieve
      mockStripe.subscriptions.retrieve.resolves({
        id: 'sub_mock123',
        items: {
          data: [
            {
              id: 'si_item123',
              price: {
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      });

      // Mock price creation for the new amount
      mockStripe.prices.create.resolves({
        id: 'price_new123',
      });

      // Mock subscription update
      mockStripe.subscriptions.update.resolves({
        id: 'sub_mock123',
      });

      await stripeAdapter.updateSubscriptionAmount('sub_mock123', 2000000, 'USD');

      // Verify subscription was retrieved to get the current item
      expect(mockStripe.subscriptions.retrieve.calledOnce).toBe(true);
      expect(mockStripe.subscriptions.retrieve.calledWith('sub_mock123')).toBe(true);

      // Verify a new price was created with the correct amount
      expect(mockStripe.prices.create.calledOnce).toBe(true);
      const priceArgs = mockStripe.prices.create.firstCall.args[0];
      expect(priceArgs.unit_amount).toBe(2000); // 2000000 millicents -> 2000 cents
      expect(priceArgs.currency).toBe('usd');
      expect(priceArgs.recurring.interval).toBe('month');

      // Verify subscription was updated with no proration
      expect(mockStripe.subscriptions.update.calledOnce).toBe(true);
      const updateArgs = mockStripe.subscriptions.update.firstCall.args;
      expect(updateArgs[0]).toBe('sub_mock123');
      expect(updateArgs[1].items[0].id).toBe('si_item123');
      expect(updateArgs[1].items[0].price).toBe('price_new123');
      expect(updateArgs[1].proration_behavior).toBe('none');
    });

    it('should throw when updating subscription with no items', async () => {
      // Mock subscription retrieve with no items
      mockStripe.subscriptions.retrieve.resolves({
        id: 'sub_mock123',
        items: {
          data: [],
        },
      });

      await expect(
        stripeAdapter.updateSubscriptionAmount('sub_mock123', 2000000, 'USD'),
      ).rejects.toThrow('Subscription has no items to update');
    });

    it('should report support for amount updates', () => {
      expect(stripeAdapter.supportsAmountUpdates()).toBe(true);
    });

    it('should verify webhook signature with valid and invalid signatures', () => {
      const payload = JSON.stringify({ id: 'evt_test', type: 'invoice.paid' });
      const validSignature = 't=1234567890,v1=valid_signature_hash';
      const invalidSignature = 't=1234567890,v1=invalid_signature_hash';

      // Mock valid signature
      mockStripe.webhooks.constructEvent.onFirstCall().returns({ id: 'evt_test' });

      // Mock invalid signature (throws error)
      mockStripe.webhooks.constructEvent.onSecondCall().throws(new Error('Invalid signature'));

      // Test valid signature
      const validResult = stripeAdapter.verifyWebhookSignature(payload, validSignature);
      expect(validResult).toBe(true);

      // Test invalid signature
      const invalidResult = stripeAdapter.verifyWebhookSignature(payload, invalidSignature);
      expect(invalidResult).toBe(false);
    });

    describe('parseWebhookEvent', () => {
      // ---------------------------------------------------------------------
      // Captured payloads — one per handled event type, replayed byte-for-byte
      // from a real test-mode Stripe delivery at the API version the adapter
      // pins (src/server/funding/test/fixtures/stripe). These are the tests
      // that detect Stripe API-shape drift; a hand-written payload can only
      // ever re-assert the author's belief about the shape, which is precisely
      // what drifted before pv-jdot.2.1. The hand-built cases further down
      // cover shapes no capture at this API version can produce, and each says
      // why it has to be hand-built.
      // ---------------------------------------------------------------------
      describe('captured Stripe test-mode payloads', () => {
        it('should parse a captured checkout.session.completed', () => {
          const fixture = capturedStripeEvent('checkout.session.completed');

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.eventId).toBe('evt_1U9qOaLM7gkEdqMfm3WNk9Ag');
          expect(event.eventType).toBe('checkout.session.completed');
          expect(event.subscriptionId).toBe('sub_1U9qOYLM7gkEdqMfd7WoHNz7');
          expect(event.customerId).toBe('cus_VAAjKPe5TGoA44');
          expect(event.status).toBe('active');
          expect(event.accountId).toBe('6e87d5ca-4d89-42c1-aa9d-5ef437fe1111');

          // Stripe metadata values are strings, so the calendar list arrives
          // JSON-encoded rather than as an array. Downstream parses it; the
          // adapter must pass the string through untouched.
          expect(event.calendarIds).toBe('["cbe74815-939e-48b3-af44-1cd4eb3671bb"]');
          expect(typeof event.calendarIds).toBe('string');
        });

        it('should parse a captured invoice.paid from the parent subscription reference', () => {
          const fixture = capturedStripeEvent('invoice.paid');

          // Shape guard: at this API version the pre-Basil top-level field is
          // not merely null but absent, so the id below can only have come
          // from parent.subscription_details.subscription.
          expect(fixture.data.object).not.toHaveProperty('subscription');

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.eventId).toBe('evt_1U9qOaLM7gkEdqMfdMhGZ0ga');
          expect(event.eventType).toBe('invoice.paid');
          expect(event.subscriptionId).toBe('sub_1U9qOYLM7gkEdqMfd7WoHNz7');
          expect(event.customerId).toBe('cus_VAAjKPe5TGoA44');
          expect(event.status).toBe('active');

          // Invoice events carry no Pavillion metadata at all.
          expect(event.accountId).toBeUndefined();
          expect(event.calendarIds).toBeUndefined();
        });

        it('should parse a captured invoice.payment_succeeded from the parent subscription reference', () => {
          const fixture = capturedStripeEvent('invoice.payment_succeeded');

          expect(fixture.data.object).not.toHaveProperty('subscription');

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.eventId).toBe('evt_1U9qOaLM7gkEdqMfoyJPWt5m');
          expect(event.subscriptionId).toBe('sub_1U9qOYLM7gkEdqMfd7WoHNz7');
          expect(event.customerId).toBe('cus_VAAjKPe5TGoA44');
          expect(event.status).toBe('active');
        });

        it('should parse a captured invoice.payment_failed as past_due', () => {
          const fixture = capturedStripeEvent('invoice.payment_failed');

          expect(fixture.data.object).not.toHaveProperty('subscription');

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.eventId).toBe('evt_1U9qmDLM7gkEdqMfoSuJXlcw');
          expect(event.subscriptionId).toBe('sub_1U9qmALM7gkEdqMfrOrCZcve');
          expect(event.customerId).toBe('cus_VAB6DlQZRO3Ni2');
          expect(event.status).toBe('past_due');
        });

        it('should read the billing period from the items of a captured customer.subscription.updated', () => {
          const fixture = capturedStripeEvent('customer.subscription.updated');

          // Shape guard: the pre-Basil top-level period fields are absent, so
          // the period below can only have come from items.data[0].
          expect(fixture.data.object).not.toHaveProperty('current_period_start');
          expect(fixture.data.object).not.toHaveProperty('current_period_end');

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.eventId).toBe('evt_1U9qPDLM7gkEdqMfo8qMLJSQ');
          expect(event.subscriptionId).toBe('sub_1U9qOYLM7gkEdqMfd7WoHNz7');
          expect(event.customerId).toBe('cus_VAAjKPe5TGoA44');
          expect(event.currentPeriodStart).toEqual(new Date(1788025820 * 1000));
          expect(event.currentPeriodEnd).toEqual(new Date(1790704220 * 1000));
        });

        it('should carry a captured period-end cancellation in cancelAt while still reporting status active', () => {
          // This capture is a cancel-at-period-end: Stripe reports
          // status "active" — correctly, the subscription is paid through the
          // period — and records the cancellation only in
          // cancel_at_period_end / cancel_at / canceled_at. Status therefore
          // stays 'active' here, and cancelAt is the field that reveals the
          // cancellation. Reading status alone is what used to lose it.
          const fixture = capturedStripeEvent('customer.subscription.updated');
          expect(fixture.data.object.status).toBe('active');
          expect(fixture.data.object.cancel_at_period_end).toBe(true);

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.status).toBe('active');
          expect(event.cancelAt).toEqual(new Date(1790704220 * 1000));
          // The boundary is the period end, not the moment the customer asked:
          // canceled_at on this capture is 1788025863, already in the past.
          expect(event.cancelAt).toEqual(event.currentPeriodEnd);
        });

        it('should report no cancelAt for a subscription with no scheduled cancellation', () => {
          // Derived from the capture by undoing the cancellation, which is the
          // shape Stripe sends when a pending cancellation is reversed in the
          // billing portal. null, not undefined: it has to clear a stored
          // boundary rather than leave it standing.
          const fixture = capturedStripeEvent('customer.subscription.updated');
          fixture.data.object.cancel_at = null;
          fixture.data.object.cancel_at_period_end = false;

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.cancelAt).toBeNull();
        });

        it('should withhold cancelAt rather than report null when the field is unusable', () => {
          // Not a shape Stripe sends — which is the point. `null` downstream is
          // an instruction to clear a stored cancellation, so collapsing an
          // unreadable value into it would let one malformed payload un-cancel
          // a plan and hand back access nobody is paying for. `undefined` says
          // "this payload knows nothing", and the stored boundary survives.
          // NaN is deliberately absent: JSON has no such literal, so it
          // serializes to null and cannot reach the parser through a webhook
          // body at all. It is covered on getSubscription below, where the
          // value comes from the SDK rather than from JSON.
          for (const unusable of ['not-a-timestamp', {}]) {
            const fixture = capturedStripeEvent('customer.subscription.updated');
            fixture.data.object.cancel_at = unusable;

            const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

            expect(event.cancelAt).toBeUndefined();
          }

          expect(warnStub).toHaveBeenCalled();
        });

        it('should withhold cancelAt when the field is missing altogether', () => {
          const fixture = capturedStripeEvent('customer.subscription.updated');
          delete (fixture.data.object as Record<string, unknown>).cancel_at;

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.cancelAt).toBeUndefined();
        });

        it('should not map an incomplete subscription to the terminal cancelled status', () => {
          // 'cancelled' is terminal downstream — the plan can never leave it and
          // its allocations are closed — so only a genuinely finished
          // subscription may produce it. 'incomplete' means the first payment
          // has not confirmed yet, which is the ordinary state of an SCA
          // checkout, and the session-return path can create the local plan
          // before it clears.
          const fixture = capturedStripeEvent('customer.subscription.updated');
          fixture.data.object.status = 'incomplete';

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.status).toBe('past_due');
        });

        it('should map an expired incomplete subscription to cancelled', () => {
          // The one incomplete-family status that is genuinely terminal.
          const fixture = capturedStripeEvent('customer.subscription.updated');
          fixture.data.object.status = 'incomplete_expired';

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.status).toBe('cancelled');
        });

        it('should withhold a status Stripe has added since this adapter was written', () => {
          // A `default:` arm that fell through to 'cancelled' would let a future
          // Stripe status destroy paid plans on arrival. Undefined leaves the
          // local status untouched.
          const fixture = capturedStripeEvent('customer.subscription.updated');
          fixture.data.object.status = 'some_future_status';

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.status).toBeUndefined();
          expect(warnStub).toHaveBeenCalled();
        });

        it('should parse a captured customer.subscription.deleted as cancelled', () => {
          const fixture = capturedStripeEvent('customer.subscription.deleted');

          // Stripe spells the wire value with one L; the adapter maps it to
          // Pavillion's two-L internal status.
          expect(fixture.data.object.status).toBe('canceled');
          // Stripe clears the schedule once it has acted on it.
          expect(fixture.data.object.cancel_at).toBeNull();

          const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

          expect(event.eventId).toBe('evt_1U9qcvLM7gkEdqMfiOeIwqzV');
          expect(event.subscriptionId).toBe('sub_1U9qOYLM7gkEdqMfd7WoHNz7');
          expect(event.customerId).toBe('cus_VAAjKPe5TGoA44');
          expect(event.status).toBe('cancelled');
          expect(event.cancelAt).toBeNull();
        });

        it('should raise no drift warning for any captured payload', () => {
          // The warning is reserved for genuine API-shape drift, so a payload
          // Stripe actually sent must never trigger one.
          const captured = [
            'checkout.session.completed',
            'customer.subscription.deleted',
            'customer.subscription.updated',
            'invoice.paid',
            'invoice.payment_failed',
            'invoice.payment_succeeded',
          ] as const;

          for (const type of captured) {
            stripeAdapter.parseWebhookEvent(capturedStripeEventPayload(type));
          }

          expect(warnStub).not.toHaveBeenCalled();
        });
      });

      it('should parse checkout.session.completed without calendarIds', () => {
        // Derived from the real capture by removing the one key under test, so
        // everything else stays the shape Stripe actually sends.
        const fixture = capturedStripeEvent('checkout.session.completed');
        delete (fixture.data.object.metadata as Record<string, string>).pavillion_calendar_ids;

        const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

        expect(event.subscriptionId).toBe('sub_1U9qOYLM7gkEdqMfd7WoHNz7');
        expect(event.status).toBe('active');
        expect(event.accountId).toBe('6e87d5ca-4d89-42c1-aa9d-5ef437fe1111');
        expect(event.calendarIds).toBeUndefined();
      });

      it('should resolve the checkout session subscription when it is expanded to an object', () => {
        const payload = JSON.stringify({
          id: 'evt_checkout_expanded',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: { id: 'sub_checkout_expanded', object: 'subscription' },
              customer: 'cus_checkout_expanded',
              metadata: {
                pavillion_account_id: 'acc_expanded',
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBe('sub_checkout_expanded');
      });

      it('should leave subscriptionId undefined when the checkout session subscription id is not a string', () => {
        const payload = JSON.stringify({
          id: 'evt_checkout_nonstring_id',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: { id: 12345, object: 'subscription' },
              customer: 'cus_checkout_nonstring',
              metadata: {
                pavillion_account_id: 'acc_nonstring',
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBeUndefined();
        expect(warnStub).toHaveBeenCalled();
      });

      it('should resolve the invoice subscription when it is expanded to an object', () => {
        const payload = JSON.stringify({
          id: 'evt_inv_expanded',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_expanded',
              parent: {
                type: 'subscription_details',
                quote_details: null,
                subscription_details: {
                  subscription: { id: 'sub_expanded_123', object: 'subscription' },
                  metadata: null,
                },
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBe('sub_expanded_123');
      });

      it('should fall back to the legacy top-level invoice subscription field', () => {
        // Necessarily hand-built: at the pinned API version Stripe leaves the
        // top-level field null on every invoice, so no capture can reach this
        // branch. It stays covered because an endpoint's serialization version
        // is set by the instance admin, independently of the adapter's pin.
        const payload = JSON.stringify({
          id: 'evt_inv_legacy',
          type: 'invoice.paid',
          data: {
            object: {
              subscription: 'sub_legacy_123',
              customer: 'cus_legacy_123',
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBe('sub_legacy_123');
        expect(event.status).toBe('active');
      });

      it('should prefer the parent subscription when both shapes are present', () => {
        // The resolved id is an authorization key downstream, so precedence
        // between the two shapes must never silently invert.
        const payload = JSON.stringify({
          id: 'evt_inv_both_shapes',
          type: 'invoice.paid',
          data: {
            object: {
              subscription: 'sub_legacy_shape',
              customer: 'cus_both_shapes',
              parent: {
                type: 'subscription_details',
                quote_details: null,
                subscription_details: {
                  subscription: 'sub_modern_shape',
                  metadata: null,
                },
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBe('sub_modern_shape');
      });

      it('should leave subscriptionId undefined when the subscription reference has no id', () => {
        const payload = JSON.stringify({
          id: 'evt_inv_malformed',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_malformed',
              parent: {
                type: 'subscription_details',
                quote_details: null,
                subscription_details: {
                  subscription: { object: 'subscription' },
                  metadata: null,
                },
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBeUndefined();
      });

      it('should leave subscriptionId undefined when the subscription id is not a string', () => {
        const payload = JSON.stringify({
          id: 'evt_inv_nonstring_id',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_nonstring_id',
              parent: {
                type: 'subscription_details',
                quote_details: null,
                subscription_details: {
                  subscription: { id: 12345, object: 'subscription' },
                  metadata: null,
                },
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBeUndefined();
      });

      it('should not warn for a quote invoice, which carries no subscription by design', () => {
        // A quote-backed invoice legitimately has no subscription. Warning on
        // it would drown the warning that exists to surface real shape drift.
        const payload = JSON.stringify({
          id: 'evt_inv_quote',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_quote',
              parent: {
                type: 'quote_details',
                quote_details: { quote: 'qt_quote_123' },
                subscription_details: null,
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBeUndefined();
        expect(warnStub).not.toHaveBeenCalled();
        expect(debugStub).toHaveBeenCalled();
      });

      it('should warn when a subscription parent carries no subscription reference', () => {
        // The inverse of the quote case: the parent claims a subscription but
        // has none, which is the drift the warning is reserved for.
        const payload = JSON.stringify({
          id: 'evt_inv_empty_parent',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_empty_parent',
              parent: {
                type: 'subscription_details',
                quote_details: null,
                subscription_details: null,
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBeUndefined();
        expect(warnStub).toHaveBeenCalled();
      });

      it('should leave subscriptionId undefined for an invoice with no subscription parent', () => {
        const payload = JSON.stringify({
          id: 'evt_inv_one_off',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_one_off',
              parent: null,
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBeUndefined();
        expect(event.customerId).toBe('cus_one_off');
        expect(warnStub).not.toHaveBeenCalled();
      });

      it('should map a past_due subscription status', () => {
        // Derived from the real capture with only the status changed: no
        // captured payload carries past_due, but every other field stays the
        // shape Stripe sends so the mapping is exercised in context.
        const fixture = capturedStripeEvent('customer.subscription.updated');
        fixture.data.object.status = 'past_due';

        const event = stripeAdapter.parseWebhookEvent(JSON.stringify(fixture));

        expect(event.subscriptionId).toBe('sub_1U9qOYLM7gkEdqMfd7WoHNz7');
        expect(event.status).toBe('past_due');
        expect(event.currentPeriodStart).toEqual(new Date(1788025820 * 1000));
        expect(event.currentPeriodEnd).toEqual(new Date(1790704220 * 1000));
      });

      it('should fall back to legacy top-level subscription period fields', () => {
        // Necessarily hand-built: Stripe moved these fields onto the items in
        // the Basil API, so no capture at the pinned version carries them.
        const now = Math.floor(Date.now() / 1000);
        const periodEnd = now + 30 * 24 * 60 * 60;
        const payload = JSON.stringify({
          id: 'evt_sub_updated_legacy',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_upd_legacy',
              customer: 'cus_upd_legacy',
              status: 'active',
              current_period_start: now,
              current_period_end: periodEnd,
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.currentPeriodStart).toEqual(new Date(now * 1000));
        expect(event.currentPeriodEnd).toEqual(new Date(periodEnd * 1000));
      });

      it('should not splice a period from the item and legacy shapes', () => {
        // Item-level and subscription-level anchors need not describe the same
        // window, and the end bound drives access expiry, so a half-populated
        // payload must yield no period rather than a mixed one.
        const now = Math.floor(Date.now() / 1000);
        const payload = JSON.stringify({
          id: 'evt_sub_mixed_shapes',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_mixed_shapes',
              customer: 'cus_mixed_shapes',
              status: 'active',
              current_period_end: now + 90 * 24 * 60 * 60,
              items: {
                object: 'list',
                data: [
                  {
                    id: 'si_mixed_shapes',
                    current_period_start: now,
                  },
                ],
              },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBe('sub_mixed_shapes');
        expect(event.currentPeriodStart).toBeUndefined();
        expect(event.currentPeriodEnd).toBeUndefined();
      });

      it('should omit period dates when no billing period can be resolved', () => {
        const payload = JSON.stringify({
          id: 'evt_sub_no_period',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_no_period',
              customer: 'cus_no_period',
              status: 'active',
              items: { object: 'list', data: [] },
            },
          },
        });

        const event = stripeAdapter.parseWebhookEvent(payload);

        expect(event.subscriptionId).toBe('sub_no_period');
        expect(event.status).toBe('active');
        expect(event.currentPeriodStart).toBeUndefined();
        expect(event.currentPeriodEnd).toBeUndefined();
      });
    });

    describe('getSubscription', () => {
      it('should read the billing period from the first subscription item', async () => {
        const start = Math.floor(Date.now() / 1000);
        const end = start + 30 * 24 * 60 * 60;
        mockStripe.subscriptions.retrieve.resolves({
          id: 'sub_conv_123',
          customer: 'cus_conv_123',
          status: 'active',
          cancel_at: null,
          items: {
            data: [
              {
                id: 'si_conv_123',
                current_period_start: start,
                current_period_end: end,
                price: { unit_amount: 1500, currency: 'usd' },
              },
            ],
          },
        });

        const subscription = await stripeAdapter.getSubscription('sub_conv_123');

        expect(subscription.providerSubscriptionId).toBe('sub_conv_123');
        expect(subscription.providerCustomerId).toBe('cus_conv_123');
        expect(subscription.status).toBe('active');
        expect(subscription.currentPeriodStart).toEqual(new Date(start * 1000));
        expect(subscription.currentPeriodEnd).toEqual(new Date(end * 1000));
        expect(subscription.amount).toBe(1500000);
        expect(subscription.currency).toBe('USD');
        expect(subscription.cancelAt).toBeNull();
      });

      it('should report a scheduled cancellation that the status does not reveal', async () => {
        // Hand-built rather than captured: the retrieve endpoint's response is
        // a subscription resource, not an event envelope, so no webhook
        // capture can stand in for it. The field placement mirrors the
        // customer.subscription.updated capture, where cancel_at sits beside a
        // status of "active".
        const start = Math.floor(Date.now() / 1000);
        const end = start + 30 * 24 * 60 * 60;
        mockStripe.subscriptions.retrieve.resolves({
          id: 'sub_pending_cancel',
          customer: 'cus_pending_cancel',
          status: 'active',
          cancel_at: end,
          cancel_at_period_end: true,
          items: {
            data: [
              {
                id: 'si_pending_cancel',
                current_period_start: start,
                current_period_end: end,
                price: { unit_amount: 1500, currency: 'usd' },
              },
            ],
          },
        });

        const subscription = await stripeAdapter.getSubscription('sub_pending_cancel');

        expect(subscription.status).toBe('active');
        expect(subscription.cancelAt).toEqual(new Date(end * 1000));
      });

      it('should withhold cancelAt rather than report null for a non-finite value', async () => {
        // Reachable here and not through a webhook body: this value comes from
        // the SDK, and JSON has no NaN literal.
        const start = Math.floor(Date.now() / 1000);
        const end = start + 30 * 24 * 60 * 60;
        mockStripe.subscriptions.retrieve.resolves({
          id: 'sub_nan_cancel_at',
          customer: 'cus_nan_cancel_at',
          status: 'active',
          cancel_at: Number.NaN,
          items: {
            data: [
              {
                id: 'si_nan_cancel_at',
                current_period_start: start,
                current_period_end: end,
                price: { unit_amount: 1500, currency: 'usd' },
              },
            ],
          },
        });

        const subscription = await stripeAdapter.getSubscription('sub_nan_cancel_at');

        expect(subscription.cancelAt).toBeUndefined();
      });

      it('should throw rather than build an invalid date from a non-finite bound', async () => {
        mockStripe.subscriptions.retrieve.resolves({
          id: 'sub_nan_period',
          customer: 'cus_nan_period',
          status: 'active',
          items: {
            data: [
              {
                id: 'si_nan_period',
                current_period_start: Number.NaN,
                current_period_end: Number.POSITIVE_INFINITY,
              },
            ],
          },
        });

        await expect(stripeAdapter.getSubscription('sub_nan_period')).rejects.toThrow(
          'has no billing period',
        );
      });

      it('should throw when the subscription has no resolvable billing period', async () => {
        mockStripe.subscriptions.retrieve.resolves({
          id: 'sub_no_period',
          customer: 'cus_no_period',
          status: 'active',
          items: { data: [] },
        });

        await expect(stripeAdapter.getSubscription('sub_no_period')).rejects.toThrow(
          'has no billing period',
        );
      });
    });

    describe('createCheckoutSession', () => {
      it('should create checkout session with fixed pricing (priceId)', async () => {
        mockStripe.checkout.sessions.create.resolves({
          id: 'cs_test_123',
          client_secret: 'cs_secret_abc',
        });

        const result = await stripeAdapter.createCheckoutSession({
          priceId: 'price_existing_123',
          currency: 'USD',
          interval: 'month',
          accountId: 'acc_123',
          calendarIds: ['cal_1', 'cal_2'],
          returnUrl: 'https://example.com/return',
        });

        expect(result.clientSecret).toBe('cs_secret_abc');
        expect(result.sessionId).toBe('cs_test_123');

        // Verify session was created with correct params
        expect(mockStripe.checkout.sessions.create.calledOnce).toBe(true);
        const createArgs = mockStripe.checkout.sessions.create.firstCall.args[0];
        expect(createArgs.ui_mode).toBe('embedded');
        expect(createArgs.mode).toBe('subscription');
        expect(createArgs.line_items[0].price).toBe('price_existing_123');
        expect(createArgs.line_items[0].quantity).toBe(1);
        expect(createArgs.metadata.pavillion_account_id).toBe('acc_123');
        expect(createArgs.metadata.pavillion_calendar_ids).toBe(JSON.stringify(['cal_1', 'cal_2']));
        expect(createArgs.redirect_on_completion).toBe('if_required');
        expect(createArgs.return_url).toContain('session_id=');
        expect(createArgs.return_url).toContain('CHECKOUT_SESSION_ID');

        // Should not have created a price since priceId was provided
        expect(mockStripe.prices.create.called).toBe(false);
      });

      it('should create checkout session with PWYC (amount, no priceId)', async () => {
        // Mock price creation for PWYC
        mockStripe.prices.create.resolves({
          id: 'price_pwyc_456',
        });

        mockStripe.checkout.sessions.create.resolves({
          id: 'cs_test_pwyc',
          client_secret: 'cs_secret_pwyc',
        });

        const result = await stripeAdapter.createCheckoutSession({
          amount: 5000000, // $50 in millicents
          currency: 'USD',
          interval: 'year',
          accountId: 'acc_456',
          returnUrl: 'https://example.com/return',
        });

        expect(result.clientSecret).toBe('cs_secret_pwyc');
        expect(result.sessionId).toBe('cs_test_pwyc');

        // Verify price was created first
        expect(mockStripe.prices.create.calledOnce).toBe(true);
        const priceArgs = mockStripe.prices.create.firstCall.args[0];
        expect(priceArgs.unit_amount).toBe(5000); // 5000000 millicents -> 5000 cents
        expect(priceArgs.currency).toBe('usd');
        expect(priceArgs.recurring.interval).toBe('year');

        // Verify session used the created price
        const sessionArgs = mockStripe.checkout.sessions.create.firstCall.args[0];
        expect(sessionArgs.line_items[0].price).toBe('price_pwyc_456');
      });

      it('should throw when neither priceId nor amount is provided', async () => {
        await expect(
          stripeAdapter.createCheckoutSession({
            currency: 'USD',
            interval: 'month',
            accountId: 'acc_123',
            returnUrl: 'https://example.com/return',
          }),
        ).rejects.toThrow('Either priceId or amount must be provided');
      });

      it('should not include calendarIds in metadata when not provided', async () => {
        mockStripe.checkout.sessions.create.resolves({
          id: 'cs_test_no_cals',
          client_secret: 'cs_secret_no_cals',
        });

        await stripeAdapter.createCheckoutSession({
          priceId: 'price_123',
          currency: 'USD',
          interval: 'month',
          accountId: 'acc_123',
          returnUrl: 'https://example.com/return',
        });

        const createArgs = mockStripe.checkout.sessions.create.firstCall.args[0];
        expect(createArgs.metadata.pavillion_account_id).toBe('acc_123');
        expect(createArgs.metadata.pavillion_calendar_ids).toBeUndefined();
      });

      it('should not include calendarIds in metadata when array is empty', async () => {
        mockStripe.checkout.sessions.create.resolves({
          id: 'cs_test_empty_cals',
          client_secret: 'cs_secret_empty_cals',
        });

        await stripeAdapter.createCheckoutSession({
          priceId: 'price_123',
          currency: 'USD',
          interval: 'month',
          accountId: 'acc_123',
          calendarIds: [],
          returnUrl: 'https://example.com/return',
        });

        const createArgs = mockStripe.checkout.sessions.create.firstCall.args[0];
        expect(createArgs.metadata.pavillion_calendar_ids).toBeUndefined();
      });
    });

    describe('getCheckoutSessionStatus', () => {
      it('should return status with subscription and customer IDs for complete session', async () => {
        mockStripe.checkout.sessions.retrieve.resolves({
          id: 'cs_test_123',
          status: 'complete',
          subscription: 'sub_abc123',
          customer: 'cus_xyz789',
          metadata: {
            pavillion_account_id: 'acc_123',
            pavillion_calendar_ids: JSON.stringify(['cal_1']),
          },
        });

        const result = await stripeAdapter.getCheckoutSessionStatus('cs_test_123');

        expect(result.status).toBe('complete');
        expect(result.subscriptionId).toBe('sub_abc123');
        expect(result.customerId).toBe('cus_xyz789');
        expect(result.metadata.accountId).toBe('acc_123');
        expect(result.metadata.calendarIds).toBe(JSON.stringify(['cal_1']));

        // Verify retrieve was called with correct session ID
        expect(mockStripe.checkout.sessions.retrieve.calledOnce).toBe(true);
        expect(mockStripe.checkout.sessions.retrieve.calledWith('cs_test_123')).toBe(true);
      });

      it('should return open status for incomplete sessions', async () => {
        mockStripe.checkout.sessions.retrieve.resolves({
          id: 'cs_test_open',
          status: 'open',
          subscription: null,
          customer: null,
          metadata: {
            pavillion_account_id: 'acc_456',
          },
        });

        const result = await stripeAdapter.getCheckoutSessionStatus('cs_test_open');

        expect(result.status).toBe('open');
        expect(result.subscriptionId).toBeUndefined();
        expect(result.customerId).toBeNull();
        expect(result.metadata.accountId).toBe('acc_456');
        expect(result.metadata.calendarIds).toBeUndefined();
      });

      it('should resolve the session subscription when it is expanded to an object', async () => {
        mockStripe.checkout.sessions.retrieve.resolves({
          id: 'cs_test_expanded',
          status: 'complete',
          subscription: { id: 'sub_status_expanded', object: 'subscription' },
          customer: 'cus_status_expanded',
          metadata: {
            pavillion_account_id: 'acc_status_expanded',
          },
        });

        const result = await stripeAdapter.getCheckoutSessionStatus('cs_test_expanded');

        expect(result.subscriptionId).toBe('sub_status_expanded');
      });

      it('should leave subscriptionId undefined when the session subscription id is not a string', async () => {
        mockStripe.checkout.sessions.retrieve.resolves({
          id: 'cs_test_nonstring',
          status: 'complete',
          subscription: { id: 12345, object: 'subscription' },
          customer: 'cus_status_nonstring',
          metadata: {
            pavillion_account_id: 'acc_status_nonstring',
          },
        });

        const result = await stripeAdapter.getCheckoutSessionStatus('cs_test_nonstring');

        expect(result.subscriptionId).toBeUndefined();
        expect(warnStub).toHaveBeenCalled();
      });

      it('should handle missing metadata gracefully', async () => {
        mockStripe.checkout.sessions.retrieve.resolves({
          id: 'cs_test_no_meta',
          status: 'expired',
          subscription: null,
          customer: null,
          metadata: {},
        });

        const result = await stripeAdapter.getCheckoutSessionStatus('cs_test_no_meta');

        expect(result.status).toBe('expired');
        expect(result.metadata.accountId).toBe('');
        expect(result.metadata.calendarIds).toBeUndefined();
      });
    });

    describe('createPrice', () => {
      it('should create a monthly recurring price', async () => {
        mockStripe.prices.create.resolves({
          id: 'price_new_monthly',
        });

        const priceId = await stripeAdapter.createPrice(1000000, 'USD', 'month');

        expect(priceId).toBe('price_new_monthly');
        expect(mockStripe.prices.create.calledOnce).toBe(true);

        const args = mockStripe.prices.create.firstCall.args[0];
        expect(args.unit_amount).toBe(1000); // 1000000 millicents -> 1000 cents
        expect(args.currency).toBe('usd');
        expect(args.recurring.interval).toBe('month');
        expect(args.product_data.name).toBe('Pavillion Subscription');
      });

      it('should create a yearly recurring price', async () => {
        mockStripe.prices.create.resolves({
          id: 'price_new_yearly',
        });

        const priceId = await stripeAdapter.createPrice(12000000, 'EUR', 'year');

        expect(priceId).toBe('price_new_yearly');

        const args = mockStripe.prices.create.firstCall.args[0];
        expect(args.unit_amount).toBe(12000); // 12000000 millicents -> 12000 cents
        expect(args.currency).toBe('eur');
        expect(args.recurring.interval).toBe('year');
      });

      it('should correctly convert millicents to cents', async () => {
        mockStripe.prices.create.resolves({ id: 'price_conv' });

        // $1.00 = 100000 millicents = 100 cents
        await stripeAdapter.createPrice(100000, 'USD', 'month');
        expect(mockStripe.prices.create.firstCall.args[0].unit_amount).toBe(100);

        // $100,000 = 10000000000 millicents = 10000000 cents
        await stripeAdapter.createPrice(10000000000, 'USD', 'month');
        expect(mockStripe.prices.create.secondCall.args[0].unit_amount).toBe(10000000);
      });
    });

    describe('idempotency keys', () => {
      const options = { idempotencyKey: 'pavillion:op:entity-1:nonce-1' };

      beforeEach(() => {
        mockStripe.subscriptions.retrieve.resolves({
          id: 'sub_1',
          items: { data: [{ id: 'si_1', price: { recurring: { interval: 'month' } } }] },
        });
        mockStripe.prices.create.resolves({ id: 'price_1' });
        mockStripe.subscriptions.update.resolves({ id: 'sub_1' });
        mockStripe.subscriptions.cancel.resolves({ id: 'sub_1' });
        mockStripe.checkout.sessions.create.resolves({ id: 'cs_1', client_secret: 'secret' });
        mockStripe.billingPortal.sessions.create.resolves({ url: 'https://portal.example' });
      });

      it('should send an idempotency key on immediate cancel', async () => {
        await stripeAdapter.cancelSubscription('sub_1', true, options);

        const requestOptions = mockStripe.subscriptions.cancel.firstCall.args[2];
        expect(requestOptions.idempotencyKey).toBe('pavillion:op:entity-1:nonce-1:cancel');
      });

      it('should send an idempotency key on cancel at period end', async () => {
        await stripeAdapter.cancelSubscription('sub_1', false, options);

        const requestOptions = mockStripe.subscriptions.update.firstCall.args[2];
        expect(requestOptions.idempotencyKey).toBe('pavillion:op:entity-1:nonce-1:cancel-at-period-end');
      });

      it('should send distinct keys for each mutating call in an amount update', async () => {
        await stripeAdapter.updateSubscriptionAmount('sub_1', 2000000, 'USD', options);

        const priceKey = mockStripe.prices.create.firstCall.args[1].idempotencyKey;
        const updateKey = mockStripe.subscriptions.update.firstCall.args[2].idempotencyKey;
        expect(priceKey).toBe('pavillion:op:entity-1:nonce-1:price');
        expect(updateKey).toBe('pavillion:op:entity-1:nonce-1:update');
        expect(priceKey).not.toBe(updateKey);
      });

      it('should send distinct keys for the price and session in a PWYC checkout', async () => {
        await stripeAdapter.createCheckoutSession({
          amount: 1000000,
          currency: 'USD',
          interval: 'month',
          accountId: 'acc_1',
          returnUrl: 'https://example.com/return',
        }, options);

        expect(mockStripe.prices.create.firstCall.args[1].idempotencyKey)
          .toBe('pavillion:op:entity-1:nonce-1:price');
        expect(mockStripe.checkout.sessions.create.firstCall.args[1].idempotencyKey)
          .toBe('pavillion:op:entity-1:nonce-1:checkout-session');
      });

      it('should send an idempotency key on price creation and portal session creation', async () => {
        await stripeAdapter.createPrice(1000000, 'USD', 'month', options);
        await stripeAdapter.getBillingPortalUrl('cus_1', 'https://example.com', options);

        expect(mockStripe.prices.create.firstCall.args[1].idempotencyKey)
          .toBe('pavillion:op:entity-1:nonce-1:price');
        expect(mockStripe.billingPortal.sessions.create.firstCall.args[1].idempotencyKey)
          .toBe('pavillion:op:entity-1:nonce-1:portal-session');
      });

      it('should derive the same keys when the same operation is replayed', async () => {
        await stripeAdapter.updateSubscriptionAmount('sub_1', 2000000, 'USD', options);
        await stripeAdapter.updateSubscriptionAmount('sub_1', 2000000, 'USD', options);

        expect(mockStripe.prices.create.firstCall.args[1].idempotencyKey)
          .toBe(mockStripe.prices.create.secondCall.args[1].idempotencyKey);
        expect(mockStripe.subscriptions.update.firstCall.args[2].idempotencyKey)
          .toBe(mockStripe.subscriptions.update.secondCall.args[2].idempotencyKey);
      });

      it('should derive different keys for different operations', async () => {
        await stripeAdapter.cancelSubscription('sub_1', true, { idempotencyKey: 'pavillion:plan-cancel:e:n1' });
        await stripeAdapter.cancelSubscription('sub_1', true, { idempotencyKey: 'pavillion:plan-cancel:e:n2' });

        expect(mockStripe.subscriptions.cancel.firstCall.args[2].idempotencyKey)
          .not.toBe(mockStripe.subscriptions.cancel.secondCall.args[2].idempotencyKey);
      });

      it('should send no idempotency key when none is supplied', async () => {
        await stripeAdapter.cancelSubscription('sub_1', true);

        expect(mockStripe.subscriptions.cancel.firstCall.args[2]).toEqual({});
      });

      it('should reject a derived key longer than 255 characters', async () => {
        await expect(
          stripeAdapter.cancelSubscription('sub_1', true, { idempotencyKey: 'k'.repeat(250) }),
        ).rejects.toThrow('exceeds 255 characters');
        expect(mockStripe.subscriptions.cancel.called).toBe(false);
      });
    });
  });

  describe('buildProviderIdempotencyKey', () => {
    it('should name the operation and entity and mint a fresh nonce per call', () => {
      const first = buildProviderIdempotencyKey('plan-cancel', 'entity-1');
      const second = buildProviderIdempotencyKey('plan-cancel', 'entity-1');

      expect(first).toMatch(/^pavillion:plan-cancel:entity-1:[0-9a-f-]{36}$/);
      expect(first).not.toBe(second);
      expect(first.length).toBeLessThanOrEqual(255);
    });
  });

  describe('StripeAdapter.validateKeyFormats', () => {
    it('should accept valid test keys', () => {
      const result = StripeAdapter.validateKeyFormats(
        'pk_test_abc123',
        'sk_test_abc123',
        'whsec_abc123',
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid live keys', () => {
      const result = StripeAdapter.validateKeyFormats(
        'pk_live_abc123',
        'sk_live_abc123',
        'whsec_abc123',
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid publishable key prefix', () => {
      const result = StripeAdapter.validateKeyFormats(
        'invalid_key',
        'sk_test_abc123',
        'whsec_abc123',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('publishable key');
    });

    it('should reject empty publishable key', () => {
      const result = StripeAdapter.validateKeyFormats(
        '',
        'sk_test_abc123',
        'whsec_abc123',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('publishable key');
    });

    it('should reject invalid secret key prefix', () => {
      const result = StripeAdapter.validateKeyFormats(
        'pk_test_abc123',
        'invalid_secret',
        'whsec_abc123',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('secret key');
    });

    it('should reject empty secret key', () => {
      const result = StripeAdapter.validateKeyFormats(
        'pk_test_abc123',
        '',
        'whsec_abc123',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('secret key');
    });

    it('should reject invalid webhook secret prefix', () => {
      const result = StripeAdapter.validateKeyFormats(
        'pk_test_abc123',
        'sk_test_abc123',
        'invalid_webhook',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('webhook secret');
    });

    it('should reject empty webhook secret', () => {
      const result = StripeAdapter.validateKeyFormats(
        'pk_test_abc123',
        'sk_test_abc123',
        '',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('webhook secret');
    });

    it('should reject sk_ prefix for publishable key', () => {
      const result = StripeAdapter.validateKeyFormats(
        'sk_test_abc123',
        'sk_test_abc123',
        'whsec_abc123',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('publishable key');
    });

    it('should reject pk_ prefix for secret key', () => {
      const result = StripeAdapter.validateKeyFormats(
        'pk_test_abc123',
        'pk_test_abc123',
        'whsec_abc123',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('secret key');
    });
  });

  describe('PayPalAdapter', () => {
    let paypalAdapter: PayPalAdapter;
    let mockPayPalClient: any;

    beforeEach(() => {
      // Create mock PayPal client
      mockPayPalClient = {
        subscriptions: {
          subscriptionsGet: sandbox.stub(),
          subscriptionsCancel: sandbox.stub(),
        },
      };

      // Create adapter
      const credentials = {
        clientId: 'test_client_id',
        secret: 'test_secret',
        mode: 'sandbox',
      };
      const webhookSecret = 'paypal_webhook_secret';
      paypalAdapter = new PayPalAdapter(credentials, webhookSecret);

      // Replace the client with our mock
      (paypalAdapter as any).client = mockPayPalClient;
    });

    it('should throw when updateSubscriptionAmount is called', async () => {
      await expect(
        paypalAdapter.updateSubscriptionAmount('I-MOCK123', 2000000, 'USD'),
      ).rejects.toThrow('updateSubscriptionAmount is not implemented for PayPal');
    });

    it('should report no support for amount updates', () => {
      expect(paypalAdapter.supportsAmountUpdates()).toBe(false);
    });

    it('should reject all webhook signatures until async verification is implemented', () => {
      const payload = JSON.stringify({
        id: 'WH-TEST123',
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'I-TEST123' },
      });

      // PayPal webhook verification requires an async API call to PayPal's
      // verify-webhook-signature endpoint. Until the adapter interface supports
      // async verification, all PayPal webhooks must be rejected.
      const validSignature = 'mock-signature-hash';
      expect(paypalAdapter.verifyWebhookSignature(payload, validSignature)).toBe(false);
      expect(paypalAdapter.verifyWebhookSignature(payload, '')).toBe(false);
      expect(paypalAdapter.verifyWebhookSignature('', validSignature)).toBe(false);
    });

    it('should throw when createCheckoutSession is called', async () => {
      await expect(
        paypalAdapter.createCheckoutSession({
          currency: 'USD',
          interval: 'month',
          accountId: 'acc_123',
          returnUrl: 'https://example.com/return',
        }),
      ).rejects.toThrow('createCheckoutSession is not implemented for PayPal');
    });

    it('should throw when getCheckoutSessionStatus is called', async () => {
      await expect(
        paypalAdapter.getCheckoutSessionStatus('session_123'),
      ).rejects.toThrow('getCheckoutSessionStatus is not implemented for PayPal');
    });

    it('should throw when createPrice is called', async () => {
      await expect(
        paypalAdapter.createPrice(1000000, 'USD', 'month'),
      ).rejects.toThrow('createPrice is not implemented for PayPal');
    });
  });

  describe('MockStripeAdapter', () => {
    it('should report support for amount updates', () => {
      const mockAdapter = new MockStripeAdapter();
      expect(mockAdapter.supportsAmountUpdates()).toBe(true);
    });

    it('should record updateSubscriptionAmount calls', async () => {
      const mockAdapter = new MockStripeAdapter();

      await mockAdapter.updateSubscriptionAmount('sub_123', 5000000, 'USD');
      await mockAdapter.updateSubscriptionAmount('sub_456', 3000000, 'EUR');

      expect(mockAdapter.updateSubscriptionAmountCalls).toHaveLength(2);
      expect(mockAdapter.updateSubscriptionAmountCalls[0]).toEqual({
        providerSubscriptionId: 'sub_123',
        newAmount: 5000000,
        currency: 'USD',
      });
      expect(mockAdapter.updateSubscriptionAmountCalls[1]).toEqual({
        providerSubscriptionId: 'sub_456',
        newAmount: 3000000,
        currency: 'EUR',
      });
    });

    it('should return mock data for createCheckoutSession', async () => {
      const mockAdapter = new MockStripeAdapter();

      const result = await mockAdapter.createCheckoutSession({
        priceId: 'price_123',
        currency: 'USD',
        interval: 'month',
        accountId: 'acc_123',
        calendarIds: ['cal_1'],
        returnUrl: 'https://example.com/return',
      });

      expect(result.clientSecret).toBeTruthy();
      expect(result.sessionId).toBeTruthy();
      expect(mockAdapter.createCheckoutSessionCalls).toHaveLength(1);
      expect(mockAdapter.createCheckoutSessionCalls[0].params.accountId).toBe('acc_123');
    });

    it('should return mock data for getCheckoutSessionStatus', async () => {
      const mockAdapter = new MockStripeAdapter();

      const result = await mockAdapter.getCheckoutSessionStatus('cs_mock_123');

      expect(result.status).toBe('complete');
      expect(result.subscriptionId).toBe('sub_mock_123');
      expect(result.customerId).toBe('cus_mock_123');
      expect(result.metadata.accountId).toBe('acc_mock_123');
    });

    it('should return mock price ID for createPrice', async () => {
      const mockAdapter = new MockStripeAdapter();

      const priceId = await mockAdapter.createPrice(1000000, 'USD', 'month');

      expect(priceId).toBeTruthy();
      expect(priceId).toContain('price_mock_');
      expect(mockAdapter.createPriceCalls).toHaveLength(1);
      expect(mockAdapter.createPriceCalls[0]).toEqual({
        amount: 1000000,
        currency: 'USD',
        interval: 'month',
      });
    });
  });

  describe('MockPayPalAdapter', () => {
    it('should report no support for amount updates', () => {
      const mockAdapter = new MockPayPalAdapter();
      expect(mockAdapter.supportsAmountUpdates()).toBe(false);
    });

    it('should record updateSubscriptionAmount calls', async () => {
      const mockAdapter = new MockPayPalAdapter();

      await mockAdapter.updateSubscriptionAmount('I-123', 5000000, 'USD');

      expect(mockAdapter.updateSubscriptionAmountCalls).toHaveLength(1);
      expect(mockAdapter.updateSubscriptionAmountCalls[0]).toEqual({
        providerSubscriptionId: 'I-123',
        newAmount: 5000000,
        currency: 'USD',
      });
    });

    it('should throw when createCheckoutSession is called', async () => {
      const mockAdapter = new MockPayPalAdapter();

      await expect(
        mockAdapter.createCheckoutSession({
          currency: 'USD',
          interval: 'month',
          accountId: 'acc_123',
          returnUrl: 'https://example.com/return',
        }),
      ).rejects.toThrow('createCheckoutSession is not implemented for PayPal');
    });

    it('should throw when getCheckoutSessionStatus is called', async () => {
      const mockAdapter = new MockPayPalAdapter();

      await expect(
        mockAdapter.getCheckoutSessionStatus('session_123'),
      ).rejects.toThrow('getCheckoutSessionStatus is not implemented for PayPal');
    });

    it('should throw when createPrice is called', async () => {
      const mockAdapter = new MockPayPalAdapter();

      await expect(
        mockAdapter.createPrice(1000000, 'USD', 'month'),
      ).rejects.toThrow('createPrice is not implemented for PayPal');
    });
  });

  describe('ProviderFactory', () => {
    function makeFakeEntity(id: string, providerType: string, creds: string, whSecret: string): any {
      return {
        id,
        provider_type: providerType,
        decryptCredentials: () => creds,
        decryptWebhookSecret: () => whSecret,
      };
    }

    it('should instantiate correct adapter based on provider type', () => {
      // Test Stripe adapter instantiation
      const stripeEntity = makeFakeEntity('config-1', 'stripe', JSON.stringify({ apiKey: 'sk_test_123' }), 'whsec_test');
      const stripeAdapter = ProviderFactory.getAdapter(stripeEntity);
      expect(stripeAdapter.providerType).toBe('stripe');
      expect(stripeAdapter).toBeInstanceOf(StripeAdapter);

      // Test PayPal adapter instantiation
      const paypalEntity = makeFakeEntity('config-2', 'paypal', JSON.stringify({
        clientId: 'test_client',
        secret: 'test_secret',
        mode: 'sandbox',
      }), 'paypal_webhook_secret');
      const paypalAdapter = ProviderFactory.getAdapter(paypalEntity);
      expect(paypalAdapter.providerType).toBe('paypal');
      expect(paypalAdapter).toBeInstanceOf(PayPalAdapter);
    });

    it('should handle invalid provider type with error', () => {
      const invalidEntity = makeFakeEntity('invalid', 'invalid_provider', JSON.stringify({ test: 'data' }), 'test');

      expect(() => {
        ProviderFactory.getAdapter(invalidEntity);
      }).toThrow('Unsupported provider type: invalid_provider');
    });
  });

  describe('Adapter Credential Initialization', () => {
    function makeFakeEntity(id: string, providerType: string, creds: string, whSecret: string): any {
      return {
        id,
        provider_type: providerType,
        decryptCredentials: () => creds,
        decryptWebhookSecret: () => whSecret,
      };
    }

    it('should initialize adapter with decrypted credentials from entity', () => {
      const stripeCreds = JSON.stringify({
        apiKey: 'sk_test_123456',
        publishableKey: 'pk_test_123456',
      });

      // Create adapter using factory with entity
      const stripeEntity = makeFakeEntity('config-1', 'stripe', stripeCreds, 'whsec_test_secret');
      const adapter = ProviderFactory.getAdapter(stripeEntity);
      expect(adapter.providerType).toBe('stripe');

      // Test PayPal credentials
      const paypalCreds = JSON.stringify({
        clientId: 'paypal_client_id',
        secret: 'paypal_secret',
        mode: 'sandbox',
      });
      const paypalEntity = makeFakeEntity('config-2', 'paypal', paypalCreds, 'paypal_webhook_secret');
      const paypalAdapter = ProviderFactory.getAdapter(paypalEntity);
      expect(paypalAdapter.providerType).toBe('paypal');
    });
  });
});
