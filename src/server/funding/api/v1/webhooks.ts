import express, { Request, Response, Application, Router } from 'express';
import Stripe from 'stripe';
import FundingInterface from '@/server/funding/interface';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Webhook route handlers for payment provider events
 *
 * Handles webhook events from Stripe with signature verification.
 * PayPal webhook endpoint is disabled until proper signature verification
 * is implemented (see TODO below).
 * Uses raw body parsing for signature verification.
 */
export default class WebhookRouteHandlers {
  private interface: FundingInterface;

  constructor(fundingInterface: FundingInterface) {
    this.interface = fundingInterface;
  }

  /**
   * Install webhook route handlers
   *
   * @param app - Express application
   * @param routePrefix - Route prefix (e.g., '/api/funding')
   */
  installHandlers(app: Application, routePrefix: string): void {
    const router = Router();

    // Stripe webhook endpoint - needs raw body for signature verification
    router.post(
      '/webhooks/stripe',
      express.raw({ type: 'application/json' }),
      this.handleStripeWebhook.bind(this),
    );

    // PayPal webhook endpoint - disabled until proper signature verification
    // is implemented. Returns 501 Not Implemented.
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
   * Verifies the webhook signature using Stripe's static method, then
   * delegates event parsing to the StripeAdapter via ProviderFactory.
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
      try {
        Stripe.Webhook.constructEvent(rawBody, signature, webhookSecret);
      }
      catch (err) {
        res.status(400).json({ error: `Invalid signature: ${err instanceof Error ? err.message : 'Unknown error'}`, errorName: 'ValidationError' });
        return;
      }

      // Delegate event parsing to the adapter (service layer)
      const adapter = ProviderFactory.getAdapter(providerConfig);
      const webhookEvent = adapter.parseWebhookEvent(rawBody);

      // Process webhook event
      await this.interface.processWebhookEvent(webhookEvent, stripeConfig.id);

      // Acknowledge receipt immediately
      res.status(200).json({ received: true });
    }
    catch (error) {
      logError(error, 'Error processing Stripe webhook');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle PayPal webhook events
   *
   * PayPal webhook verification is not yet implemented. This endpoint returns
   * 501 Not Implemented until proper signature verification using PayPal's
   * /v1/notifications/verify-webhook-signature API is built.
   *
   * // TODO [pv-npv6.7]: Implement PayPal webhook signature verification by
   * // calling PayPal's /v1/notifications/verify-webhook-signature API endpoint.
   * // Once implemented, restore the full webhook processing flow.
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

    res.status(501).json({
      error: 'PayPal webhook verification not implemented',
      errorName: 'NotImplemented',
    });
  }
}
