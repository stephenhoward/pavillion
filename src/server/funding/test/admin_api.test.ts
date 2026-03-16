import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import FundingService from '@/server/funding/service/funding';
import AdminRouteHandlers from '@/server/funding/api/v1/admin';
import { ProviderConnectionService } from '@/server/funding/service/provider_connection';
import { FundingSettings, ProviderConfig } from '@/common/model/funding-plan';
import { testApp } from '@/server/common/test/lib/express';

describe('Admin Funding API', () => {
  let router: express.Router;
  let service: FundingService;
  let providerConnectionService: ProviderConnectionService;
  let adminHandlers: AdminRouteHandlers;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    router = express.Router();

    // Create service with mocked dependencies
    const eventBus = { emit: sandbox.stub() } as any;
    service = new FundingService(eventBus);
    providerConnectionService = new ProviderConnectionService(eventBus);

    // Create handlers
    adminHandlers = new AdminRouteHandlers(service, providerConnectionService);
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
      });
    });
  });

  describe('POST /admin/settings', () => {
    it('should update settings with validation', async () => {
      const updateStub = sandbox.stub(service, 'updateSettings').resolves(true);

      const settingsUpdate = {
        enabled: true,
        monthlyPrice: 1500000,
        yearlyPrice: 15000000,
        currency: 'USD',
        payWhatYouCan: true,
        gracePeriodDays: 14,
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
        })
        .expect(400);

      expect(response.body.error).toContain('must be non-negative');
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
          credentials: '{"stripe_user_id": "acct_123"}',
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
      sandbox.stub(providerConnectionService, 'getProviderStatus')
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
      const updateStub = sandbox.stub(service, 'updateProvider').resolves(true);

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

});
