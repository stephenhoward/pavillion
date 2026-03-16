import express, { Request, Response, Application, Router } from 'express';
import FundingInterface from '@/server/funding/interface';
import { ProviderNotConfiguredError, WebhookSignatureError } from '@/server/funding/exceptions';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Webhook route handlers for payment provider events
 *
 * Handles webhook events from Stripe with signature verification.
 * PayPal webhook endpoint is disabled until proper signature verification
 * is implemented (see TODO below).
 * Uses raw body parsing for signature verification.
 */
export default class WebhookRoutes {
  private service: FundingInterface;

  constructor(fundingInterface: FundingInterface) {
    this.service = fundingInterface;
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
   * Extracts the raw body and stripe-signature header, then delegates all
   * business logic (config lookup, signature verification, event parsing,
   * and processing) to the service layer.
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

    const rawBody = req.body.toString('utf8');

    try {
      await this.service.handleStripeWebhook(rawBody, signature);
      res.status(200).json({ received: true });
    }
    catch (error) {
      if (error instanceof ProviderNotConfiguredError) {
        // Stripe retries non-2xx responses for up to 72 hours. Returning 200
        // acknowledges receipt gracefully — the event simply has no handler on
        // this instance. This also avoids leaking configuration state to callers.
        console.info('[WebhookRoutes] Stripe webhook received but Stripe provider is not configured — discarding event');
        res.status(200).json({ received: true });
        return;
      }

      if (error instanceof WebhookSignatureError) {
        logError(error, 'Stripe webhook signature verification failed');
        res.status(400).json({ error: 'Webhook signature verification failed', errorName: 'ValidationError' });
        return;
      }

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
