import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import FundingService from '@/server/funding/service/funding';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_subscription';
import { ComplimentaryGrantEntity } from '@/server/funding/entity/complimentary_grant';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { FundingSettings, ProviderConfig, FundingPlan } from '@/common/model/funding-plan';
import { ValidationError } from '@/common/exceptions/base';
import {
  SubscriptionNotFoundError,
  CalendarSubscriptionNotFoundError,
  DuplicateCalendarSubscriptionError,
} from '@/server/funding/exceptions';

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

    it('should throw SubscriptionNotFoundError if no active subscription exists', async () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);

      await expect(
        service.addCalendarToFundingPlan(accountId, calendarId, 500000),
      ).rejects.toThrow(SubscriptionNotFoundError);
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

    it('should throw DuplicateCalendarSubscriptionError if active subscription already exists', async () => {
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
      ).rejects.toThrow(DuplicateCalendarSubscriptionError);
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

      // findOne is called for resolveActiveSubscription; findByPk is called in cancel()
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

    it('should throw SubscriptionNotFoundError if no active subscription exists', async () => {
      const accountId = uuidv4();
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);

      await expect(
        service.removeCalendarFromFundingPlan(accountId, uuidv4()),
      ).rejects.toThrow(SubscriptionNotFoundError);
    });

    it('should throw CalendarSubscriptionNotFoundError if no active calendar subscription', async () => {
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
      ).rejects.toThrow(CalendarSubscriptionNotFoundError);
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

  describe('subscribe with calendarIds', () => {
    it('should create CalendarSubscription rows for each calendarId', async () => {
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const calendarId1 = uuidv4();
      const calendarId2 = uuidv4();
      const totalAmount = 1000000; // $10.00

      const mockProviderConfig = {
        id: providerConfigId,
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{"apiKey":"test"}',
        webhook_secret: 'secret',
        toModel: function() {
          const config = new ProviderConfig(this.id, this.provider_type as any);
          config.enabled = this.enabled;
          config.displayName = this.display_name;
          return config;
        },
      };

      const mockSettings = {
        currency: 'USD',
        toModel: function() {
          const settings = new FundingSettings();
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
          amount: totalAmount,
          currency: 'USD',
        }),
      };

      const subscriptionEntityId = uuidv4();
      const mockFundingPlanEntity = {
        id: subscriptionEntityId,
        save: sandbox.stub().resolves(),
        toModel: () => new FundingPlan(subscriptionEntityId),
      };

      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(FundingSettingsEntity, 'findOne').resolves(mockSettings as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      sandbox.stub(FundingPlanEntity, 'fromModel').returns(mockFundingPlanEntity as any);

      // Ownership verification for both calendars via CalendarInterface
      mockCalendarInterface.isCalendarOwnerById.resolves(true);

      const createStub = sandbox.stub(CalendarFundingPlanEntity, 'create').resolves({} as any);

      const subscription = await service.subscribe(
        accountId,
        'user@example.com',
        providerConfigId,
        'monthly',
        totalAmount,
        [calendarId1, calendarId2],
      );

      expect(subscription).toBeDefined();
      expect(createStub.callCount).toBe(2);
      // Each calendar gets proportional amount (total / count)
      const firstCallAmount = createStub.firstCall.args[0].amount;
      const secondCallAmount = createStub.secondCall.args[0].amount;
      expect(firstCallAmount).toBe(500000);
      expect(secondCallAmount).toBe(500000);
    });

    it('should throw ValidationError if calendarIds exceeds 50', async () => {
      const calendarIds = Array.from({ length: 51 }, () => uuidv4());

      await expect(
        service.subscribe(uuidv4(), 'user@test.com', uuidv4(), 'monthly', 1000000, calendarIds),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if calendarIds contains invalid UUID', async () => {
      const providerConfigId = uuidv4();

      const mockProviderConfig = {
        id: providerConfigId,
        enabled: true,
        toModel: function() {
          const config = new ProviderConfig(this.id, 'stripe');
          config.enabled = true;
          return config;
        },
      };

      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(FundingSettingsEntity, 'findOne').resolves({
        toModel: () => {
          const s = new FundingSettings();
          s.currency = 'USD';
          return s;
        },
      } as any);

      await expect(
        service.subscribe(uuidv4(), 'user@test.com', providerConfigId, 'monthly', 1000000, ['not-a-uuid']),
      ).rejects.toThrow(ValidationError);
    });

    it('should work without calendarIds (backward compatible)', async () => {
      const accountId = uuidv4();
      const providerConfigId = uuidv4();

      const mockProviderConfig = {
        id: providerConfigId,
        provider_type: 'stripe',
        enabled: true,
        toModel: function() {
          const config = new ProviderConfig(this.id, 'stripe');
          config.enabled = true;
          return config;
        },
      };

      const mockSettings = {
        toModel: function() {
          const settings = new FundingSettings();
          settings.currency = 'USD';
          return settings;
        },
      };

      const mockAdapter = {
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

      const mockFundingPlanEntity = {
        id: uuidv4(),
        save: sandbox.stub().resolves(),
        toModel: () => new FundingPlan(uuidv4()),
      };

      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(FundingSettingsEntity, 'findOne').resolves(mockSettings as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      sandbox.stub(FundingPlanEntity, 'fromModel').returns(mockFundingPlanEntity as any);

      const createStub = sandbox.stub(CalendarFundingPlanEntity, 'create');

      const subscription = await service.subscribe(
        accountId,
        'user@example.com',
        providerConfigId,
        'monthly',
        1000000,
      );

      expect(subscription).toBeDefined();
      // No calendar subscription rows should be created
      expect(createStub.called).toBe(false);
    });
  });
});
