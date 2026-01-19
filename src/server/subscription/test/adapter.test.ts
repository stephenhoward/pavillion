import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { ProviderConfig } from '@/common/model/subscription';
import { StripeAdapter } from '../service/provider/stripe';
import { PayPalAdapter } from '../service/provider/paypal';
import { ProviderFactory } from '../service/provider/factory';
import Stripe from 'stripe';

describe('Payment Provider Adapters', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
    ProviderFactory.clearAllCaches();
  });

  describe('PaymentProviderAdapter Interface Contract', () => {
    it('should define standard interface methods for all providers', () => {
      // This test verifies the adapter interface structure exists
      // We'll verify that adapters implement the required methods

      // Required properties
      const requiredProps = ['providerType'];

      // Required methods
      const requiredMethods = [
        'getConnectUrl',
        'handleOAuthCallback',
        'createSubscription',
        'cancelSubscription',
        'getSubscription',
        'getBillingPortalUrl',
        'verifyWebhookSignature',
        'parseWebhookEvent',
      ];

      // This test validates structure
      expect(requiredProps.length).toBe(1);
      expect(requiredMethods.length).toBe(8);

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
        billingPortal: {
          sessions: {
            create: sandbox.stub(),
          },
        },
        webhooks: {
          constructEvent: sandbox.stub(),
        },
        oauth: {
          token: sandbox.stub(),
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

    it('should verify webhook signature with valid and invalid signatures', () => {
      const payload = JSON.stringify({
        id: 'WH-TEST123',
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'I-TEST123' },
      });

      // PayPal webhook verification is simplified for this test
      // In production, this would use PayPal's verification API

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
