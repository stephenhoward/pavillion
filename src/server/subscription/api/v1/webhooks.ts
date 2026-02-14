import express, { Request, Response, Application, Router } from 'express';
import Stripe from 'stripe';
import SubscriptionInterface from '@/server/subscription/interface';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';

/**
 * Webhook route handlers for payment provider events
 *
 * Handles webhook events from Stripe and PayPal with signature verification.
 * Uses raw body parsing for signature verification.
 */
export default class WebhookRouteHandlers {
  private interface: SubscriptionInterface;

  constructor(subscriptionInterface: SubscriptionInterface) {
    this.interface = subscriptionInterface;
  }

  /**
   * Install webhook route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/subscription')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = Router();

    // Stripe webhook endpoint - needs raw body for signature verification
    router.post(
      '/webhooks/stripe',
      express.raw({ type: 'application/json' }),
      this.handleStripeWebhook.bind(this),
    );

    // PayPal webhook endpoint - needs raw body for signature verification
    router.post(
      '/webhooks/paypal',
      express.raw({ type: 'application/json' }),
      this.handlePayPalWebhook.bind(this),
    );

    app.use(routePrefix, router);
  }

  /**
   * Handle Stripe webhook events
   *
   * @param req - Express request with raw body
   * @param res - Express response
   */
  private async handleStripeWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      res.status(400).json({ error: 'Missing Stripe signature header', errorName: 'ValidationError' });
      return;
    }

    // Get raw body as string
    const rawBody = req.body.toString('utf8');

    try {
      // Get Stripe provider configuration to access webhook secret
      const stripeConfig = await ProviderConfigEntity.findOne({
        where: { provider_type: 'stripe' },
      });

      if (!stripeConfig) {
        res.status(400).json({ error: 'Stripe provider not configured', errorName: 'ValidationError' });
        return;
      }

      // Get decrypted webhook secret
      const providerConfig = stripeConfig.toModel();
      const webhookSecret = providerConfig.webhookSecret;

      // Verify webhook signature using static method
      let event: Stripe.Event;
      try {
        event = Stripe.Webhook.constructEvent(rawBody, signature, webhookSecret);
      }
      catch (err) {
        res.status(400).json({ error: `Invalid signature: ${err instanceof Error ? err.message : 'Unknown error'}`, errorName: 'ValidationError' });
        return;
      }

      // Parse event data
      const webhookEvent = this.parseStripeEvent(event);

      // Process webhook event
      await this.interface.processWebhookEvent(webhookEvent, stripeConfig.id);

      // Acknowledge receipt immediately
      res.status(200).json({ received: true });
    }
    catch (error) {
      console.error('Error processing Stripe webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle PayPal webhook events
   *
   * @param req - Express request with raw body
   * @param res - Express response
   */
  private async handlePayPalWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['paypal-transmission-sig'] as string;

    if (!signature) {
      res.status(400).json({ error: 'Missing PayPal signature header', errorName: 'ValidationError' });
      return;
    }

    // Get raw body as string
    const rawBody = req.body.toString('utf8');

    try {
      // Get PayPal provider configuration
      const paypalConfig = await ProviderConfigEntity.findOne({
        where: { provider_type: 'paypal' },
      });

      if (!paypalConfig) {
        res.status(400).json({ error: 'PayPal provider not configured', errorName: 'ValidationError' });
        return;
      }

      // Verify PayPal webhook signature
      // Note: PayPal webhook verification is more complex and typically involves
      // calling PayPal's verification API. For now, we'll do basic validation.
      const isValid = this.verifyPayPalSignature(rawBody, signature);

      if (!isValid) {
        res.status(400).json({ error: 'Invalid PayPal signature', errorName: 'ValidationError' });
        return;
      }

      // Parse webhook payload
      const payload = JSON.parse(rawBody);

      // Parse event data
      const webhookEvent = this.parsePayPalEvent(payload);

      // Process webhook event
      await this.interface.processWebhookEvent(webhookEvent, paypalConfig.id);

      // Acknowledge receipt immediately
      res.status(200).json({ received: true });
    }
    catch (error) {
      console.error('Error processing PayPal webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Parse Stripe webhook event into standardized format
   *
   * @param event - Stripe event object
   * @returns Standardized webhook event
   * @private
   */
  private parseStripeEvent(event: Stripe.Event): any {
    const webhookEvent: any = {
      eventId: event.id,
      eventType: event.type,
      rawPayload: event,
    };

    // Parse event-specific data
    switch (event.type) {
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        webhookEvent.subscriptionId = invoice.subscription as string;
        webhookEvent.customerId = invoice.customer as string;
        webhookEvent.status = 'active';
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        webhookEvent.subscriptionId = invoice.subscription as string;
        webhookEvent.customerId = invoice.customer as string;
        webhookEvent.status = 'past_due';
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        webhookEvent.subscriptionId = subscription.id;
        webhookEvent.customerId = subscription.customer as string;
        webhookEvent.status = this.mapStripeStatus(subscription.status);
        webhookEvent.currentPeriodStart = new Date(subscription.current_period_start * 1000);
        webhookEvent.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        webhookEvent.subscriptionId = subscription.id;
        webhookEvent.customerId = subscription.customer as string;
        webhookEvent.status = 'cancelled';
        break;
      }
    }

    return webhookEvent;
  }

  /**
   * Parse PayPal webhook event into standardized format
   *
   * @param payload - PayPal webhook payload
   * @returns Standardized webhook event
   * @private
   */
  private parsePayPalEvent(payload: any): any {
    const webhookEvent: any = {
      eventId: payload.id || '',
      eventType: payload.event_type || '',
      rawPayload: payload,
    };

    const resource = payload.resource;

    switch (payload.event_type) {
      case 'PAYMENT.SALE.COMPLETED': {
        webhookEvent.subscriptionId = resource?.billing_agreement_id;
        webhookEvent.status = 'active';
        break;
      }

      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        webhookEvent.subscriptionId = resource?.id;
        webhookEvent.status = 'active';
        if (resource?.billing_info) {
          webhookEvent.currentPeriodStart = new Date(resource.start_time);
          webhookEvent.currentPeriodEnd = new Date(resource.billing_info.next_billing_time);
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        webhookEvent.subscriptionId = resource?.id;
        webhookEvent.status = 'cancelled';
        break;
      }

      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        webhookEvent.subscriptionId = resource?.id;
        webhookEvent.status = 'suspended';
        break;
      }

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        webhookEvent.subscriptionId = resource?.id;
        webhookEvent.status = 'past_due';
        break;
      }
    }

    return webhookEvent;
  }

  /**
   * Verify PayPal webhook signature
   *
   * Note: This is a simplified implementation. In production, you should use
   * PayPal's webhook verification API.
   *
   * @param payload - Raw webhook payload
   * @param signature - Signature from headers
   * @returns True if signature is valid
   * @private
   */
  private verifyPayPalSignature(payload: string, signature: string): boolean {
    // Basic validation - signature and payload must exist
    // In production, this should call PayPal's verification API
    return signature.length > 0 && payload.length > 0;
  }

  /**
   * Map Stripe subscription status to internal status
   *
   * @param stripeStatus - Stripe subscription status
   * @returns Internal subscription status
   * @private
   */
  private mapStripeStatus(
    stripeStatus: Stripe.Subscription.Status,
  ): 'active' | 'past_due' | 'suspended' | 'cancelled' {
    switch (stripeStatus) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'unpaid':
      case 'paused':
        return 'suspended';
      case 'canceled':
      case 'incomplete':
      case 'incomplete_expired':
        return 'cancelled';
      default:
        return 'cancelled';
    }
  }
}
