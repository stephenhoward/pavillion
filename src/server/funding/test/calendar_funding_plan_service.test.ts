import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import FundingService, { MIN_PWYC_AMOUNT } from '@/server/funding/service/funding';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { ComplimentaryGrantEntity } from '@/server/funding/entity/complimentary_grant';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderConfig, FundingPlan, FundingSettings } from '@/common/model/funding-plan';
import { ValidationError } from '@/common/exceptions/base';
import {
  InvalidAmountError,
  FundingPlanNotFoundError,
  CalendarFundingPlanNotFoundError,
  DuplicateCalendarFundingPlanError,
  FundingAccessIndeterminateError,
} from '@/common/exceptions/funding';

describe('FundingService - Calendar Funding Plan Methods', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: FundingService;
  let mockCalendarInterface: {
    isCalendarOwnerById: sinon.SinonStub;
    calendarExists: sinon.SinonStub;
    getCalendarOwnerAccountId: sinon.SinonStub;
  };
  let mockAccountsInterface: {
    accountIsAdmin: sinon.SinonStub;
  };

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new FundingService(eventBus);

    // Create mock CalendarInterface and inject it
    mockCalendarInterface = {
      isCalendarOwnerById: sandbox.stub(),
      calendarExists: sandbox.stub(),
      getCalendarOwnerAccountId: sandbox.stub(),
    };
    service.setCalendarInterface(mockCalendarInterface as any);

    // Create mock AccountsInterface and inject it
    mockAccountsInterface = {
      accountIsAdmin: sandbox.stub().resolves(false),
    };
    service.setAccountsInterface(mockAccountsInterface as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('addCalendarToFundingPlan', () => {
    it('should create a CalendarFundingPlan row and update provider total', async () => {
      const fundingPlanId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const amount = 500000; // $5.00 in millicents
      const providerConfigId = uuidv4();

      const mockFundingPlanEntity = {
        id: fundingPlanId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        toModel: function() {
          const sub = new FundingPlan(this.id);
          sub.accountId = this.account_id;
          sub.providerConfigId = this.provider_config_id;
          sub.providerSubscriptionId = this.provider_subscription_id;
          sub.status = this.status;
          return sub;
        },
      };

      const mockCalendarFundingPlan = {
        id: uuidv4(),
        funding_plan_id: fundingPlanId,
        calendar_id: calendarId,
        amount: amount,
        end_time: null,
        save: sandbox.stub().resolves(),
      };

      const mockProviderConfig = {
        toModel: () => new ProviderConfig(providerConfigId, 'stripe'),
      };

      const mockAdapter = {
        updateSubscriptionAmount: sandbox.stub().resolves(),
        supportsAmountUpdates: sandbox.stub().returns(true),
      };

      // Ownership verification via CalendarInterface
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      sandbox.stub(FundingPlanEntity, 'findOne').resolves(mockFundingPlanEntity as any);
      // No existing active calendar plan
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);
      const createStub = sandbox.stub(CalendarFundingPlanEntity, 'create').resolves(mockCalendarFundingPlan as any);
      // Sum of active calendar amounts (just the new one)
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([mockCalendarFundingPlan] as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.addCalendarToFundingPlan(accountId, calendarId, amount);

      expect(createStub.called).toBe(true);
      expect(mockAdapter.updateSubscriptionAmount.called).toBe(true);
    });

    it('should throw FundingPlanNotFoundError if no active plan exists', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);

      await expect(
        service.addCalendarToFundingPlan(accountId, calendarId, 500000),
      ).rejects.toThrow(FundingPlanNotFoundError);
    });

    it('should throw ValidationError if account does not own the calendar', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const fundingPlanId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves({
        id: fundingPlanId,
        account_id: accountId,
        status: 'active',
      } as any);

      // Account is not an owner of the calendar
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(false);

      await expect(
        service.addCalendarToFundingPlan(accountId, calendarId, 500000),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw DuplicateCalendarFundingPlanError if active plan already exists', async () => {
      const accountId = uuidv4();
      const fundingPlanId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves({
        id: fundingPlanId,
        account_id: accountId,
        status: 'active',
      } as any);

      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      // The open allocation belongs to the plan being added to, which is what
      // makes this a duplicate rather than a calendar to be moved across.
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
        funding_plan_id: fundingPlanId,
        end_time: null,
      } as any);

      await expect(
        service.addCalendarToFundingPlan(accountId, calendarId, 500000),
      ).rejects.toThrow(DuplicateCalendarFundingPlanError);
    });

    it('should throw error with InvalidAmountError name if amount is negative', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();

      try {
        await service.addCalendarToFundingPlan(accountId, calendarId, -100);
        expect.fail('Should have thrown');
      }
      catch (err: any) {
        expect(err.name).toBe('InvalidAmountError');
      }
    });

    it.each([
      ['zero', 0],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['non-integer', MIN_PWYC_AMOUNT + 0.5],
      ['below the minimum', MIN_PWYC_AMOUNT - 1],
    ])('should throw InvalidAmountError when amount is %s', async (_label, amount) => {
      const findOneStub = sandbox.stub(FundingPlanEntity, 'findOne');

      await expect(
        service.addCalendarToFundingPlan(uuidv4(), uuidv4(), amount),
      ).rejects.toThrow(InvalidAmountError);

      expect(findOneStub.called).toBe(false);
    });

    it('should accept an amount equal to the minimum', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const fundingPlanId = uuidv4();
      const providerConfigId = uuidv4();

      const mockFundingPlanEntity = {
        id: fundingPlanId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        status: 'active',
      };
      const mockCalendarFundingPlan = {
        id: uuidv4(),
        funding_plan_id: fundingPlanId,
        calendar_id: calendarId,
        amount: MIN_PWYC_AMOUNT,
        end_time: null,
      };
      const mockAdapter = {
        updateSubscriptionAmount: sandbox.stub().resolves(),
        supportsAmountUpdates: sandbox.stub().returns(true),
      };

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(mockFundingPlanEntity as any);
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);
      const createStub = sandbox.stub(CalendarFundingPlanEntity, 'create').resolves(mockCalendarFundingPlan as any);
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([mockCalendarFundingPlan] as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves({
        toModel: () => new ProviderConfig(providerConfigId, 'stripe'),
      } as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.addCalendarToFundingPlan(accountId, calendarId, MIN_PWYC_AMOUNT);

      expect(createStub.calledOnce).toBe(true);
      expect(mockAdapter.updateSubscriptionAmount.calledOnce).toBe(true);
    });

    it('should throw ValidationError for invalid UUID parameters', async () => {
      await expect(
        service.addCalendarToFundingPlan('not-uuid', uuidv4(), 500000),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.addCalendarToFundingPlan(uuidv4(), 'not-uuid', 500000),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('removeCalendarFromFundingPlan', () => {
    it('should set end_time and reduce provider amount', async () => {
      const fundingPlanId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const mockFundingPlanEntity = {
        id: fundingPlanId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: periodEnd,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new FundingPlan(this.id);
          sub.accountId = this.account_id;
          sub.providerConfigId = this.provider_config_id;
          sub.providerSubscriptionId = this.provider_subscription_id;
          sub.currentPeriodEnd = this.current_period_end;
          return sub;
        },
      };

      const mockCalendarSub = {
        id: uuidv4(),
        funding_plan_id: fundingPlanId,
        calendar_id: calendarId,
        amount: 500000,
        end_time: null as Date | null,
        save: sandbox.stub().resolves(),
      };

      // Another active calendar plan remains
      const otherCalendarSub = {
        id: uuidv4(),
        funding_plan_id: fundingPlanId,
        calendar_id: uuidv4(),
        amount: 300000,
        end_time: null,
      };

      const mockProviderConfig = {
        toModel: () => new ProviderConfig(providerConfigId, 'stripe'),
      };

      const mockAdapter = {
        updateSubscriptionAmount: sandbox.stub().resolves(),
        cancelSubscription: sandbox.stub().resolves(),
        supportsAmountUpdates: sandbox.stub().returns(true),
      };

      sandbox.stub(FundingPlanEntity, 'findOne').resolves(mockFundingPlanEntity as any);
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      // The specific calendar plan to remove
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(mockCalendarSub as any);
      // Remaining active plans (after end_time is set)
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([otherCalendarSub] as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.removeCalendarFromFundingPlan(accountId, calendarId);

      expect(mockCalendarSub.end_time).toEqual(periodEnd);
      expect(mockCalendarSub.save.called).toBe(true);
      expect(mockAdapter.updateSubscriptionAmount.called).toBe(true);
      // Should update with remaining amount (300000)
      expect(mockAdapter.updateSubscriptionAmount.firstCall.args[1]).toBe(300000);
    });

    it('should cancel plan via this.cancel() when removing last active calendar', async () => {
      const fundingPlanId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const mockFundingPlanEntity = {
        id: fundingPlanId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: periodEnd,
        cancelled_at: null as Date | null,
        cancel_at: null as Date | null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new FundingPlan(this.id);
          sub.accountId = this.account_id;
          sub.providerConfigId = this.provider_config_id;
          sub.providerSubscriptionId = this.provider_subscription_id;
          sub.currentPeriodEnd = this.current_period_end;
          return sub;
        },
      };

      const mockCalendarSub = {
        id: uuidv4(),
        funding_plan_id: fundingPlanId,
        calendar_id: calendarId,
        amount: 500000,
        end_time: null as Date | null,
        save: sandbox.stub().resolves(),
      };

      const mockProviderConfig = {
        toModel: () => new ProviderConfig(providerConfigId, 'stripe'),
      };

      const mockAdapter = {
        updateSubscriptionAmount: sandbox.stub().resolves(),
        cancelSubscription: sandbox.stub().resolves(),
        supportsAmountUpdates: sandbox.stub().returns(true),
      };

      // findOne is called for resolveActiveFundingPlan; findByPk is called in cancel()
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(mockFundingPlanEntity as any);
      sandbox.stub(FundingPlanEntity, 'findByPk').resolves(mockFundingPlanEntity as any);
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(mockCalendarSub as any);
      // No remaining active plans
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([]);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.removeCalendarFromFundingPlan(accountId, calendarId);

      expect(mockCalendarSub.end_time).toEqual(periodEnd);
      expect(mockAdapter.cancelSubscription.called).toBe(true);
      // Cancelled at the period end, not immediately: the allocation's own
      // end_time and the plan's boundary are the same paid-through date, so
      // the calendar keeps its coverage for the period already paid for.
      expect(mockFundingPlanEntity.status).toBe('active');
      expect(mockFundingPlanEntity.cancel_at).toEqual(periodEnd);
    });

    it('should throw FundingPlanNotFoundError if no active plan exists', async () => {
      const accountId = uuidv4();
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);

      await expect(
        service.removeCalendarFromFundingPlan(accountId, uuidv4()),
      ).rejects.toThrow(FundingPlanNotFoundError);
    });

    it('should throw CalendarFundingPlanNotFoundError if no active calendar plan', async () => {
      const accountId = uuidv4();
      const fundingPlanId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves({
        id: fundingPlanId,
        account_id: accountId,
        status: 'active',
      } as any);

      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);

      await expect(
        service.removeCalendarFromFundingPlan(accountId, calendarId),
      ).rejects.toThrow(CalendarFundingPlanNotFoundError);
    });

    it('should throw ValidationError for invalid UUID parameters', async () => {
      await expect(
        service.removeCalendarFromFundingPlan('not-uuid', uuidv4()),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getFundingStatusForCalendar', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('should return admin_exempt when calendar owner is admin', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      // Account owns the calendar
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      // Calendar has an owner via CalendarInterface
      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      // Owner has admin role (asked of the accounts domain)
      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(true);

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('admin_exempt');
    });

    it('should return grant when calendar has an active grant', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      // Account owns the calendar
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);

      // Active grant for this calendar (via hasActiveGrant)
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        revoked_at: null,
        expires_at: null,
      } as any);

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('grant');
    });

    /**
     * Put the calendar in a state where only the funding plan can decide the
     * answer: owned by the caller, owner not an admin, no grant.
     *
     * @param accountId - Account that owns the calendar
     * @param calendarId - Calendar under test
     */
    async function onlyThePlanDecides(accountId: string, calendarId: string): Promise<void> {
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
    }

    /**
     * Stub the calendar's allocation row and the funding plan behind it.
     *
     * The allocation row itself always exists here (end_time null) — that is
     * the point. What varies is the plan it belongs to, and whether the query
     * asking for it joins that plan at all. The fake honours the include's
     * `where: { status: 'active' }` exactly as the database would, so a query
     * written without the join still sees the row. That asymmetry is what the
     * boundary tests below are measuring: a predicate that reads the
     * allocation alone reports covered here, and one that goes through the
     * plan does not.
     *
     * @param calendarId - Calendar the allocation belongs to
     * @param plan - Overrides for the funding plan, or null for no allocation
     */
    function stubAllocation(
      calendarId: string,
      plan: {
        status?: string;
        cancelled_at?: Date | null;
        cancel_at?: Date | null;
        current_period_end?: Date | null;
      } | null,
    ): void {
      /** The allocation row as the query in `options` would see it, or null. */
      const visibleRow = (options?: any) => {
        if (plan === null) {
          return null;
        }

        const fundingPlan = {
          status: 'active',
          cancelled_at: null,
          cancel_at: null,
          current_period_end: new Date(Date.now() + 30 * DAY),
          ...plan,
        };

        const joinedStatus = options?.include?.[0]?.where?.status;
        if (joinedStatus !== undefined && fundingPlan.status !== joinedStatus) {
          return null;
        }

        return {
          id: uuidv4(),
          calendar_id: calendarId,
          end_time: null,
          fundingPlan,
        } as any;
      };

      sandbox.stub(CalendarFundingPlanEntity, 'findOne').callsFake(async (options?: any) => visibleRow(options));
    }

    it('should return covered when calendar has an active calendar plan', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      await onlyThePlanDecides(accountId, calendarId);
      stubAllocation(calendarId, {});

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('covered');
    });

    /**
     * The displayed status and the gate decision are computed by the same
     * predicate, so a calendar the gate refuses is never shown as covered.
     * Before they were aligned this method read the allocation row alone —
     * no join to the plan's status, no access boundary — and reported 'covered'
     * for a calendar whose plan had been cancelled while every feature on it
     * was already refused.
     */
    describe('agreement with the gate for a plan past its access boundary', () => {
      it('should return not_covered when the funding plan behind the allocation was cancelled', async () => {
        const calendarId = uuidv4();
        const accountId = uuidv4();

        await onlyThePlanDecides(accountId, calendarId);
        stubAllocation(calendarId, { status: 'cancelled' });

        const status = await service.getFundingStatusForCalendar(accountId, calendarId);
        expect(status).toBe('not_covered');
      });

      it('should return not_covered when an active plan passed its scheduled cancellation', async () => {
        const calendarId = uuidv4();
        const accountId = uuidv4();

        await onlyThePlanDecides(accountId, calendarId);
        // A cancel-at-period-end whose deletion webhook never arrived: the
        // plan still says 'active' and only cancel_at reveals the end.
        stubAllocation(calendarId, { cancel_at: new Date(Date.now() - DAY) });

        const status = await service.getFundingStatusForCalendar(accountId, calendarId);
        expect(status).toBe('not_covered');
      });

      it('should still return covered while a scheduled cancellation is ahead of it', async () => {
        const calendarId = uuidv4();
        const accountId = uuidv4();

        await onlyThePlanDecides(accountId, calendarId);
        stubAllocation(calendarId, { cancel_at: new Date(Date.now() + DAY) });

        const status = await service.getFundingStatusForCalendar(accountId, calendarId);
        expect(status).toBe('covered');
      });

      it('should return not_covered when the paid-through date plus grace has passed', async () => {
        const calendarId = uuidv4();
        const accountId = uuidv4();

        await onlyThePlanDecides(accountId, calendarId);
        // Default instance grace period is 7 days; 30 days past the period end
        // is outside it even though the plan still claims to be active.
        stubAllocation(calendarId, { current_period_end: new Date(Date.now() - 30 * DAY) });

        const status = await service.getFundingStatusForCalendar(accountId, calendarId);
        expect(status).toBe('not_covered');
      });

      it('should still return covered inside the grace period after the paid-through date', async () => {
        const calendarId = uuidv4();
        const accountId = uuidv4();

        await onlyThePlanDecides(accountId, calendarId);
        stubAllocation(calendarId, { current_period_end: new Date(Date.now() - DAY) });

        const status = await service.getFundingStatusForCalendar(accountId, calendarId);
        expect(status).toBe('covered');
      });
    });

    it('should return not_covered when no exemption, grant, or plan exists', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      // Account owns the calendar
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('not_covered');
    });

    it('should return not_covered when calendar has no owner', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      // Account owns the calendar (for ownership check)
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(null);

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('not_covered');
    });

    it('should throw ValidationError for invalid calendarId UUID', async () => {
      const accountId = uuidv4();

      await expect(
        service.getFundingStatusForCalendar(accountId, 'not-a-uuid'),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid accountId UUID', async () => {
      const calendarId = uuidv4();

      await expect(
        service.getFundingStatusForCalendar('not-a-uuid', calendarId),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when account does not own the calendar', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(false);

      await expect(
        service.getFundingStatusForCalendar(accountId, calendarId),
      ).rejects.toThrow(ValidationError);
    });

    it('should not echo the account or calendar id in the ownership refusal', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(false);

      const error = await service
        .getFundingStatusForCalendar(accountId, calendarId)
        .then(() => { throw new Error('expected rejection'); }, (e: unknown) => e as Error);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).not.toContain(accountId);
      expect(error.message).not.toContain(calendarId);
    });
  });

  describe('getCalendarFundingSummary', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const GRACE_DAYS = 7;

    /**
     * Stub the single instance funding-settings row.
     *
     * @param enabled - Whether the operator has funding switched on
     */
    function stubFundingEnabled(enabled: boolean): void {
      sandbox.stub(FundingSettingsEntity, 'findOne').resolves({
        id: uuidv4(),
        toModel: () => {
          const settings = new FundingSettings();
          settings.enabled = enabled;
          settings.gracePeriodDays = GRACE_DAYS;
          return settings;
        },
      } as any);
    }

    it('should report the coverage status alongside the gate decision', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const periodEnd = new Date(Date.now() + 30 * DAY);

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      mockCalendarInterface.getCalendarOwnerAccountId.withArgs(calendarId).resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        end_time: null,
        fundingPlan: {
          status: 'active',
          cancelled_at: null,
          current_period_end: periodEnd,
        },
      } as any);
      stubFundingEnabled(true);

      const summary = await service.getCalendarFundingSummary(accountId, calendarId);

      expect(summary.status).toBe('covered');
      expect(summary.features.widget_embedding).toBe(true);
    });

    /**
     * The documented divergence: on an instance that does not charge, every
     * gate is open (checkFundingAccess invariant 1, DEC-001 instance autonomy)
     * while the calendar's funding relationship is still, truthfully, none.
     * A consumer must read the feature flags rather than the status to learn
     * what a calendar may do — this is the case that proves the difference.
     */
    it('should report open features with a not_covered status when the instance does not charge', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      mockCalendarInterface.getCalendarOwnerAccountId.withArgs(calendarId).resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);
      stubFundingEnabled(false);

      const summary = await service.getCalendarFundingSummary(accountId, calendarId);

      expect(summary.status).toBe('not_covered');
      expect(summary.features.widget_embedding).toBe(true);
    });

    it('should verify ownership before reporting anything', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(false);

      await expect(
        service.getCalendarFundingSummary(accountId, calendarId),
      ).rejects.toThrow(ValidationError);
    });

    /**
     * The summary carries no plan dates, so a calendar qualified by something
     * other than its plan never has its allocation read at all.
     *
     * An admin who also pays is the case that proves it: the status is decided
     * by the exemption, and the gate short-circuits on the same exemption.
     * Reading the allocation unconditionally is what would turn into a genuine
     * cross-account disclosure the day a calendar's owner and its funder can
     * differ, so the lookup never happening is the property under test.
     */
    it('should not read the plan allocation for a calendar qualified by something other than its plan', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      mockCalendarInterface.getCalendarOwnerAccountId.withArgs(calendarId).resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(true);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);

      // A live, in-boundary allocation the admin exemption makes irrelevant.
      const allocationLookup = sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        end_time: null,
        fundingPlan: {
          status: 'active',
          cancelled_at: null,
          current_period_end: new Date(Date.now() + 30 * DAY),
        },
      } as any);
      stubFundingEnabled(true);

      const summary = await service.getCalendarFundingSummary(accountId, calendarId);

      expect(summary.status).toBe('admin_exempt');
      // The plan is never read — not merely left out of the response.
      expect(allocationLookup.called).toBe(false);
    });

    /**
     * Mirrors the handler-level allowlist assertion one layer down.
     *
     * The handler filters what it sends, but FundingInterface hands this object
     * to a cross-domain caller unfiltered, so a field added at the service
     * would escape through that path with nothing to catch it. Asserting the
     * key set here means the addition fails a test whichever layer eventually
     * consumes it.
     */
    it('should carry exactly the summary field allowlist and nothing else', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      mockCalendarInterface.getCalendarOwnerAccountId.withArgs(calendarId).resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        end_time: null,
        fundingPlan: {
          status: 'active',
          cancelled_at: null,
          current_period_end: new Date(Date.now() + 30 * DAY),
          account_id: 'owner-account-id',
          provider_customer_id: 'cus_leak',
          provider_subscription_id: 'sub_leak',
        },
      } as any);
      stubFundingEnabled(true);

      const summary = await service.getCalendarFundingSummary(accountId, calendarId);

      expect(Object.keys(summary).sort()).toEqual(
        ['features', 'status'],
      );

      const serialised = JSON.stringify(summary);
      for (const secret of ['owner-account-id', 'cus_leak', 'sub_leak']) {
        expect(serialised).not.toContain(secret);
      }
    });

    /**
     * The instance settings are read twice over on this path — once for the
     * display status and once inside every gate decision — and neither can
     * answer without it. An unreadable row is therefore the indeterminate
     * case, and it must arrive as the class consumers branch on rather than
     * as whatever the driver happened to throw: CalendarService keys on it to
     * keep this out of the 402 path, and it would silently miss a raw Error.
     */
    it('should raise the indeterminate error when the instance settings cannot be read', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      mockCalendarInterface.getCalendarOwnerAccountId.withArgs(calendarId).resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(FundingSettingsEntity, 'findOne').rejects(new Error('DB error'));

      await expect(
        service.getCalendarFundingSummary(accountId, calendarId),
      ).rejects.toThrow(FundingAccessIndeterminateError);

      // errorName is what crosses the wire, so it is what a consumer keys on.
      await expect(
        service.getCalendarFundingSummary(accountId, calendarId),
      ).rejects.toMatchObject({ name: 'FundingAccessIndeterminateError' });
    });

    /**
     * The gate answer is authoritative and computed in isolation from the
     * display status, so a read only the display path needs cannot sink it.
     * Here the grant table is unreadable while the calendar holds a live paid
     * allocation: checkFundingAccess still allows (a determinate allow beats
     * an indeterminate sibling read), and the summary must carry that allow
     * with a null — display-indeterminate — status rather than answer 500
     * and hide the funding card from a paying owner.
     */
    it('should keep the gate answer when a display-only read fails', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      mockCalendarInterface.getCalendarOwnerAccountId.withArgs(calendarId).resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').rejects(new Error('grant table unreadable'));
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        end_time: null,
        fundingPlan: {
          status: 'active',
          cancelled_at: null,
          current_period_end: new Date(Date.now() + 30 * DAY),
        },
      } as any);
      stubFundingEnabled(true);

      const summary = await service.getCalendarFundingSummary(accountId, calendarId);

      expect(summary.features.widget_embedding).toBe(true);
      expect(summary.status).toBeNull();
    });

    /**
     * The display failure never becomes an access answer in either direction:
     * with no allow from any readable source the gate closes on its own
     * terms, and the status stays indeterminate rather than being inferred
     * as `not_covered` from the closed gate.
     */
    it('should not turn a display-only read failure into a gate answer', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.isCalendarOwnerById.withArgs(accountId, calendarId).resolves(true);
      mockCalendarInterface.getCalendarOwnerAccountId.withArgs(calendarId).resolves(accountId);

      mockAccountsInterface.accountIsAdmin.withArgs(accountId).resolves(false);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').rejects(new Error('grant table unreadable'));
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);
      stubFundingEnabled(true);

      const summary = await service.getCalendarFundingSummary(accountId, calendarId);

      expect(summary.features.widget_embedding).toBe(false);
      expect(summary.status).toBeNull();
    });
  });

});


describe('FundingService - getCalendarsInFundingPlan', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: FundingService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new FundingService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return empty array when account has no active funding plan', async () => {
    const accountId = uuidv4();
    sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);

    const result = await service.getCalendarsInFundingPlan(accountId);

    expect(result).toEqual([]);
  });

  it('should return empty array when plan exists but has no active calendar allocations', async () => {
    const accountId = uuidv4();
    const fundingPlanId = uuidv4();

    sandbox.stub(FundingPlanEntity, 'findOne').resolves({
      id: fundingPlanId,
      account_id: accountId,
      status: 'active',
    } as any);

    sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([]);

    const result = await service.getCalendarsInFundingPlan(accountId);

    expect(result).toEqual([]);
  });

  it('should return active allocations with calendarId, amount, and createdAt', async () => {
    const accountId = uuidv4();
    const fundingPlanId = uuidv4();
    const calendarId1 = uuidv4();
    const calendarId2 = uuidv4();
    const createdAt1 = new Date('2026-01-15');
    const createdAt2 = new Date('2026-02-20');

    sandbox.stub(FundingPlanEntity, 'findOne').resolves({
      id: fundingPlanId,
      account_id: accountId,
      status: 'active',
    } as any);

    sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([
      {
        funding_plan_id: fundingPlanId,
        calendar_id: calendarId1,
        amount: 500000,
        end_time: null,
        created_at: createdAt1,
      },
      {
        funding_plan_id: fundingPlanId,
        calendar_id: calendarId2,
        amount: 300000,
        end_time: null,
        created_at: createdAt2,
      },
    ] as any);

    const result = await service.getCalendarsInFundingPlan(accountId);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      calendarId: calendarId1,
      amount: 500000,
      createdAt: createdAt1,
    });
    expect(result[1]).toEqual({
      calendarId: calendarId2,
      amount: 300000,
      createdAt: createdAt2,
    });
  });

  it('should only return active allocations (end_time IS NULL), not ended ones', async () => {
    const accountId = uuidv4();
    const fundingPlanId = uuidv4();
    const activeCalendarId = uuidv4();
    const activeCreatedAt = new Date('2026-01-15');

    sandbox.stub(FundingPlanEntity, 'findOne').resolves({
      id: fundingPlanId,
      account_id: accountId,
      status: 'active',
    } as any);

    // findAll is called with end_time: { [Op.is]: null }, so the stub
    // should only return active allocations (the service filters via the query)
    sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([
      {
        funding_plan_id: fundingPlanId,
        calendar_id: activeCalendarId,
        amount: 500000,
        end_time: null,
        created_at: activeCreatedAt,
      },
    ] as any);

    const result = await service.getCalendarsInFundingPlan(accountId);

    expect(result).toHaveLength(1);
    expect(result[0].calendarId).toBe(activeCalendarId);
  });

  it('should throw ValidationError for invalid UUID', async () => {
    await expect(
      service.getCalendarsInFundingPlan('not-a-uuid'),
    ).rejects.toThrow(ValidationError);
  });
});
