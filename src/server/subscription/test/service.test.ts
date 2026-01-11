import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import db from '@/server/common/entity/db';
import SubscriptionService from '@/server/subscription/service/subscription';
import { SubscriptionSettingsEntity } from '@/server/subscription/entity/subscription_settings';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { SubscriptionEventEntity } from '@/server/subscription/entity/subscription_event';
import { ProviderFactory } from '@/server/subscription/service/provider/factory';
import { SubscriptionSettings, ProviderConfig, Subscription } from '@/common/model/subscription';
import { WebhookEvent } from '@/server/subscription/service/provider/adapter';
import { v4 as uuidv4 } from 'uuid';

describe('SubscriptionService', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: SubscriptionService;

  beforeAll(async () => {
    // Sync database schema before running tests
    await db.sync({ force: true });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new SubscriptionService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getSettings', () => {
    it('should return instance subscription settings', async () => {
      const settingsId = uuidv4();
      const mockEntity = {
        id: settingsId,
        enabled: true,
        monthly_price: 1000000, // $10.00 in millicents
        yearly_price: 10000000, // $100.00 in millicents
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
        toModel: function() {
          const settings = new SubscriptionSettings(this.id);
          settings.enabled = this.enabled;
          settings.monthlyPrice = this.monthly_price;
          settings.yearlyPrice = this.yearly_price;
          settings.currency = this.currency;
          settings.payWhatYouCan = this.pay_what_you_can;
          settings.gracePeriodDays = this.grace_period_days;
          return settings;
        },
      };

      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockEntity as any);

      const settings = await service.getSettings();

      expect(settings).toBeDefined();
      expect(settings.enabled).toBe(true);
      expect(settings.monthlyPrice).toBe(1000000);
      expect(settings.yearlyPrice).toBe(10000000);
      expect(settings.currency).toBe('USD');
    });
  });

  describe('updateSettings', () => {
    it('should validate and save settings', async () => {
      const settingsId = uuidv4();
      const existingEntity = {
        id: settingsId,
        enabled: false,
        monthly_price: 0,
        yearly_price: 0,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(existingEntity as any);

      const updatedSettings = new SubscriptionSettings(settingsId);
      updatedSettings.enabled = true;
      updatedSettings.monthlyPrice = 1000000;
      updatedSettings.yearlyPrice = 10000000;
      updatedSettings.currency = 'USD';

      const result = await service.updateSettings(updatedSettings);

      expect(result).toBe(true);
      expect(existingEntity.enabled).toBe(true);
      expect(existingEntity.monthly_price).toBe(1000000);
      expect(existingEntity.yearly_price).toBe(10000000);
      expect(existingEntity.save.called).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('should create subscription via provider', async () => {
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const subscriptionId = uuidv4();

      const mockProviderConfig = {
        id: providerConfigId,
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{"apiKey":"test"}',
        webhook_secret: 'secret',
        toModel: function() {
          const config = new ProviderConfig(this.id, this.provider_type);
          config.enabled = this.enabled;
          config.displayName = this.display_name;
          config.credentials = this.credentials;
          config.webhookSecret = this.webhook_secret;
          return config;
        },
      };

      const mockSettings = {
        currency: 'USD',
        toModel: function() {
          const settings = new SubscriptionSettings();
          settings.currency = this.currency;
          return settings;
        },
      };

      const mockAdapter = {
        providerType: 'stripe' as const,
        createSubscription: sandbox.stub().resolves({
          providerSubscriptionId: 'sub_123',
          providerCustomerId: 'cus_123',
          status: 'active' as const,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          amount: 1000000,
          currency: 'USD',
        }),
      };

      const mockSubscriptionEntity = {
        id: subscriptionId,
        save: sandbox.stub().resolves(),
        toModel: () => new Subscription(subscriptionId),
      };

      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockSettings as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      sandbox.stub(SubscriptionEntity, 'fromModel').returns(mockSubscriptionEntity as any);

      const subscription = await service.subscribe(
        accountId,
        'user@example.com',
        providerConfigId,
        'monthly',
        1000000,
      );

      expect(subscription).toBeDefined();
      expect(mockAdapter.createSubscription.called).toBe(true);
      expect(mockSubscriptionEntity.save.called).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should mark subscription for end-of-period cancellation', async () => {
      const subscriptionId = uuidv4();
      const mockEntity = {
        id: subscriptionId,
        account_id: uuidv4(),
        provider_config_id: uuidv4(),
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        status: 'active',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelled_at: null,
        suspended_at: null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      const mockProviderConfig = {
        toModel: () => new ProviderConfig(uuidv4(), 'stripe'),
      };

      const mockAdapter = {
        cancelSubscription: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves(mockEntity as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.cancel(subscriptionId, false);

      expect(mockAdapter.cancelSubscription.calledWith('sub_123', false)).toBe(true);
      expect(mockEntity.status).toBe('cancelled');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('processWebhookEvent', () => {
    it('should update subscription status based on webhook event', async () => {
      const subscriptionId = uuidv4();
      const providerEventId = 'evt_123';

      const mockEntity = {
        id: subscriptionId,
        account_id: uuidv4(),
        provider_config_id: uuidv4(),
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(),
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      const webhookEvent: WebhookEvent = {
        eventId: providerEventId,
        eventType: 'invoice.payment_failed',
        subscriptionId: 'sub_123',
        status: 'past_due',
        rawPayload: {},
      };

      const mockEventEntity = {
        id: uuidv4(),
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionEntity, 'findOne').resolves(mockEntity as any);
      sandbox.stub(SubscriptionEventEntity, 'findOne').resolves(null);
      sandbox.stub(SubscriptionEventEntity.prototype, 'save').resolves(mockEventEntity as any);

      await service.processWebhookEvent(webhookEvent, uuidv4());

      expect(mockEntity.status).toBe('past_due');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('status transitions', () => {
    it('should transition from active to past_due on payment failure', async () => {
      const subscriptionId = uuidv4();
      const mockEntity = {
        id: subscriptionId,
        status: 'active',
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      const mockEventEntity = {
        id: uuidv4(),
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionEntity, 'findOne').resolves(mockEntity as any);
      sandbox.stub(SubscriptionEventEntity, 'findOne').resolves(null);
      sandbox.stub(SubscriptionEventEntity.prototype, 'save').resolves(mockEventEntity as any);

      const webhookEvent: WebhookEvent = {
        eventId: 'evt_123',
        eventType: 'payment_failed',
        subscriptionId: 'sub_123',
        status: 'past_due',
        rawPayload: {},
      };

      await service.processWebhookEvent(webhookEvent, uuidv4());

      expect(mockEntity.status).toBe('past_due');
    });

    it('should transition from past_due to suspended after grace period', async () => {
      const subscriptionId = uuidv4();
      const gracePeriodDays = 7;
      const pastDueDate = new Date(Date.now() - (gracePeriodDays + 1) * 24 * 60 * 60 * 1000);

      const mockEntity = {
        id: subscriptionId,
        status: 'past_due',
        updated_at: pastDueDate,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      sandbox.stub(SubscriptionEntity, 'findAll').resolves([mockEntity] as any);

      const mockSettings = {
        toModel: () => {
          const settings = new SubscriptionSettings();
          settings.gracePeriodDays = gracePeriodDays;
          return settings;
        },
      };
      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockSettings as any);

      await service.suspendExpiredSubscriptions();

      expect(mockEntity.status).toBe('suspended');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('SubscriptionInterface.hasActiveSubscription', () => {
    it('should return true for account with active subscription', async () => {
      const accountId = uuidv4();
      const mockEntity = {
        status: 'active',
      };

      sandbox.stub(SubscriptionEntity, 'findOne').resolves(mockEntity as any);

      const hasActive = await service.hasActiveSubscription(accountId);

      expect(hasActive).toBe(true);
    });

    it('should return false for account without active subscription', async () => {
      const accountId = uuidv4();

      sandbox.stub(SubscriptionEntity, 'findOne').resolves(null);

      const hasActive = await service.hasActiveSubscription(accountId);

      expect(hasActive).toBe(false);
    });
  });
});
