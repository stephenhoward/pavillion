import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Transaction } from 'sequelize';
import db from '@/server/common/entity/db';
import FundingService from '@/server/funding/service/funding';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { AccountEntity } from '@/server/common/entity/account';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { ProviderConfig } from '@/common/model/funding-plan';

/**
 * Transaction boundaries around the calendar allocation paths.
 *
 * These run against real rows — nothing is stubbed except the payment provider
 * adapter, which is the failure being injected — so a rollback is observable as
 * the absence or unchanged state of a database row. Sibling unit tests in
 * ../service.test.ts stub the entity layer wholesale and therefore cannot see a
 * rollback at all; the same reasoning puts
 * calendar/test/integration/create_event_transaction.test.ts in its own file.
 *
 * Each test injects a failure at the last step of one wrapped path — always
 * after at least one local write has already been issued — and asserts nothing
 * partial survived.
 */
describe('FundingService allocation transactions', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: FundingService;
  let mockCalendarInterface: {
    isCalendarOwnerById: sinon.SinonStub;
    calendarExists: sinon.SinonStub;
    getCalendarOwnerAccountId: sinon.SinonStub;
    getCalendar: sinon.SinonStub;
  };

  let accountId: string;
  let calendarId: string;
  let secondCalendarId: string;
  let providerConfigId: string;
  let fundingPlanId: string;
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    await db.sync({ force: true });

    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new FundingService(eventBus);

    mockCalendarInterface = {
      isCalendarOwnerById: sandbox.stub().resolves(true),
      calendarExists: sandbox.stub().resolves(true),
      getCalendarOwnerAccountId: sandbox.stub(),
      getCalendar: sandbox.stub().resolves(null),
    };
    service.setCalendarInterface(mockCalendarInterface as any);

    const account = AccountEntity.build({
      id: uuidv4(),
      email: 'rollback@example.com',
      password_hash: 'hash',
      status: 'active',
      languages: 'en',
    });
    await account.save();
    accountId = account.id;

    const calendar = CalendarEntity.build({
      id: uuidv4(),
      url_name: 'rollback-cal',
      languages: 'en',
      default_date_range: 'month',
    });
    await calendar.save();
    calendarId = calendar.id;

    const secondCalendar = CalendarEntity.build({
      id: uuidv4(),
      url_name: 'rollback-cal-two',
      languages: 'en',
      default_date_range: 'month',
    });
    await secondCalendar.save();
    secondCalendarId = secondCalendar.id;

    const providerModel = new ProviderConfig(uuidv4(), 'stripe');
    providerModel.enabled = true;
    providerModel.displayName = 'Credit Card';
    providerModel.credentials = JSON.stringify({ apiKey: 'sk_test_123' });
    providerModel.webhookSecret = 'whsec_test_secret';
    const providerConfig = ProviderConfigEntity.fromModel(providerModel);
    await providerConfig.save();
    providerConfigId = providerConfig.id;

    const plan = FundingPlanEntity.build({
      id: uuidv4(),
      account_id: accountId,
      provider_config_id: providerConfigId,
      provider_subscription_id: 'sub_rollback_existing',
      provider_customer_id: 'cus_rollback_existing',
      status: 'active',
      billing_cycle: 'monthly',
      amount: 1000000,
      currency: 'USD',
      current_period_start: new Date(),
      current_period_end: periodEnd,
      cancelled_at: null,
      suspended_at: null,
    });
    await plan.save();
    fundingPlanId = plan.id;
  });

  afterEach(() => {
    sandbox.restore();
    ProviderFactory.clearAllCaches();
  });

  async function createAllocation(forCalendarId: string, amount: number): Promise<CalendarFundingPlanEntity> {
    const allocation = CalendarFundingPlanEntity.build({
      id: uuidv4(),
      funding_plan_id: fundingPlanId,
      calendar_id: forCalendarId,
      amount,
      end_time: null,
    });
    await allocation.save();
    return allocation;
  }

  it('should roll back the new allocation row when the provider amount update fails on add', async () => {
    const updateSubscriptionAmount = sandbox.stub().rejects(new Error('provider rejected amount update'));
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      supportsAmountUpdates: () => true,
      updateSubscriptionAmount,
    } as any);

    await expect(
      service.addCalendarToFundingPlan(accountId, calendarId, 500000),
    ).rejects.toThrow('provider rejected amount update');

    // The failure was injected after the allocation row was written
    expect(updateSubscriptionAmount.calledOnce).toBe(true);

    const allocations = await CalendarFundingPlanEntity.findAll({
      where: { funding_plan_id: fundingPlanId },
    });
    expect(allocations).toHaveLength(0);
  });

  /**
   * The lock itself cannot be observed behaviourally here: SQLite ignores the
   * lock clause (Sequelize emits it only for dialects that support it) and
   * serialises writers anyway, so a concurrency test would pass with or without
   * it. Asserting the option is issued is the only regression guard available
   * short of a Postgres-backed test, and the race it prevents — two parallel
   * adds each computing a total blind to the other's insert, leaving a calendar
   * covered that nobody is billed for — is worth guarding.
   *
   * Ordering matters as much as the option: a refactor that reintroduced an
   * unlocked pre-transaction read and locked only a later re-read would still
   * pass a lock-option assertion, so each path also pins the locked resolve
   * ahead of the allocation access it is there to protect.
   */
  it('should resolve the plan under a FOR UPDATE lock before writing the allocation on add', async () => {
    const planFindOne = sandbox.spy(FundingPlanEntity, 'findOne');
    const allocationCreate = sandbox.spy(CalendarFundingPlanEntity, 'create');
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      supportsAmountUpdates: () => true,
      updateSubscriptionAmount: sandbox.stub().resolves(),
    } as any);

    await service.addCalendarToFundingPlan(accountId, calendarId, 500000);

    const options = planFindOne.firstCall.args[0] as any;
    expect(options.lock).toBe(Transaction.LOCK.UPDATE);
    expect(options.transaction).toBeDefined();
    // The very first plan read is the locked one — no unlocked read precedes it
    expect(planFindOne.firstCall.calledBefore(allocationCreate.firstCall)).toBe(true);

    const allocations = await CalendarFundingPlanEntity.findAll({
      where: { funding_plan_id: fundingPlanId },
    });
    expect(allocations).toHaveLength(1);
  });

  it('should resolve the plan under a FOR UPDATE lock before reading allocations on remove', async () => {
    await createAllocation(calendarId, 500000);
    await createAllocation(secondCalendarId, 300000);

    const planFindOne = sandbox.spy(FundingPlanEntity, 'findOne');
    const allocationFindOne = sandbox.spy(CalendarFundingPlanEntity, 'findOne');
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      supportsAmountUpdates: () => true,
      updateSubscriptionAmount: sandbox.stub().resolves(),
    } as any);

    await service.removeCalendarFromFundingPlan(accountId, calendarId);

    const options = planFindOne.firstCall.args[0] as any;
    expect(options.lock).toBe(Transaction.LOCK.UPDATE);
    expect(options.transaction).toBeDefined();
    // The remaining-active count that decides whether to cancel the whole plan
    // must be taken after the lock, not before it
    expect(planFindOne.firstCall.calledBefore(allocationFindOne.firstCall)).toBe(true);
  });

  it('should resolve the plan under a FOR UPDATE lock before cancelling at the provider on a standalone cancel', async () => {
    await createAllocation(calendarId, 500000);

    const planFindByPk = sandbox.spy(FundingPlanEntity, 'findByPk');
    const cancelSubscription = sandbox.stub().resolves();
    sandbox.stub(ProviderFactory, 'getAdapter').returns({ cancelSubscription } as any);

    await service.cancel(fundingPlanId, false);

    const options = planFindByPk.firstCall.args[1] as any;
    expect(options.lock).toBe(Transaction.LOCK.UPDATE);
    expect(options.transaction).toBeDefined();
    // The provider call must wait behind any in-flight allocation change, so
    // the lock is taken before it rather than only before the status write
    expect(planFindByPk.firstCall.calledBefore(cancelSubscription.firstCall)).toBe(true);

    const plan = await FundingPlanEntity.findByPk(fundingPlanId);
    expect(plan!.status).toBe('cancelled');
  });

  it('should resolve the plan under a FOR UPDATE lock in the caller-owned transaction on cancel', async () => {
    const planFindByPk = sandbox.spy(FundingPlanEntity, 'findByPk');
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      cancelSubscription: sandbox.stub().resolves(),
    } as any);

    await db.transaction(async (tx) => {
      await service.cancel(fundingPlanId, false, tx);

      const options = planFindByPk.firstCall.args[1] as any;
      expect(options.lock).toBe(Transaction.LOCK.UPDATE);
      expect(options.transaction).toBe(tx);
    });
  });

  it('should re-check for an existing plan under a FOR UPDATE lock before writing on checkout completion', async () => {
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      getSubscription: sandbox.stub().resolves({
        providerSubscriptionId: 'sub_lock_new',
        providerCustomerId: 'cus_lock_new',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
        amount: 1000000,
        currency: 'USD',
      }),
    } as any);

    const planFindOne = sandbox.spy(FundingPlanEntity, 'findOne');
    const allocationCreate = sandbox.spy(CalendarFundingPlanEntity, 'create');

    await service.processWebhookEvent({
      eventId: 'evt_lock_checkout',
      eventType: 'checkout.session.completed',
      subscriptionId: 'sub_lock_new',
      customerId: 'cus_lock_new',
      accountId,
      calendarIds: JSON.stringify([calendarId]),
      rawPayload: { type: 'checkout.session.completed' },
    }, providerConfigId);

    const lockedRead = planFindOne.getCalls().find((call) => (call.args[0] as any)?.lock === Transaction.LOCK.UPDATE);
    expect(lockedRead).toBeDefined();
    expect((lockedRead!.args[0] as any).transaction).toBeDefined();
    expect(lockedRead!.calledBefore(allocationCreate.firstCall)).toBe(true);

    const plans = await FundingPlanEntity.findAll({
      where: { provider_subscription_id: 'sub_lock_new' },
    });
    expect(plans).toHaveLength(1);
  });

  it('should roll back the end_time write when the provider amount update fails on remove', async () => {
    const allocation = await createAllocation(calendarId, 500000);
    await createAllocation(secondCalendarId, 300000);

    const updateSubscriptionAmount = sandbox.stub().rejects(new Error('provider rejected amount update'));
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      supportsAmountUpdates: () => true,
      updateSubscriptionAmount,
    } as any);

    await expect(
      service.removeCalendarFromFundingPlan(accountId, calendarId),
    ).rejects.toThrow('provider rejected amount update');

    expect(updateSubscriptionAmount.calledOnce).toBe(true);

    await allocation.reload();
    expect(allocation.end_time).toBeNull();
  });

  it('should roll back both the end_time write and the plan cancellation when the provider cancel fails', async () => {
    const allocation = await createAllocation(calendarId, 500000);

    const cancelSubscription = sandbox.stub().rejects(new Error('provider rejected cancellation'));
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      supportsAmountUpdates: () => true,
      updateSubscriptionAmount: sandbox.stub().resolves(),
      cancelSubscription,
    } as any);

    await expect(
      service.removeCalendarFromFundingPlan(accountId, calendarId),
    ).rejects.toThrow('provider rejected cancellation');

    // Last active calendar, so the removal took the cancel branch
    expect(cancelSubscription.calledOnce).toBe(true);

    await allocation.reload();
    expect(allocation.end_time).toBeNull();

    const plan = await FundingPlanEntity.findByPk(fundingPlanId);
    expect(plan!.status).toBe('active');
    expect(plan!.cancelled_at).toBeNull();
  });

  it('should roll back the funding plan and event rows when a calendar allocation write fails on checkout completion', async () => {
    sandbox.stub(ProviderFactory, 'getAdapter').returns({
      getSubscription: sandbox.stub().resolves({
        providerSubscriptionId: 'sub_rollback_new',
        providerCustomerId: 'cus_rollback_new',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
        amount: 1000000,
        currency: 'USD',
      }),
    } as any);

    // Fail the last write in the transaction, after the plan and event rows
    const createStub = sandbox.stub(CalendarFundingPlanEntity, 'create')
      .rejects(new Error('allocation write failed'));

    const createdEvents: unknown[] = [];
    eventBus.on('funding:plan:created', (payload) => createdEvents.push(payload));

    await expect(
      service.processWebhookEvent({
        eventId: 'evt_rollback_checkout',
        eventType: 'checkout.session.completed',
        subscriptionId: 'sub_rollback_new',
        customerId: 'cus_rollback_new',
        accountId,
        calendarIds: JSON.stringify([calendarId]),
        rawPayload: { type: 'checkout.session.completed' },
      }, providerConfigId),
    ).rejects.toThrow('allocation write failed');

    expect(createStub.calledOnce).toBe(true);

    const plans = await FundingPlanEntity.findAll({
      where: { provider_subscription_id: 'sub_rollback_new' },
    });
    expect(plans).toHaveLength(0);

    const events = await FundingEventEntity.findAll({
      where: { provider_event_id: 'evt_rollback_checkout' },
    });
    expect(events).toHaveLength(0);
    expect(createdEvents).toHaveLength(0);
  });

  /**
   * Call-site coverage for the deferral helper.
   *
   * The helper itself is exercised directly in
   * common/test/integration/emit_after_tx.test.ts. Those tests cannot see a
   * call site that bypasses the helper and emits on the bus directly, which is
   * what this one pins down.
   */
  describe('emitAfterTx deferral', () => {
    it('should not emit plan cancellation when the caller-owned transaction rolls back', async () => {
      // A cancel() that emitted directly on the bus would pass every other
      // test in this file, because each of those injects its failure before
      // the emit line is reached.
      await createAllocation(calendarId, 500000);
      sandbox.stub(ProviderFactory, 'getAdapter').returns({
        cancelSubscription: sandbox.stub().resolves(),
      } as any);

      const cancelled: unknown[] = [];
      eventBus.on('funding:plan:cancelled', (payload) => cancelled.push(payload));

      await expect(
        db.transaction(async (tx) => {
          await service.cancel(fundingPlanId, false, tx);
          throw new Error('forced rollback after cancel');
        }),
      ).rejects.toThrow('forced rollback after cancel');

      await new Promise((resolve) => setImmediate(resolve));

      expect(cancelled).toHaveLength(0);

      const plan = await FundingPlanEntity.findByPk(fundingPlanId);
      expect(plan!.status).toBe('active');
    });
  });
});
