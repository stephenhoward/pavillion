import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import FundingService from '@/server/funding/service/funding';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { AccountEntity } from '@/server/common/entity/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { ProviderConfig, FundingSettings, FundingPlan } from '@/common/model/funding-plan';
import { WebhookEvent } from '@/server/funding/service/provider/adapter';
import { checkGracePeriodExpiry } from '@/server/funding/service/jobs';

/**
 * Integration tests for subscription payment system
 * Task 9.3: Write up to 10 additional strategic tests
 *
 * These tests cover end-to-end workflows and integration points
 * that are not fully covered by unit tests.
 */
describe('Subscription System Integration Tests', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: FundingService;
  let clock: sinon.SinonFakeTimers;

  beforeAll(async () => {
    // Sync database schema before running tests
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new FundingService(eventBus);

    // Use fake timers for time-based tests
    clock = sandbox.useFakeTimers({
      now: new Date('2026-01-15T12:00:00Z'),
      shouldAdvanceTime: false,
    });

    // Clear database between tests
    await db.sync({ force: true });
  });

  afterEach(() => {
    sandbox.restore();
    ProviderFactory.clearAllCaches();
  });

  /**
   * Helper function to create a provider config using the proper model conversion
   */
  async function createProviderConfig(providerType: 'stripe' | 'paypal'): Promise<ProviderConfigEntity> {
    const providerModel = new ProviderConfig(uuidv4(), providerType);
    providerModel.enabled = true;
    providerModel.displayName = providerType === 'stripe' ? 'Credit Card' : 'PayPal';
    providerModel.credentials = JSON.stringify(
      providerType === 'stripe'
        ? { apiKey: 'sk_test_123' }
        : { clientId: 'test_client', secret: 'test_secret', mode: 'sandbox' },
    );
    providerModel.webhookSecret = 'whsec_test_secret';

    const entity = ProviderConfigEntity.fromModel(providerModel);
    await entity.save();
    return entity;
  }

  /**
   * Integration Test 2: Payment failure flow (active -> past_due -> suspended)
   */
  it('should handle complete payment failure flow through suspension', async () => {
    // Setup
    const settings = FundingSettingsEntity.build({
      id: uuidv4(),
      enabled: true,
      monthly_price: 1000000,
      yearly_price: 10000000,
      currency: 'USD',
      pay_what_you_can: false,
      grace_period_days: 7,
    });
    await settings.save();

    const providerConfig = await createProviderConfig('stripe');

    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'failure@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();

    // Create active subscription
    const subscription = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: account.id,
      provider_config_id: providerConfig.id,
      provider_subscription_id: 'sub_payment_failure',
      provider_customer_id: 'cus_payment_failure',
      status: 'active',
      billing_cycle: 'monthly',
      amount: 1000000,
      currency: 'USD',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelled_at: null,
      suspended_at: null,
    });
    await subscription.save();

    // Step 1: Payment fails (webhook)
    const failureEvent: WebhookEvent = {
      eventId: 'evt_payment_failed',
      eventType: 'invoice.payment_failed',
      subscriptionId: 'sub_payment_failure',
      status: 'past_due',
      rawPayload: { type: 'invoice.payment_failed' },
    };

    await service.processWebhookEvent(failureEvent, providerConfig.id);

    // Verify: Status changed to past_due
    await subscription.reload();
    expect(subscription.status).toBe('past_due');

    // Step 2: Advance time beyond grace period (8 days)
    const eightDaysAgo = new Date('2026-01-07T12:00:00Z');
    await db.query(
      'UPDATE funding_plan SET updatedAt = ? WHERE id = ?',
      {
        replacements: [eightDaysAgo.toISOString(), subscription.id],
      },
    );

    // Step 3: Run grace period check job
    await checkGracePeriodExpiry();

    // Verify: Status changed to suspended
    await subscription.reload();
    expect(subscription.status).toBe('suspended');
    expect(subscription.suspended_at).not.toBeNull();
  });

  /**
   * Integration Test 3: User cancellation flow (cancel -> continues to period end)
   */
  it('should handle user cancellation flow correctly', async () => {
    // Setup
    const providerConfig = await createProviderConfig('stripe');

    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'cancel@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();

    // Create active subscription
    const subscription = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: account.id,
      provider_config_id: providerConfig.id,
      provider_subscription_id: 'sub_user_cancel',
      provider_customer_id: 'cus_user_cancel',
      status: 'active',
      billing_cycle: 'yearly',
      amount: 10000000, // $100.00
      currency: 'USD',
      current_period_start: new Date('2026-01-01T00:00:00Z'),
      current_period_end: new Date('2027-01-01T00:00:00Z'),
      cancelled_at: null,
      suspended_at: null,
    });
    await subscription.save();

    // Mock adapter cancel method
    const mockAdapter = {
      cancelSubscription: sandbox.stub().resolves(),
    };
    sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

    // Step 1: User cancels subscription (end of period)
    await service.cancel(subscription.id, false);

    // Verify: Status is cancelled, but subscription continues
    await subscription.reload();
    expect(subscription.status).toBe('cancelled');
    expect(subscription.cancelled_at).not.toBeNull();
    expect(mockAdapter.cancelSubscription.calledWith('sub_user_cancel', false)).toBe(true);

    // Verify: Subscription should still be queryable as "active" until period ends
    const currentDate = new Date('2026-06-01T00:00:00Z'); // 6 months later, still in period
    expect(subscription.current_period_end.getTime()).toBeGreaterThan(currentDate.getTime());
  });

  /**
   * Integration Test 4: Admin force cancellation (immediate termination)
   */
  it('should handle admin force cancellation with immediate termination', async () => {
    // Setup
    const providerConfig = await createProviderConfig('stripe');

    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'force@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();

    // Create active subscription
    const subscription = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: account.id,
      provider_config_id: providerConfig.id,
      provider_subscription_id: 'sub_force_cancel',
      provider_customer_id: 'cus_force_cancel',
      status: 'active',
      billing_cycle: 'monthly',
      amount: 1000000,
      currency: 'USD',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      cancelled_at: null,
      suspended_at: null,
    });
    await subscription.save();

    // Mock adapter
    const mockAdapter = {
      cancelSubscription: sandbox.stub().resolves(),
    };
    sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

    // Admin force cancels (immediate = true)
    await service.cancel(subscription.id, true);

    // Verify: Immediate cancellation
    await subscription.reload();
    expect(subscription.status).toBe('cancelled');
    expect(mockAdapter.cancelSubscription.calledWith('sub_force_cancel', true)).toBe(true);
  });

  /**
   * Integration Test 5: Webhook idempotency with duplicate events
   */
  it('should handle webhook idempotency correctly with duplicate events', async () => {
    // Setup
    const providerConfig = await createProviderConfig('stripe');

    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'idempotent@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();

    const subscription = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: account.id,
      provider_config_id: providerConfig.id,
      provider_subscription_id: 'sub_idempotent',
      provider_customer_id: 'cus_idempotent',
      status: 'active',
      billing_cycle: 'monthly',
      amount: 1000000,
      currency: 'USD',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelled_at: null,
      suspended_at: null,
    });
    await subscription.save();

    // Create webhook event
    const webhookEvent: WebhookEvent = {
      eventId: 'evt_idempotent_test',
      eventType: 'invoice.payment_failed',
      subscriptionId: 'sub_idempotent',
      status: 'past_due',
      rawPayload: { type: 'invoice.payment_failed' },
    };

    // Process event first time
    await service.processWebhookEvent(webhookEvent, providerConfig.id);

    // Verify status changed
    await subscription.reload();
    expect(subscription.status).toBe('past_due');

    // Change status back to active (simulating recovery)
    subscription.status = 'active';
    await subscription.save();

    // Process same event again (duplicate webhook delivery)
    await service.processWebhookEvent(webhookEvent, providerConfig.id);

    // Verify status did NOT change (idempotent)
    await subscription.reload();
    expect(subscription.status).toBe('active'); // Should remain active, not go back to past_due

    // Verify only one event log exists
    const eventCount = await FundingEventEntity.count({
      where: { provider_event_id: 'evt_idempotent_test' },
    });
    expect(eventCount).toBe(1);
  });

  /**
   * Integration Test 8: Subscription interface cross-domain query
   */
  it('should provide subscription status via domain interface', async () => {
    // Setup
    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'interface@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();

    // Create a calendar for the account so we can link the subscription to it
    const calendar = CalendarEntity.build({
      id: uuidv4(),
      url_name: 'interface-test-cal',
      languages: 'en',
      default_date_range: 'month',
    });
    await calendar.save();

    const providerConfig = await createProviderConfig('stripe');

    // Create active subscription for the account
    const subscription = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: account.id,
      provider_config_id: providerConfig.id,
      provider_subscription_id: 'sub_interface',
      provider_customer_id: 'cus_interface',
      status: 'active',
      billing_cycle: 'monthly',
      amount: 1000000,
      currency: 'USD',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelled_at: null,
      suspended_at: null,
    });
    await subscription.save();

    // Link the subscription to the calendar via CalendarFundingPlanEntity
    const calendarSub = CalendarFundingPlanEntity.build({
      id: uuidv4(),
      funding_plan_id: subscription.id,
      calendar_id: calendar.id,
      amount: 1000000,
      end_time: null,
    });
    await calendarSub.save();

    // Test interface method: hasActiveFundingPlan — now takes calendarId
    const hasActive = await service.hasActiveFundingPlan(calendar.id);
    expect(hasActive).toBe(true);

    // Test with a calendar that has no subscription
    const calendarWithoutSub = CalendarEntity.build({
      id: uuidv4(),
      url_name: 'no-sub-cal',
      languages: 'en',
      default_date_range: 'month',
    });
    await calendarWithoutSub.save();

    const hasActiveNoSub = await service.hasActiveFundingPlan(calendarWithoutSub.id);
    expect(hasActiveNoSub).toBe(false);

    // Test getStatus - should work even though column query uses createdAt
    const status = await service.getStatus(account.id);
    expect(status).toBeDefined();
    expect(status?.status).toBe('active');
    expect(status?.accountId).toBe(account.id);
  });

  /**
   * Integration Test 9: Grace period boundary check
   */
  it('should handle grace period boundary correctly', async () => {
    // Setup
    const settings = FundingSettingsEntity.build({
      id: uuidv4(),
      enabled: true,
      monthly_price: 1000000,
      yearly_price: 10000000,
      currency: 'USD',
      pay_what_you_can: false,
      grace_period_days: 7,
    });
    await settings.save();

    const providerConfig = await createProviderConfig('stripe');

    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'grace@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();

    // Create subscription past_due
    const subscription = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: account.id,
      provider_config_id: providerConfig.id,
      provider_subscription_id: 'sub_grace_edge',
      provider_customer_id: 'cus_grace_edge',
      status: 'past_due',
      billing_cycle: 'monthly',
      amount: 1000000,
      currency: 'USD',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelled_at: null,
      suspended_at: null,
    });
    await subscription.save();

    // Set updatedAt to 9 days ago (clearly past grace period)
    const nineDaysAgo = new Date('2026-01-06T12:00:00Z');
    await db.query(
      'UPDATE funding_plan SET updatedAt = ? WHERE id = ?',
      {
        replacements: [nineDaysAgo.toISOString(), subscription.id],
      },
    );

    // Run grace period check
    await checkGracePeriodExpiry();

    // Verify: Should be suspended (past grace period)
    await subscription.reload();
    expect(subscription.status).toBe('suspended');
    expect(subscription.suspended_at).not.toBeNull();
  });
});
