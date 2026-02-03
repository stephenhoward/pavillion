import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { ProviderConnectionService } from '@/server/subscription/service/provider_connection';
import { OAuthStateManager } from '@/server/subscription/service/oauth_state_manager';
import { WebhookManager } from '@/server/subscription/service/provider/webhook_manager';
import { PaymentProviderAdapter, ProviderCredentials, WebhookRegistration } from '@/server/subscription/service/provider/adapter';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { ProviderType } from '@/common/model/subscription';
import { EventEmitter } from 'events';

describe('ProviderConnectionService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ProviderConnectionService;
  let eventBus: EventEmitter;
  let oauthStateManager: OAuthStateManager;
  let webhookManager: WebhookManager;
  let mockStripeAdapter: sinon.SinonStubbedInstance<PaymentProviderAdapter>;
  let mockPayPalAdapter: sinon.SinonStubbedInstance<PaymentProviderAdapter>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    oauthStateManager = new OAuthStateManager();
    webhookManager = new WebhookManager();

    // Create mock adapters
    mockStripeAdapter = {
      providerType: 'stripe',
      buildOAuthUrl: sandbox.stub(),
      exchangeCodeForCredentials: sandbox.stub(),
      registerWebhook: sandbox.stub(),
      deleteWebhook: sandbox.stub(),
      validateCredentials: sandbox.stub(),
      getConnectUrl: sandbox.stub(),
      handleOAuthCallback: sandbox.stub(),
      createSubscription: sandbox.stub(),
      cancelSubscription: sandbox.stub(),
      getSubscription: sandbox.stub(),
      getBillingPortalUrl: sandbox.stub(),
      verifyWebhookSignature: sandbox.stub(),
      parseWebhookEvent: sandbox.stub(),
    } as any;

    mockPayPalAdapter = {
      providerType: 'paypal',
      buildOAuthUrl: sandbox.stub(),
      exchangeCodeForCredentials: sandbox.stub(),
      registerWebhook: sandbox.stub(),
      deleteWebhook: sandbox.stub(),
      validateCredentials: sandbox.stub(),
      getConnectUrl: sandbox.stub(),
      handleOAuthCallback: sandbox.stub(),
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

  describe('initiateStripeOAuth', () => {
    it('should generate state token and return OAuth URL', async () => {
      const adminUser = { id: uuidv4(), email: 'admin@example.com' };
      const stateToken = 'generated-state-token-hex';
      const oauthUrl = 'https://connect.stripe.com/oauth/authorize?client_id=...';

      // Stub OAuthStateManager
      const generateTokenStub = sandbox.stub(oauthStateManager, 'generateToken');
      generateTokenStub.withArgs('stripe').resolves(stateToken);

      // Stub adapter factory to return mock adapter
      sandbox.stub(service as any, 'getAdapter').returns(mockStripeAdapter);

      // Stub buildOAuthUrl on mock adapter
      mockStripeAdapter.buildOAuthUrl.withArgs(stateToken, sinon.match.string).resolves(oauthUrl);

      // Replace service's oauth manager
      (service as any).oauthStateManager = oauthStateManager;

      const result = await service.initiateStripeOAuth(adminUser);

      expect(result).toEqual({
        oauthUrl,
        state: stateToken,
      });

      expect(generateTokenStub.calledOnce).toBe(true);
      expect(mockStripeAdapter.buildOAuthUrl.calledOnce).toBe(true);
    });
  });

  describe('handleStripeCallback', () => {
    it('should validate state, exchange code, and store credentials', async () => {
      const code = 'auth-code-from-stripe';
      const state = 'valid-state-token';
      const credentials: ProviderCredentials = {
        stripe_user_id: 'acct_test123',
        scope: 'read_write',
        livemode: false,
      };
      const webhookRegistration: WebhookRegistration = {
        webhookId: 'we_test123',
        webhookSecret: 'whsec_test123',
      };

      // Stub state validation
      const validateTokenStub = sandbox.stub(oauthStateManager, 'validateToken');
      validateTokenStub.withArgs(state, 'stripe').resolves(true);

      // Stub adapter
      sandbox.stub(service as any, 'getAdapter').returns(mockStripeAdapter);
      mockStripeAdapter.exchangeCodeForCredentials.withArgs(code).resolves(credentials);

      // Stub webhook manager
      const generateUrlStub = sandbox.stub(webhookManager, 'generateWebhookUrl');
      generateUrlStub.withArgs('stripe').returns('https://example.com/api/subscription/v1/webhooks/stripe');

      mockStripeAdapter.registerWebhook.resolves(webhookRegistration);

      // Stub ProviderConfigEntity
      const findOneStub = sandbox.stub(ProviderConfigEntity, 'findOne');
      findOneStub.resolves(null); // No existing config

      const createStub = sandbox.stub(ProviderConfigEntity, 'create');
      const mockEntity = {
        id: uuidv4(),
        provider_type: 'stripe',
        save: sandbox.stub().resolves(),
      };
      createStub.resolves(mockEntity as any);

      // Replace service managers
      (service as any).oauthStateManager = oauthStateManager;
      (service as any).webhookManager = webhookManager;

      const result = await service.handleStripeCallback(code, state);

      expect(result).toBe(true);
      expect(validateTokenStub.calledOnce).toBe(true);
      expect(mockStripeAdapter.exchangeCodeForCredentials.calledOnce).toBe(true);
      expect(mockStripeAdapter.registerWebhook.calledOnce).toBe(true);
      expect(createStub.calledOnce).toBe(true);
    });

    it('should return false if state token is invalid', async () => {
      const code = 'auth-code';
      const state = 'invalid-state';

      const validateTokenStub = sandbox.stub(oauthStateManager, 'validateToken');
      validateTokenStub.withArgs(state, 'stripe').resolves(false);

      (service as any).oauthStateManager = oauthStateManager;

      const result = await service.handleStripeCallback(code, state);

      expect(result).toBe(false);
      expect(validateTokenStub.calledOnce).toBe(true);
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
      generateUrlStub.withArgs('paypal').returns('https://example.com/api/subscription/v1/webhooks/paypal');

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
          credentials: JSON.stringify({ stripe_user_id: 'acct_123' }),
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

      const countStub = sandbox.stub(SubscriptionEntity, 'count');
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
      const countStub = sandbox.stub(SubscriptionEntity, 'count');
      countStub.resolves(2); // 2 active subscriptions

      const mockSubscriptions = [
        { id: uuidv4(), provider_subscription_id: 'sub_1', provider_config_id: providerId },
        { id: uuidv4(), provider_subscription_id: 'sub_2', provider_config_id: providerId },
      ];

      const findAllStub = sandbox.stub(SubscriptionEntity, 'findAll');
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

      const countStub = sandbox.stub(SubscriptionEntity, 'count');
      countStub.resolves(3);

      const result = await service.getActiveSubscriptionCount('stripe');

      expect(result).toBe(3);
      expect(countStub.calledOnce).toBe(true);
    });
  });
});
