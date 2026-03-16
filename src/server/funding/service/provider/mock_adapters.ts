import {
  PaymentProviderAdapter,
  CreateSubscriptionParams,
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  CheckoutSessionStatus,
  ProviderSubscription,
  ProviderCredentials,
  WebhookEvent,
  WebhookRegistration,
} from './adapter';
import { ProviderType } from '@/common/model/funding-plan';

/**
 * Recorded call for updateSubscriptionAmount
 */
export interface UpdateSubscriptionAmountCall {
  providerSubscriptionId: string;
  newAmount: number;
  currency: string;
}

/**
 * Recorded call for createCheckoutSession
 */
export interface CreateCheckoutSessionCall {
  params: CreateCheckoutSessionParams;
}

/**
 * Recorded call for createPrice
 */
export interface CreatePriceCall {
  amount: number;
  currency: string;
  interval: 'month' | 'year';
}

/**
 * Mock Stripe Adapter for Testing
 *
 * Returns mock data without making real API calls.
 * Enabled when MOCK_OAUTH=true environment variable is set.
 */
export class MockStripeAdapter implements PaymentProviderAdapter {
  readonly providerType: ProviderType = 'stripe';

  /** Recorded calls to updateSubscriptionAmount for test verification */
  updateSubscriptionAmountCalls: UpdateSubscriptionAmountCall[] = [];

  /** Recorded calls to createCheckoutSession for test verification */
  createCheckoutSessionCalls: CreateCheckoutSessionCall[] = [];

  /** Recorded calls to createPrice for test verification */
  createPriceCalls: CreatePriceCall[] = [];

  /** Counter for generating unique mock IDs */
  private idCounter = 0;

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
   * Mock Stripe supports amount updates
   *
   * @returns True
   */
  supportsAmountUpdates(): boolean {
    return true;
  }

  /**
   * Update subscription amount (mock)
   *
   * Records the call parameters for test verification.
   *
   * @param providerSubscriptionId - Provider's subscription ID
   * @param newAmount - New subscription amount in millicents
   * @param currency - ISO 4217 currency code
   */
  async updateSubscriptionAmount(
    providerSubscriptionId: string,
    newAmount: number,
    currency: string,
  ): Promise<void> {
    this.updateSubscriptionAmountCalls.push({
      providerSubscriptionId,
      newAmount,
      currency,
    });
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

  /**
   * Create a checkout session (mock)
   *
   * Records the call parameters for test verification and returns mock data.
   *
   * @param params - Checkout session parameters
   * @returns Mock client secret and session ID
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    this.createCheckoutSessionCalls.push({ params });
    this.idCounter++;

    return {
      clientSecret: `cs_mock_secret_${this.idCounter}`,
      sessionId: `cs_mock_${this.idCounter}`,
    };
  }

  /**
   * Get checkout session status (mock)
   *
   * @param sessionId - The checkout session ID
   * @returns Mock checkout session status
   */
  async getCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus> {
    return {
      status: 'complete',
      subscriptionId: 'sub_mock_123',
      customerId: 'cus_mock_123',
      metadata: {
        accountId: 'acc_mock_123',
        calendarIds: JSON.stringify(['cal_mock_1']),
      },
    };
  }

  /**
   * Create a recurring price (mock)
   *
   * Records the call parameters for test verification.
   *
   * @param amount - Amount in millicents
   * @param currency - ISO 4217 currency code
   * @param interval - Billing interval
   * @returns Mock price ID
   */
  async createPrice(amount: number, currency: string, interval: 'month' | 'year'): Promise<string> {
    this.createPriceCalls.push({ amount, currency, interval });
    this.idCounter++;

    return `price_mock_${this.idCounter}`;
  }
}

/**
 * Mock PayPal Adapter for Testing
 *
 * Returns mock data without making real API calls.
 * Enabled when MOCK_OAUTH=true environment variable is set.
 */
export class MockPayPalAdapter implements PaymentProviderAdapter {
  readonly providerType: ProviderType = 'paypal';

  /** Recorded calls to updateSubscriptionAmount for test verification */
  updateSubscriptionAmountCalls: UpdateSubscriptionAmountCall[] = [];

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
   * Mock PayPal does not support amount updates
   *
   * @returns False
   */
  supportsAmountUpdates(): boolean {
    return false;
  }

  /**
   * Update subscription amount (mock)
   *
   * Records the call parameters for test verification.
   *
   * @param providerSubscriptionId - Provider's subscription ID
   * @param newAmount - New subscription amount in millicents
   * @param currency - ISO 4217 currency code
   */
  async updateSubscriptionAmount(
    providerSubscriptionId: string,
    newAmount: number,
    currency: string,
  ): Promise<void> {
    this.updateSubscriptionAmountCalls.push({
      providerSubscriptionId,
      newAmount,
      currency,
    });
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

  /**
   * Create a checkout session (mock)
   *
   * PayPal does not support embedded checkout sessions.
   *
   * @param params - Checkout session parameters
   * @throws Error always
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    throw new Error('createCheckoutSession is not implemented for PayPal');
  }

  /**
   * Get checkout session status (mock)
   *
   * PayPal does not support checkout sessions.
   *
   * @param sessionId - The checkout session ID
   * @throws Error always
   */
  async getCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus> {
    throw new Error('getCheckoutSessionStatus is not implemented for PayPal');
  }

  /**
   * Create a recurring price (mock)
   *
   * PayPal does not support standalone price creation.
   *
   * @param amount - Amount in millicents
   * @param currency - ISO 4217 currency code
   * @param interval - Billing interval
   * @throws Error always
   */
  async createPrice(amount: number, currency: string, interval: 'month' | 'year'): Promise<string> {
    throw new Error('createPrice is not implemented for PayPal');
  }
}
