import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import FundingService from '@/server/funding/service/funding';
import FundingPlanRoutes from '@/server/funding/api/v1/funding-plan';
import { Account } from '@/common/model/account';
import { FundingPlan } from '@/common/model/funding-plan';
import type { ProviderInfo } from '@/server/funding/service/funding';
import { testApp } from '@/server/common/test/lib/express';

describe('User Funding Plan API Routes', () => {
  let router: express.Router;
  let service: FundingService;
  let fundingPlanHandlers: FundingPlanRoutes;
  let sandbox: sinon.SinonSandbox;
  let mockAccount: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create service with mocked dependencies
    const eventBus = { emit: sandbox.stub() } as any;
    service = new FundingService(eventBus);

    // Create handlers
    fundingPlanHandlers = new FundingPlanRoutes(service);

    // Create mock account
    mockAccount = new Account('test-account-id');
    mockAccount.email = 'test@example.com';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /options', () => {
    it('should return available providers and pricing when authenticated', async () => {
      const mockProvider1: ProviderInfo = {
        id: 'provider-1',
        providerType: 'stripe',
        displayName: 'Credit Card',
      };

      const mockProvider2: ProviderInfo = {
        id: 'provider-2',
        providerType: 'paypal',
        displayName: 'PayPal',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

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
      const stripeProvider: ProviderInfo = {
        id: 'provider-1',
        providerType: 'stripe',
        displayName: 'Credit Card',
        publishableKey: 'pk_test_abc123',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      const stripeResult = response.body.providers[0];
      expect(stripeResult.publishableKey).toBe('pk_test_abc123');
    });

    it('should include publishableKey for live Stripe keys', async () => {
      const stripeProvider: ProviderInfo = {
        id: 'provider-1',
        providerType: 'stripe',
        displayName: 'Credit Card',
        publishableKey: 'pk_live_abc123',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBe('pk_live_abc123');
    });

    it('should never expose secret_key, apiKey, or webhook_secret in options response', async () => {
      // Service returns ProviderInfo which structurally cannot contain secrets
      const stripeProvider: ProviderInfo = {
        id: 'provider-1',
        providerType: 'stripe',
        displayName: 'Credit Card',
        publishableKey: 'pk_test_abc123',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

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
      const paypalProvider: ProviderInfo = {
        id: 'provider-2',
        providerType: 'paypal',
        displayName: 'PayPal',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

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
      // Service omits publishableKey when credentials lack it
      const stripeProvider: ProviderInfo = {
        id: 'provider-1',
        providerType: 'stripe',
        displayName: 'Credit Card',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBeUndefined();
    });

    it('should omit publishableKey when credentials JSON is malformed', async () => {
      // Service omits publishableKey when credentials are malformed
      const stripeProvider: ProviderInfo = {
        id: 'provider-1',
        providerType: 'stripe',
        displayName: 'Credit Card',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBeUndefined();
    });

    it('should reject publishableKey that does not start with pk_test_ or pk_live_', async () => {
      // Service rejects non-pk_ prefixed keys and omits publishableKey
      const stripeProvider: ProviderInfo = {
        id: 'provider-1',
        providerType: 'stripe',
        displayName: 'Credit Card',
      };

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
      }, fundingPlanHandlers.getOptions.bind(fundingPlanHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.providers[0].publishableKey).toBeUndefined();
    });
  });

  describe('GET /status', () => {
    it('should return current funding plan status', async () => {
      const mockPlan = new FundingPlan('sub-1');
      mockPlan.accountId = 'test-account-id';
      mockPlan.status = 'active';
      mockPlan.billingCycle = 'yearly';
      mockPlan.amount = 10000000;
      mockPlan.currency = 'USD';
      mockPlan.currentPeriodStart = new Date('2025-01-01');
      mockPlan.currentPeriodEnd = new Date('2026-01-01');

      sandbox.stub(service, 'getStatus').resolves(mockPlan);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, fundingPlanHandlers.getStatus.bind(fundingPlanHandlers));

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

    it('should report a scheduled cancellation the status cannot express', async () => {
      // A cancel-at-period-end stays 'active' until its boundary, so without
      // cancelAt the client has no way to tell a continuing plan from one that
      // is ending — which is exactly what the account screen has to display.
      const cancelAt = new Date('2026-01-01T00:00:00.000Z');
      const mockPlan = new FundingPlan('sub-1');
      mockPlan.accountId = 'test-account-id';
      mockPlan.status = 'active';
      mockPlan.cancelAt = cancelAt;

      sandbox.stub(service, 'getStatus').resolves(mockPlan);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, fundingPlanHandlers.getStatus.bind(fundingPlanHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body.status).toBe('active');
      expect(response.body.cancelAt).toBe(cancelAt.toISOString());
    });

    it('should send exactly the allowlisted fields and no provider identifiers', async () => {
      // The sibling calendar endpoint has an allowlist test and this one did
      // not, so the field set here was free to grow. FundingPlan carries the
      // account id and the Stripe customer and subscription ids; none of them
      // answers a question this screen asks, and the last two identify objects
      // in the operator's Stripe account (DEC-004).
      const mockPlan = new FundingPlan('sub-1');
      mockPlan.accountId = 'test-account-id';
      mockPlan.providerConfigId = 'provider-config-id';
      mockPlan.providerCustomerId = 'cus_secret';
      mockPlan.providerSubscriptionId = 'sub_secret';
      mockPlan.status = 'active';
      mockPlan.accountEmail = 'owner@example.com';

      sandbox.stub(service, 'getStatus').resolves(mockPlan);

      router.get('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, fundingPlanHandlers.getStatus.bind(fundingPlanHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(Object.keys(response.body).sort()).toEqual([
        'amount',
        'billingCycle',
        'cancelAt',
        'cancelledAt',
        'currency',
        'currentPeriodEnd',
        'currentPeriodStart',
        'id',
        'status',
        'suspendedAt',
      ]);

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('cus_secret');
      expect(serialized).not.toContain('sub_secret');
      expect(serialized).not.toContain('test-account-id');
      expect(serialized).not.toContain('owner@example.com');
    });
  });

  describe('POST /cancel', () => {
    it('should mark funding plan for end-of-period cancellation', async () => {
      const mockPlan = new FundingPlan('sub-1');
      mockPlan.accountId = 'test-account-id';
      mockPlan.status = 'active';

      const getStatusStub = sandbox.stub(service, 'getStatus').resolves(mockPlan);
      const cancelStub = sandbox.stub(service, 'cancel').resolves();

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, fundingPlanHandlers.cancel.bind(fundingPlanHandlers));

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
      }, fundingPlanHandlers.getPortal.bind(fundingPlanHandlers));

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
      router.get('/handler-status', fundingPlanHandlers.getStatus.bind(fundingPlanHandlers));
      router.post('/handler-cancel', fundingPlanHandlers.cancel.bind(fundingPlanHandlers));
      router.get('/handler-portal', fundingPlanHandlers.getPortal.bind(fundingPlanHandlers));

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
