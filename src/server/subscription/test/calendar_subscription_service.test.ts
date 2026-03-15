import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import SubscriptionService from '@/server/subscription/service/subscription';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { CalendarSubscriptionEntity } from '@/server/subscription/entity/calendar_subscription';
import { ComplimentaryGrantEntity } from '@/server/subscription/entity/complimentary_grant';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import { SubscriptionSettingsEntity } from '@/server/subscription/entity/subscription_settings';
import { ProviderFactory } from '@/server/subscription/service/provider/factory';
import { SubscriptionSettings, ProviderConfig, Subscription } from '@/common/model/subscription';
import { ValidationError } from '@/common/exceptions/base';
import {
  SubscriptionNotFoundError,
  CalendarSubscriptionNotFoundError,
  DuplicateCalendarSubscriptionError,
} from '@/server/subscription/exceptions';

describe('SubscriptionService - Calendar Subscription Methods', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: SubscriptionService;
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
    service = new SubscriptionService(eventBus);

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

  describe('addCalendarToSubscription', () => {
    it('should create a CalendarSubscription row and update Stripe total', async () => {
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const amount = 500000; // $5.00 in millicents
      const providerConfigId = uuidv4();

      const mockSubscriptionEntity = {
        id: subscriptionId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.accountId = this.account_id;
          sub.providerConfigId = this.provider_config_id;
          sub.providerSubscriptionId = this.provider_subscription_id;
          sub.status = this.status;
          return sub;
        },
      };

      const mockCalendarSubscription = {
        id: uuidv4(),
        subscription_id: subscriptionId,
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

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves(mockSubscriptionEntity as any);
      // No existing active calendar subscription
      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves(null);
      const createStub = sandbox.stub(CalendarSubscriptionEntity, 'create').resolves(mockCalendarSubscription as any);
      // Sum of active calendar amounts (just the new one)
      sandbox.stub(CalendarSubscriptionEntity, 'findAll').resolves([mockCalendarSubscription] as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.addCalendarToSubscription(accountId, subscriptionId, calendarId, amount);

      expect(createStub.called).toBe(true);
      expect(mockAdapter.updateSubscriptionAmount.called).toBe(true);
    });

    it('should throw SubscriptionNotFoundError if subscription does not exist', async () => {
      const accountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves(null);

      await expect(
        service.addCalendarToSubscription(accountId, subscriptionId, calendarId, 500000),
      ).rejects.toThrow(SubscriptionNotFoundError);
    });

    it('should throw ValidationError if account does not own the subscription', async () => {
      const accountId = uuidv4();
      const otherAccountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves({
        id: subscriptionId,
        account_id: otherAccountId,
        status: 'active',
      } as any);

      await expect(
        service.addCalendarToSubscription(accountId, subscriptionId, calendarId, 500000),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if account does not own the calendar', async () => {
      const accountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves({
        id: subscriptionId,
        account_id: accountId,
        status: 'active',
      } as any);

      // Account is not an owner of the calendar
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(false);

      await expect(
        service.addCalendarToSubscription(accountId, subscriptionId, calendarId, 500000),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw DuplicateCalendarSubscriptionError if active subscription already exists', async () => {
      const accountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves({
        id: subscriptionId,
        account_id: accountId,
        status: 'active',
      } as any);

      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves({
        id: uuidv4(),
        end_time: null,
      } as any);

      await expect(
        service.addCalendarToSubscription(accountId, subscriptionId, calendarId, 500000),
      ).rejects.toThrow(DuplicateCalendarSubscriptionError);
    });

    it('should throw error with InvalidAmountError name if amount is negative', async () => {
      const accountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      try {
        await service.addCalendarToSubscription(accountId, subscriptionId, calendarId, -100);
        expect.fail('Should have thrown');
      }
      catch (err: any) {
        expect(err.name).toBe('InvalidAmountError');
      }
    });

    it('should throw ValidationError for invalid UUID parameters', async () => {
      await expect(
        service.addCalendarToSubscription('not-uuid', uuidv4(), uuidv4(), 500000),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.addCalendarToSubscription(uuidv4(), 'not-uuid', uuidv4(), 500000),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.addCalendarToSubscription(uuidv4(), uuidv4(), 'not-uuid', 500000),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('removeCalendarFromSubscription', () => {
    it('should set end_time and reduce Stripe amount', async () => {
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const mockSubscriptionEntity = {
        id: subscriptionId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: periodEnd,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.accountId = this.account_id;
          sub.providerConfigId = this.provider_config_id;
          sub.providerSubscriptionId = this.provider_subscription_id;
          sub.currentPeriodEnd = this.current_period_end;
          return sub;
        },
      };

      const mockCalendarSub = {
        id: uuidv4(),
        subscription_id: subscriptionId,
        calendar_id: calendarId,
        amount: 500000,
        end_time: null as Date | null,
        save: sandbox.stub().resolves(),
      };

      // Another active calendar subscription remains
      const otherCalendarSub = {
        id: uuidv4(),
        subscription_id: subscriptionId,
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

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves(mockSubscriptionEntity as any);
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      // The specific calendar subscription to remove
      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves(mockCalendarSub as any);
      // Remaining active subscriptions (after end_time is set)
      sandbox.stub(CalendarSubscriptionEntity, 'findAll').resolves([otherCalendarSub] as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.removeCalendarFromSubscription(accountId, subscriptionId, calendarId);

      expect(mockCalendarSub.end_time).toEqual(periodEnd);
      expect(mockCalendarSub.save.called).toBe(true);
      expect(mockAdapter.updateSubscriptionAmount.called).toBe(true);
      // Should update with remaining amount (300000)
      expect(mockAdapter.updateSubscriptionAmount.firstCall.args[1]).toBe(300000);
    });

    it('should cancel subscription when removing last active calendar', async () => {
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const mockSubscriptionEntity = {
        id: subscriptionId,
        account_id: accountId,
        provider_config_id: providerConfigId,
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: periodEnd,
        cancelled_at: null as Date | null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.accountId = this.account_id;
          sub.providerConfigId = this.provider_config_id;
          sub.providerSubscriptionId = this.provider_subscription_id;
          sub.currentPeriodEnd = this.current_period_end;
          return sub;
        },
      };

      const mockCalendarSub = {
        id: uuidv4(),
        subscription_id: subscriptionId,
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

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves(mockSubscriptionEntity as any);
      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);
      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves(mockCalendarSub as any);
      // No remaining active subscriptions
      sandbox.stub(CalendarSubscriptionEntity, 'findAll').resolves([]);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.removeCalendarFromSubscription(accountId, subscriptionId, calendarId);

      expect(mockCalendarSub.end_time).toEqual(periodEnd);
      expect(mockAdapter.cancelSubscription.called).toBe(true);
      expect(mockSubscriptionEntity.status).toBe('cancelled');
    });

    it('should throw SubscriptionNotFoundError if subscription does not exist', async () => {
      const accountId = uuidv4();
      sandbox.stub(SubscriptionEntity, 'findByPk').resolves(null);

      await expect(
        service.removeCalendarFromSubscription(accountId, uuidv4(), uuidv4()),
      ).rejects.toThrow(SubscriptionNotFoundError);
    });

    it('should throw CalendarSubscriptionNotFoundError if no active calendar subscription', async () => {
      const accountId = uuidv4();
      const subscriptionId = uuidv4();
      const calendarId = uuidv4();

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves({
        id: subscriptionId,
        account_id: accountId,
        status: 'active',
      } as any);

      mockCalendarInterface.isCalendarOwnerById
        .withArgs(accountId, calendarId)
        .resolves(true);

      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves(null);

      await expect(
        service.removeCalendarFromSubscription(accountId, subscriptionId, calendarId),
      ).rejects.toThrow(CalendarSubscriptionNotFoundError);
    });

    it('should throw ValidationError for invalid UUID parameters', async () => {
      await expect(
        service.removeCalendarFromSubscription('not-uuid', uuidv4(), uuidv4()),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getFundingStatusForCalendar', () => {
    it('should return admin-exempt when calendar owner is admin', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

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

      const status = await service.getFundingStatusForCalendar(calendarId);
      expect(status).toBe('admin-exempt');
    });

    it('should return grant when calendar has an active grant', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      const { AccountRoleEntity } = await import('@/server/common/entity/account');
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);

      // Active grant for this calendar
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        revoked_at: null,
        expires_at: null,
      } as any);

      const status = await service.getFundingStatusForCalendar(calendarId);
      expect(status).toBe('grant');
    });

    it('should return funded when calendar has an active calendar subscription', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      const { AccountRoleEntity } = await import('@/server/common/entity/account');
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);

      // No grant
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);

      // Active calendar subscription exists
      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves({
        id: uuidv4(),
        calendar_id: calendarId,
        end_time: null,
      } as any);

      const status = await service.getFundingStatusForCalendar(calendarId);
      expect(status).toBe('funded');
    });

    it('should return unfunded when no exemption, grant, or subscription exists', async () => {
      const calendarId = uuidv4();
      const accountId = uuidv4();

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(accountId);

      const { AccountRoleEntity } = await import('@/server/common/entity/account');
      sandbox.stub(AccountRoleEntity, 'findOne').resolves(null);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves(null);

      const status = await service.getFundingStatusForCalendar(calendarId);
      expect(status).toBe('unfunded');
    });

    it('should return unfunded when calendar has no owner', async () => {
      const calendarId = uuidv4();

      mockCalendarInterface.getCalendarOwnerAccountId
        .withArgs(calendarId)
        .resolves(null);

      const status = await service.getFundingStatusForCalendar(calendarId);
      expect(status).toBe('unfunded');
    });

    it('should throw ValidationError for invalid calendarId UUID', async () => {
      await expect(
        service.getFundingStatusForCalendar('not-a-uuid'),
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
          amount: totalAmount,
          currency: 'USD',
        }),
      };

      const subscriptionEntityId = uuidv4();
      const mockSubscriptionEntity = {
        id: subscriptionEntityId,
        save: sandbox.stub().resolves(),
        toModel: () => new Subscription(subscriptionEntityId),
      };

      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockSettings as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      sandbox.stub(SubscriptionEntity, 'fromModel').returns(mockSubscriptionEntity as any);

      // Ownership verification for both calendars via CalendarInterface
      mockCalendarInterface.isCalendarOwnerById.resolves(true);

      const createStub = sandbox.stub(CalendarSubscriptionEntity, 'create').resolves({} as any);

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
      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves({
        toModel: () => {
          const s = new SubscriptionSettings();
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
          const settings = new SubscriptionSettings();
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

      const mockSubscriptionEntity = {
        id: uuidv4(),
        save: sandbox.stub().resolves(),
        toModel: () => new Subscription(uuidv4()),
      };

      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockSettings as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      sandbox.stub(SubscriptionEntity, 'fromModel').returns(mockSubscriptionEntity as any);

      const createStub = sandbox.stub(CalendarSubscriptionEntity, 'create');

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
