import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import config from 'config';
import { WebhookManager } from '../service/provider/webhook_manager';
import FundingApiV1 from '../api/v1';

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

  // Regression test for the bug where the generator read the nonexistent
  // `server.domain` config key: config.has() returned false, so the URL
  // silently fell back to BASE_URL or localhost instead of the configured
  // instance domain. The generator must read the canonical `domain` key.
  it('should use the instance domain from the `domain` config key', () => {
    const configStub = sandbox.stub(config, 'get');
    configStub.withArgs('domain').returns('events.example.org');

    const webhookUrl = webhookManager.generateWebhookUrl('stripe');

    expect(webhookUrl).toBe('https://events.example.org/api/funding/webhooks/stripe');
  });

  // Decision (stated per the missing-domain acceptance criterion): a blank
  // domain fails loudly rather than silently falling back to localhost — a
  // webhook registered against the wrong domain is a payment-integration
  // failure that presents as "webhooks never arrive."
  it('should throw rather than fall back when the configured domain is blank', () => {
    const configStub = sandbox.stub(config, 'get');
    configStub.withArgs('domain').returns('   ');

    expect(() => webhookManager.generateWebhookUrl('stripe')).toThrow(/domain/);
  });

  // Regression test for the bug where the wizard surfaced /api/funding/v1/webhooks/...
  // but the route was mounted at /api/funding/webhooks/... — operators copied the
  // generated URL into the Stripe Dashboard verbatim and every delivery 404'd.
  it('should generate a URL whose path resolves to the mounted webhook route', async () => {
    const generatedUrl = webhookManager.generateWebhookUrl('stripe');
    const pathMatch = generatedUrl.match(/\/api\/funding\/[^?#]+/);
    expect(pathMatch, `generated URL has no /api/funding path: ${generatedUrl}`).not.toBeNull();
    const pathname = pathMatch![0];

    // Mounted through FundingApiV1.install, as the running app does, so the
    // path is checked against the real installer rather than against a router
    // this test wired up itself (see the invariant note in webhooks.test.ts,
    // pv-ufag).
    const handleStripeWebhook = sandbox.stub().resolves();
    const app = express();
    FundingApiV1.install(app, { handleStripeWebhook } as any);

    // A request without a Stripe-Signature header reaches the handler and gets
    // 400. A 404 means the generated path does not match the mounted route.
    const response = await request(app)
      .post(pathname)
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).not.toBe(404);
  });

  // Payment provider dashboards (Stripe, PayPal) reject non-HTTPS webhook URLs
  // in production. If an operator sets the `domain` config value with an
  // explicit http:// prefix (typical when a reverse proxy terminates TLS in
  // front of the app), the generator must still emit https:// so the URL the
  // operator pastes is actually accepted.
  describe('HTTPS enforcement', () => {
    it('should upgrade a configured http:// domain to https:// for non-localhost hosts', () => {
      const configStub = sandbox.stub(config, 'get');
      configStub.withArgs('domain').returns('http://staging.pavillion.dev');
      const url = webhookManager.generateWebhookUrl('stripe');
      expect(url.startsWith('https://staging.pavillion.dev')).toBe(true);
    });

    it('should preserve a configured https:// domain unchanged', () => {
      const configStub = sandbox.stub(config, 'get');
      configStub.withArgs('domain').returns('https://prod.pavillion.dev');
      const url = webhookManager.generateWebhookUrl('stripe');
      expect(url.startsWith('https://prod.pavillion.dev')).toBe(true);
    });

    it('should keep an explicit http://localhost domain so local dev still works', () => {
      const configStub = sandbox.stub(config, 'get');
      configStub.withArgs('domain').returns('http://localhost:3000');
      const url = webhookManager.generateWebhookUrl('stripe');
      expect(url.startsWith('http://localhost:3000')).toBe(true);
    });
  });
});
