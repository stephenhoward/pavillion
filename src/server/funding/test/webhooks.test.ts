import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import express, { Application } from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import FundingService from '@/server/funding/service/funding';
import FundingInterface from '@/server/funding/interface/index';
import WebhookRouteHandlers from '@/server/funding/api/v1/webhooks';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_subscription';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { ProviderConfig } from '@/common/model/funding-plan';
import { ProviderFactory } from '@/server/funding/service/provider/factory';

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

describe('Webhook Handling', () => {
  let app: Application;
  let service: FundingService;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox;
  let stripeConfig: ProviderConfigEntity;
  let paypalConfig: ProviderConfigEntity;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    await db.sync({ force: true });

    // Create event bus
    eventBus = new EventEmitter();

    // Create service
    service = new FundingService(eventBus);

    // Create test provider configurations
    const stripeModel = new ProviderConfig(uuidv4(), 'stripe');
    stripeModel.enabled = true;
    stripeModel.displayName = 'Credit Card';
    stripeModel.credentials = JSON.stringify({ apiKey: 'sk_test_123' });
    stripeModel.webhookSecret = 'whsec_test_stripe';
    stripeConfig = ProviderConfigEntity.fromModel(stripeModel);
    await stripeConfig.save();

    const paypalModel = new ProviderConfig(uuidv4(), 'paypal');
    paypalModel.enabled = true;
    paypalModel.displayName = 'PayPal';
    paypalModel.credentials = JSON.stringify({ clientId: 'test_client', secret: 'test_secret' });
    paypalModel.webhookSecret = 'webhook_secret_paypal';
    paypalConfig = ProviderConfigEntity.fromModel(paypalModel);
    await paypalConfig.save();

    // Create Express app with raw body parsing for webhooks
    app = express();

    // Install webhook routes (they handle raw body internally)
    const webhookRoutes = new WebhookRouteHandlers(service as any);
    webhookRoutes.installHandlers(app, '/api/funding');
  });

  afterEach(() => {
    sandbox.restore();
    vi.clearAllMocks();
    ProviderFactory.clearAllCaches();
  });

  describe('Stripe webhook signature verification', () => {
    it('should accept webhook with valid Stripe signature', async () => {
      // Create a test webhook payload
      const webhookPayload = JSON.stringify({
        id: 'evt_test_webhook',
        type: 'invoice.paid',
        data: {
          object: {
            subscription: 'sub_test',
            customer: 'cus_test',
          },
        },
      });

      // Mock Stripe.Webhook.constructEvent
      vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue({
        id: 'evt_test_webhook',
        type: 'invoice.paid',
        data: {
          object: {
            subscription: 'sub_test',
            customer: 'cus_test',
          },
        },
      } as any);

      const response = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(Stripe.Webhook.constructEvent).toHaveBeenCalledOnce();
    });

    it('should reject webhook with invalid Stripe signature', async () => {
      const webhookPayload = JSON.stringify({
        id: 'evt_test_webhook',
        type: 'invoice.paid',
      });

      // Mock Stripe.Webhook.constructEvent to throw error
      vi.mocked(Stripe.Webhook.constructEvent).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const response = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'invalid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid signature');
    });

    it('should return 400 when stripe-signature header is missing', async () => {
      const webhookPayload = JSON.stringify({
        id: 'evt_test_webhook',
        type: 'invoice.paid',
      });

      const response = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing Stripe signature');
    });
  });

  describe('PayPal webhook signature verification', () => {
    it('should accept webhook with valid PayPal signature', async () => {
      const webhookPayload = JSON.stringify({
        id: 'WH-test-event',
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          billing_agreement_id: 'sub_test',
        },
      });

      const response = await request(app)
        .post('/api/funding/webhooks/paypal')
        .set('paypal-transmission-sig', 'valid_paypal_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(200);
    });

    it('should reject webhook with invalid PayPal signature', async () => {
      const webhookPayload = JSON.stringify({
        id: 'WH-test-event',
        event_type: 'PAYMENT.SALE.COMPLETED',
      });

      const response = await request(app)
        .post('/api/funding/webhooks/paypal')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('signature');
    });
  });

  describe('Webhook event processing', () => {
    it('should update subscription status when webhook event is processed', async () => {
      // Create a test subscription
      const subscriptionId = uuidv4();
      const subscription = new FundingPlanEntity();
      subscription.id = subscriptionId;
      subscription.account_id = uuidv4();
      subscription.provider_config_id = stripeConfig.id;
      subscription.provider_subscription_id = 'sub_test_123';
      subscription.provider_customer_id = 'cus_test_123';
      subscription.status = 'active';
      subscription.billing_cycle = 'monthly';
      subscription.amount = 1000000; // $10.00 in millicents
      subscription.currency = 'USD';
      subscription.current_period_start = new Date();
      subscription.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await subscription.save();

      // Create webhook payload for payment failure
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

      // Mock Stripe.Webhook.constructEvent
      vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

      // Send webhook
      const response = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(200);

      // Verify subscription status was updated
      const updatedSubscription = await FundingPlanEntity.findByPk(subscriptionId);
      expect(updatedSubscription).toBeDefined();
      expect(updatedSubscription?.status).toBe('past_due');
    });
  });

  describe('Webhook event deduplication', () => {
    it('should handle duplicate webhook events idempotently', async () => {
      // Create a test subscription
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

      // Mock Stripe.Webhook.constructEvent
      vi.mocked(Stripe.Webhook.constructEvent).mockReturnValue(JSON.parse(webhookPayload) as any);

      // Send webhook first time
      const response1 = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response1.status).toBe(200);

      // Verify event was logged
      const event1 = await FundingEventEntity.findOne({
        where: { provider_event_id: 'evt_duplicate_test' },
      });
      expect(event1).toBeDefined();
      expect(event1?.processed_at).toBeDefined();

      // Send same webhook again (duplicate)
      const response2 = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response2.status).toBe(200);

      // Verify only one event was logged (idempotent)
      const eventCount = await FundingEventEntity.count({
        where: { provider_event_id: 'evt_duplicate_test' },
      });
      expect(eventCount).toBe(1);

      // Verify subscription status hasn't changed from duplicate processing
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

      // Mock the adapter returned by ProviderFactory
      mockAdapter = {
        providerType: 'stripe',
        getSubscription: sandbox.stub().resolves({
          providerSubscriptionId: 'sub_checkout_123',
          providerCustomerId: 'cus_checkout_123',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          amount: 1000000, // $10.00 in millicents
          currency: 'USD',
        }),
      };

      sandbox.stub(ProviderFactory, 'getAdapter').returns(mockAdapter);

      // Mock CalendarInterface for ownership verification
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

      // Verify funding plan was created
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

      // Update mock for this subscription ID
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

      // Verify funding plan was created
      const fundingPlan = await FundingPlanEntity.findOne({
        where: { provider_subscription_id: 'sub_checkout_cal' },
      });
      expect(fundingPlan).toBeDefined();

      // Verify calendar allocations were created
      const allocations = await CalendarFundingPlanEntity.findAll({
        where: { funding_plan_id: fundingPlan!.id },
      });
      expect(allocations).toHaveLength(2);

      // Each calendar should get half the amount
      const amounts = allocations.map((a) => a.amount);
      expect(amounts).toContain(1000000); // 2000000 / 2
    });

    it('should re-validate calendarIds and skip unowned calendars', async () => {
      // Only the first calendar is owned by the account
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

      // Verify funding plan was created
      const fundingPlan = await FundingPlanEntity.findOne({
        where: { provider_subscription_id: 'sub_checkout_reval' },
      });
      expect(fundingPlan).toBeDefined();

      // Only one calendar allocation should exist (the owned one)
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

      // Send first time
      const response1 = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);
      expect(response1.status).toBe(200);

      // Send duplicate (same event ID)
      const response2 = await request(app)
        .post('/api/funding/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);
      expect(response2.status).toBe(200);

      // Only one funding plan should exist
      const plans = await FundingPlanEntity.findAll({
        where: { provider_subscription_id: 'sub_checkout_dup' },
      });
      expect(plans).toHaveLength(1);

      // Only one event record should exist
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

      // Funding plan should be created without calendar allocations
      const fundingPlan = await FundingPlanEntity.findOne({
        where: { provider_subscription_id: 'sub_checkout_nocals' },
      });
      expect(fundingPlan).toBeDefined();
      expect(fundingPlan?.amount).toBe(500000);

      // No calendar allocations
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

      // Should still return 200 (webhook acknowledged) but no funding plan created
      expect(response.status).toBe(200);

      const fundingPlan = await FundingPlanEntity.findOne({
        where: { provider_subscription_id: 'sub_checkout_noaccount' },
      });
      expect(fundingPlan).toBeNull();
    });
  });
});
