import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import db from '@/server/common/entity/db';
import SubscriptionService from '@/server/subscription/service/subscription';
import { SubscriptionSettingsEntity } from '@/server/subscription/entity/subscription_settings';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { SubscriptionEventEntity } from '@/server/subscription/entity/subscription_event';
import { ComplimentaryGrantEntity } from '@/server/subscription/entity/complimentary_grant';
import { CalendarSubscriptionEntity } from '@/server/subscription/entity/calendar_subscription';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { ProviderFactory } from '@/server/subscription/service/provider/factory';
import { SubscriptionSettings, ProviderConfig, Subscription } from '@/common/model/subscription';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { WebhookEvent } from '@/server/subscription/service/provider/adapter';
import {
  DuplicateGrantError,
  GrantNotFoundError,
} from '@/server/subscription/exceptions';
import { ValidationError } from '@/common/exceptions/base';
import { AccountEntity } from '@/server/common/entity/account';
import { v4 as uuidv4 } from 'uuid';

describe('SubscriptionService', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: SubscriptionService;

  beforeAll(async () => {
    // Sync database schema before running tests
    await db.sync({ force: true });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new SubscriptionService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getSettings', () => {
    it('should return instance subscription settings', async () => {
      const settingsId = uuidv4();
      const mockEntity = {
        id: settingsId,
        enabled: true,
        monthly_price: 1000000, // $10.00 in millicents
        yearly_price: 10000000, // $100.00 in millicents
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
        toModel: function() {
          const settings = new SubscriptionSettings(this.id);
          settings.enabled = this.enabled;
          settings.monthlyPrice = this.monthly_price;
          settings.yearlyPrice = this.yearly_price;
          settings.currency = this.currency;
          settings.payWhatYouCan = this.pay_what_you_can;
          settings.gracePeriodDays = this.grace_period_days;
          return settings;
        },
      };

      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockEntity as any);

      const settings = await service.getSettings();

      expect(settings).toBeDefined();
      expect(settings.enabled).toBe(true);
      expect(settings.monthlyPrice).toBe(1000000);
      expect(settings.yearlyPrice).toBe(10000000);
      expect(settings.currency).toBe('USD');
    });
  });

  describe('updateSettings', () => {
    it('should validate and save settings', async () => {
      const settingsId = uuidv4();
      const existingEntity = {
        id: settingsId,
        enabled: false,
        monthly_price: 0,
        yearly_price: 0,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(existingEntity as any);

      const updatedSettings = new SubscriptionSettings(settingsId);
      updatedSettings.enabled = true;
      updatedSettings.monthlyPrice = 1000000;
      updatedSettings.yearlyPrice = 10000000;
      updatedSettings.currency = 'USD';

      const result = await service.updateSettings(updatedSettings);

      expect(result).toBe(true);
      expect(existingEntity.enabled).toBe(true);
      expect(existingEntity.monthly_price).toBe(1000000);
      expect(existingEntity.yearly_price).toBe(10000000);
      expect(existingEntity.save.called).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('should create subscription via provider', async () => {
      const accountId = uuidv4();
      const providerConfigId = uuidv4();
      const subscriptionId = uuidv4();

      const mockProviderConfig = {
        id: providerConfigId,
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        credentials: '{"apiKey":"test"}',
        webhook_secret: 'secret',
        toModel: function() {
          const config = new ProviderConfig(this.id, this.provider_type);
          config.enabled = this.enabled;
          config.displayName = this.display_name;
          config.credentials = this.credentials;
          config.webhookSecret = this.webhook_secret;
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
          amount: 1000000,
          currency: 'USD',
        }),
      };

      const mockSubscriptionEntity = {
        id: subscriptionId,
        save: sandbox.stub().resolves(),
        toModel: () => new Subscription(subscriptionId),
      };

      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockSettings as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      sandbox.stub(SubscriptionEntity, 'fromModel').returns(mockSubscriptionEntity as any);

      const subscription = await service.subscribe(
        accountId,
        'user@example.com',
        providerConfigId,
        'monthly',
        1000000,
      );

      expect(subscription).toBeDefined();
      expect(mockAdapter.createSubscription.called).toBe(true);
      expect(mockSubscriptionEntity.save.called).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should mark subscription for end-of-period cancellation', async () => {
      const subscriptionId = uuidv4();
      const mockEntity = {
        id: subscriptionId,
        account_id: uuidv4(),
        provider_config_id: uuidv4(),
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        status: 'active',
        billing_cycle: 'monthly',
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelled_at: null,
        suspended_at: null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      const mockProviderConfig = {
        toModel: () => new ProviderConfig(uuidv4(), 'stripe'),
      };

      const mockAdapter = {
        cancelSubscription: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionEntity, 'findByPk').resolves(mockEntity as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.cancel(subscriptionId, false);

      expect(mockAdapter.cancelSubscription.calledWith('sub_123', false)).toBe(true);
      expect(mockEntity.status).toBe('cancelled');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('processWebhookEvent', () => {
    it('should update subscription status based on webhook event', async () => {
      const subscriptionId = uuidv4();
      const providerEventId = 'evt_123';

      const mockEntity = {
        id: subscriptionId,
        account_id: uuidv4(),
        provider_config_id: uuidv4(),
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(),
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      const webhookEvent: WebhookEvent = {
        eventId: providerEventId,
        eventType: 'invoice.payment_failed',
        subscriptionId: 'sub_123',
        status: 'past_due',
        rawPayload: {},
      };

      const mockEventEntity = {
        id: uuidv4(),
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionEntity, 'findOne').resolves(mockEntity as any);
      sandbox.stub(SubscriptionEventEntity, 'findOne').resolves(null);
      sandbox.stub(SubscriptionEventEntity.prototype, 'save').resolves(mockEventEntity as any);

      await service.processWebhookEvent(webhookEvent, uuidv4());

      expect(mockEntity.status).toBe('past_due');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('status transitions', () => {
    it('should transition from active to past_due on payment failure', async () => {
      const subscriptionId = uuidv4();
      const mockEntity = {
        id: subscriptionId,
        status: 'active',
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      const mockEventEntity = {
        id: uuidv4(),
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(SubscriptionEntity, 'findOne').resolves(mockEntity as any);
      sandbox.stub(SubscriptionEventEntity, 'findOne').resolves(null);
      sandbox.stub(SubscriptionEventEntity.prototype, 'save').resolves(mockEventEntity as any);

      const webhookEvent: WebhookEvent = {
        eventId: 'evt_123',
        eventType: 'payment_failed',
        subscriptionId: 'sub_123',
        status: 'past_due',
        rawPayload: {},
      };

      await service.processWebhookEvent(webhookEvent, uuidv4());

      expect(mockEntity.status).toBe('past_due');
    });

    it('should transition from past_due to suspended after grace period', async () => {
      const subscriptionId = uuidv4();
      const gracePeriodDays = 7;
      const pastDueDate = new Date(Date.now() - (gracePeriodDays + 1) * 24 * 60 * 60 * 1000);

      const mockEntity = {
        id: subscriptionId,
        status: 'past_due',
        updated_at: pastDueDate,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new Subscription(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      sandbox.stub(SubscriptionEntity, 'findAll').resolves([mockEntity] as any);

      const mockSettings = {
        toModel: () => {
          const settings = new SubscriptionSettings();
          settings.gracePeriodDays = gracePeriodDays;
          return settings;
        },
      };
      sandbox.stub(SubscriptionSettingsEntity, 'findOne').resolves(mockSettings as any);

      await service.suspendExpiredSubscriptions();

      expect(mockEntity.status).toBe('suspended');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('hasActiveSubscription', () => {
    it('should return true for calendar with active subscription via calendar_subscription join', async () => {
      const calendarId = uuidv4();
      const mockCalendarSub = {
        calendar_id: calendarId,
        end_time: null,
      };

      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves(mockCalendarSub as any);

      const hasActive = await service.hasActiveSubscription(calendarId);

      expect(hasActive).toBe(true);
    });

    it('should return false for calendar without active subscription', async () => {
      const calendarId = uuidv4();

      sandbox.stub(CalendarSubscriptionEntity, 'findOne').resolves(null);

      const hasActive = await service.hasActiveSubscription(calendarId);

      expect(hasActive).toBe(false);
    });
  });

  describe('createGrant', () => {
    it('should create a grant with valid calendarId', async () => {
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const grantId = uuidv4();

      const mockGrantEntity = {
        id: grantId,
        account_id: grantedBy,
        calendar_id: calendarId,
        granted_by: grantedBy,
        reason: null,
        expires_at: null,
        revoked_at: null,
        revoked_by: null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const grant = new ComplimentaryGrant(this.id);
          grant.accountId = this.account_id;
          grant.calendarId = this.calendar_id;
          grant.grantedBy = this.granted_by;
          grant.reason = this.reason;
          grant.expiresAt = this.expires_at;
          grant.revokedAt = this.revoked_at;
          grant.revokedBy = this.revoked_by;
          return grant;
        },
      };

      sandbox.stub(CalendarEntity, 'findByPk').resolves({ id: calendarId } as any);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(ComplimentaryGrantEntity, 'build').returns(mockGrantEntity as any);

      const grant = await service.createGrant(calendarId, grantedBy);

      expect(grant).toBeDefined();
      expect(grant.calendarId).toBe(calendarId);
      expect(grant.grantedBy).toBe(grantedBy);
      expect(mockGrantEntity.save.called).toBe(true);
    });

    it('should create a grant with optional reason and expiresAt', async () => {
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const reason = 'Beta tester reward';
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const mockGrantEntity = {
        id: uuidv4(),
        account_id: grantedBy,
        calendar_id: calendarId,
        granted_by: grantedBy,
        reason: reason,
        expires_at: expiresAt,
        revoked_at: null,
        revoked_by: null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const grant = new ComplimentaryGrant(this.id);
          grant.accountId = this.account_id;
          grant.calendarId = this.calendar_id;
          grant.grantedBy = this.granted_by;
          grant.reason = this.reason;
          grant.expiresAt = this.expires_at;
          grant.revokedAt = this.revoked_at;
          grant.revokedBy = this.revoked_by;
          return grant;
        },
      };

      sandbox.stub(CalendarEntity, 'findByPk').resolves({ id: calendarId } as any);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);
      sandbox.stub(ComplimentaryGrantEntity, 'build').returns(mockGrantEntity as any);

      const grant = await service.createGrant(calendarId, grantedBy, reason, expiresAt);

      expect(grant.reason).toBe(reason);
      expect(grant.expiresAt).toEqual(expiresAt);
    });

    it('should throw DuplicateGrantError if active grant already exists for calendar', async () => {
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const existingGrantEntity = {
        id: uuidv4(),
        calendar_id: calendarId,
        revoked_at: null,
        expires_at: null,
      };

      sandbox.stub(CalendarEntity, 'findByPk').resolves({ id: calendarId } as any);
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(existingGrantEntity as any);

      await expect(service.createGrant(calendarId, grantedBy)).rejects.toThrow(DuplicateGrantError);
    });

    it('should throw ValidationError for invalid calendarId UUID', async () => {
      await expect(
        service.createGrant('not-a-uuid', uuidv4()),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid grantedBy UUID', async () => {
      await expect(
        service.createGrant(uuidv4(), 'not-a-uuid'),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for reason exceeding 500 characters', async () => {
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const longReason = 'a'.repeat(501);

      await expect(
        service.createGrant(calendarId, grantedBy, longReason),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for expiresAt in the past', async () => {
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const pastDate = new Date(Date.now() - 1000);

      await expect(
        service.createGrant(calendarId, grantedBy, undefined, pastDate),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('revokeGrant', () => {
    it('should set revoked_at and revoked_by on the grant', async () => {
      const grantId = uuidv4();
      const revokedBy = uuidv4();

      const mockGrantEntity = {
        id: grantId,
        revoked_at: null,
        revoked_by: null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const grant = new ComplimentaryGrant(this.id);
          grant.revokedAt = this.revoked_at;
          grant.revokedBy = this.revoked_by;
          return grant;
        },
      };

      sandbox.stub(ComplimentaryGrantEntity, 'findByPk').resolves(mockGrantEntity as any);

      await service.revokeGrant(grantId, revokedBy);

      expect(mockGrantEntity.revoked_at).toBeInstanceOf(Date);
      expect(mockGrantEntity.revoked_by).toBe(revokedBy);
      expect(mockGrantEntity.save.called).toBe(true);
    });

    it('should throw GrantNotFoundError if grant does not exist', async () => {
      const grantId = uuidv4();
      const revokedBy = uuidv4();

      sandbox.stub(ComplimentaryGrantEntity, 'findByPk').resolves(null);

      await expect(service.revokeGrant(grantId, revokedBy)).rejects.toThrow(GrantNotFoundError);
    });

    it('should throw ValidationError for invalid grantId UUID', async () => {
      await expect(
        service.revokeGrant('not-a-uuid', uuidv4()),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid revokedBy UUID', async () => {
      await expect(
        service.revokeGrant(uuidv4(), 'not-a-uuid'),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('listGrants', () => {
    it('should return only active grants by default', async () => {
      const activeGrant = {
        id: uuidv4(),
        account_id: uuidv4(),
        revoked_at: null,
        expires_at: null,
        toModel: function() {
          const grant = new ComplimentaryGrant(this.id);
          grant.accountId = this.account_id;
          grant.revokedAt = this.revoked_at;
          return grant;
        },
      };

      const findAllStub = sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([activeGrant] as any);

      const grants = await service.listGrants();

      expect(grants).toHaveLength(1);
      expect(findAllStub.called).toBe(true);
      // Should have a where clause filtering revoked
      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs).toHaveProperty('where');
    });

    it('should return all grants including revoked when includeRevoked is true', async () => {
      const activeGrant = {
        id: uuidv4(),
        account_id: uuidv4(),
        revoked_at: null,
        expires_at: null,
        toModel: function() {
          return new ComplimentaryGrant(this.id);
        },
      };
      const revokedGrant = {
        id: uuidv4(),
        account_id: uuidv4(),
        revoked_at: new Date(),
        revoked_by: uuidv4(),
        expires_at: null,
        toModel: function() {
          return new ComplimentaryGrant(this.id);
        },
      };

      const findAllStub = sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([activeGrant, revokedGrant] as any);

      const grants = await service.listGrants(true);

      expect(grants).toHaveLength(2);
      expect(findAllStub.called).toBe(true);
      // Should not have a where clause when including revoked
      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs).not.toHaveProperty('where');
    });
  });

  describe('hasActiveGrant', () => {
    it('should return true for calendar with active grant', async () => {
      const calendarId = uuidv4();
      const mockGrant = {
        id: uuidv4(),
        calendar_id: calendarId,
        revoked_at: null,
        expires_at: null,
      };

      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(mockGrant as any);

      const result = await service.hasActiveGrant(calendarId);

      expect(result).toBe(true);
    });

    it('should return false for calendar with no grant', async () => {
      const calendarId = uuidv4();

      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);

      const result = await service.hasActiveGrant(calendarId);

      expect(result).toBe(false);
    });

    it('should return false for calendar with revoked grant', async () => {
      const calendarId = uuidv4();

      // hasActiveGrant queries with WHERE revoked_at IS NULL, so it returns null for revoked grants
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);

      const result = await service.hasActiveGrant(calendarId);

      expect(result).toBe(false);
    });

    it('should return false for calendar with expired grant', async () => {
      const calendarId = uuidv4();

      // hasActiveGrant queries with WHERE expires_at > NOW(), so expired returns null
      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);

      const result = await service.hasActiveGrant(calendarId);

      expect(result).toBe(false);
    });
  });

  describe('getGrantForCalendar', () => {
    it('should return active grant for calendar', async () => {
      const calendarId = uuidv4();
      const grantId = uuidv4();
      const mockGrantEntity = {
        id: grantId,
        calendar_id: calendarId,
        revoked_at: null,
        expires_at: null,
        toModel: function() {
          const grant = new ComplimentaryGrant(this.id);
          grant.calendarId = this.calendar_id;
          grant.revokedAt = this.revoked_at;
          grant.expiresAt = this.expires_at;
          return grant;
        },
      };

      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(mockGrantEntity as any);

      const grant = await service.getGrantForCalendar(calendarId);

      expect(grant).not.toBeNull();
      expect(grant?.calendarId).toBe(calendarId);
    });

    it('should return null when no active grant exists for calendar', async () => {
      const calendarId = uuidv4();

      sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(null);

      const grant = await service.getGrantForCalendar(calendarId);

      expect(grant).toBeNull();
    });
  });

  describe('hasSubscriptionAccess', () => {
    it('should return true if hasActiveGrant returns true', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(true);
      sandbox.stub(service, 'hasActiveSubscription').resolves(false);

      const result = await service.hasSubscriptionAccess(calendarId);

      expect(result).toBe(true);
    });

    it('should return true if hasActiveSubscription returns true', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(false);
      sandbox.stub(service, 'hasActiveSubscription').resolves(true);

      const result = await service.hasSubscriptionAccess(calendarId);

      expect(result).toBe(true);
    });

    it('should return false if both hasActiveGrant and hasActiveSubscription return false', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(false);
      sandbox.stub(service, 'hasActiveSubscription').resolves(false);

      const result = await service.hasSubscriptionAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should return false if grant check errors and subscription check returns false (fail-secure)', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').rejects(new Error('DB error'));
      sandbox.stub(service, 'hasActiveSubscription').resolves(false);

      const result = await service.hasSubscriptionAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should return false if grant check returns false and subscription check errors (fail-secure)', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(false);
      sandbox.stub(service, 'hasActiveSubscription').rejects(new Error('DB error'));

      const result = await service.hasSubscriptionAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should return false if both checks error (fail-secure)', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').rejects(new Error('Grant DB error'));
      sandbox.stub(service, 'hasActiveSubscription').rejects(new Error('Sub DB error'));

      const result = await service.hasSubscriptionAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should not check subscription if grant check succeeds with true', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(true);
      const subStub = sandbox.stub(service, 'hasActiveSubscription').resolves(false);

      await service.hasSubscriptionAccess(calendarId);

      expect(subStub.called).toBe(false);
    });
  });
});
