import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import express, { Application } from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import db from '@/server/common/entity/db';
import SubscriptionService from '@/server/subscription/service/subscription';
import WebhookRouteHandlers from '@/server/subscription/api/v1/webhooks';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { SubscriptionEventEntity } from '@/server/subscription/entity/subscription_event';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import { ProviderConfig } from '@/common/model/subscription';

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
  let service: SubscriptionService;
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
    service = new SubscriptionService(eventBus);

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
    const webhookRoutes = new WebhookRouteHandlers(service);
    webhookRoutes.installHandlers(app, '/api/subscription');
  });

  afterEach(() => {
    sandbox.restore();
    vi.clearAllMocks();
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
        .post('/api/subscription/webhooks/stripe')
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
        .post('/api/subscription/webhooks/stripe')
        .set('stripe-signature', 'invalid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid signature');
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
        .post('/api/subscription/webhooks/paypal')
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
        .post('/api/subscription/webhooks/paypal')
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
      const subscription = new SubscriptionEntity();
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
        .post('/api/subscription/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response.status).toBe(200);

      // Verify subscription status was updated
      const updatedSubscription = await SubscriptionEntity.findByPk(subscriptionId);
      expect(updatedSubscription).toBeDefined();
      expect(updatedSubscription?.status).toBe('past_due');
    });
  });

  describe('Webhook event deduplication', () => {
    it('should handle duplicate webhook events idempotently', async () => {
      // Create a test subscription
      const subscriptionId = uuidv4();
      const subscription = new SubscriptionEntity();
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
        .post('/api/subscription/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response1.status).toBe(200);

      // Verify event was logged
      const event1 = await SubscriptionEventEntity.findOne({
        where: { provider_event_id: 'evt_duplicate_test' },
      });
      expect(event1).toBeDefined();
      expect(event1?.processed_at).toBeDefined();

      // Send same webhook again (duplicate)
      const response2 = await request(app)
        .post('/api/subscription/webhooks/stripe')
        .set('stripe-signature', 'valid_signature')
        .set('Content-Type', 'application/json')
        .send(webhookPayload);

      expect(response2.status).toBe(200);

      // Verify only one event was logged (idempotent)
      const eventCount = await SubscriptionEventEntity.count({
        where: { provider_event_id: 'evt_duplicate_test' },
      });
      expect(eventCount).toBe(1);

      // Verify subscription status hasn't changed from duplicate processing
      const finalSubscription = await SubscriptionEntity.findByPk(subscriptionId);
      expect(finalSubscription?.status).toBe('active');
    });
  });
});
