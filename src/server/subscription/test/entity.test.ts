import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { SubscriptionSettingsEntity } from '../entity/subscription_settings';
import { ProviderConfigEntity } from '../entity/provider_config';
import { SubscriptionEntity } from '../entity/subscription';
import { SubscriptionEventEntity } from '../entity/subscription_event';
import { SubscriptionSettings, ProviderConfig, Subscription, SubscriptionEvent } from '@/common/model/subscription';
import { millicentsToDisplay, displayToMillicents } from '@/common/model/subscription';

describe('Subscription Entities', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('SubscriptionSettingsEntity', () => {
    it('should convert entity to model and back', () => {
      const entityData = {
        id: 'test-id',
        enabled: true,
        monthly_price: 1000000, // $10.00 in millicents
        yearly_price: 10000000, // $100.00 in millicents
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      };

      const entity = SubscriptionSettingsEntity.build(entityData);

      const model = entity.toModel();
      expect(model).toBeInstanceOf(SubscriptionSettings);
      expect(model.id).toBe('test-id');
      expect(model.enabled).toBe(true);
      expect(model.monthlyPrice).toBe(1000000);
      expect(model.yearlyPrice).toBe(10000000);
      expect(model.currency).toBe('USD');
      expect(model.payWhatYouCan).toBe(false);
      expect(model.gracePeriodDays).toBe(7);

      const newEntity = SubscriptionSettingsEntity.fromModel(model);
      expect(newEntity.get('id')).toBe('test-id');
      expect(newEntity.get('enabled')).toBe(true);
      expect(newEntity.get('monthly_price')).toBe(1000000);
      expect(newEntity.get('yearly_price')).toBe(10000000);
      expect(newEntity.get('currency')).toBe('USD');
      expect(newEntity.get('pay_what_you_can')).toBe(false);
      expect(newEntity.get('grace_period_days')).toBe(7);
    });
  });

  describe('ProviderConfigEntity', () => {
    it('should encrypt and decrypt credentials', () => {
      const testCredentials = JSON.stringify({
        apiKey: 'sk_test_123456',
        secretKey: 'secret_abc',
      });

      const entityData = {
        id: 'provider-id',
        provider_type: 'stripe' as const,
        enabled: true,
        display_name: 'Credit Card',
        credentials: 'encrypted:credentials', // Simulating encrypted data
        webhook_secret: 'encrypted:webhook', // Simulating encrypted data
      };

      const entity = ProviderConfigEntity.build(entityData);

      // Set up private fields to simulate decryption
      (entity as any)._decryptedCredentials = testCredentials;
      (entity as any)._decryptedWebhookSecret = 'whsec_test';

      const model = entity.toModel();
      expect(model.credentials).toBe(testCredentials);
      expect(model.webhookSecret).toBe('whsec_test');

      const newEntity = ProviderConfigEntity.fromModel(model);
      expect((newEntity as any)._decryptedCredentials).toBe(testCredentials);
      expect((newEntity as any)._decryptedWebhookSecret).toBe('whsec_test');
    });
  });

  describe('SubscriptionEntity', () => {
    it('should validate status transitions', () => {
      const entityData = {
        id: 'sub-id',
        account_id: 'account-id',
        provider_config_id: 'provider-id',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        status: 'active' as const,
        billing_cycle: 'monthly' as const,
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelled_at: null,
        suspended_at: null,
      };

      const entity = SubscriptionEntity.build(entityData);

      // Test model conversion
      const model = entity.toModel();
      expect(model.status).toBe('active');
      expect(model.billingCycle).toBe('monthly');
      expect(model.amount).toBe(1000000);

      // Test fromModel
      const newEntity = SubscriptionEntity.fromModel(model);
      expect(newEntity.get('status')).toBe('active');
      expect(newEntity.get('billing_cycle')).toBe('monthly');
    });
  });

  describe('SubscriptionEventEntity', () => {
    it('should store event payload as JSON', () => {
      const payload = {
        type: 'invoice.paid',
        data: {
          amount: 1000,
          currency: 'usd',
        },
      };

      const entityData = {
        id: 'event-id',
        subscription_id: 'sub-id',
        event_type: 'invoice.paid',
        provider_event_id: 'evt_123',
        payload: JSON.stringify(payload),
        processed_at: new Date(),
      };

      const entity = SubscriptionEventEntity.build(entityData);

      const model = entity.toModel();
      expect(model.eventType).toBe('invoice.paid');
      expect(model.providerEventId).toBe('evt_123');

      const storedPayload = JSON.parse(model.payload);
      expect(storedPayload.type).toBe('invoice.paid');
      expect(storedPayload.data.amount).toBe(1000);
    });
  });

  describe('Millicent Currency Conversion', () => {
    it('should convert millicents to display amount correctly', () => {
      expect(millicentsToDisplay(1000000)).toBe('10.00');
      expect(millicentsToDisplay(500000)).toBe('5.00');
      expect(millicentsToDisplay(1234567)).toBe('12.35'); // Rounds
      expect(millicentsToDisplay(0)).toBe('0.00');
    });

    it('should convert display amount to millicents correctly', () => {
      expect(displayToMillicents('10.00')).toBe(1000000);
      expect(displayToMillicents('5.50')).toBe(550000);
      expect(displayToMillicents('0.01')).toBe(1000);
      expect(displayToMillicents('100')).toBe(10000000);
    });
  });

  describe('Entity Associations', () => {
    it('should establish subscription to account relationship', () => {
      const subscriptionData = {
        id: 'sub-id',
        account_id: 'account-id',
        provider_config_id: 'provider-id',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        status: 'active' as const,
        billing_cycle: 'monthly' as const,
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelled_at: null,
        suspended_at: null,
      };

      const subscription = SubscriptionEntity.build(subscriptionData);

      expect(subscription.account_id).toBe('account-id');
      expect(subscription.provider_config_id).toBe('provider-id');

      // Test toModel includes foreign key relationships
      const model = subscription.toModel();
      expect(model.accountId).toBe('account-id');
      expect(model.providerConfigId).toBe('provider-id');
    });
  });
});
