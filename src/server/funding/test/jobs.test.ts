import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { AccountEntity } from '@/server/common/entity/account';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import FundingService from '@/server/funding/service/funding';
import { checkGracePeriodExpiry } from '@/server/funding/service/jobs';

describe('Funding Plan Scheduled Jobs', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let _service: FundingService;
  let _clock: sinon.SinonFakeTimers;

  beforeAll(async () => {
    // Sync database schema before running tests
    await db.sync({ force: true });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    _service = new FundingService(eventBus);

    // Use fake timers to control date/time
    _clock = sandbox.useFakeTimers({
      now: new Date('2026-01-15T12:00:00Z'),
      shouldAdvanceTime: false,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('checkGracePeriodExpiry', () => {
    it('should identify past_due funding plans past grace period', async () => {
      // Create settings with 7-day grace period
      const settings = FundingSettingsEntity.build({
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

      // Create funding plan that went past_due 8 days ago (beyond grace period)
      const expiredPlan = FundingPlanEntity.build({
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
      await expiredPlan.save();

      // Manually update updatedAt to 8 days ago using raw query
      const eightDaysAgo = new Date('2026-01-07T12:00:00Z');
      await db.query(
        'UPDATE funding_plan SET updatedAt = ? WHERE id = ?',
        {
          replacements: [eightDaysAgo.toISOString(), expiredPlan.id],
        },
      );

      // Run the job
      await checkGracePeriodExpiry();

      // Reload funding plan to check status
      await expiredPlan.reload();

      // Should be suspended
      expect(expiredPlan.status).toBe('suspended');
    });

    it('should transition status to suspended', async () => {
      // Create settings
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

      // Create past_due funding plan beyond grace period
      const plan = FundingPlanEntity.build({
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
      await plan.save();

      // Manually update updatedAt to 10 days ago
      const tenDaysAgo = new Date('2026-01-05T12:00:00Z');
      await db.query(
        'UPDATE funding_plan SET updatedAt = ? WHERE id = ?',
        {
          replacements: [tenDaysAgo.toISOString(), plan.id],
        },
      );

      // Verify initial status
      expect(plan.status).toBe('past_due');

      // Run the job
      await checkGracePeriodExpiry();

      // Reload and verify transition
      await plan.reload();
      expect(plan.status).toBe('suspended');
    });

    it('should set suspended_at timestamp', async () => {
      // Create settings
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

      // Create past_due funding plan
      const plan = FundingPlanEntity.build({
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
      await plan.save();

      // Manually update updatedAt to 9 days ago
      const nineDaysAgo = new Date('2026-01-06T12:00:00Z');
      await db.query(
        'UPDATE funding_plan SET updatedAt = ? WHERE id = ?',
        {
          replacements: [nineDaysAgo.toISOString(), plan.id],
        },
      );

      // Verify no suspended_at initially
      expect(plan.suspended_at).toBeNull();

      // Run the job
      await checkGracePeriodExpiry();

      // Reload and verify suspended_at is set
      await plan.reload();
      expect(plan.suspended_at).not.toBeNull();
      expect(plan.suspended_at).toBeInstanceOf(Date);

      // Should be set to current time (within fake timer context)
      const expectedTime = new Date('2026-01-15T12:00:00Z');
      expect(plan.suspended_at?.getTime()).toBe(expectedTime.getTime());
    });

    it('should not affect funding plans within grace period', async () => {
      // Create settings with 7-day grace period
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

      // Create funding plan that went past_due 5 days ago (within grace period)
      const recentPlan = FundingPlanEntity.build({
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
      await recentPlan.save();

      // Manually update updatedAt to 5 days ago
      const fiveDaysAgo = new Date('2026-01-10T12:00:00Z');
      await db.query(
        'UPDATE funding_plan SET updatedAt = ? WHERE id = ?',
        {
          replacements: [fiveDaysAgo.toISOString(), recentPlan.id],
        },
      );

      // Create funding plan that went past_due 1 day ago (well within grace period)
      const veryRecentPlan = FundingPlanEntity.build({
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
      await veryRecentPlan.save();

      // Manually update updatedAt to 1 day ago
      const oneDayAgo = new Date('2026-01-14T12:00:00Z');
      await db.query(
        'UPDATE funding_plan SET updatedAt = ? WHERE id = ?',
        {
          replacements: [oneDayAgo.toISOString(), veryRecentPlan.id],
        },
      );

      // Run the job
      await checkGracePeriodExpiry();

      // Reload both funding plans
      await recentPlan.reload();
      await veryRecentPlan.reload();

      // Both should still be past_due
      expect(recentPlan.status).toBe('past_due');
      expect(recentPlan.suspended_at).toBeNull();

      expect(veryRecentPlan.status).toBe('past_due');
      expect(veryRecentPlan.suspended_at).toBeNull();
    });
  });

  /*
   * The scan is an unlocked snapshot. These hand the job a scan result that
   * has gone stale and let the real database answer the locked re-read.
   */
  describe('suspendExpiredFundingPlans with a stale scan', () => {
    /**
     * Seed a plan in its current state and return a copy of it as the scan saw
     * it: past due since well before the cutoff.
     *
     * @param status - The plan's status by the time the row is locked
     * @param updatedAt - When the plan was last written, by then
     */
    async function seedStaleCandidate(status: 'past_due' | 'suspended' | 'active', updatedAt: Date) {
      await FundingSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      }).save();

      const account = AccountEntity.build({
        id: uuidv4(),
        email: `stale-${uuidv4()}@example.com`,
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      const providerConfig = ProviderConfigEntity.build({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{}',
        webhook_secret: 'test_secret',
      });
      await providerConfig.save();

      const plan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: `sub_${uuidv4()}`,
        provider_customer_id: 'cus_stale',
        status,
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
      });
      await plan.save();
      await db.query('UPDATE funding_plan SET updatedAt = ? WHERE id = ?', {
        replacements: [updatedAt.toISOString(), plan.id],
      });

      // Only the scan is replaced. Sequelize's findOne is built on findAll, so
      // the locked re-read (the one query naming an id) goes to the database.
      const realFindAll = FundingPlanEntity.findAll.bind(FundingPlanEntity);
      sandbox.stub(FundingPlanEntity, 'findAll').callsFake(((options: any) =>
        (options?.where?.id
          ? realFindAll(options)
          : Promise.resolve([{ id: plan.id, status: 'past_due' }]))) as any);
      const emitted = sandbox.spy();
      eventBus.on('funding:plan:suspended', emitted);

      return { plan, emitted };
    }

    it('should not suspend, or announce, a plan a webhook already suspended', async () => {
      const { plan, emitted } = await seedStaleCandidate('suspended', new Date('2026-01-05T12:00:00Z'));

      await _service.suspendExpiredFundingPlans();
      await _clock.runAllAsync();

      await plan.reload();
      expect(plan.suspended_at).toBeNull();
      expect(emitted.called).toBe(false);
    });

    it('should not suspend a plan whose grace period restarted after the scan', async () => {
      // Past due again when the row is locked, but only since yesterday: it
      // recovered and failed once more between scan and lock.
      const { plan, emitted } = await seedStaleCandidate('past_due', new Date('2026-01-14T12:00:00Z'));

      await _service.suspendExpiredFundingPlans();
      await _clock.runAllAsync();

      await plan.reload();
      expect(plan.status).toBe('past_due');
      expect(emitted.called).toBe(false);
    });

    it('should suspend, and announce once, a plan the scan read correctly', async () => {
      const { plan, emitted } = await seedStaleCandidate('past_due', new Date('2026-01-05T12:00:00Z'));

      await _service.suspendExpiredFundingPlans();
      await _clock.runAllAsync();

      await plan.reload();
      expect(plan.status).toBe('suspended');
      expect(emitted.callCount).toBe(1);
    });
  });

  /*
   * The provider keeps a subscription past_due while it retries, long after
   * the job has suspended the plan locally. Its reports must not hand the plan
   * back to the job for a second suspension.
   */
  describe('suspendExpiredFundingPlans after the provider reports past due again', () => {
    it('should not suspend, or announce, a plan a second time', async () => {
      await FundingSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      }).save();

      const account = AccountEntity.build({
        id: uuidv4(),
        email: `resuspend-${uuidv4()}@example.com`,
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      const providerConfig = ProviderConfigEntity.build({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{}',
        webhook_secret: 'test_secret',
      });
      await providerConfig.save();

      const subscriptionId = `sub_${uuidv4()}`;
      const plan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: subscriptionId,
        provider_customer_id: 'cus_resuspend',
        status: 'suspended',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: new Date('2026-01-10T12:00:00Z'),
      });
      await plan.save();

      const emitted = sandbox.spy();
      eventBus.on('funding:plan:suspended', emitted);

      await _service.processWebhookEvent({
        eventId: `evt_${uuidv4()}`,
        eventType: 'invoice.payment_failed',
        subscriptionId,
        status: 'past_due',
        rawPayload: {},
      }, providerConfig.id);
      await db.query('UPDATE funding_plan SET updatedAt = ? WHERE id = ?', {
        replacements: [new Date('2026-01-05T12:00:00Z').toISOString(), plan.id],
      });

      await _service.suspendExpiredFundingPlans();
      await _clock.runAllAsync();

      await plan.reload();
      expect(plan.status).toBe('suspended');
      expect(plan.suspended_at).toEqual(new Date('2026-01-10T12:00:00Z'));
      expect(emitted.called).toBe(false);
    });
  });
});
