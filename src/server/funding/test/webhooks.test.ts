import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import express, { Application } from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import FundingService from '@/server/funding/service/funding';
import WebhookRoutes from '@/server/funding/api/v1/webhooks';
import FundingApiV1 from '@/server/funding/api/v1';
import AccountApiV1 from '@/server/accounts/api/v1';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { ProviderConfig } from '@/common/model/funding-plan';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { StripeAdapter } from '@/server/funding/service/provider/stripe';
import {
  ProviderNotConfiguredError,
  WebhookSignatureError,
} from '@/common/exceptions/funding';

// Mock Stripe module
vi.mock('stripe', () => {
  const mockConstructEvent = vi.fn();

  return {
    default: class Stripe {
      static Webhook = {
        constructEvent: mockConstructEvent,
      };
      webhooks = {
        constructEvent: mockConstructEvent,
      };
    },
  };
});

import Stripe from 'stripe';

/**
 * Create a parseWebhookEvent function that matches StripeAdapter behavior.
 * Used by test mocks so the webhook handler can delegate parsing to the adapter.
 */
function createParseWebhookEvent() {
  const adapter = new StripeAdapter({ apiKey: 'sk_test_mock' }, 'whsec_mock');
  return (payload: string) => adapter.parseWebhookEvent(payload);
}

/**
 * Build a minimal mock FundingInterface for thin-handler tests.
 * Only the methods called by WebhookRoutes need to be stubbed.
 */
function buildMockInterface(sandbox: sinon.SinonSandbox) {
  return {
    handleStripeWebhook: sandbox.stub().resolves(),
  };
}

describe('Webhook Handling', () => {

  // -------------------------------------------------------------------------
  // Thin API handler tests — service is mocked, only HTTP concerns are tested
  // -------------------------------------------------------------------------
  describe('API handler (thin layer)', () => {
    let app: Application;
    let sandbox: sinon.SinonSandbox;
    let mockInterface: ReturnType<typeof buildMockInterface>;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockInterface = buildMockInterface(sandbox);

      app = express();
      const webhookRoutes = new WebhookRoutes(mockInterface as any);
      webhookRoutes.installHandlers(app, '/api/funding');
    });

    afterEach(() => {
      sandbox.restore();
      vi.clearAllMocks();
    });

    describe('Stripe webhook handler', () => {
      it('should delegate to service and return 200 on success', async () => {
        const webhookPayload = JSON.stringify({ id: 'evt_ok', type: 'invoice.paid' });

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ received: true });
        expect(mockInterface.handleStripeWebhook.calledOnce).toBe(true);

        const [rawBody, sig] = mockInterface.handleStripeWebhook.firstCall.args;
        expect(rawBody).toBe(webhookPayload);
        expect(sig).toBe('valid_signature');
      });

      it('should return 400 when stripe-signature header is missing', async () => {
        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ id: 'evt_nosig', type: 'invoice.paid' }));

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Missing Stripe signature');
        expect(mockInterface.handleStripeWebhook.called).toBe(false);
      });

      it('should return 200 and discard event when Stripe is not configured', async () => {
        mockInterface.handleStripeWebhook.rejects(new ProviderNotConfiguredError('Stripe not configured'));

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'some_signature')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ id: 'evt_noconfig', type: 'invoice.paid' }));

        // Returns 200 so Stripe stops retrying — event has no handler on this instance
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ received: true });
        // Must NOT expose configuration state to the caller
        expect(response.body.error).toBeUndefined();
      });

      it('should return 400 with generic message when signature verification fails', async () => {
        mockInterface.handleStripeWebhook.rejects(new WebhookSignatureError());

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'bad_signature')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ id: 'evt_badsig', type: 'invoice.paid' }));

        expect(response.status).toBe(400);
        // Must return a generic message — must NOT echo the Stripe SDK error detail
        expect(response.body.error).toBe('Webhook signature verification failed');
        expect(response.body.error).not.toContain('No signatures found');
        expect(response.body.error).not.toContain('raw request body');
      });

      it('should return 500 for unexpected service errors', async () => {
        mockInterface.handleStripeWebhook.rejects(new Error('Unexpected DB error'));

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'some_signature')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ id: 'evt_err', type: 'invoice.paid' }));

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Internal server error');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Full-wiring tests — mounts through FundingApiV1.install, exactly as the
  // running app does. Regression guard for pv-ufag: a global express.json()
  // registered before the raw webhook route consumes the body, so the handler
  // receives the parsed object ("[object Object]") instead of the raw bytes
  // Stripe signed — making signature verification fail for every real event.
  // -------------------------------------------------------------------------
  describe('Full FundingApiV1 wiring (raw body preservation)', () => {
    let app: Application;
    let sandbox: sinon.SinonSandbox;
    let handleStripeWebhook: sinon.SinonStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      handleStripeWebhook = sandbox.stub().resolves();
      const mockInterface = {
        handleStripeWebhook,
      };

      app = express();
      FundingApiV1.install(app, mockInterface as any);
    });

    afterEach(() => {
      sandbox.restore();
      vi.clearAllMocks();
    });

    it('delivers the exact raw JSON body to the service for signature verification', async () => {
      const webhookPayload = JSON.stringify({ id: 'evt_raw_body', type: 'invoice.paid' });

      const response = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(handleStripeWebhook.calledOnce).toBe(true);

      // The raw body must reach the service byte-for-byte. If a global json
      // parser ran first, this would be "[object Object]" and Stripe signature
      // verification would fail.
      const [rawBody, signature] = handleStripeWebhook.firstCall.args;
      expect(rawBody).toBe(webhookPayload);
      expect(signature).toBe('valid_signature');
    });

    it('preserves the raw body when an earlier domain has already registered a parser (boot-order regression)', async () => {
      // The production bug was cross-domain: accounts (and authentication)
      // initialize before funding in server.ts and used to register a GLOBAL
      // express.json() that consumed the webhook body before funding's raw route
      // ran. A funding-only test cannot catch that — this composes the real
      // accounts installer first, exactly as the app boots. Every domain parser
      // must be scoped so /api/funding/webhooks stays raw (pv-ufag).
      const bootApp = express();
      AccountApiV1.install(bootApp, {} as any);
      FundingApiV1.install(bootApp, {
        handleStripeWebhook,
      } as any);

      const webhookPayload = JSON.stringify({ id: 'evt_boot_order', type: 'invoice.paid' });

      const response = await request(bootApp)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(handleStripeWebhook.calledOnce).toBe(true);
      const [rawBody] = handleStripeWebhook.firstCall.args;
      expect(rawBody).toBe(webhookPayload);
    });
  });

  // -------------------------------------------------------------------------
  // Integration tests — real service, tests business logic through the stack
  // -------------------------------------------------------------------------
  describe('Integration (full stack)', () => {
    let app: Application;
    let service: FundingService;
    let eventBus: EventEmitter;
    let sandbox: sinon.SinonSandbox;
    let stripeConfig: ProviderConfigEntity;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();
      await db.sync({ force: true });

      eventBus = new EventEmitter();
      service = new FundingService(eventBus);

      // Create test Stripe provider configuration
      const stripeModel = new ProviderConfig(uuidv4(), 'stripe');
      stripeModel.enabled = true;
      stripeModel.displayName = 'Credit Card';
      stripeConfig = ProviderConfigEntity.fromModel(stripeModel);
      stripeConfig._decryptedCredentials = JSON.stringify({ apiKey: 'sk_test_123' });
      stripeConfig._decryptedWebhookSecret = 'whsec_test_stripe';
      await stripeConfig.save();

      app = express();
      const webhookRoutes = new WebhookRoutes(service as any);
      webhookRoutes.installHandlers(app, '/api/funding');
    });

    afterEach(() => {
      sandbox.restore();
      vi.clearAllMocks();
      ProviderFactory.clearAllCaches();
    });

    describe('Webhook event processing', () => {
      it('should update subscription status when webhook event is processed', async () => {
        const subscriptionId = uuidv4();
        const subscription = new FundingPlanEntity();
        subscription.id = subscriptionId;
        subscription.account_id = uuidv4();
        subscription.provider_config_id = stripeConfig.id;
        subscription.provider_subscription_id = 'sub_test_123';
        subscription.provider_customer_id = 'cus_test_123';
        subscription.status = 'active';
        subscription.billing_cycle = 'monthly';
        subscription.amount = 1000000;
        subscription.currency = 'USD';
        subscription.current_period_start = new Date();
        subscription.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await subscription.save();

        const webhookPayload = JSON.stringify({
          id: 'evt_payment_failed',
          type: 'invoice.payment_failed',
          data: {
            object: {
              subscription: 'sub_test_123',
              customer: 'cus_test_123',
            },
          },
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const updatedSubscription = await FundingPlanEntity.findByPk(subscriptionId);
        expect(updatedSubscription).toBeDefined();
        expect(updatedSubscription?.status).toBe('past_due');
      });

      it('should store local FundingPlan UUID in funding_plan_id, not the Stripe subscription ID', async () => {
        const localPlanId = uuidv4();
        const subscription = new FundingPlanEntity();
        subscription.id = localPlanId;
        subscription.account_id = uuidv4();
        subscription.provider_config_id = stripeConfig.id;
        subscription.provider_subscription_id = 'sub_fk_test_456';
        subscription.provider_customer_id = 'cus_fk_test_456';
        subscription.status = 'active';
        subscription.billing_cycle = 'monthly';
        subscription.amount = 1000000;
        subscription.currency = 'USD';
        subscription.current_period_start = new Date();
        subscription.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await subscription.save();

        const webhookPayload = JSON.stringify({
          id: 'evt_fk_test',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_fk_test_456',
              customer: 'cus_fk_test_456',
              status: 'active',
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            },
          },
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const loggedEvent = await FundingEventEntity.findOne({
          where: { provider_event_id: 'evt_fk_test' },
        });
        expect(loggedEvent).toBeDefined();
        expect(loggedEvent?.funding_plan_id).toBe(localPlanId);
        expect(loggedEvent?.funding_plan_id).not.toBe('sub_fk_test_456');
      });

      it('should log event with empty funding_plan_id when no matching FundingPlan exists', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_unknown_sub',
          type: 'invoice.paid',
          data: {
            object: {
              subscription: 'sub_nonexistent_999',
              customer: 'cus_nonexistent_999',
            },
          },
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const loggedEvent = await FundingEventEntity.findOne({
          where: { provider_event_id: 'evt_unknown_sub' },
        });
        expect(loggedEvent).toBeDefined();
        expect(loggedEvent?.funding_plan_id).toBe('');
        expect(loggedEvent?.event_type).toBe('invoice.paid');
      });
    });

    describe('Webhook event deduplication', () => {
      it('should handle duplicate webhook events idempotently', async () => {
        const subscriptionId = uuidv4();
        const subscription = new FundingPlanEntity();
        subscription.id = subscriptionId;
        subscription.account_id = uuidv4();
        subscription.provider_config_id = stripeConfig.id;
        subscription.provider_subscription_id = 'sub_test_dup';
        subscription.provider_customer_id = 'cus_test_dup';
        subscription.status = 'active';
        subscription.billing_cycle = 'monthly';
        subscription.amount = 1000000;
        subscription.currency = 'USD';
        subscription.current_period_start = new Date();
        subscription.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await subscription.save();

        const webhookPayload = JSON.stringify({
          id: 'evt_duplicate_test',
          type: 'invoice.paid',
          data: {
            object: {
              subscription: 'sub_test_dup',
              customer: 'cus_test_dup',
            },
          },
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response1 = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);
        expect(response1.status).toBe(200);

        const event1 = await FundingEventEntity.findOne({
          where: { provider_event_id: 'evt_duplicate_test' },
        });
        expect(event1).toBeDefined();
        expect(event1?.processed_at).toBeDefined();

        const response2 = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);
        expect(response2.status).toBe(200);

        const eventCount = await FundingEventEntity.count({
          where: { provider_event_id: 'evt_duplicate_test' },
        });
        expect(eventCount).toBe(1);

        const finalSubscription = await FundingPlanEntity.findByPk(subscriptionId);
        expect(finalSubscription?.status).toBe('active');
      });
    });

    describe('checkout.session.completed webhook', () => {
      const testAccountId = uuidv4();
      const testCalendarId1 = uuidv4();
      const testCalendarId2 = uuidv4();

      let mockAdapter: any;
      let mockCalendarInterface: any;

      beforeEach(() => {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        mockAdapter = {
          providerType: 'stripe',
          verifyWebhookSignature: sandbox.stub().returns(true),
          parseWebhookEvent: createParseWebhookEvent(),
          getSubscription: sandbox.stub().resolves({
            providerSubscriptionId: 'sub_checkout_123',
            providerCustomerId: 'cus_checkout_123',
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            amount: 1000000,
            currency: 'USD',
          }),
        };

        sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter);

        mockCalendarInterface = {
          isCalendarOwnerById: sandbox.stub().resolves(true),
        };
        service.setCalendarInterface(mockCalendarInterface as any);
      });

      it('should create a funding plan from completed checkout session', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_complete',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_123',
              customer: 'cus_checkout_123',
              metadata: {
                pavillion_account_id: testAccountId,
                pavillion_calendar_ids: JSON.stringify([testCalendarId1]),
              },
            },
          },
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_123' },
        });
        expect(fundingPlan).toBeDefined();
        expect(fundingPlan?.account_id).toBe(testAccountId);
        expect(fundingPlan?.provider_customer_id).toBe('cus_checkout_123');
        expect(fundingPlan?.provider_config_id).toBe(stripeConfig.id);
        expect(fundingPlan?.status).toBe('active');
        expect(fundingPlan?.amount).toBe(1000000);
        expect(fundingPlan?.currency).toBe('USD');
      });

      it('should allocate funding to validated calendars', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_with_calendars',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_cal',
              customer: 'cus_checkout_cal',
              metadata: {
                pavillion_account_id: testAccountId,
                pavillion_calendar_ids: JSON.stringify([testCalendarId1, testCalendarId2]),
              },
            },
          },
        });

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        mockAdapter.getSubscription.resolves({
          providerSubscriptionId: 'sub_checkout_cal',
          providerCustomerId: 'cus_checkout_cal',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          amount: 2000000,
          currency: 'USD',
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_cal' },
        });
        expect(fundingPlan).toBeDefined();

        const allocations = await CalendarFundingPlanEntity.findAll({
          where: { funding_plan_id: fundingPlan!.id },
        });
        expect(allocations).toHaveLength(2);

        const amounts = allocations.map((a) => a.amount);
        expect(amounts).toContain(1000000);
      });

      it('should re-validate calendarIds and skip unowned calendars', async () => {
        mockCalendarInterface.isCalendarOwnerById
          .withArgs(testAccountId, testCalendarId1).resolves(true);
        mockCalendarInterface.isCalendarOwnerById
          .withArgs(testAccountId, testCalendarId2).resolves(false);

        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_revalidate',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_reval',
              customer: 'cus_checkout_reval',
              metadata: {
                pavillion_account_id: testAccountId,
                pavillion_calendar_ids: JSON.stringify([testCalendarId1, testCalendarId2]),
              },
            },
          },
        });

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        mockAdapter.getSubscription.resolves({
          providerSubscriptionId: 'sub_checkout_reval',
          providerCustomerId: 'cus_checkout_reval',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          amount: 1000000,
          currency: 'USD',
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_reval' },
        });
        expect(fundingPlan).toBeDefined();

        const allocations = await CalendarFundingPlanEntity.findAll({
          where: { funding_plan_id: fundingPlan!.id },
        });
        expect(allocations).toHaveLength(1);
        expect(allocations[0].calendar_id).toBe(testCalendarId1);
      });

      it('should handle duplicate checkout.session.completed events idempotently', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_dup',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_dup',
              customer: 'cus_checkout_dup',
              metadata: {
                pavillion_account_id: testAccountId,
                pavillion_calendar_ids: JSON.stringify([testCalendarId1]),
              },
            },
          },
        });

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        mockAdapter.getSubscription.resolves({
          providerSubscriptionId: 'sub_checkout_dup',
          providerCustomerId: 'cus_checkout_dup',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          amount: 1000000,
          currency: 'USD',
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response1 = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);
        expect(response1.status).toBe(200);

        const response2 = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);
        expect(response2.status).toBe(200);

        const plans = await FundingPlanEntity.findAll({
          where: { provider_subscription_id: 'sub_checkout_dup' },
        });
        expect(plans).toHaveLength(1);

        const eventCount = await FundingEventEntity.count({
          where: { provider_event_id: 'evt_checkout_dup' },
        });
        expect(eventCount).toBe(1);
      });

      it('should handle checkout without calendarIds metadata', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_no_cals',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_nocals',
              customer: 'cus_checkout_nocals',
              metadata: {
                pavillion_account_id: testAccountId,
              },
            },
          },
        });

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        mockAdapter.getSubscription.resolves({
          providerSubscriptionId: 'sub_checkout_nocals',
          providerCustomerId: 'cus_checkout_nocals',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          amount: 500000,
          currency: 'USD',
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_nocals' },
        });
        expect(fundingPlan).toBeDefined();
        expect(fundingPlan?.amount).toBe(500000);

        const allocations = await CalendarFundingPlanEntity.findAll({
          where: { funding_plan_id: fundingPlan!.id },
        });
        expect(allocations).toHaveLength(0);
      });

      it('should detect yearly billing cycle from subscription period', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_yearly',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_yearly',
              customer: 'cus_checkout_yearly',
              metadata: {
                pavillion_account_id: testAccountId,
              },
            },
          },
        });

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        mockAdapter.getSubscription.resolves({
          providerSubscriptionId: 'sub_checkout_yearly',
          providerCustomerId: 'cus_checkout_yearly',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          amount: 10000000,
          currency: 'USD',
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_yearly' },
        });
        expect(fundingPlan).toBeDefined();
        expect(fundingPlan?.billing_cycle).toBe('yearly');
      });

      it('should handle missing accountId in metadata gracefully', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_no_account',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_noaccount',
              customer: 'cus_checkout_noaccount',
              metadata: {},
            },
          },
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        const response = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(webhookPayload);

        expect(response.status).toBe(200);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_noaccount' },
        });
        expect(fundingPlan).toBeNull();
      });
    });
  });
});
