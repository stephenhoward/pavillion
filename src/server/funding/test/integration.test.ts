import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import FundingService from '@/server/funding/service/funding';
import { ProviderConnectionService } from '@/server/funding/service/provider_connection';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { AccountEntity } from '@/server/common/entity/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { ProviderConfig } from '@/common/model/funding-plan';
import { WebhookEvent } from '@/server/funding/service/provider/adapter';
import { checkGracePeriodExpiry } from '@/server/funding/service/jobs';
import FundingEventHandlers from '@/server/funding/events';
import { Account } from '@/common/model/account';
import type AccountsInterface from '@/server/accounts/interface';
import type EmailInterface from '@/server/email/interface';
import { MailData } from '@/server/common/email/types';
import { initI18Next } from '@/server/common/test/lib/i18next';
import { backdatePastDue } from '@/server/funding/test/fixtures/past-due';
import {
  ActiveFundingPlanExistsError,
  DuplicateCalendarFundingPlanError,
  FundingPlanNotResumableError,
} from '@/common/exceptions/funding';

initI18Next();

/**
 * Integration tests for funding plan payment system
 * Task 9.3: Write up to 10 additional strategic tests
 *
 * These tests cover end-to-end workflows and integration points
 * that are not fully covered by unit tests.
 */
describe('Funding Plan System Integration Tests', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: FundingService;
  let _clock: sinon.SinonFakeTimers;

  beforeAll(async () => {
    // Sync database schema before running tests
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new FundingService(eventBus);

    // Use fake timers for time-based tests
    _clock = sandbox.useFakeTimers({
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
   * Install the real funding event handlers on the suite's bus, with a stub
   * mail transport and an accounts lookup that knows only the plan owner.
   *
   * Each call installs another full set of handlers on the same bus, so call
   * it once per test: a second call would send every email twice.
   *
   * @param account - The plan-owning account
   * @returns The emails the handlers send, in order
   */
  function captureDunningEmails(account: AccountEntity): MailData[] {
    const sentEmails: MailData[] = [];
    const handlers = new FundingEventHandlers({
      sendEmail: async (data: MailData) => { sentEmails.push(data); return null; },
    } as unknown as EmailInterface);
    handlers.setAccountsInterface({
      getAccountById: async (id: string) =>
        (id === account.id ? new Account(account.id, 'owner', account.email) : undefined),
    } as unknown as AccountsInterface);
    handlers.install(eventBus);
    return sentEmails;
  }

  /**
   * Lifecycle emits are deferred past commit with setImmediate, which this
   * suite's fake clock holds; run every queued timer (and the handler
   * microtasks between them) before counting.
   */
  const settleEmits = () => _clock.runAllAsync();

  /**
   * A failed payment through suspension and back, as Stripe actually drives
   * it: the provider keeps the subscription past_due and keeps retrying long
   * after Pavillion's grace period has suspended the plan locally.
   */
  describe('dunning: past-due grace and held suspension', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const graceExpired = new Date('2026-01-07T12:00:00Z');

    /**
     * An instance with a 7-day grace period and one account whose active
     * monthly plan covers one calendar.
     */
    async function seedDunningPlan() {
      await FundingSettingsEntity.build({
        id: uuidv4(),
        enabled: true,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      }).save();

      const providerConfig = await createProviderConfig('stripe');
      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'dunning@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      const plan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_dunning',
        provider_customer_id: 'cus_dunning',
        status: 'active',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
      });
      await plan.save();

      const calendar = CalendarEntity.build({
        id: uuidv4(),
        url_name: `dunning-cal-${uuidv4().slice(0, 8)}`,
        languages: 'en',
        default_date_range: 'month',
      });
      await calendar.save();

      await CalendarFundingPlanEntity.build({
        id: uuidv4(),
        funding_plan_id: plan.id,
        calendar_id: calendar.id,
        amount: 1000000,
        end_time: null,
      }).save();

      return { account, plan, providerConfig, calendar };
    }

    const providerReport = (
      eventId: string,
      eventType: string,
      status: 'active' | 'past_due',
      extra: Partial<WebhookEvent> = {},
    ): WebhookEvent => ({
      eventId,
      eventType,
      subscriptionId: 'sub_dunning',
      status,
      rawPayload: {},
      ...extra,
    });

    it('should stamp the failure instant on the plan and clear it once the provider reports it paid', async () => {
      const { plan, providerConfig } = await seedDunningPlan();

      await service.processWebhookEvent(
        providerReport('evt_failed', 'invoice.payment_failed', 'past_due'), providerConfig.id);
      await plan.reload();
      expect(plan.past_due_since).toEqual(new Date('2026-01-15T12:00:00Z'));

      await service.processWebhookEvent(
        providerReport('evt_paid', 'invoice.payment_succeeded', 'active'), providerConfig.id);
      await plan.reload();
      expect(plan.status).toBe('active');
      expect(plan.past_due_since).toBeNull();
    });

    it('should email once for the failure and once for the suspension over a full retry cycle', async () => {
      const { account, plan, providerConfig } = await seedDunningPlan();
      const sentEmails = captureDunningEmails(account);

      await service.processWebhookEvent(
        providerReport('evt_first_failure', 'invoice.payment_failed', 'past_due'), providerConfig.id);

      await backdatePastDue(plan.id, graceExpired);
      await service.suspendExpiredFundingPlans();
      await plan.reload();
      expect(plan.status).toBe('suspended');
      const suspendedAt = plan.suspended_at;

      // Stripe keeps retrying the invoice and keeps calling the subscription
      // past due. Each report must leave the local suspension in place.
      await service.processWebhookEvent(
        providerReport('evt_retry_failed', 'invoice.payment_failed', 'past_due'), providerConfig.id);
      await service.processWebhookEvent(
        providerReport('evt_still_past_due', 'customer.subscription.updated', 'past_due'), providerConfig.id);
      await plan.reload();
      expect(plan.status).toBe('suspended');
      expect(plan.suspended_at).toEqual(suspendedAt);

      // A grace period later the job finds nothing past due to suspend again.
      _clock.tick(8 * DAY);
      await service.suspendExpiredFundingPlans();

      await settleEmits();
      expect(sentEmails.map((email) => email.subject)).toEqual([
        'A payment for your funding plan didn\'t go through',
        'Your funding plan has been suspended',
      ]);
      expect((await service.getStatus(account.id))?.status).toBe('suspended');
    });

    it('should reactivate a suspended plan when the provider reports it paid, without emailing', async () => {
      const { account, plan, providerConfig } = await seedDunningPlan();
      await service.processWebhookEvent(
        providerReport('evt_failure', 'invoice.payment_failed', 'past_due'), providerConfig.id);
      await backdatePastDue(plan.id, graceExpired);
      await service.suspendExpiredFundingPlans();
      await settleEmits();

      const sentEmails = captureDunningEmails(account);
      const reactivated = sandbox.spy();
      eventBus.on('funding:plan:reactivated', reactivated);

      await service.processWebhookEvent(
        providerReport('evt_recovered', 'invoice.payment_succeeded', 'active'), providerConfig.id);
      await settleEmits();

      await plan.reload();
      expect(plan.status).toBe('active');
      expect(plan.suspended_at).toBeNull();
      expect(reactivated.callCount).toBe(1);
      expect(sentEmails).toHaveLength(0);
    });

    /**
     * Every write below lands on a plan that is past due and never pays. None
     * of them may move the end of its grace period: if one did, a holder could
     * repeat it once per grace period and keep paid features until the
     * provider gave up.
     */
    describe('grace measured from the failure, not the last write', () => {
      const writesToAPastDuePlan: Array<[string, (planId: string, providerConfigId: string) => Promise<void>]> = [
        ['a cancel followed by a resume', async (planId) => {
          sandbox.stub(ProviderFactory, 'getAdapter').returns({
            cancelSubscription: sandbox.stub().resolves(),
            resumeSubscription: sandbox.stub().resolves(),
          } as any);
          await service.cancel(planId, false);
          await service.resume(planId);
        }],
        ['a provider report that only schedules a cancellation', async (_planId, providerConfigId) => {
          await service.processWebhookEvent(providerReport(
            'evt_schedule_only', 'customer.subscription.updated', 'past_due',
            { cancelAt: new Date('2026-02-01T00:00:00Z') },
          ), providerConfigId);
        }],
        ['a provider report that only moves the billing period', async (_planId, providerConfigId) => {
          await service.processWebhookEvent(providerReport(
            'evt_period_only', 'customer.subscription.updated', 'past_due',
            {
              currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
              currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
            },
          ), providerConfigId);
        }],
      ];

      it.each(writesToAPastDuePlan)('should not restart the grace period on %s', async (_label, write) => {
        const { plan, providerConfig, calendar } = await seedDunningPlan();
        await service.processWebhookEvent(
          providerReport('evt_failed', 'invoice.payment_failed', 'past_due'), providerConfig.id);

        // Six days into a seven-day grace: still covered.
        _clock.tick(6 * DAY);
        expect(await service.checkFundingAccess(calendar.id, 'widget_embedding')).toBe(true);

        await write(plan.id, providerConfig.id);
        await plan.reload();
        expect(plan.status).toBe('past_due');
        expect(plan.past_due_since).toEqual(new Date('2026-01-15T12:00:00Z'));

        // Eight days after the failure: covered by neither the gate nor the job.
        _clock.tick(2 * DAY);
        expect(await service.checkFundingAccess(calendar.id, 'widget_embedding')).toBe(false);

        await service.suspendExpiredFundingPlans();
        await plan.reload();
        expect(plan.status).toBe('suspended');
      });
    });
  });

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

    // Create active funding plan
    const plan = FundingPlanEntity.build({
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
    await plan.save();

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
    await plan.reload();
    expect(plan.status).toBe('past_due');

    // Step 2: Advance time beyond grace period (8 days)
    await backdatePastDue(plan.id, new Date('2026-01-07T12:00:00Z'));

    // Step 3: Run grace period check job
    await checkGracePeriodExpiry();

    // Verify: Status changed to suspended
    await plan.reload();
    expect(plan.status).toBe('suspended');
    expect(plan.suspended_at).not.toBeNull();
  });

  /**
   * Integration Test 3: User cancellation flow (cancel -> continues to period end)
   */
  describe('user cancellation at period end', () => {
    const periodEnd = new Date('2027-01-01T00:00:00Z');

    /**
     * Seed an account with one active yearly plan covering one calendar, and
     * stub the provider so cancellation and checkout can be driven.
     *
     * @returns The account, its plan, the calendar allocation, and the adapter
     */
    async function seedCoveredAccount() {
      const providerConfig = await createProviderConfig('stripe');

      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'cancel@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      const plan = FundingPlanEntity.build({
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
        current_period_end: periodEnd,
        cancelled_at: null,
        cancel_at: null,
        suspended_at: null,
      });
      await plan.save();

      const allocation = CalendarFundingPlanEntity.build({
        id: uuidv4(),
        funding_plan_id: plan.id,
        calendar_id: uuidv4(),
        amount: 10000000,
        end_time: null,
      });
      await allocation.save();

      const mockAdapter = {
        cancelSubscription: sandbox.stub().resolves(),
        createCheckoutSession: sandbox.stub().resolves({
          clientSecret: 'cs_secret_abc',
          sessionId: 'cs_test_abc123',
        }),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      return { account, plan, allocation, providerConfig, mockAdapter };
    }

    it('should keep the plan active through the period it was paid for', async () => {
      const { plan, mockAdapter } = await seedCoveredAccount();

      await service.cancel(plan.id, false);

      await plan.reload();
      expect(mockAdapter.cancelSubscription.calledWith('sub_user_cancel', false)).toBe(true);
      // The customer paid through 2027-01-01 and it is currently 2026-01-15.
      // Marking the plan 'cancelled' here would revoke a year of paid
      // entitlement.
      expect(plan.status).toBe('active');
      expect(plan.cancel_at).toEqual(periodEnd);
      expect(plan.cancelled_at).toBeNull();
    });

    /** Stripe's echo of a period-end cancellation: still active, cancel_at set. */
    const scheduledCancellation = (eventId: string): WebhookEvent => ({
      eventId,
      eventType: 'customer.subscription.updated',
      subscriptionId: 'sub_user_cancel',
      status: 'active',
      cancelAt: periodEnd,
      rawPayload: {},
    });

    /** Stripe's report that the subscription has ended. */
    const subscriptionDeleted = (eventId: string): WebhookEvent => ({
      eventId,
      eventType: 'customer.subscription.deleted',
      subscriptionId: 'sub_user_cancel',
      status: 'cancelled',
      cancelAt: null,
      rawPayload: {},
    });

    it('should announce, and email, a repeated period-end cancel only once', async () => {
      const { account, plan, mockAdapter } = await seedCoveredAccount();
      const sentEmails = captureDunningEmails(account);
      const emitted = sandbox.spy();
      eventBus.on('funding:plan:cancelled', emitted);

      // A double click on the cancel button.
      await service.cancel(plan.id, false);
      await service.cancel(plan.id, false);

      await settleEmits();
      expect(emitted.callCount).toBe(1);
      expect(sentEmails).toHaveLength(1);
      expect(mockAdapter.cancelSubscription.callCount).toBe(1);
    });

    it('should email the owner once when the cancellation is scheduled from the billing portal', async () => {
      const { account, providerConfig } = await seedCoveredAccount();
      const sentEmails = captureDunningEmails(account);

      await service.processWebhookEvent(scheduledCancellation('evt_portal_cancel'), providerConfig.id);

      await settleEmits();
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].emailAddress).toBe('cancel@example.com');
      expect(sentEmails[0].textMessage).toContain('until the end of the current billing period');
    });

    it('should email the owner once when the provider ends a subscription nobody cancelled', async () => {
      // Stripe ending the subscription after its payment retries run out, or
      // an operator deleting it from the Stripe dashboard.
      const { account, providerConfig } = await seedCoveredAccount();
      const sentEmails = captureDunningEmails(account);

      await service.processWebhookEvent(subscriptionDeleted('evt_provider_deleted'), providerConfig.id);

      await settleEmits();
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].textMessage).toContain('Calendars it covered no longer have access');
    });

    it('should email once for an in-app cancel, whatever the provider echoes afterwards', async () => {
      const { account, plan, providerConfig } = await seedCoveredAccount();
      const sentEmails = captureDunningEmails(account);

      await service.cancel(plan.id, false);
      await service.processWebhookEvent(scheduledCancellation('evt_echo_updated'), providerConfig.id);
      await service.processWebhookEvent(subscriptionDeleted('evt_echo_deleted'), providerConfig.id);

      await settleEmits();
      expect(sentEmails).toHaveLength(1);
    });

    it('should not email again when a provider cancellation is replayed', async () => {
      const { account, providerConfig } = await seedCoveredAccount();
      const sentEmails = captureDunningEmails(account);

      await service.processWebhookEvent(scheduledCancellation('evt_portal_cancel'), providerConfig.id);
      // The same delivery retried, then a later event that still carries the
      // schedule (Stripe sends one on every subscription change).
      await service.processWebhookEvent(scheduledCancellation('evt_portal_cancel'), providerConfig.id);
      await service.processWebhookEvent(scheduledCancellation('evt_portal_cancel_later'), providerConfig.id);
      await service.processWebhookEvent(subscriptionDeleted('evt_portal_deleted'), providerConfig.id);
      await service.processWebhookEvent(subscriptionDeleted('evt_portal_deleted'), providerConfig.id);

      await settleEmits();
      expect(sentEmails).toHaveLength(1);
    });

    it('should finalize the plan and close its allocations when the deletion event arrives', async () => {
      const { plan, allocation, providerConfig } = await seedCoveredAccount();
      await service.cancel(plan.id, false);

      await service.processWebhookEvent({
        eventId: 'evt_integration_deleted',
        eventType: 'customer.subscription.deleted',
        subscriptionId: 'sub_user_cancel',
        status: 'cancelled',
        cancelAt: null,
        rawPayload: {},
      }, providerConfig.id);

      await plan.reload();
      await allocation.reload();
      expect(plan.status).toBe('cancelled');
      expect(plan.cancelled_at).not.toBeNull();
      // Dated from the boundary the customer paid through, so the coverage
      // record says what they bought rather than when Stripe told us.
      expect(allocation.end_time).toEqual(periodEnd);
    });

    it('should survive the provider reporting the cancelled subscription as active', async () => {
      // The real sequence that broke this: Stripe reports a period-end
      // cancellation as status "active", so the very next webhook after
      // cancel() carried 'active' and used to overwrite the cancellation.
      const { plan, providerConfig } = await seedCoveredAccount();
      await service.cancel(plan.id, false);

      await service.processWebhookEvent({
        eventId: 'evt_integration_updated_active',
        eventType: 'customer.subscription.updated',
        subscriptionId: 'sub_user_cancel',
        status: 'active',
        cancelAt: periodEnd,
        rawPayload: {},
      }, providerConfig.id);

      await plan.reload();
      expect(plan.status).toBe('active');
      expect(plan.cancel_at).toEqual(periodEnd);
    });

    it('should still count as the account\'s one plan while it winds down', async () => {
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

      const { account, plan } = await seedCoveredAccount();
      await service.cancel(plan.id, false);

      // One account, one plan. A cancellation scheduled for the period end does
      // not free the account to buy a second one — the customer is still on
      // this plan and still covered by it. Resuming before the boundary is a
      // reversal of the pending cancellation on this plan (pv-jdot.3.3), never
      // a second subscription, so this stays a real 409 rather than becoming
      // the loophole that lets two plans bill one account.
      await expect(
        service.createCheckoutSession(account.id, 'monthly', 'https://pavillion.dev/return'),
      ).rejects.toThrow(ActiveFundingPlanExistsError);
    });

    it('should survive an incomplete status arriving before the payment confirms', async () => {
      // The SCA race: the session-return path creates the plan as soon as the
      // checkout session reads `complete`, which can precede the subscription
      // leaving `incomplete`. If `incomplete` reached the terminal 'cancelled'
      // status, that first webhook would kill a plan the customer is in the
      // middle of paying for — allocations closed, calendars uncovered, and
      // the terminal guard refusing every later event that would revive it.
      const { plan, allocation, providerConfig } = await seedCoveredAccount();

      await service.processWebhookEvent({
        eventId: 'evt_incomplete',
        eventType: 'customer.subscription.updated',
        subscriptionId: 'sub_user_cancel',
        status: 'past_due',
        rawPayload: {},
      }, providerConfig.id);

      await plan.reload();
      expect(plan.status).toBe('past_due');

      await service.processWebhookEvent({
        eventId: 'evt_payment_confirmed',
        eventType: 'customer.subscription.updated',
        subscriptionId: 'sub_user_cancel',
        status: 'active',
        rawPayload: {},
      }, providerConfig.id);

      await plan.reload();
      await allocation.reload();
      expect(plan.status).toBe('active');
      expect(allocation.end_time).toBeNull();
    });

    it('should leave an already-written end_time alone when the deletion event is redelivered', async () => {
      // Finalization is keyed on the plan being cancelled rather than on the
      // transition into it, so a redelivery genuinely does run the close again.
      // What makes that safe is the `end_time IS NULL` filter, and only the
      // real database can demonstrate that filter working — a stubbed update
      // call can be inspected for a filter that does nothing.
      const { plan, allocation, providerConfig } = await seedCoveredAccount();
      await service.cancel(plan.id, false);

      const deletion = {
        eventType: 'customer.subscription.deleted',
        subscriptionId: 'sub_user_cancel',
        status: 'cancelled' as const,
        cancelAt: null,
        rawPayload: {},
      };

      await service.processWebhookEvent({ ...deletion, eventId: 'evt_first_delivery' }, providerConfig.id);
      await allocation.reload();
      const firstEndTime = allocation.end_time;
      expect(firstEndTime).toEqual(periodEnd);

      // A distinct event id, because Stripe redelivers a *retry* under the same
      // id (which the dedupe check short-circuits) but also sends further
      // events for the same subscription. This is the case dedupe does not
      // catch.
      await service.processWebhookEvent({ ...deletion, eventId: 'evt_second_delivery' }, providerConfig.id);

      await allocation.reload();
      expect(allocation.end_time).toEqual(firstEndTime);
    });

    it('should close the calendar allocations when the plan is cancelled immediately', async () => {
      // An immediate cancellation is the end of the road locally: the plan is
      // already 'cancelled' when the provider's deletion event arrives, so that
      // event finds no transition to finalize. If this path did not close its
      // own allocations, they would stay open forever — denying nothing, but
      // colliding with the one-open-allocation-per-calendar index the next time
      // the same calendar was bought.
      const { plan, allocation } = await seedCoveredAccount();

      await service.cancel(plan.id, true);

      await plan.reload();
      await allocation.reload();
      expect(plan.status).toBe('cancelled');
      expect(allocation.end_time).not.toBeNull();
    });

    /**
     * Drive a period-end cancellation all the way to the provider's deletion
     * event, leaving the plan finalized as 'cancelled'.
     */
    async function finalizeCancellation(providerConfigId: string) {
      await service.processWebhookEvent({
        eventId: 'evt_integration_finalize',
        eventType: 'customer.subscription.deleted',
        subscriptionId: 'sub_user_cancel',
        status: 'cancelled',
        cancelAt: null,
        rawPayload: {},
      }, providerConfigId);
    }

    describe('resuming before the boundary', () => {
      it('should reverse the pending cancellation on the plan the account already holds', async () => {
        const { account, plan, allocation, mockAdapter } = await seedCoveredAccount();
        const resumeSubscription = sandbox.stub().resolves();
        Object.assign(mockAdapter, { resumeSubscription });
        await service.cancel(plan.id, false);

        await service.resume(plan.id);

        await plan.reload();
        await allocation.reload();
        expect(resumeSubscription.calledOnce).toBe(true);
        expect(resumeSubscription.firstCall.args[0]).toBe('sub_user_cancel');
        // A fresh nonce per attempt, scoped to this operation and this plan, so
        // a replay de-duplicates at the provider without colliding with a cancel.
        expect(resumeSubscription.firstCall.args[1].idempotencyKey)
          .toMatch(new RegExp(`^pavillion:plan-resume:${plan.id}:[0-9a-f-]{36}$`));
        expect(plan.status).toBe('active');
        expect(plan.cancel_at).toBeNull();
        expect(allocation.end_time).toBeNull();
        // One account, one plan: resuming is never a second subscription.
        expect(await FundingPlanEntity.count({ where: { account_id: account.id } })).toBe(1);
      });

      it('should refuse to resume a plan that has already ended', async () => {
        const { plan, providerConfig, mockAdapter } = await seedCoveredAccount();
        const resumeSubscription = sandbox.stub().resolves();
        Object.assign(mockAdapter, { resumeSubscription });
        await service.cancel(plan.id, false);
        await finalizeCancellation(providerConfig.id);

        // The provider has deleted the subscription; there is nothing left to
        // un-cancel. A fresh checkout is the way back.
        await expect(service.resume(plan.id)).rejects.toThrow(FundingPlanNotResumableError);
        expect(resumeSubscription.called).toBe(false);
      });

      it('should refuse to resume once the cancellation boundary has passed', async () => {
        const { plan, mockAdapter } = await seedCoveredAccount();
        const resumeSubscription = sandbox.stub().resolves();
        Object.assign(mockAdapter, { resumeSubscription });
        plan.cancel_at = new Date('2026-01-10T00:00:00Z');
        await plan.save();

        // Still 'active' only because the deletion event has not arrived; the
        // provider has already ended the subscription it would be asked to keep.
        await expect(service.resume(plan.id)).rejects.toThrow(FundingPlanNotResumableError);
        expect(resumeSubscription.called).toBe(false);
      });

      it('should refuse to resume a plan whose last calendar has been removed', async () => {
        // Removing the last calendar closes its allocation at the period end
        // and cancels the plan at the same boundary. Resuming would have the
        // provider renew a subscription that covers nothing.
        const { plan, allocation, mockAdapter } = await seedCoveredAccount();
        const resumeSubscription = sandbox.stub().resolves();
        Object.assign(mockAdapter, { resumeSubscription });
        await service.cancel(plan.id, false);
        allocation.end_time = periodEnd;
        await allocation.save();

        await expect(service.resume(plan.id)).rejects.toThrow(FundingPlanNotResumableError);

        await plan.reload();
        expect(resumeSubscription.called).toBe(false);
        expect(plan.cancel_at).toEqual(periodEnd);
      });

      it('should refuse to resume a plan with no pending cancellation', async () => {
        const { plan, mockAdapter } = await seedCoveredAccount();
        const resumeSubscription = sandbox.stub().resolves();
        Object.assign(mockAdapter, { resumeSubscription });

        await expect(service.resume(plan.id)).rejects.toThrow(FundingPlanNotResumableError);
        expect(resumeSubscription.called).toBe(false);
      });

      it('should leave the cancellation in place when the provider refuses to resume', async () => {
        const { plan, mockAdapter } = await seedCoveredAccount();
        Object.assign(mockAdapter, { resumeSubscription: sandbox.stub().rejects(new Error('stripe down')) });
        await service.cancel(plan.id, false);

        await expect(service.resume(plan.id)).rejects.toThrow('stripe down');

        await plan.reload();
        expect(plan.cancel_at).toEqual(periodEnd);
      });
    });

    it('should let an account whose only plan has ended start a fresh checkout', async () => {
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

      const { account, plan, allocation, providerConfig, mockAdapter } = await seedCoveredAccount();
      await service.cancel(plan.id, false);
      await finalizeCancellation(providerConfig.id);
      service.setCalendarInterface({
        isCalendarOwnerById: sandbox.stub().resolves(true),
      } as any);

      // The checkout gate counts only an 'active' plan, so a finalized one is
      // history rather than the account's one plan.
      const session = await service.createCheckoutSession(
        account.id,
        'monthly',
        'https://pavillion.dev/return',
        undefined,
        [allocation.calendar_id],
      );

      expect(session.sessionId).toBe('cs_test_abc123');
      expect(mockAdapter.createCheckoutSession.calledOnce).toBe(true);
    });
  });

  /**
   * Which plan GET /v1/status reports when an account has held more than one.
   * An account accumulates rows over time — a finalized plan stays behind as
   * history when a fresh checkout creates the next — so newest-first alone
   * would let a plan that has ended hide the one the account is paying for.
   */
  /**
   * Disconnecting a provider removes its billing portal, which is the only way
   * a suspended plan can be reactivated. Both disconnect paths therefore count
   * every plan that has not ended, not just active and past_due ones.
   */
  describe('provider disconnect guards', () => {
    async function seedProviderWithPlan(status: 'suspended' | 'cancelled') {
      const providerConfig = await createProviderConfig('stripe');
      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'disconnect@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      const plan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_disconnect',
        provider_customer_id: 'cus_disconnect',
        status,
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: status === 'cancelled' ? new Date() : null,
        cancel_at: null,
        suspended_at: status === 'suspended' ? new Date() : null,
      });
      await plan.save();

      return { providerConfig, plan };
    }

    it('should refuse to disconnect a provider whose only plan is suspended', async () => {
      const { providerConfig } = await seedProviderWithPlan('suspended');

      await expect(service.disconnectProvider('stripe')).rejects.toThrow('have not ended');
      expect(await ProviderConfigEntity.findByPk(providerConfig.id)).not.toBeNull();
    });

    it('should disconnect a provider whose plans have all been cancelled', async () => {
      const { providerConfig } = await seedProviderWithPlan('cancelled');

      expect(await service.disconnectProvider('stripe')).toBe(true);
      expect(await ProviderConfigEntity.findByPk(providerConfig.id)).toBeNull();
    });

    it('should ask for confirmation before the admin flow disconnects a provider with a suspended plan', async () => {
      const { providerConfig } = await seedProviderWithPlan('suspended');
      const connections = new ProviderConnectionService(eventBus);

      const result = await connections.disconnectProvider('stripe', false);

      expect(result.requiresConfirmation).toBe(true);
      expect(result.activeFundingPlanCount).toBe(1);
      expect(await connections.getActiveFundingPlanCount('stripe')).toBe(1);
      expect(await ProviderConfigEntity.findByPk(providerConfig.id)).not.toBeNull();
    });

    it('should let the admin flow disconnect a provider whose plans have all been cancelled without confirmation', async () => {
      const { providerConfig } = await seedProviderWithPlan('cancelled');
      const connections = new ProviderConnectionService(eventBus);

      const result = await connections.disconnectProvider('stripe', false);

      expect(result.requiresConfirmation).toBeUndefined();
      expect(await ProviderConfigEntity.findByPk(providerConfig.id)).toBeNull();
    });
  });

  describe('getStatus', () => {
    async function seedAccountPlans(statuses: Array<'active' | 'past_due' | 'suspended' | 'cancelled'>) {
      const providerConfig = await createProviderConfig('stripe');
      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'status@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      // Oldest first; the fake clock is frozen, so step it to give each row a
      // distinct createdAt.
      const plans: FundingPlanEntity[] = [];
      for (const status of statuses) {
        _clock.tick(60 * 1000);
        const plan = FundingPlanEntity.build({
          id: uuidv4(),
          account_id: account.id,
          provider_config_id: providerConfig.id,
          provider_subscription_id: `sub_${uuidv4()}`,
          provider_customer_id: 'cus_status',
          status,
          billing_cycle: 'monthly',
          amount: 1000000,
          currency: 'USD',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          cancelled_at: status === 'cancelled' ? new Date() : null,
          cancel_at: null,
          suspended_at: null,
        });
        await plan.save();
        plans.push(plan);
      }

      return { account, plans };
    }

    it('should prefer an active plan over a newer cancelled one', async () => {
      const { account, plans: [active] } = await seedAccountPlans(['active', 'cancelled']);

      const status = await service.getStatus(account.id);

      expect(status?.id).toBe(active.id);
      expect(status?.status).toBe('active');
    });

    it('should prefer a past_due plan over a newer cancelled one', async () => {
      const { account, plans: [pastDue] } = await seedAccountPlans(['past_due', 'cancelled']);

      const status = await service.getStatus(account.id);

      expect(status?.id).toBe(pastDue.id);
    });

    it('should report a plan that is winding down to its boundary over a newer cancelled one', async () => {
      // A period-end cancellation stays 'active' until the boundary: it is
      // still the plan the account is covered by, not one on its way out of
      // the list.
      const { account, plans: [cancelling] } = await seedAccountPlans(['active', 'cancelled']);
      cancelling.cancel_at = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      await cancelling.save();

      const status = await service.getStatus(account.id);

      expect(status?.id).toBe(cancelling.id);
      expect(status?.cancelAt).toEqual(cancelling.cancel_at);
    });

    it('should report the most recent cancelled plan when nothing else is live', async () => {
      const { account, plans: [, newest] } = await seedAccountPlans(['cancelled', 'cancelled']);

      const status = await service.getStatus(account.id);

      expect(status?.id).toBe(newest.id);
      expect(status?.status).toBe('cancelled');
    });

    it('should report nothing for an account that has never held a plan', async () => {
      expect(await service.getStatus(uuidv4())).toBeUndefined();
    });

    // The funding page's covered-calendars list resolves the same plan the
    // status card shows, so a plan in dunning still lists what it covers.
    it.each(['past_due', 'suspended'] as const)(
      'should list the calendars a %s plan covers, past a newer cancelled plan',
      async (status) => {
        const { account, plans: [current] } = await seedAccountPlans([status, 'cancelled']);
        const calendarId = uuidv4();
        await CalendarFundingPlanEntity.build({
          id: uuidv4(),
          funding_plan_id: current.id,
          calendar_id: calendarId,
          amount: 1000000,
          end_time: null,
        }).save();

        const covered = await service.getCalendarsInFundingPlan(account.id);

        expect(covered.map((item) => item.calendarId)).toEqual([calendarId]);
      },
    );
  });

  /**
   * The account-level invariant: one account holds at most one funding plan,
   * and one calendar belongs to at most one plan. These run against the real
   * schema because that is where the invariant is enforced — every unit-level
   * test in this domain stubs the plan lookup, so none of them exercises the
   * `where` clause or the unique index that actually hold the line.
   */
  describe('one plan per account, one plan per calendar', () => {
    async function seedAccountWithPlan(status: 'active' | 'past_due' | 'suspended') {
      const providerConfig = await createProviderConfig('stripe');

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

      const account = AccountEntity.build({
        id: uuidv4(),
        email: 'invariant@example.com',
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      const plan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_invariant',
        provider_customer_id: 'cus_invariant',
        status,
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        cancel_at: null,
        suspended_at: null,
      });
      await plan.save();

      return { account, plan, providerConfig };
    }

    it('should refuse a second checkout while the account holds a continuing plan', async () => {
      const { account } = await seedAccountWithPlan('active');
      sandbox.stub(ProviderFactory, 'getAdapter').returns({
        createCheckoutSession: sandbox.stub().resolves({ clientSecret: 's', sessionId: 'cs_test_x' }),
      } as any);

      await expect(
        service.createCheckoutSession(account.id, 'monthly', 'https://pavillion.dev/return'),
      ).rejects.toThrow(ActiveFundingPlanExistsError);
    });

    it.each(['past_due', 'suspended'] as const)(
      'should refuse a second checkout while the account\'s plan is %s',
      async (status) => {
        // The subscription still exists at the provider and its unpaid invoice
        // can still collect. A second subscription bought meanwhile would
        // charge the account twice; the way back is the billing portal.
        const { account } = await seedAccountWithPlan(status);
        const createCheckoutSession = sandbox.stub().resolves({ clientSecret: 's', sessionId: 'cs_test_x' });
        sandbox.stub(ProviderFactory, 'getAdapter').returns({ createCheckoutSession } as any);

        await expect(
          service.createCheckoutSession(account.id, 'monthly', 'https://pavillion.dev/return'),
        ).rejects.toThrow(ActiveFundingPlanExistsError);
        expect(createCheckoutSession.called).toBe(false);
      },
    );

    it('should record a cancellation the new subscription already carries', async () => {
      // A checkout can complete against a subscription that is already
      // scheduled to cancel — created through the provider's own surfaces, or
      // cancelled between paying and our seeing it. Dropping the schedule would
      // leave the plan with no boundary at all, so access would run to the
      // period end plus grace on a subscription about to be deleted.
      const { account, providerConfig } = await seedAccountWithPlan('suspended');
      const cancelAt = new Date('2026-02-10T00:00:00.000Z');

      sandbox.stub(ProviderFactory, 'getAdapter').returns({
        getSubscription: sandbox.stub().resolves({
          providerSubscriptionId: 'sub_born_cancelling',
          providerCustomerId: 'cus_born_cancelling',
          status: 'active',
          currentPeriodStart: new Date('2026-01-15T00:00:00Z'),
          currentPeriodEnd: new Date('2026-02-15T00:00:00Z'),
          amount: 1000000,
          currency: 'USD',
          cancelAt,
        }),
      } as any);

      await service.processWebhookEvent({
        eventId: 'evt_born_cancelling',
        eventType: 'checkout.session.completed',
        subscriptionId: 'sub_born_cancelling',
        customerId: 'cus_born_cancelling',
        accountId: account.id,
        rawPayload: {},
      }, providerConfig.id);

      const created = await FundingPlanEntity.findOne({
        where: { provider_subscription_id: 'sub_born_cancelling' },
      });
      expect(created).not.toBeNull();
      expect(created!.cancel_at).toEqual(cancelAt);
    });

    it('should move a calendar stranded on a suspended plan rather than failing the add', async () => {
      // The sequence the unique index would otherwise turn into a 500 with no
      // way out: plan suspended (allocations stay open), a new plan arrives
      // past the checkout gate without that calendar (a session opened before
      // the suspension, say), then the calendar is added. A pre-check scoped to the active
      // plan sees nothing, the insert hits the index, and the calendar becomes
      // uncoverable — removeCalendarFromFundingPlan only looks under the active
      // plan, so it would answer 404.
      const { account, providerConfig } = await seedAccountWithPlan('suspended');
      const calendarId = uuidv4();

      const strandedPlan = await FundingPlanEntity.findOne({
        where: { account_id: account.id, status: 'suspended' },
      });
      const stranded = await CalendarFundingPlanEntity.create({
        id: uuidv4(),
        funding_plan_id: strandedPlan!.id,
        calendar_id: calendarId,
        amount: 1000000,
        end_time: null,
      });

      const livePlan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_live',
        provider_customer_id: 'cus_live',
        status: 'active',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        cancel_at: null,
        suspended_at: null,
      });
      await livePlan.save();

      service.setCalendarInterface({
        isCalendarOwnerById: sandbox.stub().resolves(true),
      } as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns({
        supportsAmountUpdates: () => true,
        updateSubscriptionAmount: sandbox.stub().resolves(),
      } as any);

      await service.addCalendarToFundingPlan(account.id, calendarId, 1000000);

      await stranded.reload();
      expect(stranded.end_time).not.toBeNull();

      const open = await CalendarFundingPlanEntity.findAll({
        where: { calendar_id: calendarId, end_time: null },
      });
      expect(open).toHaveLength(1);
      expect(open[0].funding_plan_id).toBe(livePlan.id);
    });

    it('should still reject adding a calendar the active plan already covers', async () => {
      const { account, plan } = await seedAccountWithPlan('active');
      const calendarId = uuidv4();

      await CalendarFundingPlanEntity.create({
        id: uuidv4(),
        funding_plan_id: plan.id,
        calendar_id: calendarId,
        amount: 1000000,
        end_time: null,
      });

      service.setCalendarInterface({
        isCalendarOwnerById: sandbox.stub().resolves(true),
      } as any);

      // Widening the pre-check to the whole calendar must not lose the ordinary
      // duplicate answer, which is a conflict the caller can act on.
      await expect(
        service.addCalendarToFundingPlan(account.id, calendarId, 1000000),
      ).rejects.toThrow(DuplicateCalendarFundingPlanError);
    });

    it('should refuse a second open allocation for one calendar at the database level', async () => {
      const { plan, providerConfig } = await seedAccountWithPlan('active');
      const calendarId = uuidv4();

      await CalendarFundingPlanEntity.create({
        id: uuidv4(),
        funding_plan_id: plan.id,
        calendar_id: calendarId,
        amount: 1000000,
        end_time: null,
      });

      const otherPlan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: uuidv4(),
        provider_config_id: providerConfig.id,
        provider_subscription_id: 'sub_other',
        provider_customer_id: 'cus_other',
        status: 'active',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        cancel_at: null,
        suspended_at: null,
      });
      await otherPlan.save();

      // A different plan, so the older (funding_plan_id, calendar_id) index
      // permits this. The invariant that forbids it is the calendar-scoped one.
      await expect(
        CalendarFundingPlanEntity.create({
          id: uuidv4(),
          funding_plan_id: otherPlan.id,
          calendar_id: calendarId,
          amount: 1000000,
          end_time: null,
        }),
      ).rejects.toThrow();
    });

    it('should close a suspended plan\'s allocation when the calendar is bought again', async () => {
      // A suspended plan keeps its allocations open. The checkout gate refuses
      // a new plan while it is suspended, but a checkout can still complete
      // past it (a session opened before the suspension), and that sequence
      // would otherwise hand the unique index a second open row and leave the
      // provider retrying the webhook forever. Driven through the webhook, so
      // the gate is not in the path.
      const { account, plan, providerConfig } = await seedAccountWithPlan('suspended');
      const calendarId = uuidv4();

      const stranded = await CalendarFundingPlanEntity.create({
        id: uuidv4(),
        funding_plan_id: plan.id,
        calendar_id: calendarId,
        amount: 1000000,
        end_time: null,
      });

      // processCheckoutCompleted re-verifies ownership before allocating, so
      // the calendar domain has to answer for this account's calendar.
      service.setCalendarInterface({
        isCalendarOwnerById: sandbox.stub().withArgs(account.id, calendarId).resolves(true),
      } as any);

      sandbox.stub(ProviderFactory, 'getAdapter').returns({
        getSubscription: sandbox.stub().resolves({
          providerSubscriptionId: 'sub_repurchase',
          providerCustomerId: 'cus_repurchase',
          status: 'active',
          currentPeriodStart: new Date('2026-01-15T00:00:00Z'),
          currentPeriodEnd: new Date('2026-02-15T00:00:00Z'),
          amount: 1000000,
          currency: 'USD',
          cancelAt: null,
        }),
      } as any);

      await service.processWebhookEvent({
        eventId: 'evt_repurchase',
        eventType: 'checkout.session.completed',
        subscriptionId: 'sub_repurchase',
        customerId: 'cus_repurchase',
        accountId: account.id,
        calendarIds: JSON.stringify([calendarId]),
        rawPayload: {},
      }, providerConfig.id);

      await stranded.reload();
      expect(stranded.end_time).not.toBeNull();

      const open = await CalendarFundingPlanEntity.findAll({
        where: { calendar_id: calendarId, end_time: null },
      });
      expect(open).toHaveLength(1);
      expect(open[0].funding_plan_id).not.toBe(plan.id);
    });
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

    // Create active funding plan
    const plan = FundingPlanEntity.build({
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
    await plan.save();

    // Mock adapter
    const mockAdapter = {
      cancelSubscription: sandbox.stub().resolves(),
    };
    sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

    // Admin force cancels (immediate = true)
    await service.cancel(plan.id, true);

    // Verify: Immediate cancellation
    await plan.reload();
    expect(plan.status).toBe('cancelled');
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

    const plan = FundingPlanEntity.build({
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
    await plan.save();

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
    await plan.reload();
    expect(plan.status).toBe('past_due');

    // Change status back to active (simulating recovery)
    plan.status = 'active';
    await plan.save();

    // Process same event again (duplicate webhook delivery)
    await service.processWebhookEvent(webhookEvent, providerConfig.id);

    // Verify status did NOT change (idempotent)
    await plan.reload();
    expect(plan.status).toBe('active'); // Should remain active, not go back to past_due

    // Verify only one event log exists
    const eventCount = await FundingEventEntity.count({
      where: { provider_event_id: 'evt_idempotent_test' },
    });
    expect(eventCount).toBe(1);
  });

  /**
   * Integration Test 8: Funding plan interface cross-domain query
   */
  it('should provide funding plan status via domain interface', async () => {
    // Setup
    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'interface@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();

    // Create a calendar for the account so we can link the funding plan to it
    const calendar = CalendarEntity.build({
      id: uuidv4(),
      url_name: 'interface-test-cal',
      languages: 'en',
      default_date_range: 'month',
    });
    await calendar.save();

    const providerConfig = await createProviderConfig('stripe');

    // Create active funding plan for the account
    const plan = FundingPlanEntity.build({
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
    await plan.save();

    // Link the funding plan to the calendar via CalendarFundingPlanEntity
    const calendarSub = CalendarFundingPlanEntity.build({
      id: uuidv4(),
      funding_plan_id: plan.id,
      calendar_id: calendar.id,
      amount: 1000000,
      end_time: null,
    });
    await calendarSub.save();

    // Test interface method: hasActiveFundingPlan — now takes calendarId
    const hasActive = await service.hasActiveFundingPlan(calendar.id);
    expect(hasActive).toBe(true);

    // Test with a calendar that has no funding plan
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

    // Create funding plan past_due
    const plan = FundingPlanEntity.build({
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
    await plan.save();

    // Past due since 9 days ago (clearly past grace period)
    await backdatePastDue(plan.id, new Date('2026-01-06T12:00:00Z'));

    // Run grace period check
    await checkGracePeriodExpiry();

    // Verify: Should be suspended (past grace period)
    await plan.reload();
    expect(plan.status).toBe('suspended');
    expect(plan.suspended_at).not.toBeNull();
  });

  /**
   * checkFundingAccess against real entities.
   *
   * The gate's plan lookup eager-loads the funding plan through the
   * `fundingPlan` association on CalendarFundingPlanEntity. Unit tests stub
   * findOne wholesale, so these tests exist to execute that include (and the
   * access-boundary read of the loaded plan) against a real database — a
   * broken association alias must fail here.
   */
  describe('checkFundingAccess funding plan gate', () => {
    /**
     * Enable instance funding so the gate actually consults coverage.
     */
    async function enableInstanceFunding(): Promise<void> {
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
    }

    /**
     * Create a calendar covered by a funding plan allocation. Plan defaults
     * to active and inside its billing period (fake clock: 2026-01-15);
     * overrides let a test push the plan past its access boundary.
     */
    async function createCoveredCalendar(planOverrides: Record<string, unknown> = {}): Promise<CalendarEntity> {
      const providerConfig = await createProviderConfig('stripe');

      const account = AccountEntity.build({
        id: uuidv4(),
        email: `gate-${uuidv4()}@example.com`,
        password_hash: 'hash',
        status: 'active',
        languages: 'en',
      });
      await account.save();

      const calendar = CalendarEntity.build({
        id: uuidv4(),
        url_name: `gate-cal-${uuidv4().slice(0, 8)}`,
        languages: 'en',
        default_date_range: 'month',
      });
      await calendar.save();

      const plan = FundingPlanEntity.build({
        id: uuidv4(),
        account_id: account.id,
        provider_config_id: providerConfig.id,
        provider_subscription_id: `sub_${uuidv4().slice(0, 8)}`,
        provider_customer_id: `cus_${uuidv4().slice(0, 8)}`,
        status: 'active',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date('2026-01-01T00:00:00Z'),
        current_period_end: new Date('2026-02-01T00:00:00Z'),
        cancelled_at: null,
        suspended_at: null,
        ...planOverrides,
      });
      await plan.save();

      const allocation = CalendarFundingPlanEntity.build({
        id: uuidv4(),
        funding_plan_id: plan.id,
        calendar_id: calendar.id,
        amount: 1000000,
        end_time: null,
      });
      await allocation.save();

      return calendar;
    }

    it('should open the gate for a calendar covered by an active funding plan', async () => {
      await enableInstanceFunding();
      const calendar = await createCoveredCalendar();

      const access = await service.checkFundingAccess(calendar.id, 'widget_embedding');

      expect(access).toBe(true);
    });

    it('should close the gate for a calendar with no funding plan allocation', async () => {
      await enableInstanceFunding();

      const calendar = CalendarEntity.build({
        id: uuidv4(),
        url_name: 'gate-uncovered-cal',
        languages: 'en',
        default_date_range: 'month',
      });
      await calendar.save();

      const access = await service.checkFundingAccess(calendar.id, 'widget_embedding');

      expect(access).toBe(false);
    });

    it('should close the gate when the covering plan is past its access boundary', async () => {
      await enableInstanceFunding();

      // Still status 'active' with a live allocation, but the paid-through
      // date plus the 7-day grace period ended before the fake clock's
      // 2026-01-15 — only the boundary read of the eager-loaded plan denies it.
      const calendar = await createCoveredCalendar({
        current_period_start: new Date('2025-11-01T00:00:00Z'),
        current_period_end: new Date('2025-12-01T00:00:00Z'),
      });

      const access = await service.checkFundingAccess(calendar.id, 'widget_embedding');

      expect(access).toBe(false);
    });

    /** The one past_due plan the test seeded, read back by its status. */
    async function pastDuePlan(): Promise<FundingPlanEntity> {
      return (await FundingPlanEntity.findOne({ where: { status: 'past_due' } }))!;
    }

    it('should keep the gate open for a past_due plan inside its grace period', async () => {
      await enableInstanceFunding();
      // Written at the fake clock's now, so the 7-day grace has just begun.
      const calendar = await createCoveredCalendar({ status: 'past_due' });

      const access = await service.checkFundingAccess(calendar.id, 'widget_embedding');

      expect(access).toBe(true);
    });

    it('should close the gate for a past_due plan once its grace period has expired', async () => {
      await enableInstanceFunding();
      const calendar = await createCoveredCalendar({ status: 'past_due' });
      await backdatePastDue((await pastDuePlan()).id, new Date('2026-01-07T12:00:00Z'));

      // Closed whether or not the suspension job has run yet ...
      expect(await service.checkFundingAccess(calendar.id, 'widget_embedding')).toBe(false);

      // ... and still closed once it has.
      await service.suspendExpiredFundingPlans();
      expect(await service.checkFundingAccess(calendar.id, 'widget_embedding')).toBe(false);
    });
  });
});
