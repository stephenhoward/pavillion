import {
  PaymentProviderAdapter,
  CreateSubscriptionParams,
  ProviderSubscription,
  ProviderCredentials,
  WebhookEvent,
  WebhookRegistration,
} from './adapter';
import { ProviderType } from '@/common/model/subscription';

/**
 * Mock Stripe Adapter for Testing
 *
 * Returns mock credentials without making real API calls.
 * Enabled when MOCK_OAUTH=true environment variable is set.
 */
export class MockStripeAdapter implements PaymentProviderAdapter {
  readonly providerType: ProviderType = 'stripe';

  /**
   * Get OAuth connection URL (mock)
   *
   * @param returnUrl - URL to redirect to after OAuth flow
   * @returns Mock OAuth URL
   */
  async getConnectUrl(returnUrl: string): Promise<string> {
    return `http://localhost:3000/admin/funding?mock_oauth=stripe&return_url=${encodeURIComponent(returnUrl)}`;
  }

  /**
   * Build OAuth authorization URL (mock)
   *
   * @param state - CSRF protection state token
   * @param redirectUri - Callback URL for OAuth flow
   * @returns Mock OAuth authorization URL
   */
  async buildOAuthUrl(state: string, redirectUri: string): Promise<string> {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'mock_client_id',
      scope: 'read_write',
      state,
      redirect_uri: redirectUri,
    });

    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Handle OAuth callback (mock)
   *
   * @param code - Authorization code from OAuth callback
   * @returns Mock provider credentials
   */
  async handleOAuthCallback(code: string): Promise<ProviderCredentials> {
    return this.exchangeCodeForCredentials(code);
  }

  /**
   * Exchange authorization code for credentials (mock)
   *
   * @param code - Authorization code from OAuth callback
   * @returns Mock Stripe credentials
   */
  async exchangeCodeForCredentials(code: string): Promise<ProviderCredentials> {
    const timestamp = Date.now();

    return {
      apiKey: `sk_mock_${timestamp}`,
      stripeUserId: `acct_mock_${timestamp}`,
      scope: 'read_write',
      livemode: false,
      refreshToken: `rt_mock_${timestamp}`,
      publishableKey: `pk_mock_${timestamp}`,
    };
  }

  /**
   * Register a webhook endpoint (mock)
   *
   * @param webhookUrl - The URL to receive webhook events
   * @param credentials - Provider credentials
   * @returns Mock webhook registration
   */
  async registerWebhook(
    webhookUrl: string,
    credentials: ProviderCredentials,
  ): Promise<WebhookRegistration> {
    const timestamp = Date.now();

    return {
      webhookId: `we_mock_${timestamp}`,
      webhookSecret: `whsec_mock_${timestamp}`,
    };
  }

  /**
   * Delete a webhook endpoint (mock)
   *
   * @param webhookId - The webhook endpoint ID to delete
   * @param credentials - Provider credentials
   */
  async deleteWebhook(webhookId: string, credentials: ProviderCredentials): Promise<void> {
    // Mock deletion - no actual API call
    return Promise.resolve();
  }

  /**
   * Validate provider credentials (mock)
   *
   * @param credentials - Provider credentials to validate
   * @returns Always returns true for mock
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    // Mock validation - always returns true
    return true;
  }

  /**
   * Create a new subscription (mock)
   *
   * @param params - Subscription creation parameters
   * @returns Mock subscription data
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<ProviderSubscription> {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + (params.billingCycle === 'monthly' ? 1 : 12));

    return {
      providerSubscriptionId: `sub_mock_${Date.now()}`,
      providerCustomerId: `cus_mock_${Date.now()}`,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      amount: params.amount,
      currency: params.currency,
    };
  }

  /**
   * Cancel a subscription (mock)
   *
   * @param subscriptionId - Provider's subscription ID
   * @param immediate - If true, cancel immediately
   */
  async cancelSubscription(subscriptionId: string, immediate: boolean): Promise<void> {
    // Mock cancellation - no actual API call
    return Promise.resolve();
  }

  /**
   * Get subscription status (mock)
   *
   * @param subscriptionId - Provider's subscription ID
   * @returns Mock subscription data
   */
  async getSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    return {
      providerSubscriptionId: subscriptionId,
      providerCustomerId: 'cus_mock_123',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      amount: 1000000, // $10.00
      currency: 'USD',
    };
  }

  /**
   * Get billing portal URL (mock)
   *
   * @param customerId - Provider's customer ID
   * @param returnUrl - URL to return to after portal session
   * @returns Mock billing portal URL
   */
  async getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    return `http://localhost:3000/mock/billing-portal?customer=${customerId}&return_url=${encodeURIComponent(returnUrl)}`;
  }

  /**
   * Verify webhook signature (mock)
   *
   * @param payload - Raw webhook payload
   * @param signature - Signature header from webhook request
   * @returns Always returns true for mock
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // Mock verification - always returns true
    return true;
  }

  /**
   * Parse webhook event (mock)
   *
   * @param payload - Raw webhook payload
   * @returns Mock webhook event data
   */
  parseWebhookEvent(payload: string): WebhookEvent {
    const event = JSON.parse(payload);

    return {
      eventId: event.id || 'evt_mock_123',
      eventType: event.type || 'customer.subscription.created',
      subscriptionId: 'sub_mock_123',
      customerId: 'cus_mock_123',
      status: 'active',
      rawPayload: event,
    };
  }
}

/**
 * Mock PayPal Adapter for Testing
 *
 * Returns mock credentials without making real API calls.
 * Enabled when MOCK_OAUTH=true environment variable is set.
 */
export class MockPayPalAdapter implements PaymentProviderAdapter {
  readonly providerType: ProviderType = 'paypal';

  /**
   * Get OAuth connection URL (mock)
   *
   * @param returnUrl - URL to redirect to after OAuth flow
   * @returns Mock OAuth URL
   */
  async getConnectUrl(returnUrl: string): Promise<string> {
    return `http://localhost:3000/admin/funding?mock_oauth=paypal&return_url=${encodeURIComponent(returnUrl)}`;
  }

  /**
   * Build OAuth authorization URL (mock)
   *
   * @param state - CSRF protection state token
   * @param redirectUri - Callback URL for OAuth flow
   * @returns Mock OAuth authorization URL
   */
  async buildOAuthUrl(state: string, redirectUri: string): Promise<string> {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'mock_paypal_client',
      scope: 'openid email',
      state,
      redirect_uri: redirectUri,
    });

    return `https://www.sandbox.paypal.com/connect?${params.toString()}`;
  }

  /**
   * Handle OAuth callback (mock)
   *
   * @param code - Authorization code from OAuth callback
   * @returns Mock provider credentials
   */
  async handleOAuthCallback(code: string): Promise<ProviderCredentials> {
    return this.exchangeCodeForCredentials(code);
  }

  /**
   * Exchange authorization code for credentials (mock)
   *
   * @param code - Authorization code from OAuth callback
   * @returns Mock PayPal credentials
   */
  async exchangeCodeForCredentials(code: string): Promise<ProviderCredentials> {
    const timestamp = Date.now();

    return {
      clientId: `paypal_client_mock_${timestamp}`,
      secret: `paypal_secret_mock_${timestamp}`,
      accessToken: `paypal_access_mock_${timestamp}`,
      mode: 'sandbox',
    };
  }

  /**
   * Register a webhook endpoint (mock)
   *
   * @param webhookUrl - The URL to receive webhook events
   * @param credentials - Provider credentials
   * @returns Mock webhook registration
   */
  async registerWebhook(
    webhookUrl: string,
    credentials: ProviderCredentials,
  ): Promise<WebhookRegistration> {
    const timestamp = Date.now();

    return {
      webhookId: `WH-MOCK-${timestamp}`,
      webhookSecret: `paypal_webhook_secret_mock_${timestamp}`,
    };
  }

  /**
   * Delete a webhook endpoint (mock)
   *
   * @param webhookId - The webhook endpoint ID to delete
   * @param credentials - Provider credentials
   */
  async deleteWebhook(webhookId: string, credentials: ProviderCredentials): Promise<void> {
    // Mock deletion - no actual API call
    return Promise.resolve();
  }

  /**
   * Validate provider credentials (mock)
   *
   * @param credentials - Provider credentials to validate
   * @returns Always returns true for mock
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    // Mock validation - always returns true
    // Check that required fields exist
    if (credentials.clientId && credentials.secret) {
      return true;
    }
    return true; // Accept any credentials in mock mode
  }

  /**
   * Create a new subscription (mock)
   *
   * @param params - Subscription creation parameters
   * @returns Mock subscription data
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<ProviderSubscription> {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + (params.billingCycle === 'monthly' ? 1 : 12));

    return {
      providerSubscriptionId: `I-MOCK${Date.now()}`,
      providerCustomerId: params.accountEmail,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      amount: params.amount,
      currency: params.currency,
    };
  }

  /**
   * Cancel a subscription (mock)
   *
   * @param subscriptionId - Provider's subscription ID
   * @param immediate - If true, cancel immediately
   */
  async cancelSubscription(subscriptionId: string, immediate: boolean): Promise<void> {
    // Mock cancellation - no actual API call
    return Promise.resolve();
  }

  /**
   * Get subscription status (mock)
   *
   * @param subscriptionId - Provider's subscription ID
   * @returns Mock subscription data
   */
  async getSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    return {
      providerSubscriptionId: subscriptionId,
      providerCustomerId: 'mock@paypal.com',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      amount: 1000000, // $10.00
      currency: 'USD',
    };
  }

  /**
   * Get billing portal URL (mock)
   *
   * @param customerId - Provider's customer ID
   * @param returnUrl - URL to return to after portal session
   * @returns Mock billing portal URL
   */
  async getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    return `http://localhost:3000/mock/paypal-billing?customer=${customerId}&return_url=${encodeURIComponent(returnUrl)}`;
  }

  /**
   * Verify webhook signature (mock)
   *
   * @param payload - Raw webhook payload
   * @param signature - Signature header from webhook request
   * @returns Always returns true for mock
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // Mock verification - always returns true
    return true;
  }

  /**
   * Parse webhook event (mock)
   *
   * @param payload - Raw webhook payload
   * @returns Mock webhook event data
   */
  parseWebhookEvent(payload: string): WebhookEvent {
    const event = JSON.parse(payload);

    return {
      eventId: event.id || 'WH-MOCK-123',
      eventType: event.event_type || 'BILLING.SUBSCRIPTION.ACTIVATED',
      subscriptionId: 'I-MOCK123',
      customerId: 'mock@paypal.com',
      status: 'active',
      rawPayload: event,
    };
  }
}
