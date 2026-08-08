import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import FundingInterface from '@/server/funding/interface';
import AdminRoutes from '@/server/funding/api/v1/admin';
import { FundingSettings, ProviderConfig } from '@/common/model/funding-plan';
import { testApp } from '@/server/common/test/lib/express';
import ExpressHelper from '@/server/common/helper/express';
import { Account } from '@/common/model/account';

describe('Admin Funding API', () => {
  let router: express.Router;
  let service: FundingInterface;
  let adminHandlers: AdminRoutes;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create the funding interface with a mocked event bus
    const eventBus = { emit: sandbox.stub() } as any;
    service = new FundingInterface(eventBus);

    // Create handlers
    adminHandlers = new AdminRoutes(service);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /admin/settings', () => {
    it('should return current subscription settings for admin user', async () => {
      const mockSettings = new FundingSettings();
      mockSettings.enabled = true;
      mockSettings.monthlyPrice = 1000000; // $10.00 in millicents
      mockSettings.yearlyPrice = 10000000; // $100.00 in millicents
      mockSettings.currency = 'USD';
      mockSettings.payWhatYouCan = false;
      mockSettings.gracePeriodDays = 7;
      mockSettings.payWhatYouCanYearlyDiscount = 15;

      sandbox.stub(service, 'getSettings').resolves(mockSettings);

      router.get('/handler', adminHandlers.getSettings.bind(adminHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body).toEqual({
        enabled: true,
        monthlyPrice: 1000000,
        yearlyPrice: 10000000,
        currency: 'USD',
        payWhatYouCan: false,
        gracePeriodDays: 7,
        payWhatYouCanYearlyDiscount: 15,
      });
    });
  });

  describe('POST /admin/settings', () => {
    it('should update settings with validation', async () => {
      const updateStub = sandbox.stub(service, 'updateSettings').resolves();

      const settingsUpdate = {
        enabled: true,
        monthlyPrice: 1500000,
        yearlyPrice: 15000000,
        currency: 'USD',
        payWhatYouCan: true,
        gracePeriodDays: 14,
        payWhatYouCanYearlyDiscount: 10,
      };

      router.post('/handler', adminHandlers.updateSettings.bind(adminHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send(settingsUpdate)
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(updateStub.calledOnce).toBe(true);
    });

    it('should reject invalid currency codes', async () => {
      router.post('/handler', adminHandlers.updateSettings.bind(adminHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          enabled: true,
          monthlyPrice: 1000000,
          yearlyPrice: 10000000,
          currency: 'INVALID',
          payWhatYouCan: false,
          gracePeriodDays: 7,
          payWhatYouCanYearlyDiscount: 0,
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid currency code');
    });

    it('should reject negative prices', async () => {
      router.post('/handler', adminHandlers.updateSettings.bind(adminHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          enabled: true,
          monthlyPrice: -1000,
          yearlyPrice: 10000000,
          currency: 'USD',
          payWhatYouCan: false,
          gracePeriodDays: 7,
          payWhatYouCanYearlyDiscount: 0,
        })
        .expect(400);

      expect(response.body.error).toContain('must be non-negative');
    });

    it('should reject payWhatYouCanYearlyDiscount greater than 100', async () => {
      router.post('/handler', adminHandlers.updateSettings.bind(adminHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          enabled: true,
          monthlyPrice: 1000000,
          yearlyPrice: 10000000,
          currency: 'USD',
          payWhatYouCan: true,
          gracePeriodDays: 7,
          payWhatYouCanYearlyDiscount: 101,
        })
        .expect(400);

      expect(response.body.error).toContain('payWhatYouCanYearlyDiscount must be a number between 0 and 100');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should reject negative payWhatYouCanYearlyDiscount', async () => {
      router.post('/handler', adminHandlers.updateSettings.bind(adminHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          enabled: true,
          monthlyPrice: 1000000,
          yearlyPrice: 10000000,
          currency: 'USD',
          payWhatYouCan: true,
          gracePeriodDays: 7,
          payWhatYouCanYearlyDiscount: -5,
        })
        .expect(400);

      expect(response.body.error).toContain('payWhatYouCanYearlyDiscount must be a number between 0 and 100');
      expect(response.body.errorName).toBe('ValidationError');
    });

    it('should reject non-numeric payWhatYouCanYearlyDiscount', async () => {
      router.post('/handler', adminHandlers.updateSettings.bind(adminHandlers));

      const response = await request(testApp(router))
        .post('/handler')
        .send({
          enabled: true,
          monthlyPrice: 1000000,
          yearlyPrice: 10000000,
          currency: 'USD',
          payWhatYouCan: true,
          gracePeriodDays: 7,
          payWhatYouCanYearlyDiscount: 'ten',
        })
        .expect(400);

      expect(response.body.error).toContain('payWhatYouCanYearlyDiscount must be a number between 0 and 100');
      expect(response.body.errorName).toBe('ValidationError');
    });
  });

  /**
   * settings.enabled is an instance-level switch: it decides whether funding
   * gates apply at all (checkFundingAccess invariant 1), so the only path that
   * may write it is the admin-gated POST /api/funding/v1/admin/settings.
   *
   * The passport arm of ExpressHelper.adminOnly is captured at module load and
   * cannot be restubbed, so authorization is covered in two parts, following
   * the pattern in src/server/calendar/test/admin.integration.test.ts:
   * registration wires the whole adminOnly chain, and the role-check arm
   * rejects a non-admin.
   */
  describe('instance settings write authorization', () => {
    it('registers the settings routes behind the full adminOnly chain', () => {
      const app = express();
      adminHandlers.installHandlers(app, '/api/funding/v1');

      const settingsLayers = (app as any)._router.stack
        .filter((layer: any) => layer.name === 'router')
        .flatMap((layer: any) => layer.handle.stack)
        .filter((layer: any) => layer.route?.path === '/admin/settings');

      expect(settingsLayers.length).toBe(2); // GET and POST

      for (const layer of settingsLayers) {
        const handlers = layer.route.stack.map((l: any) => l.handle);
        for (const guard of ExpressHelper.adminOnly) {
          expect(handlers).toContain(guard);
        }
      }
    });

    it('rejects a non-admin attempt to write settings.enabled', async () => {
      const updateStub = sandbox.stub(service, 'updateSettings').resolves();
      const nonAdmin = new Account('user-uuid', 'user', 'user@example.com');
      nonAdmin.roles = [];

      router.use((req, _res, next) => {
        req.user = nonAdmin;
        next();
      });
      // Reuse the production role-check arm; only the passport arm is skipped.
      router.post(
        '/admin/settings',
        ExpressHelper.adminOnly[1],
        adminHandlers.updateSettings.bind(adminHandlers),
      );

      await request(testApp(router))
        .post('/admin/settings')
        .send({
          enabled: true,
          monthlyPrice: 1000000,
          yearlyPrice: 10000000,
          currency: 'USD',
          payWhatYouCan: false,
          gracePeriodDays: 7,
          payWhatYouCanYearlyDiscount: 0,
        })
        .expect(403);

      expect(updateStub.called).toBe(false);
    });
  });

  describe('GET /admin/providers', () => {
    it('should list all configured providers with configured status', async () => {
      const mockProviders: ProviderConfig[] = [
        {
          id: 'provider-1',
          providerType: 'stripe',
          enabled: true,
          displayName: 'Credit Card',
          credentials: '{"apiKey": "sk_test_123"}',
          webhookSecret: 'secret1',
        },
        {
          id: 'provider-2',
          providerType: 'paypal',
          enabled: false,
          displayName: 'PayPal',
          credentials: '{}',
          webhookSecret: '',
        },
      ];

      sandbox.stub(service, 'getProviders').resolves(mockProviders);
      sandbox.stub(service, 'getProviderStatus')
        .withArgs('stripe').resolves({ configured: true })
        .withArgs('paypal').resolves({ configured: false });

      router.get('/handler', adminHandlers.listProviders.bind(adminHandlers));

      const response = await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].provider_type).toBe('stripe');
      expect(response.body[0].configured).toBe(true);
      expect(response.body[1].provider_type).toBe('paypal');
      expect(response.body[1].configured).toBe(false);
      // Credentials should not be exposed
      expect(response.body[0].credentials).toBeUndefined();
    });
  });

  describe('PUT /admin/providers/:providerType', () => {
    it('should update provider display name and enabled status', async () => {
      const updateStub = sandbox.stub(service, 'updateProvider').resolves();

      router.put('/handler/:providerType', adminHandlers.updateProvider.bind(adminHandlers));

      const response = await request(testApp(router))
        .put('/handler/stripe')
        .send({
          displayName: 'Credit/Debit Card',
          enabled: true,
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(updateStub.calledWith('stripe', 'Credit/Debit Card', true)).toBe(true);
    });
  });

  describe('GET /admin/funding-plans', () => {
    const mockPaginationResult = (page: number, limit: number) => ({
      fundingPlans: [],
      pagination: {
        currentPage: page,
        totalPages: 0,
        totalCount: 0,
        limit,
      },
    });

    it('should use default limit of 50 when no limit is provided', async () => {
      const stub = sandbox.stub(service, 'listFundingPlans').resolves(mockPaginationResult(1, 50));

      router.get('/handler', adminHandlers.listFundingPlans.bind(adminHandlers));

      await request(testApp(router))
        .get('/handler')
        .expect(200);

      expect(stub.calledOnce).toBe(true);
      expect(stub.firstCall.args[0]).toBe(1); // page defaults to 1
      expect(stub.firstCall.args[1]).toBe(50); // limit defaults to 50
    });

    it('should cap limit at 100 when a higher value is requested', async () => {
      const stub = sandbox.stub(service, 'listFundingPlans').resolves(mockPaginationResult(1, 100));

      router.get('/handler', adminHandlers.listFundingPlans.bind(adminHandlers));

      await request(testApp(router))
        .get('/handler?limit=999999')
        .expect(200);

      expect(stub.calledOnce).toBe(true);
      expect(stub.firstCall.args[1]).toBe(100); // capped at MAX_LIMIT
    });

    it('should pass a valid limit through unchanged', async () => {
      const stub = sandbox.stub(service, 'listFundingPlans').resolves(mockPaginationResult(1, 10));

      router.get('/handler', adminHandlers.listFundingPlans.bind(adminHandlers));

      await request(testApp(router))
        .get('/handler?limit=10')
        .expect(200);

      expect(stub.firstCall.args[1]).toBe(10);
    });

    it('should fall back to default limit when limit is zero or negative', async () => {
      const stub = sandbox.stub(service, 'listFundingPlans').resolves(mockPaginationResult(1, 50));

      router.get('/handler', adminHandlers.listFundingPlans.bind(adminHandlers));

      await request(testApp(router))
        .get('/handler?limit=0')
        .expect(200);

      expect(stub.firstCall.args[1]).toBe(50); // zero falls back to default

      stub.resetHistory();

      await request(testApp(router))
        .get('/handler?limit=-5')
        .expect(200);

      expect(stub.firstCall.args[1]).toBe(50); // negative falls back to default
    });

    it('should fall back to page 1 when page is zero or negative', async () => {
      const stub = sandbox.stub(service, 'listFundingPlans').resolves(mockPaginationResult(1, 50));

      router.get('/handler', adminHandlers.listFundingPlans.bind(adminHandlers));

      await request(testApp(router))
        .get('/handler?page=0')
        .expect(200);

      expect(stub.firstCall.args[0]).toBe(1); // zero falls back to page 1

      stub.resetHistory();

      await request(testApp(router))
        .get('/handler?page=-3')
        .expect(200);

      expect(stub.firstCall.args[0]).toBe(1); // negative falls back to page 1
    });

    it('should pass page and limit correctly when both are valid', async () => {
      const stub = sandbox.stub(service, 'listFundingPlans').resolves(mockPaginationResult(3, 25));

      router.get('/handler', adminHandlers.listFundingPlans.bind(adminHandlers));

      await request(testApp(router))
        .get('/handler?page=3&limit=25')
        .expect(200);

      expect(stub.firstCall.args[0]).toBe(3);
      expect(stub.firstCall.args[1]).toBe(25);
    });
  });


});
