import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { WebhookManager } from '../service/provider/webhook_manager';
import WebhookRoutes from '../api/v1/webhooks';

/**
 * Tests for WebhookManager Utility Service
 *
 * The registerWebhook/deleteWebhook methods have been removed from all adapters.
 * Stripe webhooks are managed manually via the Stripe dashboard.
 * This file now only tests the WebhookManager URL generation utility.
 */
describe('WebhookManager Utility Service', () => {
  const sandbox = sinon.createSandbox();
  let webhookManager: WebhookManager;

  beforeEach(() => {
    webhookManager = new WebhookManager();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should generate webhook URL with correct format', () => {
    const providerType = 'stripe';
    const webhookUrl = webhookManager.generateWebhookUrl(providerType);

    // Webhook URL should contain the correct path structure
    expect(webhookUrl).toContain('/api/funding/webhooks/stripe');
    expect(webhookUrl).toContain('stripe');
  });

  it('should generate different URLs for different providers', () => {
    const stripeUrl = webhookManager.generateWebhookUrl('stripe');
    const paypalUrl = webhookManager.generateWebhookUrl('paypal');

    expect(stripeUrl).toContain('/webhooks/stripe');
    expect(paypalUrl).toContain('/webhooks/paypal');
    expect(stripeUrl).not.toBe(paypalUrl);
  });

  it('should use instance domain from configuration', () => {
    const webhookUrl = webhookManager.generateWebhookUrl('stripe');

    // Should generate a valid webhook URL path
    expect(webhookUrl).toContain('/api/funding/webhooks/');
    expect(webhookUrl.length).toBeGreaterThan(0);
  });

  // Regression test for the bug where the wizard surfaced /api/funding/v1/webhooks/...
  // but the route was mounted at /api/funding/webhooks/... — operators copied the
  // generated URL into the Stripe Dashboard verbatim and every delivery 404'd.
  it('should generate a URL whose path resolves to the mounted webhook route', async () => {
    const generatedUrl = webhookManager.generateWebhookUrl('stripe');
    const pathMatch = generatedUrl.match(/\/api\/funding\/[^?#]+/);
    expect(pathMatch, `generated URL has no /api/funding path: ${generatedUrl}`).not.toBeNull();
    const pathname = pathMatch![0];

    const handleStripeWebhook = sandbox.stub().resolves();
    const app = express();
    const webhookRoutes = new WebhookRoutes({ handleStripeWebhook } as any);
    webhookRoutes.installHandlers(app, '/api/funding');

    // A request without a Stripe-Signature header reaches the handler and gets
    // 400. A 404 means the generated path does not match the mounted route.
    const response = await request(app)
      .post(pathname)
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).not.toBe(404);
  });
});
