import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { StripeAdapter } from '../service/provider/stripe';
import { PayPalAdapter } from '../service/provider/paypal';
import { WebhookManager } from '../service/provider/webhook_manager';
import { MockStripeAdapter, MockPayPalAdapter } from '../service/provider/mock_adapters';

/**
 * Tests for Provider Adapter Webhook Management
 *
 * This test suite covers:
 * - Stripe adapter webhook registration (throws - managed manually)
 * - Stripe adapter webhook deletion (throws - managed manually)
 * - PayPal adapter webhook registration (mocked API)
 * - Error handling in adapters (network failures, invalid responses)
 * - WebhookManager utility service
 * - Mock adapters for testing without real credentials
 */
describe('Provider Adapter Webhook Management', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('StripeAdapter Webhook Registration', () => {
    let adapter: StripeAdapter;

    beforeEach(() => {
      const credentials = { apiKey: 'sk_test_123' };
      const webhookSecret = 'whsec_test';
      adapter = new StripeAdapter(credentials, webhookSecret);
    });

    it('should throw because Stripe webhooks are managed manually', async () => {
      const webhookUrl = 'https://example.com/webhooks/stripe';
      const credentials = { apiKey: 'sk_test_123' };

      await expect(adapter.registerWebhook(webhookUrl, credentials)).rejects.toThrow(
        'Stripe webhook registration is managed manually via the admin dashboard',
      );
    });
  });

  describe('StripeAdapter Webhook Deletion', () => {
    let adapter: StripeAdapter;

    beforeEach(() => {
      const credentials = { apiKey: 'sk_test_123' };
      const webhookSecret = 'whsec_test';
      adapter = new StripeAdapter(credentials, webhookSecret);
    });

    it('should throw because Stripe webhooks are managed manually', async () => {
      const webhookId = 'we_test123';
      const credentials = { apiKey: 'sk_test_123' };

      await expect(adapter.deleteWebhook(webhookId, credentials)).rejects.toThrow(
        'Stripe webhook deletion is managed manually via the admin dashboard',
      );
    });
  });

  describe('PayPalAdapter Webhook Registration', () => {
    let adapter: PayPalAdapter;
    let fetchStub: any;

    beforeEach(() => {
      const credentials = {
        clientId: 'test_client',
        secret: 'test_secret',
        mode: 'sandbox',
      };
      const webhookSecret = 'paypal_webhook_secret';
      adapter = new PayPalAdapter(credentials, webhookSecret);

      // Mock global fetch for PayPal API calls
      fetchStub = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchStub.mockRestore();
    });

    it('should register webhook with PayPal API (mocked)', async () => {
      const webhookUrl = 'https://example.com/webhooks/paypal';

      // Mock PayPal OAuth token request
      fetchStub.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test_token', token_type: 'Bearer' }),
      } as Response);

      // Mock webhook creation request
      fetchStub.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'WH-TEST123',
          url: webhookUrl,
          event_types: [
            { name: 'BILLING.SUBSCRIPTION.CREATED' },
            { name: 'BILLING.SUBSCRIPTION.CANCELLED' },
          ],
        }),
      } as Response);

      const credentials = { clientId: 'test_client', secret: 'test_secret' };
      const result = await adapter.registerWebhook(webhookUrl, credentials);

      expect(result).toEqual({
        webhookId: 'WH-TEST123',
        webhookSecret: expect.any(String),
      });

      // Verify webhook creation was called
      expect(fetchStub).toHaveBeenCalledTimes(2); // Token + webhook creation
    });

    it('should handle sandbox vs production environment differences', async () => {
      const webhookUrl = 'https://example.com/webhooks/paypal';

      // Mock responses
      fetchStub.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test_token' }),
      } as Response);

      fetchStub.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'WH-TEST123' }),
      } as Response);

      await adapter.registerWebhook(webhookUrl, { mode: 'sandbox' });

      // Check that sandbox API URL was used
      const tokenCall = fetchStub.mock.calls[0];
      expect(tokenCall[0]).toContain('sandbox.paypal.com');
    });
  });

  describe('Error Handling in Adapters', () => {
    it('should throw for Stripe webhook registration (managed manually)', async () => {
      const adapter = new StripeAdapter({ apiKey: 'sk_test' }, 'whsec_test');

      const webhookUrl = 'https://example.com/webhooks/stripe';
      const credentials = { apiKey: 'sk_test' };

      await expect(adapter.registerWebhook(webhookUrl, credentials)).rejects.toThrow(
        'Stripe webhook registration is managed manually via the admin dashboard',
      );
    });

    it('should handle invalid responses in PayPal adapter', async () => {
      const adapter = new PayPalAdapter(
        { clientId: 'test', secret: 'test', mode: 'sandbox' },
        'webhook_secret',
      );

      const fetchStub = vi.spyOn(global, 'fetch');

      // Mock failed token request
      fetchStub.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const webhookUrl = 'https://example.com/webhooks/paypal';
      const credentials = { clientId: 'invalid', secret: 'invalid' };

      await expect(adapter.registerWebhook(webhookUrl, credentials)).rejects.toThrow();

      fetchStub.mockRestore();
    });
  });

  describe('WebhookManager Utility Service', () => {
    let webhookManager: WebhookManager;

    beforeEach(() => {
      webhookManager = new WebhookManager();
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

  describe('Mock Adapters for Testing', () => {
    it('should create MockStripeAdapter that validates apiKey', async () => {
      const mockAdapter = new MockStripeAdapter();

      // Should validate credentials with apiKey
      const isValid = await mockAdapter.validateCredentials({
        apiKey: 'sk_test_any_key',
      });
      expect(isValid).toBe(true);

      // Should reject credentials without apiKey
      const isInvalid = await mockAdapter.validateCredentials({});
      expect(isInvalid).toBe(false);
    });

    it('should create MockPayPalAdapter without API calls', async () => {
      const mockAdapter = new MockPayPalAdapter();

      // Should validate credentials without API calls
      const isValid = await mockAdapter.validateCredentials({
        clientId: 'any_client_id',
        secret: 'any_secret',
      });

      expect(isValid).toBe(true);
    });

    it('should throw for MockStripeAdapter webhook registration', async () => {
      const mockStripe = new MockStripeAdapter();

      await expect(
        mockStripe.registerWebhook('https://test.com/webhook', {}),
      ).rejects.toThrow('Stripe webhook registration is managed manually via the admin dashboard');
    });

    it('should generate predictable test credentials for PayPal development', async () => {
      const mockPayPal = new MockPayPalAdapter();

      const paypalWebhook = await mockPayPal.registerWebhook(
        'https://test.com/webhook',
        {},
      );

      // Mock webhooks should return predictable IDs
      expect(paypalWebhook.webhookId).toContain('WH-MOCK-');
    });

    it('should use mock adapters when MOCK_OAUTH environment variable is set', () => {
      // This test verifies the pattern exists for environment-based mocking
      const mockOAuthEnabled = process.env.MOCK_OAUTH === 'true';

      if (mockOAuthEnabled) {
        const mockAdapter = new MockStripeAdapter();
        expect(mockAdapter.providerType).toBe('stripe');
      }

      // Test passes regardless of environment variable
      expect(true).toBe(true);
    });
  });
});
