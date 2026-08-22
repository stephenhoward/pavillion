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
  // Fail-closed signing secret — CVE-2026-41432 pattern.
  //
  // Stripe's constructEvent computes an HMAC over the payload keyed by the
  // signing secret. Given an empty key it still produces a well-defined digest,
  // so anyone who knows the secret is unset can forge a "valid" signature. A
  // missing or blank secret must therefore reject the request outright rather
  // than reach constructEvent at all.
  //
  // This is unconditional, not environment-gated: the assertions below run
  // under NODE_ENV=test and still expect rejection. Development instances that
  // have configured no Stripe credentials at all get MockStripeAdapter from
  // ProviderFactory, which bypasses signature verification entirely — that is
  // the only path where an unsigned webhook is accepted, and it is unreachable
  // once real credentials exist.
  // -------------------------------------------------------------------------
  describe('Fail-closed webhook signing secret', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      ProviderFactory.clearAllCaches();
    });

    afterEach(() => {
      vi.clearAllMocks();
      ProviderFactory.clearAllCaches();
    });

    it('refuses to verify against an empty secret without calling constructEvent', () => {
      const adapter = new StripeAdapter({ apiKey: 'sk_test_empty_secret' }, '');

      expect(adapter.verifyWebhookSignature('{"id":"evt_x"}', 'any_signature')).toBe(false);
      expect(vi.mocked(Stripe.Webhook.constructEvent)).not.toHaveBeenCalled();
    });

    it('refuses to verify against a whitespace-only secret', () => {
      const adapter = new StripeAdapter({ apiKey: 'sk_test_blank_secret' }, '   ');

      expect(adapter.verifyWebhookSignature('{"id":"evt_x"}', 'any_signature')).toBe(false);
      expect(vi.mocked(Stripe.Webhook.constructEvent)).not.toHaveBeenCalled();
    });

    it('rejects a webhook with 400 when the stored signing secret is empty', async () => {
      await db.sync({ force: true });

      // Real API credentials but no signing secret — ProviderFactory builds a
      // real StripeAdapter (not the mock), exactly as a misconfigured instance
      // whose admin saved keys but never pasted the whsec_ value.
      const stripeModel = new ProviderConfig(uuidv4(), 'stripe');
      stripeModel.enabled = true;
      stripeModel.displayName = 'Credit Card';
      const unconfigured = ProviderConfigEntity.fromModel(stripeModel);
      unconfigured._decryptedCredentials = JSON.stringify({ apiKey: 'sk_test_123' });
      unconfigured._decryptedWebhookSecret = '';
      await unconfigured.save();

      const service = new FundingService(new EventEmitter());
      const app = express();
      FundingApiV1.install(app, service as any);

      const webhookPayload = JSON.stringify({
        id: 'evt_forged_no_secret',
        type: 'invoice.payment_failed',
        data: { object: { subscription: 'sub_forged', customer: 'cus_forged' } },
      });

      const response = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'forged_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Webhook signature verification failed');

      // The payload must never reach Stripe's verifier with an empty key...
      expect(vi.mocked(Stripe.Webhook.constructEvent)).not.toHaveBeenCalled();
      // ...and the forged event must leave no trace in the event log.
      const logged = await FundingEventEntity.findOne({
        where: { provider_event_id: 'evt_forged_no_secret' },
      });
      expect(logged).toBeNull();
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
      it('should update funding plan status when webhook event is processed', async () => {
        const fundingPlanId = uuidv4();
        const plan = new FundingPlanEntity();
        plan.id = fundingPlanId;
        plan.account_id = uuidv4();
        plan.provider_config_id = stripeConfig.id;
        plan.provider_subscription_id = 'sub_test_123';
        plan.provider_customer_id = 'cus_test_123';
        plan.status = 'active';
        plan.billing_cycle = 'monthly';
        plan.amount = 1000000;
        plan.currency = 'USD';
        plan.current_period_start = new Date();
        plan.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await plan.save();

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

        const updatedPlan = await FundingPlanEntity.findByPk(fundingPlanId);
        expect(updatedPlan).toBeDefined();
        expect(updatedPlan?.status).toBe('past_due');
      });

      it('should store local FundingPlan UUID in funding_plan_id, not the Stripe subscription ID', async () => {
        const localPlanId = uuidv4();
        const plan = new FundingPlanEntity();
        plan.id = localPlanId;
        plan.account_id = uuidv4();
        plan.provider_config_id = stripeConfig.id;
        plan.provider_subscription_id = 'sub_fk_test_456';
        plan.provider_customer_id = 'cus_fk_test_456';
        plan.status = 'active';
        plan.billing_cycle = 'monthly';
        plan.amount = 1000000;
        plan.currency = 'USD';
        plan.current_period_start = new Date();
        plan.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await plan.save();

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

      it('should log event with null funding_plan_id when no matching FundingPlan exists', async () => {
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
        // Must be SQL NULL, never '' — Postgres rejects '' for a UUID column,
        // which would abort the insert and leave Stripe retrying forever.
        expect(loggedEvent?.funding_plan_id).toBeNull();
        expect(loggedEvent?.event_type).toBe('invoice.paid');
      });

      it('should dedupe a redelivered event that has no matching FundingPlan', async () => {
        const webhookPayload = JSON.stringify({
          id: 'evt_unknown_sub_redelivered',
          type: 'invoice.paid',
          data: {
            object: {
              subscription: 'sub_nonexistent_redelivered',
              customer: 'cus_nonexistent_redelivered',
            },
          },
        });

        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

        for (let delivery = 0; delivery < 2; delivery++) {
          const response = await request(app)
            .post('/api/funding/webhooks/stripe')
            .set('stripe-signature', 'valid_signature')
            .set('Content-Type', 'application/json')
            .send(webhookPayload);
          expect(response.status).toBe(200);
        }

        const eventCount = await FundingEventEntity.count({
          where: { provider_event_id: 'evt_unknown_sub_redelivered' },
        });
        expect(eventCount).toBe(1);
      });
    });

    describe('Webhook event deduplication', () => {
      it('should handle duplicate webhook events idempotently', async () => {
        const fundingPlanId = uuidv4();
        const plan = new FundingPlanEntity();
        plan.id = fundingPlanId;
        plan.account_id = uuidv4();
        plan.provider_config_id = stripeConfig.id;
        plan.provider_subscription_id = 'sub_test_dup';
        plan.provider_customer_id = 'cus_test_dup';
        plan.status = 'active';
        plan.billing_cycle = 'monthly';
        plan.amount = 1000000;
        plan.currency = 'USD';
        plan.current_period_start = new Date();
        plan.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await plan.save();

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

        const finalPlan = await FundingPlanEntity.findByPk(fundingPlanId);
        expect(finalPlan?.status).toBe('active');
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

      it('should leave no plan or dedupe row behind when subscription retrieval throws', async () => {
        // The adapter throws when a Stripe subscription carries no resolvable
        // billing period. Retrieval happens before the write transaction, so
        // nothing must be persisted — otherwise the dedupe check would swallow
        // Stripe's retry and the paid-for plan would never be created.
        mockAdapter.getSubscription.rejects(
          new Error('Stripe subscription sub_checkout_throw has no billing period'),
        );

        const webhookPayload = JSON.stringify({
          id: 'evt_checkout_throw',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_checkout_throw',
              customer: 'cus_checkout_throw',
              metadata: {
                pavillion_account_id: testAccountId,
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

        // 500 asks Stripe to retry rather than silently dropping the payment
        expect(response.status).toBe(500);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_throw' },
        });
        expect(fundingPlan).toBeNull();

        const eventCount = await FundingEventEntity.count({
          where: { provider_event_id: 'evt_checkout_throw' },
        });
        expect(eventCount).toBe(0);
      });

      it('should process a later unrelated event after one delivery fails', async () => {
        // Stripe delivers one event per request, so a throw can only fail the
        // delivery that caused it. This guards against state from a failed
        // delivery leaking into the next one.
        mockAdapter.getSubscription
          .withArgs('sub_checkout_broken')
          .rejects(new Error('Stripe subscription sub_checkout_broken has no billing period'));

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        mockAdapter.getSubscription.withArgs('sub_checkout_healthy').resolves({
          providerSubscriptionId: 'sub_checkout_healthy',
          providerCustomerId: 'cus_checkout_healthy',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          amount: 1000000,
          currency: 'USD',
        });

        const buildPayload = (eventId: string, subscriptionId: string) => JSON.stringify({
          id: eventId,
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: subscriptionId,
              customer: `cus_${subscriptionId}`,
              metadata: { pavillion_account_id: testAccountId },
            },
          },
        });

        const brokenPayload = buildPayload('evt_checkout_broken', 'sub_checkout_broken');
        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(brokenPayload) as any);
        const brokenResponse = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(brokenPayload);
        expect(brokenResponse.status).toBe(500);

        const healthyPayload = buildPayload('evt_checkout_healthy', 'sub_checkout_healthy');
        vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(healthyPayload) as any);
        const healthyResponse = await request(app)
          .post('/api/funding/webhooks/stripe')
          .set('stripe-signature', 'valid_signature')
          .set('Content-Type', 'application/json')
          .send(healthyPayload);
        expect(healthyResponse.status).toBe(200);

        const fundingPlan = await FundingPlanEntity.findOne({
          where: { provider_subscription_id: 'sub_checkout_healthy' },
        });
        expect(fundingPlan).not.toBeNull();
      });
    });

    describe('Funding event data minimization', () => {
      it('should not persist the raw provider payload for a lifecycle event', async () => {
        const plan = new FundingPlanEntity();
        plan.id = uuidv4();
        plan.account_id = uuidv4();
        plan.provider_config_id = stripeConfig.id;
        plan.provider_subscription_id = 'sub_minimization';
        plan.provider_customer_id = 'cus_minimization';
        plan.status = 'active';
        plan.billing_cycle = 'monthly';
        plan.amount = 1000000;
        plan.currency = 'USD';
        plan.current_period_start = new Date();
        plan.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await plan.save();

        const webhookPayload = JSON.stringify({
          id: 'evt_minimization',
          type: 'invoice.payment_failed',
          data: {
            object: {
              subscription: 'sub_minimization',
              customer: 'cus_minimization',
              customer_email: 'payer@example.com',
              customer_name: 'A Payer',
              payment_method_details: { card: { last4: '4242', brand: 'visa' } },
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
          where: { provider_event_id: 'evt_minimization' },
        });
        expect(loggedEvent).not.toBeNull();

        const storedPayload = loggedEvent!.toModel().payload;
        expect(storedPayload).not.toContain('payer@example.com');
        expect(storedPayload).not.toContain('A Payer');
        expect(storedPayload).not.toContain('4242');
        expect(storedPayload).not.toContain('cus_minimization');
        expect(JSON.parse(storedPayload)).toEqual({ status: 'past_due' });
      });

      it('should record a null status for an event type the adapter does not parse', async () => {
        // The adapter only sets a status for the five lifecycle event types it
        // switches on. Endpoints are often subscribed to more than that, so
        // any other delivery lands here carrying no status at all.
        const webhookPayload = JSON.stringify({
          id: 'evt_unparsed_type',
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_test_123',
              customer: 'cus_unparsed',
              receipt_email: 'payer@example.com',
              charges: { data: [{ billing_details: { name: 'A Payer' } }] },
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
          where: { provider_event_id: 'evt_unparsed_type' },
        });
        expect(loggedEvent).not.toBeNull();
        expect(loggedEvent!.event_type).toBe('payment_intent.succeeded');

        const storedPayload = loggedEvent!.toModel().payload;
        expect(storedPayload).not.toContain('payer@example.com');
        expect(storedPayload).not.toContain('A Payer');
        expect(storedPayload).not.toContain('cus_unparsed');
        expect(JSON.parse(storedPayload)).toEqual({ status: null });
      });

      it('should not persist the raw provider payload on checkout completion', async () => {
        const accountId = uuidv4();
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        sandbox.stub(ProviderFactory, 'getAdapter').returns({
          providerType: 'stripe',
          verifyWebhookSignature: sandbox.stub().returns(true),
          parseWebhookEvent: createParseWebhookEvent(),
          getSubscription: sandbox.stub().resolves({
            providerSubscriptionId: 'sub_min_checkout',
            providerCustomerId: 'cus_min_checkout',
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            amount: 1000000,
            currency: 'USD',
          }),
        } as any);

        const webhookPayload = JSON.stringify({
          id: 'evt_min_checkout',
          type: 'checkout.session.completed',
          data: {
            object: {
              subscription: 'sub_min_checkout',
              customer: 'cus_min_checkout',
              customer_details: { email: 'payer@example.com', name: 'A Payer' },
              metadata: { pavillion_account_id: accountId },
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
          where: { provider_event_id: 'evt_min_checkout' },
        });
        expect(loggedEvent).not.toBeNull();

        const storedPayload = loggedEvent!.toModel().payload;
        expect(storedPayload).not.toContain('payer@example.com');
        expect(storedPayload).not.toContain('A Payer');
        expect(storedPayload).not.toContain('cus_min_checkout');
        expect(JSON.parse(storedPayload)).toEqual({ status: 'active' });
      });
    });
  });
});
