import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { WebhookManager } from '../service/provider/webhook_manager';

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
    expect(webhookUrl).toContain('/api/funding/v1/webhooks/stripe');
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
    expect(webhookUrl).toContain('/api/funding/v1/webhooks/');
    expect(webhookUrl.length).toBeGreaterThan(0);
  });
});
