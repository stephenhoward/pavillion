import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import { FundingSettingsEntity } from '../entity/funding_settings';
import { ProviderConfigEntity } from '../entity/provider_config';
import { FundingPlanEntity } from '../entity/funding_plan';
import { FundingEventEntity } from '../entity/funding_event';
import { FundingSettings } from '@/common/model/funding-plan';
import { millicentsToDisplay, displayToMillicents } from '@/common/model/funding-plan';

describe('Funding Plan Entities', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('FundingSettingsEntity', () => {
    it('should convert entity to model and back', () => {
      const entityData = {
        id: 'test-id',
        enabled: true,
        monthly_price: 1000000, // $10.00 in millicents
        yearly_price: 10000000, // $100.00 in millicents
        currency: 'USD',
        pay_what_you_can: false,
        grace_period_days: 7,
      };

      const entity = FundingSettingsEntity.build(entityData);

      const model = entity.toModel();
      expect(model).toBeInstanceOf(FundingSettings);
      expect(model.id).toBe('test-id');
      expect(model.enabled).toBe(true);
      expect(model.monthlyPrice).toBe(1000000);
      expect(model.yearlyPrice).toBe(10000000);
      expect(model.currency).toBe('USD');
      expect(model.payWhatYouCan).toBe(false);
      expect(model.gracePeriodDays).toBe(7);

      const newEntity = FundingSettingsEntity.fromModel(model);
      expect(newEntity.get('id')).toBe('test-id');
      expect(newEntity.get('enabled')).toBe(true);
      expect(newEntity.get('monthly_price')).toBe(1000000);
      expect(newEntity.get('yearly_price')).toBe(10000000);
      expect(newEntity.get('currency')).toBe('USD');
      expect(newEntity.get('pay_what_you_can')).toBe(false);
      expect(newEntity.get('grace_period_days')).toBe(7);
    });
  });

  describe('ProviderConfigEntity', () => {
    it('should encrypt and decrypt credentials', () => {
      const testCredentials = JSON.stringify({
        apiKey: 'sk_test_123456',
        secretKey: 'secret_abc',
      });

      const entityData = {
        id: 'provider-id',
        provider_type: 'stripe' as const,
        enabled: true,
        display_name: 'Credit Card',
        credentials: 'encrypted:credentials', // Simulating encrypted data
        webhook_secret: 'encrypted:webhook', // Simulating encrypted data
      };

      const entity = ProviderConfigEntity.build(entityData);

      // Set up temporary fields to simulate decryption
      entity._decryptedCredentials = testCredentials;
      entity._decryptedWebhookSecret = 'whsec_test';

      // toModel() should NOT include credentials
      const model = entity.toModel();
      expect((model as any).credentials).toBeUndefined();
      expect((model as any).webhookSecret).toBeUndefined();

      // Decrypt methods should return plaintext values
      expect(entity.decryptCredentials()).toBe(testCredentials);
      expect(entity.decryptWebhookSecret()).toBe('whsec_test');
    });
  });

  describe('FundingPlanEntity', () => {
    it('should validate status transitions', () => {
      const entityData = {
        id: 'sub-id',
        account_id: 'account-id',
        provider_config_id: 'provider-id',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        status: 'active' as const,
        billing_cycle: 'monthly' as const,
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelled_at: null,
        cancel_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        suspended_at: null,
      };

      const entity = FundingPlanEntity.build(entityData);

      // Test model conversion
      const model = entity.toModel();
      expect(model.status).toBe('active');
      expect(model.billingCycle).toBe('monthly');
      expect(model.amount).toBe(1000000);
      // The scheduled cancellation has to survive the round trip: it is the
      // only thing distinguishing this plan from one that is simply running.
      expect(model.cancelAt).toEqual(entityData.cancel_at);

      // Test fromModel
      const newEntity = FundingPlanEntity.fromModel(model);
      expect(newEntity.get('status')).toBe('active');
      expect(newEntity.get('billing_cycle')).toBe('monthly');
      expect(newEntity.get('cancel_at')).toEqual(entityData.cancel_at);
    });

    describe('status transition hook', () => {
      const planRow = (status: 'active' | 'past_due' | 'suspended' | 'cancelled') => ({
        id: 'sub-id',
        account_id: 'account-id',
        provider_config_id: 'provider-id',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        status,
        billing_cycle: 'monthly' as const,
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelled_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
        cancel_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        suspended_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      /**
       * Builds a plan in the given status, with both lifecycle markers set, for
       * tests that then reassign .status. That reassignment is what populates
       * previous('status'), so these instances need no further ceremony.
       */
      function buildPlan(status: 'active' | 'past_due' | 'suspended' | 'cancelled'): FundingPlanEntity {
        return FundingPlanEntity.build(planRow(status));
      }

      it('should clear both cancellation markers when a cancelled plan is resubscribed', () => {
        const entity = buildPlan('cancelled');

        entity.status = 'active';
        FundingPlanEntity.validateStatusTransition(entity);

        // A stale cancellation marker on a paying plan would read as an
        // expired plan to the funding-access check. cancel_at matters more
        // than cancelled_at here: it is the one planAccessExpiry reads, so a
        // stale one actively denies a paying customer.
        expect(entity.cancelled_at).toBeNull();
        expect(entity.cancel_at).toBeNull();
      });

      it('should clear suspended_at when a suspended plan is reactivated', () => {
        const entity = buildPlan('suspended');

        entity.status = 'active';
        FundingPlanEntity.validateStatusTransition(entity);

        expect(entity.suspended_at).toBeNull();
      });

      it('should set cancelled_at when a plan is cancelled', () => {
        const entity = buildPlan('active');
        entity.cancelled_at = null;

        entity.status = 'cancelled';
        FundingPlanEntity.validateStatusTransition(entity);

        expect(entity.cancelled_at).toBeInstanceOf(Date);
      });

      it('should leave both markers untouched when the status does not change', () => {
        // A save that touches some other column must not restamp the lifecycle
        // markers. raw: true seeds previous() from the row without any
        // reassignment, which is what a loaded-then-resaved record looks like
        // when status is not among the columns being updated.
        const row = planRow('cancelled');
        const entity = FundingPlanEntity.build(row, { isNewRecord: false, raw: true });

        expect(entity.previous('status')).toBe('cancelled');

        FundingPlanEntity.validateStatusTransition(entity);

        expect(entity.cancelled_at).toBe(row.cancelled_at);
        expect(entity.cancel_at).toBe(row.cancel_at);
        expect(entity.suspended_at).toBe(row.suspended_at);
      });

      it('should leave a scheduled cancellation alone while the plan is still active', () => {
        // The state a cancel-at-period-end produces: 'active' with cancel_at
        // set. Every later save of that row — a period roll, an amount change
        // — passes through this hook without a status change, and none of them
        // may drop the boundary.
        const row = planRow('active');
        const entity = FundingPlanEntity.build(row, { isNewRecord: false, raw: true });

        FundingPlanEntity.validateStatusTransition(entity);

        expect(entity.cancel_at).toBe(row.cancel_at);
      });
    });
  });

  describe('FundingEventEntity', () => {
    it('should round-trip fundingPlanId through toModel and fromModel', () => {
      const entity = FundingEventEntity.build({
        id: 'event-id',
        funding_plan_id: 'plan-id',
        event_type: 'invoice.paid',
        provider_event_id: 'evt_123',
        payload: '{"status":"active"}',
        processed_at: new Date(),
      });

      const model = entity.toModel();
      expect(model.fundingPlanId).toBe('plan-id');

      const newEntity = FundingEventEntity.fromModel(model);
      expect(newEntity.get('funding_plan_id')).toBe('plan-id');
      expect(newEntity.get('id')).toBe('event-id');
      expect(newEntity.get('event_type')).toBe('invoice.paid');
      expect(newEntity.get('provider_event_id')).toBe('evt_123');
    });

    it('should round-trip a null fundingPlanId for events with no local plan', () => {
      const entity = FundingEventEntity.build({
        id: 'event-id',
        funding_plan_id: null,
        event_type: 'invoice.paid',
        provider_event_id: 'evt_orphan',
        payload: '{"status":null}',
        processed_at: new Date(),
      });

      const model = entity.toModel();
      expect(model.fundingPlanId).toBeNull();

      const newEntity = FundingEventEntity.fromModel(model);
      expect(newEntity.get('funding_plan_id')).toBeNull();
    });

    it('should store event payload as JSON', () => {
      const payload = {
        type: 'invoice.paid',
        data: {
          amount: 1000,
          currency: 'usd',
        },
      };

      const entityData = {
        id: 'event-id',
        funding_plan_id: 'sub-id',
        event_type: 'invoice.paid',
        provider_event_id: 'evt_123',
        payload: JSON.stringify(payload),
        processed_at: new Date(),
      };

      const entity = FundingEventEntity.build(entityData);

      const model = entity.toModel();
      expect(model.eventType).toBe('invoice.paid');
      expect(model.providerEventId).toBe('evt_123');

      const storedPayload = JSON.parse(model.payload);
      expect(storedPayload.type).toBe('invoice.paid');
      expect(storedPayload.data.amount).toBe(1000);
    });
  });

  describe('Millicent Currency Conversion', () => {
    it('should convert millicents to display amount correctly', () => {
      expect(millicentsToDisplay(1000000)).toBe('10.00');
      expect(millicentsToDisplay(500000)).toBe('5.00');
      expect(millicentsToDisplay(1234567)).toBe('12.35'); // Rounds
      expect(millicentsToDisplay(0)).toBe('0.00');
    });

    it('should convert display amount to millicents correctly', () => {
      expect(displayToMillicents('10.00')).toBe(1000000);
      expect(displayToMillicents('5.50')).toBe(550000);
      expect(displayToMillicents('0.01')).toBe(1000);
      expect(displayToMillicents('100')).toBe(10000000);
    });
  });

  describe('Entity Associations', () => {
    it('should establish funding plan to account relationship', () => {
      const planData = {
        id: 'sub-id',
        account_id: 'account-id',
        provider_config_id: 'provider-id',
        provider_subscription_id: 'sub_123',
        provider_customer_id: 'cus_123',
        status: 'active' as const,
        billing_cycle: 'monthly' as const,
        amount: 1000000,
        currency: 'USD',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelled_at: null,
        suspended_at: null,
      };

      const plan = FundingPlanEntity.build(planData);

      expect(plan.account_id).toBe('account-id');
      expect(plan.provider_config_id).toBe('provider-id');

      // Test toModel includes foreign key relationships
      const model = plan.toModel();
      expect(model.accountId).toBe('account-id');
      expect(model.providerConfigId).toBe('provider-id');
    });
  });
});
