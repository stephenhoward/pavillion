import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { ProviderConfig } from '@/common/model/funding-plan';
import { StripeAdapter } from '../service/provider/stripe';
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
        'createSubscription',
        'cancelSubscription',
        'supportsAmountUpdates',
        'updateSubscriptionAmount',
        'getSubscription',
        'getBillingPortalUrl',
        'verifyWebhookSignature',
        'parseWebhookEvent',
        'registerWebhook',
        'deleteWebhook',
        'validateCredentials',
        'createCheckoutSession',
        'getCheckoutSessionStatus',
        'createPrice',
      ];

      expect(requiredProps.length).toBe(1);
      expect(requiredMethods.length).toBe(14);

      // Verify StripeAdapter implements the interface
      const stripeConfig = new ProviderConfig('test-stripe', 'stripe');
      stripeConfig.credentials = JSON.stringify({ apiKey: 'sk_test_123' });
      stripeConfig.webhookSecret = 'whsec_test';

      const stripeAdapter = new StripeAdapter(
        JSON.parse(stripeConfig.credentials),
        stripeConfig.webhookSecret,
      );

      expect(stripeAdapter.providerType).toBe('stripe');
      requiredMethods.forEach((method) => {
        expect(typeof (stripeAdapter as any)[method]).toBe('function');
      });

      // Verify PayPalAdapter implements the interface
      const paypalConfig = new ProviderConfig('test-paypal', 'paypal');
      paypalConfig.credentials = JSON.stringify({
        clientId: 'test_client',
        secret: 'test_secret',
        mode: 'sandbox',
      });
      paypalConfig.webhookSecret = 'paypal_webhook_secret';

      const paypalAdapter = new PayPalAdapter(
        JSON.parse(paypalConfig.credentials),
        paypalConfig.webhookSecret,
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
      };

      // Create adapter
      const credentials = { apiKey: 'sk_test_123' };
      const webhookSecret = 'whsec_test_secret';
      stripeAdapter = new StripeAdapter(credentials, webhookSecret);

      // Replace the Stripe instance with our mock
      (stripeAdapter as any).stripe = mockStripe;
    });

    it('should create subscription with mock Stripe SDK', async () => {
      // Mock customer list (no existing customer)
      mockStripe.customers.list.resolves({ data: [] });

      // Mock customer creation
      mockStripe.customers.create.resolves({
        id: 'cus_mock123',
        email: 'test@example.com',
      });

      // Mock price creation
      mockStripe.prices.create.resolves({
        id: 'price_mock123',
      });

      // Mock subscription creation
      mockStripe.subscriptions.create.resolves({
        id: 'sub_mock123',
        customer: 'cus_mock123',
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        items: {
          data: [
            {
              price: {
                unit_amount: 1000, // $10.00 in cents
                currency: 'usd',
              },
            },
          ],
        },
      });

      // Create subscription
      const result = await stripeAdapter.createSubscription({
        accountEmail: 'test@example.com',
        accountId: 'acc_123',
        amount: 1000000, // $10.00 in millicents
        currency: 'USD',
        billingCycle: 'monthly',
      });

      expect(result.providerSubscriptionId).toBe('sub_mock123');
      expect(result.providerCustomerId).toBe('cus_mock123');
      expect(result.status).toBe('active');
      expect(mockStripe.subscriptions.create.calledOnce).toBe(true);
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
        expect(createArgs.return_url).toBe('https://example.com/return');

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
        expect(result.subscriptionId).toBeNull();
        expect(result.customerId).toBeNull();
        expect(result.metadata.accountId).toBe('acc_456');
        expect(result.metadata.calendarIds).toBeUndefined();
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
          subscriptionsCreate: sandbox.stub(),
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

    it('should create subscription with mock PayPal SDK', async () => {
      // Mock subscription creation
      mockPayPalClient.subscriptions.subscriptionsCreate.resolves({
        result: {
          id: 'I-MOCK123',
          status: 'ACTIVE',
          start_time: new Date().toISOString(),
          billing_info: {
            next_billing_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
          subscriber: {
            email_address: 'test@example.com',
          },
        },
      });

      // Create subscription
      const result = await paypalAdapter.createSubscription({
        accountEmail: 'test@example.com',
        accountId: 'acc_123',
        priceId: 'P-TEST123', // Use existing plan
        amount: 1000000, // $10.00 in millicents
        currency: 'USD',
        billingCycle: 'monthly',
      });

      expect(result.providerSubscriptionId).toBe('I-MOCK123');
      expect(result.status).toBe('active');
      expect(mockPayPalClient.subscriptions.subscriptionsCreate.calledOnce).toBe(true);
    });

    it('should throw when updateSubscriptionAmount is called', async () => {
      await expect(
        paypalAdapter.updateSubscriptionAmount('I-MOCK123', 2000000, 'USD'),
      ).rejects.toThrow('updateSubscriptionAmount is not implemented for PayPal');
    });

    it('should report no support for amount updates', () => {
      expect(paypalAdapter.supportsAmountUpdates()).toBe(false);
    });

    it('should verify webhook signature with valid and invalid signatures', () => {
      const payload = JSON.stringify({
        id: 'WH-TEST123',
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'I-TEST123' },
      });

      // Test with signature present
      const validSignature = 'mock-signature-hash';
      const validResult = paypalAdapter.verifyWebhookSignature(payload, validSignature);
      expect(validResult).toBe(true);

      // Test with empty signature
      const invalidResult = paypalAdapter.verifyWebhookSignature(payload, '');
      expect(invalidResult).toBe(false);

      // Test with empty payload
      const invalidResult2 = paypalAdapter.verifyWebhookSignature('', validSignature);
      expect(invalidResult2).toBe(false);
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
    it('should instantiate correct adapter based on provider type', () => {
      // Test Stripe adapter instantiation
      const stripeConfig = new ProviderConfig('config-1', 'stripe');
      stripeConfig.credentials = JSON.stringify({ apiKey: 'sk_test_123' });
      stripeConfig.webhookSecret = 'whsec_test';

      const stripeAdapter = ProviderFactory.getAdapter(stripeConfig);
      expect(stripeAdapter.providerType).toBe('stripe');
      expect(stripeAdapter).toBeInstanceOf(StripeAdapter);

      // Test PayPal adapter instantiation
      const paypalConfig = new ProviderConfig('config-2', 'paypal');
      paypalConfig.credentials = JSON.stringify({
        clientId: 'test_client',
        secret: 'test_secret',
        mode: 'sandbox',
      });
      paypalConfig.webhookSecret = 'paypal_webhook_secret';

      const paypalAdapter = ProviderFactory.getAdapter(paypalConfig);
      expect(paypalAdapter.providerType).toBe('paypal');
      expect(paypalAdapter).toBeInstanceOf(PayPalAdapter);
    });

    it('should handle invalid provider type with error', () => {
      const invalidConfig = new ProviderConfig('invalid', 'invalid_provider' as any);
      invalidConfig.credentials = JSON.stringify({ test: 'data' });
      invalidConfig.webhookSecret = 'test';

      expect(() => {
        ProviderFactory.getAdapter(invalidConfig);
      }).toThrow('Unsupported provider type: invalid_provider');
    });
  });

  describe('Adapter Credential Initialization', () => {
    it('should initialize adapter with decrypted credentials from ProviderConfig', () => {
      // Test Stripe credential initialization
      const stripeConfig = new ProviderConfig('config-1', 'stripe');
      stripeConfig.enabled = true;
      stripeConfig.displayName = 'Credit Card';
      stripeConfig.credentials = JSON.stringify({
        apiKey: 'sk_test_123456',
        publishableKey: 'pk_test_123456',
      });
      stripeConfig.webhookSecret = 'whsec_test_secret';

      // Parse credentials (simulating what the factory does)
      const credentials = JSON.parse(stripeConfig.credentials);

      // Validate credential structure
      expect(credentials.apiKey).toBe('sk_test_123456');
      expect(credentials.publishableKey).toBe('pk_test_123456');
      expect(stripeConfig.webhookSecret).toBe('whsec_test_secret');

      // Create adapter using factory
      const adapter = ProviderFactory.getAdapter(stripeConfig);
      expect(adapter.providerType).toBe('stripe');

      // Test PayPal credentials
      const paypalConfig = new ProviderConfig('config-2', 'paypal');
      paypalConfig.credentials = JSON.stringify({
        clientId: 'paypal_client_id',
        secret: 'paypal_secret',
        mode: 'sandbox',
      });
      paypalConfig.webhookSecret = 'paypal_webhook_secret';

      const paypalCredentials = JSON.parse(paypalConfig.credentials);
      expect(paypalCredentials.clientId).toBe('paypal_client_id');
      expect(paypalCredentials.secret).toBe('paypal_secret');
      expect(paypalCredentials.mode).toBe('sandbox');

      // Create adapter using factory
      const paypalAdapter = ProviderFactory.getAdapter(paypalConfig);
      expect(paypalAdapter.providerType).toBe('paypal');
    });
  });
});
