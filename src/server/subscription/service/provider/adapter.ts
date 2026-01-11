import { ProviderType } from '@/common/model/subscription';

/**
 * Parameters for creating a subscription
 */
export interface CreateSubscriptionParams {
  accountEmail: string;
  accountId: string;
  priceId?: string; // Provider-specific price ID (Stripe) or plan ID (PayPal)
  amount: number; // in millicents
  currency: string; // ISO 4217 currency code
  billingCycle: 'monthly' | 'yearly';
  successUrl?: string; // Redirect URL after successful subscription
  cancelUrl?: string; // Redirect URL if user cancels
}

/**
 * Subscription data returned by provider
 */
export interface ProviderSubscription {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: 'active' | 'past_due' | 'suspended' | 'cancelled';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  amount: number; // in millicents
  currency: string;
}

/**
 * Provider credentials stored in ProviderConfig
 */
export interface ProviderCredentials {
  [key: string]: string | boolean | undefined;
}

/**
 * Webhook event from provider
 */
export interface WebhookEvent {
  eventId: string;
  eventType: string;
  subscriptionId?: string;
  customerId?: string;
  status?: 'active' | 'past_due' | 'suspended' | 'cancelled';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  amount?: number; // in millicents
  currency?: string;
  rawPayload: any; // Provider-specific event data
}

/**
 * Webhook registration result
 */
export interface WebhookRegistration {
  webhookId: string;
  webhookSecret: string;
}

/**
 * Abstract interface for payment provider adapters
 *
 * This interface defines the contract that all payment provider implementations
 * must follow. It supports OAuth-based account linking, subscription management,
 * and webhook handling.
 */
export interface PaymentProviderAdapter {
  /**
   * Provider type identifier
   */
  readonly providerType: ProviderType;

  /**
   * Get OAuth connection URL for linking provider account
   *
   * @param returnUrl - URL to redirect to after OAuth flow completes
   * @returns OAuth authorization URL
   */
  getConnectUrl(returnUrl: string): Promise<string>;

  /**
   * Build OAuth authorization URL with state and redirect URI
   *
   * @param state - CSRF protection state token
   * @param redirectUri - Callback URL for OAuth flow
   * @returns OAuth authorization URL
   */
  buildOAuthUrl(state: string, redirectUri: string): Promise<string>;

  /**
   * Handle OAuth callback and exchange code for credentials
   *
   * @param code - Authorization code from OAuth callback
   * @returns Provider credentials to be stored encrypted
   */
  handleOAuthCallback(code: string): Promise<ProviderCredentials>;

  /**
   * Exchange authorization code for provider credentials
   *
   * @param code - Authorization code from OAuth callback
   * @returns Provider credentials to be stored encrypted
   */
  exchangeCodeForCredentials(code: string): Promise<ProviderCredentials>;

  /**
   * Register a webhook endpoint with the provider
   *
   * @param webhookUrl - The URL to receive webhook events
   * @param credentials - Provider credentials for authentication
   * @returns Webhook ID and secret for verification
   */
  registerWebhook(
    webhookUrl: string,
    credentials: ProviderCredentials
  ): Promise<WebhookRegistration>;

  /**
   * Delete a webhook endpoint from the provider
   *
   * @param webhookId - The webhook endpoint ID to delete
   * @param credentials - Provider credentials for authentication
   */
  deleteWebhook(webhookId: string, credentials: ProviderCredentials): Promise<void>;

  /**
   * Validate provider credentials format
   *
   * @param credentials - Provider credentials to validate
   * @returns True if credentials are valid format, false otherwise
   */
  validateCredentials(credentials: ProviderCredentials): Promise<boolean>;

  /**
   * Create a new subscription for a customer
   *
   * @param params - Subscription creation parameters
   * @returns Provider subscription data
   */
  createSubscription(params: CreateSubscriptionParams): Promise<ProviderSubscription>;

  /**
   * Cancel an existing subscription
   *
   * @param subscriptionId - Provider's subscription ID
   * @param immediate - If true, cancel immediately; otherwise at period end
   */
  cancelSubscription(subscriptionId: string, immediate: boolean): Promise<void>;

  /**
   * Retrieve current subscription status from provider
   *
   * @param subscriptionId - Provider's subscription ID
   * @returns Current subscription data
   */
  getSubscription(subscriptionId: string): Promise<ProviderSubscription>;

  /**
   * Get URL to provider's billing portal for customer self-service
   *
   * @param customerId - Provider's customer ID
   * @param returnUrl - URL to return to after portal session
   * @returns Billing portal URL
   */
  getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string>;

  /**
   * Verify webhook signature from provider
   *
   * @param payload - Raw webhook payload (string)
   * @param signature - Signature header from webhook request
   * @returns True if signature is valid, false otherwise
   */
  verifyWebhookSignature(payload: string, signature: string): boolean;

  /**
   * Parse webhook event from provider
   *
   * @param payload - Raw webhook payload (already verified)
   * @returns Parsed webhook event data
   */
  parseWebhookEvent(payload: string): WebhookEvent;
}
