import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { ProviderConnectionService } from '@/server/funding/service/provider_connection';
import { WebhookManager } from '@/server/funding/service/provider/webhook_manager';
import { PaymentProviderAdapter, ProviderCredentials, WebhookRegistration } from '@/server/funding/service/provider/adapter';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { ProviderType } from '@/common/model/funding-plan';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { EventEmitter } from 'events';

describe('ProviderConnectionService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ProviderConnectionService;
  let eventBus: EventEmitter;
  let webhookManager: WebhookManager;
  let mockStripeAdapter: sinon.SinonStubbedInstance<PaymentProviderAdapter>;
  let mockPayPalAdapter: sinon.SinonStubbedInstance<PaymentProviderAdapter>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    webhookManager = new WebhookManager();

    // Create mock adapters
    mockStripeAdapter = {
      providerType: 'stripe',
      registerWebhook: sandbox.stub(),
      deleteWebhook: sandbox.stub(),
      validateCredentials: sandbox.stub(),
      createSubscription: sandbox.stub(),
      cancelSubscription: sandbox.stub(),
      getSubscription: sandbox.stub(),
      getBillingPortalUrl: sandbox.stub(),
      verifyWebhookSignature: sandbox.stub(),
      parseWebhookEvent: sandbox.stub(),
    } as any;

    mockPayPalAdapter = {
      providerType: 'paypal',
      registerWebhook: sandbox.stub(),
      deleteWebhook: sandbox.stub(),
      validateCredentials: sandbox.stub(),
      createSubscription: sandbox.stub(),
      cancelSubscription: sandbox.stub(),
      getSubscription: sandbox.stub(),
      getBillingPortalUrl: sandbox.stub(),
      verifyWebhookSignature: sandbox.stub(),
      parseWebhookEvent: sandbox.stub(),
    } as any;

    service = new ProviderConnectionService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('configureStripe', () => {
    const adminUser = { id: uuidv4(), email: 'admin@example.com' };
    const validCredentials = {
      publishable_key: 'pk_test_abc123def456',
      secret_key: 'sk_test_abc123def456',
      webhook_secret: 'whsec_abc123def456',
    };

    it('should validate, encrypt, and store Stripe credentials', async () => {
      // Stub entity
      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(null);

      const entityId = uuidv4();
      const createStub = sandbox.stub(ProviderConfigEntity, 'create');
      const mockEntity = {
        id: entityId,
        provider_type: 'stripe',
        _decryptedCredentials: undefined as string | undefined,
        _decryptedWebhookSecret: undefined as string | undefined,
        save: sandbox.stub().resolves(),
      };
      createStub.resolves(mockEntity as any);

      // Stub ProviderFactory.clearCache
      const clearCacheStub = sandbox.stub(ProviderFactory, 'clearCache');

      const result = await service.configureStripe(validCredentials, adminUser);

      expect(result).toBe(true);
      expect(createStub.calledOnce).toBe(true);

      // Verify the stored credentials have correct structure
      const createArgs = createStub.firstCall.args[0] as any;
      const storedCreds = JSON.parse(createArgs.credentials);
      expect(storedCreds.apiKey).toBe('sk_test_abc123def456');
      expect(storedCreds.publishableKey).toBe('pk_test_abc123def456');
      expect(createArgs.webhook_secret).toBe('whsec_abc123def456');
      expect(createArgs.provider_type).toBe('stripe');
      expect(createArgs.enabled).toBe(false);
      expect(createArgs.display_name).toBe('Stripe');

      // Verify cache was cleared
      expect(clearCacheStub.calledWith(entityId)).toBe(true);
    });

    it('should update existing configuration when provider already exists', async () => {
      const entityId = uuidv4();
      const mockEntity = {
        id: entityId,
        provider_type: 'stripe',
        _decryptedCredentials: undefined as string | undefined,
        _decryptedWebhookSecret: undefined as string | undefined,
        save: sandbox.stub().resolves(),
      };

      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(mockEntity as any);

      sandbox.stub(ProviderFactory, 'clearCache');

      const result = await service.configureStripe(validCredentials, adminUser);

      expect(result).toBe(true);
      expect(mockEntity.save.calledOnce).toBe(true);
      expect(mockEntity._decryptedWebhookSecret).toBe('whsec_abc123def456');

      const storedCreds = JSON.parse(mockEntity._decryptedCredentials!);
      expect(storedCreds.apiKey).toBe('sk_test_abc123def456');
      expect(storedCreds.publishableKey).toBe('pk_test_abc123def456');
    });

    it('should throw error for missing publishable_key', async () => {
      const creds = { ...validCredentials, publishable_key: '' };
      await expect(service.configureStripe(creds, adminUser)).rejects.toThrow('Missing required field: publishable_key');
    });

    it('should throw error for missing secret_key', async () => {
      const creds = { ...validCredentials, secret_key: '' };
      await expect(service.configureStripe(creds, adminUser)).rejects.toThrow('Missing required field: secret_key');
    });

    it('should throw error for missing webhook_secret', async () => {
      const creds = { ...validCredentials, webhook_secret: '' };
      await expect(service.configureStripe(creds, adminUser)).rejects.toThrow('Missing required field: webhook_secret');
    });

    it('should throw error for invalid key format', async () => {
      const creds = { ...validCredentials, publishable_key: 'invalid_key' };
      await expect(service.configureStripe(creds, adminUser)).rejects.toThrow('Invalid publishable key format');
    });

    it('should throw error for invalid secret key format', async () => {
      const creds = { ...validCredentials, secret_key: 'invalid_secret' };
      await expect(service.configureStripe(creds, adminUser)).rejects.toThrow('Invalid secret key format');
    });

    it('should throw error for invalid webhook secret format', async () => {
      const creds = { ...validCredentials, webhook_secret: 'invalid_webhook' };
      await expect(service.configureStripe(creds, adminUser)).rejects.toThrow('Invalid webhook secret format');
    });

    it('should emit provider:configured event', async () => {
      const entityId = uuidv4();
      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(null);

      const createStub = sandbox.stub(ProviderConfigEntity, 'create');
      createStub.resolves({
        id: entityId,
        provider_type: 'stripe',
        save: sandbox.stub().resolves(),
      } as any);

      sandbox.stub(ProviderFactory, 'clearCache');

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.configureStripe(validCredentials, adminUser);

      expect(emitSpy.calledWith('provider:configured', {
        providerType: 'stripe',
        providerId: entityId,
      })).toBe(true);
    });

    it('should accept live key prefixes', async () => {
      const liveCreds = {
        publishable_key: 'pk_live_abc123def456',
        secret_key: 'sk_live_abc123def456',
        webhook_secret: 'whsec_abc123def456',
      };

      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(null);

      const createStub = sandbox.stub(ProviderConfigEntity, 'create');
      createStub.resolves({
        id: uuidv4(),
        provider_type: 'stripe',
        save: sandbox.stub().resolves(),
      } as any);

      sandbox.stub(ProviderFactory, 'clearCache');

      const result = await service.configureStripe(liveCreds, adminUser);
      expect(result).toBe(true);
    });
  });

  describe('configurePayPal', () => {
    it('should validate, encrypt, and store PayPal credentials', async () => {
      const adminUser = { id: uuidv4(), email: 'admin@example.com' };
      const credentials: ProviderCredentials = {
        client_id: 'paypal-client-id',
        client_secret: 'paypal-client-secret',
        environment: 'sandbox',
      };
      const webhookRegistration: WebhookRegistration = {
        webhookId: 'webhook-id-123',
        webhookSecret: 'webhook-secret-123',
      };

      // Stub adapter
      sandbox.stub(service as any, 'getAdapter').returns(mockPayPalAdapter);
      mockPayPalAdapter.validateCredentials.withArgs(credentials).resolves(true);

      // Stub webhook manager
      const generateUrlStub = sandbox.stub(webhookManager, 'generateWebhookUrl');
      generateUrlStub.withArgs('paypal').returns('https://example.com/api/funding/v1/webhooks/paypal');

      mockPayPalAdapter.registerWebhook.resolves(webhookRegistration);

      // Stub entity
      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(null);

      const createStub = sandbox.stub(ProviderConfigEntity, 'create');
      const mockEntity = {
        id: uuidv4(),
        provider_type: 'paypal',
        save: sandbox.stub().resolves(),
      };
      createStub.resolves(mockEntity as any);

      (service as any).webhookManager = webhookManager;

      const result = await service.configurePayPal(credentials, adminUser);

      expect(result).toBe(true);
      expect(mockPayPalAdapter.validateCredentials.calledOnce).toBe(true);
      expect(mockPayPalAdapter.registerWebhook.calledOnce).toBe(true);
      expect(createStub.calledOnce).toBe(true);
    });

    it('should throw error if credentials are invalid', async () => {
      const adminUser = { id: uuidv4(), email: 'admin@example.com' };
      const credentials: ProviderCredentials = {
        client_id: 'invalid_id',
        client_secret: 'invalid_secret',
        environment: 'sandbox',
      };

      sandbox.stub(service as any, 'getAdapter').returns(mockPayPalAdapter);
      mockPayPalAdapter.validateCredentials.withArgs(credentials).resolves(false);

      await expect(service.configurePayPal(credentials, adminUser)).rejects.toThrow('Invalid PayPal credentials');
    });
  });

  describe('getProviderStatus', () => {
    it('should return configured:true if provider has credentials', async () => {
      const mockEntity = {
        id: uuidv4(),
        provider_type: 'stripe',
        credentials: JSON.stringify({ stripe_user_id: 'acct_123' }),
        toModel: () => ({
          id: uuidv4(),
          providerType: 'stripe' as ProviderType,
          enabled: true,
          displayName: 'Stripe',
          credentials: JSON.stringify({ apiKey: 'sk_test_123' }),
          webhookSecret: '',
        }),
      };

      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(mockEntity as any);

      const result = await service.getProviderStatus('stripe');

      expect(result.configured).toBe(true);
    });

    it('should return configured:false if provider has no credentials', async () => {
      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(null);

      const result = await service.getProviderStatus('stripe');

      expect(result.configured).toBe(false);
    });
  });

  describe('disconnectProvider', () => {
    it('should check active subscriptions and return warning if not confirmed', async () => {
      const mockEntity = {
        id: uuidv4(),
        provider_type: 'stripe',
        credentials: JSON.stringify({ webhook_id: 'we_123' }),
        toModel: () => ({
          id: uuidv4(),
          providerType: 'stripe' as ProviderType,
          credentials: JSON.stringify({ webhook_id: 'we_123' }),
        }),
      };

      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(mockEntity as any);

      const countStub = sandbox.stub(FundingPlanEntity, 'count');
      countStub.resolves(5); // 5 active subscriptions

      const result = await service.disconnectProvider('stripe', false);

      expect(result.requiresConfirmation).toBe(true);
      expect(result.activeSubscriptionCount).toBe(5);
      expect(countStub.calledOnce).toBe(true);
    });

    it('should force-cancel subscriptions and delete provider if confirmed', async () => {
      const providerId = uuidv4();
      const mockEntity = {
        id: providerId,
        provider_type: 'stripe',
        credentials: JSON.stringify({ webhook_id: 'we_123' }),
        destroy: sandbox.stub().resolves(),
        toModel: () => ({
          id: providerId,
          providerType: 'stripe' as ProviderType,
          credentials: JSON.stringify({ webhook_id: 'we_123' }),
          webhookSecret: 'whsec_123',
        }),
      };

      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(mockEntity as any);

      // Stub count for active subscriptions check
      const countStub = sandbox.stub(FundingPlanEntity, 'count');
      countStub.resolves(2); // 2 active subscriptions

      const mockSubscriptions = [
        { id: uuidv4(), provider_subscription_id: 'sub_1', provider_config_id: providerId },
        { id: uuidv4(), provider_subscription_id: 'sub_2', provider_config_id: providerId },
      ];

      const findAllStub = sandbox.stub(FundingPlanEntity, 'findAll');
      findAllStub.resolves(mockSubscriptions as any);

      // Stub adapter
      sandbox.stub(service as any, 'getAdapter').returns(mockStripeAdapter);
      mockStripeAdapter.deleteWebhook.resolves();

      // Stub cancel subscription via service
      const cancelStub = sandbox.stub();
      (service as any).subscriptionService = {
        forceCancel: cancelStub,
      };

      const result = await service.disconnectProvider('stripe', true);

      expect(result.requiresConfirmation).toBeUndefined();
      expect(cancelStub.callCount).toBe(2); // Called for each subscription
      expect(mockStripeAdapter.deleteWebhook.calledOnce).toBe(true);
      expect(mockEntity.destroy.calledOnce).toBe(true);
    });
  });

  describe('getActiveSubscriptionCount', () => {
    it('should return count of active subscriptions for provider', async () => {
      const providerId = uuidv4();
      const mockEntity = {
        id: providerId,
        provider_type: 'stripe',
      };

      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(mockEntity as any);

      const countStub = sandbox.stub(FundingPlanEntity, 'count');
      countStub.resolves(3);

      const result = await service.getActiveSubscriptionCount('stripe');

      expect(result).toBe(3);
      expect(countStub.calledOnce).toBe(true);
    });
  });
});
