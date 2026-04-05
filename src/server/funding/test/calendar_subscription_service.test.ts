import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import FundingService from '@/server/funding/service/funding';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { ComplimentaryGrantEntity } from '@/server/funding/entity/complimentary_grant';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { FundingSettings, ProviderConfig, FundingPlan } from '@/common/model/funding-plan';
import { ValidationError } from '@/common/exceptions/base';
import {
  FundingPlanNotFoundError,
  CalendarFundingPlanNotFoundError,
  DuplicateCalendarFundingPlanError,
} from '@/common/exceptions/funding';

describe('FundingService - Calendar Subscription Methods', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: FundingService;
  let mockCalendarInterface: {
    isCalendarOwnerById: sinon.SinonStub;
    calendarExists: sinon.SinonStub;
    getCalendarOwnerAccountId: sinon.SinonStub;
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
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('addCalendarToFundingPlan', () => {
    it('should create a CalendarSubscription row and update provider total', async () => {
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const amount = 500000; // $5.00 in millicents
      const providerConfigId = uuidv4();

      const mockFundingPlanEntity = {
        id: subscriptionId,
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

      const mockCalendarSubscription = {
        id: uuidv4(),
        funding_plan_id: subscriptionId,
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
      // No existing active calendar subscription
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);
      const createStub = sandbox.stub(CalendarFundingPlanEntity, 'create').resolves(mockCalendarSubscription as any);
      // Sum of active calendar amounts (just the new one)
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([mockCalendarSubscription] as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.addCalendarToFundingPlan(accountId, calendarId, amount);

      expect(createStub.called).toBe(true);
      expect(mockAdapter.updateSubscriptionAmount.called).toBe(true);
    });

    it('should throw FundingPlanNotFoundError if no active subscription exists', async () => {
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
      const subscriptionId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves({
        id: subscriptionId,
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

    it('should throw DuplicateCalendarFundingPlanError if active subscription already exists', async () => {
      const accountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves({
        id: subscriptionId,
        account_id: accountId,
        status: 'active',
      } as any);

      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
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
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const mockFundingPlanEntity = {
        id: subscriptionId,
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
        funding_plan_id: subscriptionId,
        calendar_id: calendarId,
        amount: 500000,
        end_time: null as Date | null,
        save: sandbox.stub().resolves(),
      };

      // Another active calendar subscription remains
      const otherCalendarSub = {
        id: uuidv4(),
        funding_plan_id: subscriptionId,
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

      // The specific calendar subscription to remove
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(mockCalendarSub as any);
      // Remaining active subscriptions (after end_time is set)
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

    it('should cancel subscription via this.cancel() when removing last active calendar', async () => {
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const mockFundingPlanEntity = {
        id: subscriptionId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: periodEnd,
        cancelled_at: null as Date | null,
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
        funding_plan_id: subscriptionId,
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
      // No remaining active subscriptions
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([]);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.removeCalendarFromFundingPlan(accountId, calendarId);

      expect(mockCalendarSub.end_time).toEqual(periodEnd);
      expect(mockAdapter.cancelSubscription.called).toBe(true);
      expect(mockFundingPlanEntity.status).toBe('cancelled');
    });

    it('should throw FundingPlanNotFoundError if no active subscription exists', async () => {
      const accountId = uuidv4();
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);

      await expect(
        service.removeCalendarFromFundingPlan(accountId, uuidv4()),
      ).rejects.toThrow(FundingPlanNotFoundError);
    });

    it('should throw CalendarFundingPlanNotFoundError if no active calendar subscription', async () => {
      const accountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves({
        id: subscriptionId,
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
    it('should return admin-exempt when calendar owner is admin', async () => {
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

      // Owner has admin role
      const { AccountRoleEntity } = await import('@/server/common/entity/account');
      sandbox.stub(AccountRoleEntity, 'findOne').resolves({
        account_id: accountId,
        role: 'admin',
      } as any);

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('admin-exempt');
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

      const { AccountRoleEntity } = await import('@/server/common/entity/account');
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);

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

    it('should return funded when calendar has an active calendar subscription', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      // Account owns the calendar
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      const { AccountRoleEntity } = await import('@/server/common/entity/account');
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);

      // No grant - hasActiveGrant returns null for first call, CalendarFundingPlanEntity for second
      const findOneStub = sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);

      // Active calendar subscription exists
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        end_time: null,
      } as any);

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('funded');
    });

    it('should return unfunded when no exemption, grant, or subscription exists', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      // Account owns the calendar
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      const { AccountRoleEntity } = await import('@/server/common/entity/account');
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);

      const status = await service.getFundingStatusForCalendar(accountId, calendarId);
      expect(status).toBe('unfunded');
    });

    it('should return unfunded when calendar has no owner', async () => {
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
      expect(status).toBe('unfunded');
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
