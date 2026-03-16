import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import FundingService from '@/server/funding/service/funding';
import FundingPlanRoutes from '@/server/funding/api/v1/funding-plan';
import { Account } from '@/common/model/account';
import { FundingPlan, ProviderConfig } from '@/common/model/funding-plan';
import { testApp } from '@/server/common/test/lib/express';

describe('User Subscription API Routes', () => {
  let router: express.Router;
  let service: FundingService;
  let subscriptionHandlers: FundingPlanRoutes;
  let sandbox: sinon.SinonSandbox;
  let mockAccount: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create service with mocked dependencies
    const eventBus = { emit: sandbox.stub() } as any;
    service = new FundingService(eventBus);

    // Create handlers
    subscriptionHandlers = new FundingPlanRoutes(service);

    // Create mock account
    mockAccount = new Account('test-account-id');
    mockAccount.email = 'test@example.com';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /options', () => {
    it('should return available providers and pricing when authenticated', async () => {
      const mockProvider1 = new ProviderConfig('provider-1', 'stripe');
      mockProvider1.enabled = true;
      mockProvider1.displayName = 'Credit Card';

      const mockProvider2 = new ProviderConfig('provider-2', 'paypal');
      mockProvider2.enabled = true;
      mockProvider2.displayName = 'PayPal';

      const mockOptions = {
        enabled: true,
        providers: [mockProvider1, mockProvider2],
        monthlyPrice: 1000000, // $10.00 in millicents
        yearlyPrice: 10000000, // $100.00 in millicents
        currency: 'USD',
        payWhatYouCan: true,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      // Manually bind route to bypass middleware
      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body).toEqual({
        enabled: true,
        providers: [
          {
            id: 'provider-1',
            providerType: 'stripe',
            displayName: 'Credit Card',
          },
          {
            id: 'provider-2',
            providerType: 'paypal',
            displayName: 'PayPal',
          },
        ],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: true,
      });
    });

    it('should include publishableKey for Stripe providers with valid credentials', async () => {
      const stripeProvider = new ProviderConfig('provider-1', 'stripe');
      stripeProvider.enabled = true;
      stripeProvider.displayName = 'Credit Card';
      stripeProvider.credentials = JSON.stringify({
        apiKey: 'sk_test_secret123',
        publishableKey: 'pk_test_abc123',
      });
      stripeProvider.webhookSecret = 'whsec_test_secret';

      const mockOptions = {
        enabled: true,
        providers: [stripeProvider],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      const stripeResult = response.body.providers[0];
      expect(stripeResult.publishableKey).toBe('pk_test_abc123');
    });

    it('should include publishableKey for live Stripe keys', async () => {
      const stripeProvider = new ProviderConfig('provider-1', 'stripe');
      stripeProvider.enabled = true;
      stripeProvider.displayName = 'Credit Card';
      stripeProvider.credentials = JSON.stringify({
        apiKey: 'sk_live_secret123',
        publishableKey: 'pk_live_abc123',
      });

      const mockOptions = {
        enabled: true,
        providers: [stripeProvider],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBe('pk_live_abc123');
    });

    it('should never expose secret_key, apiKey, or webhook_secret in options response', async () => {
      const stripeProvider = new ProviderConfig('provider-1', 'stripe');
      stripeProvider.enabled = true;
      stripeProvider.displayName = 'Credit Card';
      stripeProvider.credentials = JSON.stringify({
        apiKey: 'sk_test_secret123',
        publishableKey: 'pk_test_abc123',
        webhook_secret: 'whsec_test_secret',
      });
      stripeProvider.webhookSecret = 'whsec_test_secret';

      const mockOptions = {
        enabled: true,
        providers: [stripeProvider],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      const stripeResult = response.body.providers[0];
      const responseText = JSON.stringify(response.body);

      // Verify secret fields are not present in the provider object
      expect(stripeResult.credentials).toBeUndefined();
      expect(stripeResult.webhookSecret).toBeUndefined();
      expect(stripeResult.apiKey).toBeUndefined();
      expect(stripeResult.secret_key).toBeUndefined();
      expect(stripeResult.webhook_secret).toBeUndefined();
      expect(stripeResult.stripeUserId).toBeUndefined();

      // Verify secret values do not appear anywhere in the response body
      expect(responseText).not.toContain('sk_test_secret123');
      expect(responseText).not.toContain('whsec_test_secret');
    });

    it('should not include publishableKey for PayPal providers', async () => {
      const paypalProvider = new ProviderConfig('provider-2', 'paypal');
      paypalProvider.enabled = true;
      paypalProvider.displayName = 'PayPal';
      paypalProvider.credentials = JSON.stringify({
        client_id: 'paypal_client_id',
        client_secret: 'paypal_secret',
      });

      const mockOptions = {
        enabled: true,
        providers: [paypalProvider],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      const paypalResult = response.body.providers[0];
      expect(paypalResult.publishableKey).toBeUndefined();
      expect(paypalResult.credentials).toBeUndefined();

      // Verify PayPal secrets do not appear in response
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain('paypal_client_id');
      expect(responseText).not.toContain('paypal_secret');
    });

    it('should omit publishableKey when Stripe credentials have no publishableKey', async () => {
      const stripeProvider = new ProviderConfig('provider-1', 'stripe');
      stripeProvider.enabled = true;
      stripeProvider.displayName = 'Credit Card';
      stripeProvider.credentials = JSON.stringify({
        apiKey: 'sk_test_secret123',
      });

      const mockOptions = {
        enabled: true,
        providers: [stripeProvider],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBeUndefined();
    });

    it('should omit publishableKey when credentials JSON is malformed', async () => {
      const stripeProvider = new ProviderConfig('provider-1', 'stripe');
      stripeProvider.enabled = true;
      stripeProvider.displayName = 'Credit Card';
      stripeProvider.credentials = 'not-valid-json';

      const mockOptions = {
        enabled: true,
        providers: [stripeProvider],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBeUndefined();
    });

    it('should reject publishableKey that does not start with pk_test_ or pk_live_', async () => {
      const stripeProvider = new ProviderConfig('provider-1', 'stripe');
      stripeProvider.enabled = true;
      stripeProvider.displayName = 'Credit Card';
      stripeProvider.credentials = JSON.stringify({
        apiKey: 'sk_test_secret123',
        publishableKey: 'sk_test_this_is_actually_a_secret_key',
      });

      const mockOptions = {
        enabled: true,
        providers: [stripeProvider],
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
      };

      sandbox.stub(service, 'getOptions').resolves(mockOptions);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getOptions.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBeUndefined();
    });
  });

  describe('GET /status', () => {
    it('should return current subscription status', async () => {
      const mockSubscription = new FundingPlan('sub-1');
      mockSubscription.accountId = 'test-account-id';
      mockSubscription.status = 'active';
      mockSubscription.billingCycle = 'yearly';
      mockSubscription.amount = 10000000;
      mockSubscription.currency = 'USD';
      mockSubscription.currentPeriodStart = new Date('2025-01-01');
      mockSubscription.currentPeriodEnd = new Date('2026-01-01');

      sandbox.stub(service, 'getStatus').resolves(mockSubscription);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getStatus.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body).toMatchObject({
        id: 'sub-1',
        status: 'active',
        billingCycle: 'yearly',
        amount: 10000000,
        currency: 'USD',
      });
    });
  });

  describe('POST /cancel', () => {
    it('should mark subscription for end-of-period cancellation', async () => {
      const mockSubscription = new FundingPlan('sub-1');
      mockSubscription.accountId = 'test-account-id';
      mockSubscription.status = 'active';

      const getStatusStub = sandbox.stub(service, 'getStatus').resolves(mockSubscription);
      const cancelStub = sandbox.stub(service, 'cancel').resolves();

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.cancel.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(getStatusStub.calledWith('test-account-id')).toBe(true);
      expect(cancelStub.calledWith('sub-1', false)).toBe(true);
    });
  });

  describe('GET /portal', () => {
    it('should return provider billing portal URL', async () => {
      const mockPortalUrl = 'https://stripe.com/billing/portal/session_abc123';
      const getBillingPortalUrlStub = sandbox.stub(service, 'getBillingPortalUrl').resolves(mockPortalUrl);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.getPortal.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .query({ returnUrl: 'https://example.com/account' })
        .expect(200);

      expect(response.body).toEqual({
        portalUrl: mockPortalUrl,
      });
      expect(getBillingPortalUrlStub.calledWith(
        'test-account-id',
        'https://example.com/account',
      )).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      // Stub service methods to prevent database access
      sandbox.stub(service, 'getStatus').resolves(undefined);
      sandbox.stub(service, 'cancel').resolves();
      sandbox.stub(service, 'getBillingPortalUrl').resolves('');

      // Test without adding req.user - handlers should return 401
      // Note: /options is NOT tested here as it may be public
      router.get('/handler-status', subscriptionHandlers.getStatus.bind(subscriptionHandlers));
      router.post('/handler-cancel', subscriptionHandlers.cancel.bind(subscriptionHandlers));
      router.get('/handler-portal', subscriptionHandlers.getPortal.bind(subscriptionHandlers));

      await request(testApp(router))
        .get('/handler-status')
        .expect(401);

      await request(testApp(router))
        .post('/handler-cancel')
        .expect(401);

      await request(testApp(router))
        .get('/handler-portal')
        .expect(401);
    });
  });
});
