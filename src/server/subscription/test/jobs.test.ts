import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { SubscriptionSettingsEntity } from '@/server/subscription/entity/subscription_settings';
import { AccountEntity } from '@/server/common/entity/account';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import SubscriptionService from '@/server/subscription/service/subscription';
import { checkGracePeriodExpiry } from '@/server/subscription/service/jobs';

describe('Subscription Scheduled Jobs', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: SubscriptionService;
  let clock: sinon.SinonFakeTimers;

  beforeAll(async () => {
    // Sync database schema before running tests
    await db.sync({ force: true });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new SubscriptionService(eventBus);

    // Use fake timers to control date/time
    clock = sandbox.useFakeTimers({
      now: new Date('2026-01-15T12:00:00Z'),
      shouldAdvanceTime: false,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('checkGracePeriodExpiry', () => {
    it('should identify past_due subscriptions past grace period', async () => {
      // Create settings with 7-day grace period
      const settings = SubscriptionSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000, // $10 in millicents
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      });
      await settings.save();

      // Create account
      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'test@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      // Create provider config
      const providerConfig = ProviderConfigEntity.build({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{}',
        webhook_secret: 'test_secret',
      });
      await providerConfig.save();

      // Create subscription that went past_due 8 days ago (beyond grace period)
      const expiredSubscription = SubscriptionEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_expired',
        provider_customer_id: 'cus_expired',
        status: 'past_due',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
      });
      await expiredSubscription.save();

      // Manually update updatedAt to 8 days ago using raw query
      const eightDaysAgo = new Date('2026-01-07T12:00:00Z');
      await db.query(
        'UPDATE subscription SET updatedAt = ? WHERE id = ?',
        {
          replacements: [eightDaysAgo.toISOString(), expiredSubscription.id],
        }
      );

      // Run the job
      await checkGracePeriodExpiry();

      // Reload subscription to check status
      await expiredSubscription.reload();

      // Should be suspended
      expect(expiredSubscription.status).toBe('suspended');
    });

    it('should transition status to suspended', async () => {
      // Create settings
      const settings = SubscriptionSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      });
      await settings.save();

      // Create account
      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'test2@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      // Create provider config
      const providerConfig = ProviderConfigEntity.build({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{}',
        webhook_secret: 'test_secret',
      });
      await providerConfig.save();

      // Create past_due subscription beyond grace period
      const subscription = SubscriptionEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_test',
        provider_customer_id: 'cus_test',
        status: 'past_due',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
      });
      await subscription.save();

      // Manually update updatedAt to 10 days ago
      const tenDaysAgo = new Date('2026-01-05T12:00:00Z');
      await db.query(
        'UPDATE subscription SET updatedAt = ? WHERE id = ?',
        {
          replacements: [tenDaysAgo.toISOString(), subscription.id],
        }
      );

      // Verify initial status
      expect(subscription.status).toBe('past_due');

      // Run the job
      await checkGracePeriodExpiry();

      // Reload and verify transition
      await subscription.reload();
      expect(subscription.status).toBe('suspended');
    });

    it('should set suspended_at timestamp', async () => {
      // Create settings
      const settings = SubscriptionSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      });
      await settings.save();

      // Create account
      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'test3@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      // Create provider config
      const providerConfig = ProviderConfigEntity.build({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{}',
        webhook_secret: 'test_secret',
      });
      await providerConfig.save();

      // Create past_due subscription
      const subscription = SubscriptionEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_timestamp',
        provider_customer_id: 'cus_timestamp',
        status: 'past_due',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
      });
      await subscription.save();

      // Manually update updatedAt to 9 days ago
      const nineDaysAgo = new Date('2026-01-06T12:00:00Z');
      await db.query(
        'UPDATE subscription SET updatedAt = ? WHERE id = ?',
        {
          replacements: [nineDaysAgo.toISOString(), subscription.id],
        }
      );

      // Verify no suspended_at initially
      expect(subscription.suspended_at).toBeNull();

      // Run the job
      await checkGracePeriodExpiry();

      // Reload and verify suspended_at is set
      await subscription.reload();
      expect(subscription.suspended_at).not.toBeNull();
      expect(subscription.suspended_at).toBeInstanceOf(Date);

      // Should be set to current time (within fake timer context)
      const expectedTime = new Date('2026-01-15T12:00:00Z');
      expect(subscription.suspended_at?.getTime()).toBe(expectedTime.getTime());
    });

    it('should not affect subscriptions within grace period', async () => {
      // Create settings with 7-day grace period
      const settings = SubscriptionSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      });
      await settings.save();

      // Create account
      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'test4@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      // Create provider config
      const providerConfig = ProviderConfigEntity.build({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{}',
        webhook_secret: 'test_secret',
      });
      await providerConfig.save();

      // Create subscription that went past_due 5 days ago (within grace period)
      const recentSubscription = SubscriptionEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_recent',
        provider_customer_id: 'cus_recent',
        status: 'past_due',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
      });
      await recentSubscription.save();

      // Manually update updatedAt to 5 days ago
      const fiveDaysAgo = new Date('2026-01-10T12:00:00Z');
      await db.query(
        'UPDATE subscription SET updatedAt = ? WHERE id = ?',
        {
          replacements: [fiveDaysAgo.toISOString(), recentSubscription.id],
        }
      );

      // Create subscription that went past_due 1 day ago (well within grace period)
      const veryRecentSubscription = SubscriptionEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_very_recent',
        provider_customer_id: 'cus_very_recent',
        status: 'past_due',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
      });
      await veryRecentSubscription.save();

      // Manually update updatedAt to 1 day ago
      const oneDayAgo = new Date('2026-01-14T12:00:00Z');
      await db.query(
        'UPDATE subscription SET updatedAt = ? WHERE id = ?',
        {
          replacements: [oneDayAgo.toISOString(), veryRecentSubscription.id],
        }
      );

      // Run the job
      await checkGracePeriodExpiry();

      // Reload both subscriptions
      await recentSubscription.reload();
      await veryRecentSubscription.reload();

      // Both should still be past_due
      expect(recentSubscription.status).toBe('past_due');
      expect(recentSubscription.suspended_at).toBeNull();

      expect(veryRecentSubscription.status).toBe('past_due');
      expect(veryRecentSubscription.suspended_at).toBeNull();
    });
  });
});
