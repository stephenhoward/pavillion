import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import db from '@/server/common/entity/db';
import FundingService, { MIN_PWYC_AMOUNT, MAX_PWYC_AMOUNT } from '@/server/funding/service/funding';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { ComplimentaryGrantEntity } from '@/server/funding/entity/complimentary_grant';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { FundingSettings, ProviderConfig, FundingPlan } from '@/common/model/funding-plan';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { WebhookEvent } from '@/server/funding/service/provider/adapter';
import {
  DuplicateGrantError,
  GrantNotFoundError,
  ActiveFundingPlanExistsError,
  ProviderNotConfiguredError,
  InvalidSessionIdError,
  WebhookSignatureError,
  FundingPlanNotFoundError,
} from '@/common/exceptions/funding';
import { ValidationError } from '@/common/exceptions/base';
import { v4 as uuidv4 } from 'uuid';
import config from 'config';

describe('FundingService', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let service: FundingService;
  let mockCalendarInterface: {
    isCalendarOwnerById: sinon.SinonStub;
    calendarExists: sinon.SinonStub;
    getCalendarOwnerAccountId: sinon.SinonStub;
    getCalendar: sinon.SinonStub;
  };
  let mockAccountsInterface: {
    accountIsAdmin: sinon.SinonStub;
  };
  beforeAll(async () => {
    // Sync database schema before running tests
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
      getCalendar: sandbox.stub().resolves(null),
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

  describe('getSettings', () => {
    it('should return instance funding settings', async () => {
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
          const settings = new FundingSettings(this.id);
          settings.enabled = this.enabled;
          settings.monthlyPrice = this.monthly_price;
          settings.yearlyPrice = this.yearly_price;
          settings.currency = this.currency;
          settings.payWhatYouCan = this.pay_what_you_can;
          settings.gracePeriodDays = this.grace_period_days;
          return settings;
        },
      };

      sandbox.stub(FundingSettingsEntity, 'findOne').resolves(mockEntity as any);

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
        pay_what_you_can_yearly_discount: 0,
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(FundingSettingsEntity, 'findOne').resolves(existingEntity as any);

      const updatedSettings = new FundingSettings(settingsId);
      updatedSettings.enabled = true;
      updatedSettings.monthlyPrice = 1000000;
      updatedSettings.yearlyPrice = 10000000;
      updatedSettings.currency = 'USD';
      updatedSettings.payWhatYouCanYearlyDiscount = 20;

      await service.updateSettings(updatedSettings);

      expect(existingEntity.enabled).toBe(true);
      expect(existingEntity.monthly_price).toBe(1000000);
      expect(existingEntity.yearly_price).toBe(10000000);
      expect(existingEntity.pay_what_you_can_yearly_discount).toBe(20);
      expect(existingEntity.save.called).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should mark funding plan for end-of-period cancellation', async () => {
      const fundingPlanId = uuidv4();
      const mockEntity = {
        id: fundingPlanId,
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
          const sub = new FundingPlan(this.id);
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

      sandbox.stub(FundingPlanEntity, 'findByPk').resolves(mockEntity as any);
      sandbox.stub(ProviderConfigEntity, 'findByPk').resolves(mockProviderConfig as any);
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await service.cancel(fundingPlanId, false);

      expect(mockAdapter.cancelSubscription.calledWith('sub_123', false)).toBe(true);
      expect(mockEntity.status).toBe('cancelled');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('processWebhookEvent', () => {
    it('should update funding plan status based on webhook event', async () => {
      const fundingPlanId = uuidv4();
      const providerEventId = 'evt_123';

      const mockEntity = {
        id: fundingPlanId,
        account_id: uuidv4(),
        provider_config_id: uuidv4(),
        provider_subscription_id: 'sub_123',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(),
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new FundingPlan(this.id);
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

      sandbox.stub(FundingPlanEntity, 'findOne').resolves(mockEntity as any);
      sandbox.stub(FundingEventEntity, 'findOne').resolves(null);
      sandbox.stub(FundingEventEntity.prototype, 'save').resolves(mockEventEntity as any);

      await service.processWebhookEvent(webhookEvent, uuidv4());

      expect(mockEntity.status).toBe('past_due');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('handleStripeWebhook', () => {
    const rawBody = JSON.stringify({
      id: 'evt_handle_test',
      type: 'invoice.paid',
      data: {
        object: {
          subscription: 'sub_handle_test',
          customer: 'cus_handle_test',
        },
      },
    });

    const signature = 'valid_signature';

    function makeStripeConfigEntity(id: string): any {
      const creds = JSON.stringify({ apiKey: 'sk_test_mock' });
      const whSecret = 'whsec_test';
      return {
        id,
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Credit Card',
        toModel: function() {
          const config = new ProviderConfig(this.id, this.provider_type);
          config.enabled = this.enabled;
          config.displayName = this.display_name;
          return config;
        },
        decryptCredentials: () => creds,
        decryptWebhookSecret: () => whSecret,
      };
    }

    it('should throw ProviderNotConfiguredError when Stripe is not configured', async () => {
      sandbox.stub(ProviderConfigEntity, 'findOne').resolves(null);

      await expect(
        service.handleStripeWebhook(rawBody, signature),
      ).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('should throw WebhookSignatureError when signature is invalid', async () => {
      const configId = uuidv4();
      sandbox.stub(ProviderConfigEntity, 'findOne').resolves(makeStripeConfigEntity(configId) as any);

      const mockAdapter = {
        providerType: 'stripe' as const,
        verifyWebhookSignature: sandbox.stub().returns(false),
        parseWebhookEvent: sandbox.stub(),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      await expect(
        service.handleStripeWebhook(rawBody, signature),
      ).rejects.toThrow(WebhookSignatureError);

      expect(mockAdapter.parseWebhookEvent.called).toBe(false);
    });

    it('should parse and process event when signature is valid', async () => {
      const configId = uuidv4();
      sandbox.stub(ProviderConfigEntity, 'findOne').resolves(makeStripeConfigEntity(configId) as any);

      const parsedEvent: WebhookEvent = {
        eventId: 'evt_handle_test',
        eventType: 'invoice.paid',
        subscriptionId: 'sub_handle_test',
        rawPayload: {},
      };

      const mockAdapter = {
        providerType: 'stripe' as const,
        verifyWebhookSignature: sandbox.stub().returns(true),
        parseWebhookEvent: sandbox.stub().returns(parsedEvent),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      const processStub = sandbox.stub(service, 'processWebhookEvent').resolves();

      await service.handleStripeWebhook(rawBody, signature);

      expect(mockAdapter.verifyWebhookSignature.calledWith(rawBody, signature)).toBe(true);
      expect(mockAdapter.parseWebhookEvent.calledWith(rawBody)).toBe(true);
      expect(processStub.calledWith(parsedEvent, configId)).toBe(true);
    });
  });

  describe('status transitions', () => {
    it('should transition from active to past_due on payment failure', async () => {
      const fundingPlanId = uuidv4();
      const mockEntity = {
        id: fundingPlanId,
        status: 'active',
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new FundingPlan(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      const mockEventEntity = {
        id: uuidv4(),
        save: sandbox.stub().resolves(),
      };

      sandbox.stub(FundingPlanEntity, 'findOne').resolves(mockEntity as any);
      sandbox.stub(FundingEventEntity, 'findOne').resolves(null);
      sandbox.stub(FundingEventEntity.prototype, 'save').resolves(mockEventEntity as any);

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
      const fundingPlanId = uuidv4();
      const gracePeriodDays = 7;
      const pastDueDate = new Date(Date.now() - (gracePeriodDays + 1) * 24 * 60 * 60 * 1000);

      const mockEntity = {
        id: fundingPlanId,
        status: 'past_due',
        updated_at: pastDueDate,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const sub = new FundingPlan(this.id);
          sub.status = this.status;
          return sub;
        },
      };

      sandbox.stub(FundingPlanEntity, 'findAll').resolves([mockEntity] as any);

      const mockSettings = {
        toModel: () => {
          const settings = new FundingSettings();
          settings.gracePeriodDays = gracePeriodDays;
          return settings;
        },
      };
      sandbox.stub(FundingSettingsEntity, 'findOne').resolves(mockSettings as any);

      await service.suspendExpiredFundingPlans();

      expect(mockEntity.status).toBe('suspended');
      expect(mockEntity.save.called).toBe(true);
    });
  });

  describe('hasActiveFundingPlan', () => {
    it('should return true for calendar with active funding plan via calendar_funding_plan join', async () => {
      const calendarId = uuidv4();
      const mockCalendarSub = {
        calendar_id: calendarId,
        end_time: null,
      };

      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(mockCalendarSub as any);

      const hasActive = await service.hasActiveFundingPlan(calendarId);

      expect(hasActive).toBe(true);
    });

    it('should return false for calendar without active funding plan', async () => {
      const calendarId = uuidv4();

      sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);

      const hasActive = await service.hasActiveFundingPlan(calendarId);

      expect(hasActive).toBe(false);
    });
  });

  describe('getPlanStatusForCalendars', () => {
    it('should return empty map for empty input without issuing queries', async () => {
      const grantFindAll = sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([]);
      const subFindAll = sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([]);

      const result = await service.getPlanStatusForCalendars([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(grantFindAll.called).toBe(false);
      expect(subFindAll.called).toBe(false);
    });

    it('should return all calendars as subscribed when all have active funding plans', async () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      const id3 = uuidv4();

      sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([]);
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([
        { calendar_id: id1 } as any,
        { calendar_id: id2 } as any,
        { calendar_id: id3 } as any,
      ]);

      const result = await service.getPlanStatusForCalendars([id1, id2, id3]);

      expect(result.size).toBe(3);
      expect(result.get(id1)).toBe('subscribed');
      expect(result.get(id2)).toBe('subscribed');
      expect(result.get(id3)).toBe('subscribed');
    });

    it('should return a mix of subscribed, grant, and none, omitting calendars with no record', async () => {
      const grantedId = uuidv4();
      const subscribedId = uuidv4();
      const unknownId = uuidv4();

      sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([
        { calendar_id: grantedId } as any,
      ]);
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([
        { calendar_id: subscribedId } as any,
      ]);

      const result = await service.getPlanStatusForCalendars([grantedId, subscribedId, unknownId]);

      expect(result.get(grantedId)).toBe('grant');
      expect(result.get(subscribedId)).toBe('subscribed');
      // Unknown IDs must be absent from the map so callers default to 'none'
      expect(result.has(unknownId)).toBe(false);
      expect(result.size).toBe(2);
    });

    it('should prefer grant over subscribed when a calendar has both', async () => {
      const calendarId = uuidv4();

      sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([
        { calendar_id: calendarId } as any,
      ]);
      sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([
        { calendar_id: calendarId } as any,
      ]);

      const result = await service.getPlanStatusForCalendars([calendarId]);

      expect(result.get(calendarId)).toBe('grant');
      expect(result.size).toBe(1);
    });

    it('should issue a single bulk IN query per table (no per-id loop)', async () => {
      const ids = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
      const grantFindAll = sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([]);
      const subFindAll = sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves([]);

      await service.getPlanStatusForCalendars(ids);

      // One bulk query per table — no loop over single-ID calls
      expect(grantFindAll.callCount).toBe(1);
      expect(subFindAll.callCount).toBe(1);
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

      mockCalendarInterface.calendarExists.withArgs(calendarId).resolves(true);
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

      mockCalendarInterface.calendarExists.withArgs(calendarId).resolves(true);
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

      mockCalendarInterface.calendarExists.withArgs(calendarId).resolves(true);
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

  describe('revokeExpiredGrants', () => {
    it('should revoke grants with expires_at in the past', async () => {
      const expiredGrant = {
        id: uuidv4(),
        calendar_id: uuidv4(),
        granted_by: uuidv4(),
        expires_at: new Date(Date.now() - 1000), // expired 1 second ago
        revoked_at: null,
        revoked_by: null,
        save: sandbox.stub().resolves(),
        toModel: function() {
          const grant = new ComplimentaryGrant(this.id);
          grant.calendarId = this.calendar_id;
          grant.grantedBy = this.granted_by;
          grant.expiresAt = this.expires_at;
          grant.revokedAt = this.revoked_at;
          grant.revokedBy = this.revoked_by;
          return grant;
        },
      };

      sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([expiredGrant as any]);

      await service.revokeExpiredGrants();

      expect(expiredGrant.save.calledOnce).toBe(true);
      expect(expiredGrant.revoked_at).toBeInstanceOf(Date);
      expect(expiredGrant.revoked_by).toBeNull(); // auto-revoked by system
    });

    it('should not revoke grants that have not expired', async () => {
      sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([]);

      await service.revokeExpiredGrants();
      // No errors, nothing to revoke
    });

    it('should not revoke already-revoked grants', async () => {
      // The query filters by revoked_at IS NULL, so already-revoked grants
      // won't be returned by findAll. Just verify findAll is called with
      // the correct where clause.
      const findAllStub = sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves([]);

      await service.revokeExpiredGrants();

      const whereClause = findAllStub.firstCall.args[0]?.where;
      expect(whereClause).toBeDefined();
      expect(whereClause.revoked_at).toBeDefined();
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

  describe('hasFundingAccess', () => {
    it('should return true if hasActiveGrant returns true', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(true);
      sandbox.stub(service, 'hasActiveFundingPlan').resolves(false);

      const result = await service.hasFundingAccess(calendarId);

      expect(result).toBe(true);
    });

    it('should return true if hasActiveFundingPlan returns true', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(false);
      sandbox.stub(service, 'hasActiveFundingPlan').resolves(true);

      const result = await service.hasFundingAccess(calendarId);

      expect(result).toBe(true);
    });

    it('should return false if both hasActiveGrant and hasActiveFundingPlan return false', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(false);
      sandbox.stub(service, 'hasActiveFundingPlan').resolves(false);

      const result = await service.hasFundingAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should return false if grant check errors and plan check returns false (fail-secure)', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').rejects(new Error('DB error'));
      sandbox.stub(service, 'hasActiveFundingPlan').resolves(false);

      const result = await service.hasFundingAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should return false if grant check returns false and plan check errors (fail-secure)', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(false);
      sandbox.stub(service, 'hasActiveFundingPlan').rejects(new Error('DB error'));

      const result = await service.hasFundingAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should return false if both checks error (fail-secure)', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').rejects(new Error('Grant DB error'));
      sandbox.stub(service, 'hasActiveFundingPlan').rejects(new Error('Sub DB error'));

      const result = await service.hasFundingAccess(calendarId);

      expect(result).toBe(false);
    });

    it('should not check funding plan if grant check succeeds with true', async () => {
      const calendarId = uuidv4();

      sandbox.stub(service, 'hasActiveGrant').resolves(true);
      const subStub = sandbox.stub(service, 'hasActiveFundingPlan').resolves(false);

      await service.hasFundingAccess(calendarId);

      expect(subStub.called).toBe(false);
    });
  });

  describe('checkFundingAccess', () => {
    const feature = 'widget_embedding';
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    let calendarId: string;
    let ownerId: string;

    beforeEach(() => {
      calendarId = uuidv4();
      ownerId = uuidv4();
      mockCalendarInterface.getCalendarOwnerAccountId.resolves(ownerId);
    });

    /** Stub the single instance funding-settings row. */
    function stubFundingEnabled(enabled: boolean): sinon.SinonStub {
      return sandbox.stub(FundingSettingsEntity, 'findOne').resolves({
        id: uuidv4(),
        enabled,
        monthly_price: 1000000,
        yearly_price: 10000000,
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
        toModel: function() {
          const settings = new FundingSettings(this.id);
          settings.enabled = this.enabled;
          settings.monthlyPrice = this.monthly_price;
          settings.yearlyPrice = this.yearly_price;
          settings.currency = this.currency;
          settings.payWhatYouCan = this.pay_what_you_can;
          settings.gracePeriodDays = this.grace_period_days;
          return settings;
        },
      } as any);
    }

    /**
     * Stub the accounts-domain admin check for the calendar owner. Returns the
     * stub so tests can assert the accounts domain was never consulted at all.
     */
    function stubOwnerIsAdmin(isAdmin: boolean): sinon.SinonStub {
      mockAccountsInterface.accountIsAdmin.withArgs(ownerId).resolves(isAdmin);
      return mockAccountsInterface.accountIsAdmin;
    }

    /** Stub the active complimentary grant lookup for the calendar. */
    function stubGrant(hasGrant: boolean): sinon.SinonStub {
      return sandbox.stub(ComplimentaryGrantEntity, 'findOne').resolves(
        hasGrant ? { calendar_id: calendarId, revoked_at: null, expires_at: null } as any : null,
      );
    }

    /**
     * Stub the calendar's funding-plan allocation. Pass null for no allocation,
     * or plan overrides to shape the funding plan the allocation belongs to.
     */
    function stubAllocation(
      plan: { status?: string; cancelled_at?: Date | null; current_period_end?: Date | null } | null,
    ): sinon.SinonStub {
      if (plan === null) {
        return sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves(null);
      }

      return sandbox.stub(CalendarFundingPlanEntity, 'findOne').resolves({
        calendar_id: calendarId,
        end_time: null,
        fundingPlan: {
          status: 'active',
          cancelled_at: null,
          current_period_end: new Date(Date.now() + 30 * DAY),
          ...plan,
        },
      } as any);
    }

    describe('invariant 1: funding not enabled on the instance', () => {
      it('should open the gate without consulting any funding state', async () => {
        stubFundingEnabled(false);
        const grantStub = stubGrant(false);
        const allocationStub = stubAllocation(null);
        const adminStub = stubOwnerIsAdmin(false);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
        // Instance autonomy (DEC-001): a calendar's funding state is irrelevant
        // when the instance operator has not turned funding on at all.
        expect(grantStub.called).toBe(false);
        expect(allocationStub.called).toBe(false);
        expect(adminStub.called).toBe(false);
      });
    });

    describe('invariant 2: admin-exempt', () => {
      it('should open the gate for a calendar owned by an admin', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(true);
        const grantStub = stubGrant(false);
        const allocationStub = stubAllocation(null);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
        // Admin exemption is decided before any funding state is read
        expect(grantStub.called).toBe(false);
        expect(allocationStub.called).toBe(false);
      });

      it('should fall through to funding state when the owner is not an admin', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        const allocationStub = stubAllocation(null);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
        expect(allocationStub.called).toBe(true);
      });

      it('should fall through to funding state when the calendar has no resolvable owner', async () => {
        stubFundingEnabled(true);
        mockCalendarInterface.getCalendarOwnerAccountId.resolves(null);
        const adminStub = stubOwnerIsAdmin(true);
        stubGrant(true);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
        expect(adminStub.called).toBe(false);
      });
    });

    describe('invariant 3: active plan or grant', () => {
      it('should open the gate for an active complimentary grant', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(true);
        const allocationStub = stubAllocation(null);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
        expect(allocationStub.called).toBe(false);
      });

      it('should open the gate for an active funding plan allocation', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        stubAllocation({});

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
      });

      it('should close the gate with neither a grant nor a funding plan allocation', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        stubAllocation(null);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });

      it('should close the gate once the paid-through period and its grace window have passed', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        // The plan the missed-webhook case actually produces: a deletion that
        // never arrived leaves status 'active' and no cancellation marker at
        // all, so only the paid-through date can end access.
        stubAllocation({
          status: 'active',
          cancelled_at: null,
          current_period_end: new Date(Date.now() - 30 * DAY),
        });

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });

      it('should keep the gate open inside the grace window after the paid-through date', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        // Two days past the period end with a 7-day grace window: a customer
        // mid-dunning, or a renewal whose webhook has not landed yet, keeps
        // access until the instance's own grace period runs out.
        stubAllocation({
          status: 'active',
          cancelled_at: null,
          current_period_end: new Date(Date.now() - 2 * DAY),
        });

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
      });

      /**
       * The three cases below pair a past or future cancelled_at with an
       * active status to characterise planAccessExpiry as a pure function of
       * the plan's dates. That combination is not reachable through today's
       * writers — cancel() and the status-transition hook only ever write
       * cancelled_at together with status 'cancelled' — so these pin the
       * helper's arithmetic, not a live path. They become live when
       * pv-jdot.3.1 lands a cancellation marker that leaves the plan active.
       */
      it('should close the gate once a recorded cancellation has passed, however long the period runs', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        // An immediate cancellation ends access when it is recorded, even
        // though the billing period it interrupted still has weeks to run.
        stubAllocation({
          status: 'active',
          cancelled_at: new Date(Date.now() - HOUR),
          current_period_end: new Date(Date.now() + 30 * DAY),
        });

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });

      it('should keep the gate open until a scheduled cancellation is reached', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        stubAllocation({
          status: 'active',
          cancelled_at: new Date(Date.now() + HOUR),
          current_period_end: null,
        });

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
      });

      it('should close the gate on a passed cancellation with no period end recorded', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        stubAllocation({
          status: 'active',
          cancelled_at: new Date(Date.now() - HOUR),
          current_period_end: null,
        });

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });
    });

    describe('invariant 4: indeterminate reads', () => {
      it('should close every gate when the instance funding settings cannot be read', async () => {
        sandbox.stub(FundingSettingsEntity, 'findOne').rejects(new Error('DB error'));
        stubOwnerIsAdmin(false);
        stubGrant(true);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });

      it('should open the gate on a determinate grant when the owner admin-role lookup fails', async () => {
        stubFundingEnabled(true);
        mockAccountsInterface.accountIsAdmin.rejects(new Error('DB error'));
        stubGrant(true);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
      });

      it('should open the gate on a determinate grant when the owner lookup fails', async () => {
        stubFundingEnabled(true);
        mockCalendarInterface.getCalendarOwnerAccountId.rejects(new Error('Calendar domain unavailable'));
        stubGrant(true);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(true);
      });

      it('should open the gate on a determinate plan allocation when the grant lookup fails', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        sandbox.stub(ComplimentaryGrantEntity, 'findOne').rejects(new Error('DB error'));
        const allocationStub = stubAllocation({});

        const allowed = await service.checkFundingAccess(calendarId, feature);

        // A grant read that fell over says nothing about the paid allocation
        // sitting right next to it
        expect(allowed).toBe(true);
        expect(allocationStub.called).toBe(true);
      });

      it('should close the gate when the grant lookup fails and there is no plan allocation', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        sandbox.stub(ComplimentaryGrantEntity, 'findOne').rejects(new Error('DB error'));
        stubAllocation(null);

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });

      it('should close the gate when the funding plan lookup fails', async () => {
        stubFundingEnabled(true);
        stubOwnerIsAdmin(false);
        stubGrant(false);
        sandbox.stub(CalendarFundingPlanEntity, 'findOne').rejects(new Error('DB error'));

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });

      it('should close the gate when every funding read fails', async () => {
        stubFundingEnabled(true);
        mockAccountsInterface.accountIsAdmin.rejects(new Error('DB error'));
        sandbox.stub(ComplimentaryGrantEntity, 'findOne').rejects(new Error('DB error'));
        sandbox.stub(CalendarFundingPlanEntity, 'findOne').rejects(new Error('DB error'));

        const allowed = await service.checkFundingAccess(calendarId, feature);

        expect(allowed).toBe(false);
      });
    });

    describe('input validation', () => {
      it('should reject a calendarId that is not a UUID', async () => {
        await expect(service.checkFundingAccess('not-a-uuid', feature))
          .rejects.toThrow(ValidationError);
      });

      it('should reject a feature key that is not in the registry', async () => {
        await expect(service.checkFundingAccess(calendarId, 'made_up_feature' as any))
          .rejects.toThrow(ValidationError);
      });
    });

    describe('parity with the legacy status vocabularies', () => {
      /**
       * Builds the funding plan a resubscribe leaves behind, by driving a real
       * entity through the production status-transition hook rather than
       * asserting what we imagine that hook writes. Assigning .status is what
       * populates previous('status'), which is what the hook reads.
       */
      function buildReactivatedPlan(): { status: string; cancelled_at: Date | null; current_period_end: Date | null } {
        const plan = FundingPlanEntity.build({
          id: uuidv4(),
          account_id: uuidv4(),
          provider_config_id: uuidv4(),
          provider_subscription_id: 'sub_test',
          provider_customer_id: 'cus_test',
          status: 'cancelled',
          billing_cycle: 'monthly',
          amount: 1000000,
          currency: 'USD',
          current_period_start: new Date(Date.now() - DAY),
          current_period_end: new Date(Date.now() + 30 * DAY),
          cancelled_at: new Date(Date.now() - 10 * DAY),
          suspended_at: null,
        });

        plan.status = 'active';
        FundingPlanEntity.validateStatusTransition(plan);

        return {
          status: plan.status,
          cancelled_at: plan.cancelled_at,
          current_period_end: plan.current_period_end,
        };
      }

      function planFor(world: { reactivated: boolean }): Record<string, unknown> {
        return world.reactivated ? buildReactivatedPlan() : {};
      }

      /**
       * Each world is a database state that produces one value of each legacy
       * vocabulary. checkFundingAccess must reach the same allow/deny outcome
       * the legacy widget gate reached for that state, where the legacy gate is
       * the composite: instance enabled -> admin bypass -> hasFundingAccess.
       */
      const worlds = [
        {
          name: 'admin-owned calendar with no funding state',
          isAdmin: true,
          hasGrant: false,
          hasAllocation: false,
          reactivated: false,
          legacyCalendarStatus: 'admin-exempt',
          legacyPlanStatus: undefined,
          allowed: true,
        },
        {
          name: 'calendar with an active complimentary grant',
          isAdmin: false,
          hasGrant: true,
          hasAllocation: false,
          reactivated: false,
          legacyCalendarStatus: 'grant',
          legacyPlanStatus: 'grant',
          allowed: true,
        },
        {
          name: 'calendar with an active funding plan allocation',
          isAdmin: false,
          hasGrant: false,
          hasAllocation: true,
          reactivated: false,
          legacyCalendarStatus: 'funded',
          legacyPlanStatus: 'subscribed',
          allowed: true,
        },
        {
          // A plan resubscribed after cancellation. The status-transition hook
          // clears cancelled_at on cancelled -> active, so no stale
          // cancellation marker can deny a customer who is paying again.
          name: 'calendar whose funding plan was reactivated after cancellation',
          isAdmin: false,
          hasGrant: false,
          hasAllocation: true,
          reactivated: true,
          legacyCalendarStatus: 'funded',
          legacyPlanStatus: 'subscribed',
          allowed: true,
        },
        {
          name: 'calendar with no funding state at all',
          isAdmin: false,
          hasGrant: false,
          hasAllocation: false,
          reactivated: false,
          legacyCalendarStatus: 'unfunded',
          legacyPlanStatus: undefined,
          allowed: false,
        },
      ] as const;

      for (const world of worlds) {
        it(`should decide identically to the legacy vocabularies for a ${world.name}`, async () => {
          stubFundingEnabled(true);
          stubOwnerIsAdmin(world.isAdmin);
          stubGrant(world.hasGrant);
          stubAllocation(world.hasAllocation ? planFor(world) : null);
          mockCalendarInterface.isCalendarOwnerById.resolves(true);
          sandbox.stub(ComplimentaryGrantEntity, 'findAll').resolves(
            world.hasGrant ? [{ calendar_id: calendarId } as any] : [],
          );
          sandbox.stub(CalendarFundingPlanEntity, 'findAll').resolves(
            world.hasAllocation ? [{ calendar_id: calendarId } as any] : [],
          );

          // Legacy vocabulary 1: single-calendar status
          expect(await service.getFundingStatusForCalendar(ownerId, calendarId))
            .toBe(world.legacyCalendarStatus);

          // Legacy vocabulary 2: bulk plan status ('none' is an absent key)
          const bulk = await service.getPlanStatusForCalendars([calendarId]);
          expect(bulk.get(calendarId)).toBe(world.legacyPlanStatus);

          // Legacy composite gate decision (calendar.ts widget gate)
          const legacyDecision = world.isAdmin || await service.hasFundingAccess(calendarId);
          expect(legacyDecision).toBe(world.allowed);

          expect(await service.checkFundingAccess(calendarId, feature)).toBe(world.allowed);
        });
      }
    });
  });

  describe('createCheckoutSession', () => {
    const accountId = uuidv4();
    const calendarId = uuidv4();
    const providerConfigId = uuidv4();
    const returnUrl = 'https://pavillion.dev/return';

    beforeEach(() => {
      // Stub config domain so URL validation uses the same domain as the test returnUrl,
      // regardless of local.yaml overrides in the developer's environment.
      sandbox.stub(config, 'get').withArgs('domain').returns('pavillion.dev');
    });

    function stubEnabledStripeProvider() {
      const mockEntity = {
        id: providerConfigId,
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Stripe',
        toModel: function() {
          const config = new ProviderConfig(this.id, 'stripe');
          config.enabled = true;
          config.displayName = this.display_name;
          return config;
        },
        decryptCredentials: () => '{}',
        decryptWebhookSecret: () => 'whsec_test',
      };
      sandbox.stub(ProviderConfigEntity, 'findOne').resolves(mockEntity as any);
      return mockEntity;
    }

    function stubSettings(overrides?: Partial<{ monthlyPrice: number; yearlyPrice: number; currency: string }>) {
      const mockSettings = {
        toModel: () => {
          const settings = new FundingSettings();
          settings.monthlyPrice = overrides?.monthlyPrice ?? 1000000;
          settings.yearlyPrice = overrides?.yearlyPrice ?? 10000000;
          settings.currency = overrides?.currency ?? 'USD';
          return settings;
        },
      };
      sandbox.stub(FundingSettingsEntity, 'findOne').resolves(mockSettings as any);
    }

    function stubMockAdapter() {
      const mockAdapter = {
        createCheckoutSession: sandbox.stub().resolves({
          clientSecret: 'cs_secret_abc',
          sessionId: 'cs_test_abc123',
        }),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      return mockAdapter;
    }

    it('should create checkout session with valid inputs (fixed pricing)', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      const mockAdapter = stubMockAdapter();

      const result = await service.createCheckoutSession(accountId, 'monthly', returnUrl);

      expect(result.clientSecret).toBe('cs_secret_abc');
      expect(result.sessionId).toBe('cs_test_abc123');
      expect(mockAdapter.createCheckoutSession.calledOnce).toBe(true);

      const params = mockAdapter.createCheckoutSession.firstCall.args[0];
      expect(params.accountId).toBe(accountId);
      expect(params.interval).toBe('month');
      expect(params.amount).toBe(1000000);
      expect(params.currency).toBe('USD');
    });

    it('should use yearly price for yearly billing cycle', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings({ yearlyPrice: 10000000 });
      const mockAdapter = stubMockAdapter();

      await service.createCheckoutSession(accountId, 'yearly', returnUrl);

      const params = mockAdapter.createCheckoutSession.firstCall.args[0];
      expect(params.interval).toBe('year');
      expect(params.amount).toBe(10000000);
    });

    it('should create checkout session with PWYC amount', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      const mockAdapter = stubMockAdapter();

      const pwycAmount = 500000; // $5.00

      await service.createCheckoutSession(accountId, 'monthly', returnUrl, pwycAmount);

      const params = mockAdapter.createCheckoutSession.firstCall.args[0];
      expect(params.amount).toBe(pwycAmount);
    });

    it('should pass calendarIds to adapter when provided', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      const mockAdapter = stubMockAdapter();
      mockCalendarInterface.isCalendarOwnerById.resolves(true);

      const calIds = [calendarId];
      await service.createCheckoutSession(accountId, 'monthly', returnUrl, undefined, calIds);

      const params = mockAdapter.createCheckoutSession.firstCall.args[0];
      expect(params.calendarIds).toEqual(calIds);
    });

    it('should reject if user already has active funding plan', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves({ id: uuidv4(), status: 'active' } as any);

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl),
      ).rejects.toThrow(ActiveFundingPlanExistsError);
    });

    it('should reject if no Stripe provider is configured', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      sandbox.stub(ProviderConfigEntity, 'findOne').resolves(null);

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl),
      ).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('should reject if Stripe provider is disabled', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      // findOne returns null because query has enabled: true
      sandbox.stub(ProviderConfigEntity, 'findOne').resolves(null);

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl),
      ).rejects.toThrow(ProviderNotConfiguredError);
    });

    it('should reject invalid billing cycle', async () => {
      await expect(
        service.createCheckoutSession(accountId, 'weekly' as any, returnUrl),
      ).rejects.toThrow(/billing cycle/i);
    });

    it('should reject PWYC amount below minimum', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl, MIN_PWYC_AMOUNT - 1),
      ).rejects.toThrow(/at least/i);
    });

    it('should reject PWYC amount above maximum', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl, MAX_PWYC_AMOUNT + 1),
      ).rejects.toThrow(/must not exceed/i);
    });

    it('should reject non-integer PWYC amount', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl, 150000.5),
      ).rejects.toThrow(/integer/i);
    });

    it('should reject calendarId that user does not own', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      stubMockAdapter();
      mockCalendarInterface.isCalendarOwnerById.resolves(false);

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl, undefined, [calendarId]),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject invalid UUID in calendarIds', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl, undefined, ['not-a-uuid']),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject calendarIds exceeding maximum count', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();

      const tooManyIds = Array.from({ length: 51 }, () => uuidv4());

      await expect(
        service.createCheckoutSession(accountId, 'monthly', returnUrl, undefined, tooManyIds),
      ).rejects.toThrow(ValidationError);
    });

    it('should accept PWYC amount at exact minimum boundary', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      const mockAdapter = stubMockAdapter();

      await service.createCheckoutSession(accountId, 'monthly', returnUrl, MIN_PWYC_AMOUNT);

      const params = mockAdapter.createCheckoutSession.firstCall.args[0];
      expect(params.amount).toBe(MIN_PWYC_AMOUNT);
    });

    it('should accept PWYC amount at exact maximum boundary', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      const mockAdapter = stubMockAdapter();

      await service.createCheckoutSession(accountId, 'monthly', returnUrl, MAX_PWYC_AMOUNT);

      const params = mockAdapter.createCheckoutSession.firstCall.args[0];
      expect(params.amount).toBe(MAX_PWYC_AMOUNT);
    });

    it('should reject return_url with foreign origin', async () => {
      await expect(
        service.createCheckoutSession(accountId, 'monthly', 'https://evil.com/phish'),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject return_url with non-http schemes', async () => {
      const maliciousUrls = [
        'javascript:alert(1)',
        'data:text/html,<h1>hi</h1>',
        'ftp://pavillion.dev/file',
      ];

      for (const url of maliciousUrls) {
        await expect(
          service.createCheckoutSession(accountId, 'monthly', url),
        ).rejects.toThrow(ValidationError);
      }
    });

    it('should reject unparseable return_url', async () => {
      await expect(
        service.createCheckoutSession(accountId, 'monthly', 'not a url at all'),
      ).rejects.toThrow(ValidationError);
    });

    it('should accept return_url matching configured domain', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      stubMockAdapter();

      // Should not throw - pavillion.dev is the test config domain
      await expect(
        service.createCheckoutSession(accountId, 'monthly', 'https://pavillion.dev/return'),
      ).resolves.toBeDefined();
    });

    it('should accept return_url with path and query params on valid domain', async () => {
      sandbox.stub(FundingPlanEntity, 'findOne').resolves(null);
      stubEnabledStripeProvider();
      stubSettings();
      stubMockAdapter();

      await expect(
        service.createCheckoutSession(accountId, 'monthly', 'https://pavillion.dev/funding/complete?session_id={CHECKOUT_SESSION_ID}&plan=monthly'),
      ).resolves.toBeDefined();
    });
  });

  describe('getCheckoutSessionStatus', () => {
    const accountId = uuidv4();
    const providerConfigId = uuidv4();

    function stubEnabledStripeProvider() {
      const mockEntity = {
        id: providerConfigId,
        provider_type: 'stripe',
        enabled: true,
        display_name: 'Stripe',
        toModel: function() {
          const config = new ProviderConfig(this.id, 'stripe');
          config.enabled = true;
          return config;
        },
        decryptCredentials: () => '{}',
        decryptWebhookSecret: () => 'whsec_test',
      };
      sandbox.stub(ProviderConfigEntity, 'findOne').resolves(mockEntity as any);
    }

    function stubMockAdapter(metadataAccountId: string) {
      const mockAdapter = {
        getCheckoutSessionStatus: sandbox.stub().resolves({
          status: 'complete',
          subscriptionId: 'sub_mock_123',
          customerId: 'cus_mock_123',
          metadata: {
            accountId: metadataAccountId,
            calendarIds: JSON.stringify([uuidv4()]),
          },
        }),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      // Stub idempotency check so processCheckoutCompleted returns early
      // without needing full funding-plan/DB mocking
      sandbox.stub(FundingPlanEntity, 'findOne').resolves({ id: uuidv4() } as any);
      return mockAdapter;
    }

    function stubMockAdapterWithMissingAccountId(metadataAccountId: string | undefined | null) {
      const mockAdapter = {
        getCheckoutSessionStatus: sandbox.stub().resolves({
          status: 'complete',
          subscriptionId: 'sub_mock_123',
          customerId: 'cus_mock_123',
          metadata: {
            accountId: metadataAccountId,
            calendarIds: JSON.stringify([uuidv4()]),
          },
        }),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);
      return mockAdapter;
    }

    it('should return status for valid session owned by requesting user', async () => {
      stubEnabledStripeProvider();
      stubMockAdapter(accountId);

      const result = await service.getCheckoutSessionStatus(accountId, 'cs_test_abc123def');

      expect(result.status).toBe('complete');
    });

    it('should throw FundingPlanNotFoundError on IDOR mismatch (not 403)', async () => {
      stubEnabledStripeProvider();
      const differentAccountId = uuidv4();
      stubMockAdapter(differentAccountId);

      await expect(
        service.getCheckoutSessionStatus(accountId, 'cs_test_abc123def'),
      ).rejects.toThrow(FundingPlanNotFoundError);
    });

    it('should throw FundingPlanNotFoundError when metadata.accountId is empty string', async () => {
      stubEnabledStripeProvider();
      stubMockAdapterWithMissingAccountId('');

      await expect(
        service.getCheckoutSessionStatus(accountId, 'cs_test_abc123def'),
      ).rejects.toThrow(FundingPlanNotFoundError);
    });

    it('should throw FundingPlanNotFoundError when metadata.accountId is undefined', async () => {
      stubEnabledStripeProvider();
      stubMockAdapterWithMissingAccountId(undefined);

      await expect(
        service.getCheckoutSessionStatus(accountId, 'cs_test_abc123def'),
      ).rejects.toThrow(FundingPlanNotFoundError);
    });

    it('should throw FundingPlanNotFoundError when metadata.accountId is null', async () => {
      stubEnabledStripeProvider();
      stubMockAdapterWithMissingAccountId(null);

      await expect(
        service.getCheckoutSessionStatus(accountId, 'cs_test_abc123def'),
      ).rejects.toThrow(FundingPlanNotFoundError);
    });

    it('should reject empty sessionId', async () => {
      await expect(
        service.getCheckoutSessionStatus(accountId, ''),
      ).rejects.toThrow(InvalidSessionIdError);
    });

    it('should reject sessionId exceeding 200 characters', async () => {
      const longId = 'cs_test_' + 'a'.repeat(200);

      await expect(
        service.getCheckoutSessionStatus(accountId, longId),
      ).rejects.toThrow(InvalidSessionIdError);
    });

    it('should reject sessionId without cs_test_ or cs_live_ prefix', async () => {
      await expect(
        service.getCheckoutSessionStatus(accountId, 'invalid_prefix_abc'),
      ).rejects.toThrow(InvalidSessionIdError);
    });

    it('should reject sessionId with special characters', async () => {
      await expect(
        service.getCheckoutSessionStatus(accountId, 'cs_test_abc$def!'),
      ).rejects.toThrow(InvalidSessionIdError);
    });

    it('should accept cs_live_ prefix', async () => {
      stubEnabledStripeProvider();
      stubMockAdapter(accountId);

      const result = await service.getCheckoutSessionStatus(accountId, 'cs_live_abc123def');

      expect(result.status).toBe('complete');
    });

    it('should accept sessionId with underscores', async () => {
      stubEnabledStripeProvider();
      stubMockAdapter(accountId);

      const result = await service.getCheckoutSessionStatus(accountId, 'cs_test_abc_123_def');

      expect(result.status).toBe('complete');
    });

    it('should reject null sessionId', async () => {
      await expect(
        service.getCheckoutSessionStatus(accountId, null as any),
      ).rejects.toThrow(InvalidSessionIdError);
    });

    it('should reject non-string sessionId', async () => {
      await expect(
        service.getCheckoutSessionStatus(accountId, 12345 as any),
      ).rejects.toThrow(InvalidSessionIdError);
    });

    it('should eagerly trigger processCheckoutCompleted when session is complete', async () => {
      stubEnabledStripeProvider();
      const mockAdapter = {
        getCheckoutSessionStatus: sandbox.stub().resolves({
          status: 'complete',
          subscriptionId: 'sub_eager_123',
          customerId: 'cus_eager_123',
          metadata: {
            accountId: accountId,
            calendarIds: JSON.stringify([uuidv4()]),
          },
        }),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      // Idempotency check finds existing plan — processCheckoutCompleted returns early
      // This proves the method was called without needing full DB mocking
      const findOneStub = sandbox.stub(FundingPlanEntity, 'findOne').resolves({
        id: uuidv4(),
        provider_subscription_id: 'sub_eager_123',
      } as any);

      const result = await service.getCheckoutSessionStatus(accountId, 'cs_test_eager123');

      expect(result.status).toBe('complete');
      // Verify processCheckoutCompleted was entered by checking the idempotency query
      expect(findOneStub.calledOnce).toBe(true);
      expect(findOneStub.firstCall.args[0]).toEqual({
        where: {
          provider_subscription_id: 'sub_eager_123',
          provider_config_id: providerConfigId,
        },
      });
    });

    it('should skip eager creation when session is not complete', async () => {
      stubEnabledStripeProvider();
      const mockAdapter = {
        getCheckoutSessionStatus: sandbox.stub().resolves({
          status: 'open',
          subscriptionId: undefined,
          customerId: undefined,
          metadata: {
            accountId: accountId,
          },
        }),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      const findOneSpy = sandbox.stub(FundingPlanEntity, 'findOne');

      const result = await service.getCheckoutSessionStatus(accountId, 'cs_test_open123');

      expect(result.status).toBe('open');
      // processCheckoutCompleted should NOT have been called
      expect(findOneSpy.called).toBe(false);
    });

    it('should skip eager creation when subscriptionId is missing', async () => {
      stubEnabledStripeProvider();
      const mockAdapter = {
        getCheckoutSessionStatus: sandbox.stub().resolves({
          status: 'complete',
          subscriptionId: undefined,
          customerId: 'cus_mock_123',
          metadata: {
            accountId: accountId,
          },
        }),
      };
      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter as any);

      const findOneSpy = sandbox.stub(FundingPlanEntity, 'findOne');

      const result = await service.getCheckoutSessionStatus(accountId, 'cs_test_nosub123');

      expect(result.status).toBe('complete');
      // processCheckoutCompleted should NOT have been called
      expect(findOneSpy.called).toBe(false);
    });
  });
});
