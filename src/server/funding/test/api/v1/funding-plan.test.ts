import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import FundingService from '@/server/funding/service/funding';
import FundingPlanRouteHandlers from '@/server/funding/api/v1/funding-plan';
import { Account } from '@/common/model/account';
import { FundingPlan, ProviderConfig } from '@/common/model/funding-plan';
import { testApp } from '@/server/common/test/lib/express';

describe('User Subscription API Routes', () => {
  let router: express.Router;
  let service: FundingService;
  let subscriptionHandlers: FundingPlanRouteHandlers;
  let sandbox: sinon.SinonSandbox;
  let mockAccount: Account;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create service with mocked dependencies
    const eventBus = { emit: sandbox.stub() } as any;
    service = new FundingService(eventBus);

    // Create handlers
    subscriptionHandlers = new FundingPlanRouteHandlers(service);

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
  });

  describe('POST /subscribe', () => {
    it('should create subscription with chosen provider', async () => {
      const mockSubscription = new FundingPlan('sub-1');
      mockSubscription.accountId = 'test-account-id';
      mockSubscription.providerConfigId = 'provider-1';
      mockSubscription.status = 'active';
      mockSubscription.billingCycle = 'monthly';
      mockSubscription.amount = 1000000;
      mockSubscription.currency = 'USD';

      sandbox.stub(service, 'subscribe').resolves(mockSubscription);

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.subscribe.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          providerConfigId: 'provider-1',
          billingCycle: 'monthly',
          amount: 1000000,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: 'sub-1',
        accountId: 'test-account-id',
        status: 'active',
        billingCycle: 'monthly',
        amount: 1000000,
      });
    });

    it('should pass calendarIds to the service when provided', async () => {
      const mockSubscription = new FundingPlan('sub-1');
      mockSubscription.accountId = 'test-account-id';
      mockSubscription.status = 'active';
      mockSubscription.billingCycle = 'monthly';
      mockSubscription.amount = 1000000;
      mockSubscription.currency = 'USD';

      const subscribeStub = sandbox.stub(service, 'subscribe').resolves(mockSubscription);

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.subscribe.bind(subscriptionHandlers));

      const calendarIds = [
        'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
      ];

      await request(testApp(router))
        .post('/handler')
        .send({
          providerConfigId: 'provider-1',
          billingCycle: 'monthly',
          amount: 1000000,
          calendarIds,
        })
        .expect(200);

      expect(subscribeStub.calledOnce).toBe(true);
      expect(subscribeStub.firstCall.args[5]).toEqual(calendarIds);
    });

    it('should pass undefined calendarIds when not provided', async () => {
      const mockSubscription = new FundingPlan('sub-1');
      mockSubscription.accountId = 'test-account-id';
      mockSubscription.status = 'active';
      mockSubscription.billingCycle = 'monthly';
      mockSubscription.amount = 1000000;

      const subscribeStub = sandbox.stub(service, 'subscribe').resolves(mockSubscription);

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.subscribe.bind(subscriptionHandlers));

      await request(testApp(router))
        .post('/handler')
        .send({
          providerConfigId: 'provider-1',
          billingCycle: 'monthly',
          amount: 1000000,
        })
        .expect(200);

      expect(subscribeStub.calledOnce).toBe(true);
      expect(subscribeStub.firstCall.args[5]).toBeUndefined();
    });

    it('should return 400 when calendarIds is not an array', async () => {
      sandbox.stub(service, 'subscribe').resolves(new FundingPlan());

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.subscribe.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          providerConfigId: 'provider-1',
          billingCycle: 'monthly',
          amount: 1000000,
          calendarIds: 'not-an-array',
        })
        .expect(400);

      expect(response.body.error).toBe('calendarIds must be an array');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when calendarIds exceeds 50 entries', async () => {
      sandbox.stub(service, 'subscribe').resolves(new FundingPlan());

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.subscribe.bind(subscriptionHandlers));

      // Generate 51 valid UUIDs
      const calendarIds = Array.from({ length: 51 }, (_, i) =>
        `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c${String(i).padStart(2, '0')}`,
      );

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          providerConfigId: 'provider-1',
          billingCycle: 'monthly',
          amount: 1000000,
          calendarIds,
        })
        .expect(400);

      expect(response.body.error).toBe('calendarIds cannot exceed 50 entries');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should return 400 when calendarIds contains invalid UUIDs', async () => {
      sandbox.stub(service, 'subscribe').resolves(new FundingPlan());

      router.post('/handler', (req: Request, res: Response, next) => {
        req.user = mockAccount;
        next();
      }, subscriptionHandlers.subscribe.bind(subscriptionHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          providerConfigId: 'provider-1',
          billingCycle: 'monthly',
          amount: 1000000,
          calendarIds: ['not-a-uuid', 'also-invalid'],
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid calendar IDs');
      expect(response.body.error).toContain('not-a-uuid');
      expect(response.body.error).toContain('also-invalid');
      expect(response.body.errorName).toBe('ValidationError');
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
      sandbox.stub(service, 'subscribe').resolves(new FundingPlan());
      sandbox.stub(service, 'getStatus').resolves(undefined);
      sandbox.stub(service, 'cancel').resolves();
      sandbox.stub(service, 'getBillingPortalUrl').resolves('');

      // Test without adding req.user - handlers should return 401
      // Note: /options is NOT tested here as it may be public
      router.post('/handler-subscribe', subscriptionHandlers.subscribe.bind(subscriptionHandlers));
      router.get('/handler-status', subscriptionHandlers.getStatus.bind(subscriptionHandlers));
      router.post('/handler-cancel', subscriptionHandlers.cancel.bind(subscriptionHandlers));
      router.get('/handler-portal', subscriptionHandlers.getPortal.bind(subscriptionHandlers));

      await request(testApp(router))
        .post('/handler-subscribe')
        .send({})
        .expect(401);

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
