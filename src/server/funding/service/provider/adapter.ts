import { ProviderType } from '@/common/model/funding-plan';

/**
 * Parameters for creating a checkout session
 */
export interface CreateCheckoutSessionParams {
  priceId?: string; // Pre-created price ID for fixed pricing
  amount?: number; // Amount in millicents for PWYC pricing
  currency: string; // ISO 4217 currency code
  interval: 'month' | 'year';
  accountId: string;
  calendarIds?: string[];
  returnUrl: string;
}

/**
 * Result of creating a checkout session
 */
export interface CheckoutSessionResult {
  clientSecret: string;
  sessionId: string;
}

/**
 * Status of a checkout session
 */
export interface CheckoutSessionStatus {
  status: 'complete' | 'open' | 'expired';
  subscriptionId?: string;
  customerId?: string;
  metadata: {
    accountId: string;
    calendarIds?: string;
  };
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
  /** Account ID from checkout session metadata (checkout.session.completed only) */
  accountId?: string;
  /** JSON string of calendar IDs from checkout session metadata (checkout.session.completed only) */
  calendarIds?: string;
}

/**
 * Abstract interface for payment provider adapters
 *
 * This interface defines the contract that all payment provider implementations
 * must follow. It supports credential configuration, subscription management,
 * checkout sessions, and webhook handling.
 *
 * Webhook registration for Stripe is managed manually by the instance
 * administrator via the Stripe dashboard. The admin enters the webhook signing
 * secret (whsec_) through the admin credential form.
 */
export interface PaymentProviderAdapter {
  /**
   * Provider type identifier
   */
  readonly providerType: ProviderType;

  /**
   * Validate provider credentials format
   *
   * @param credentials - Provider credentials to validate
   * @returns True if credentials are valid format, false otherwise
   */
  validateCredentials(credentials: ProviderCredentials): Promise<boolean>;

  /**
   * Cancel an existing subscription
   *
   * @param subscriptionId - Provider's subscription ID
   * @param immediate - If true, cancel immediately; otherwise at period end
   */
  cancelSubscription(subscriptionId: string, immediate: boolean): Promise<void>;

  /**
   * Whether the provider supports in-place subscription amount updates
   *
   * Stripe supports updating amounts on existing subscriptions.
   * PayPal does not; subscriptions have fixed amounts set at creation.
   *
   * @returns True if updateSubscriptionAmount can be called
   */
  supportsAmountUpdates(): boolean;

  /**
   * Update the amount on an existing subscription
   *
   * @param providerSubscriptionId - Provider's subscription ID
   * @param newAmount - New subscription amount in millicents
   * @param currency - ISO 4217 currency code
   */
  updateSubscriptionAmount(providerSubscriptionId: string, newAmount: number, currency: string): Promise<void>;

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

  /**
   * Create a checkout session for embedded payment UI
   *
   * For fixed pricing, pass priceId. For PWYC pricing, pass amount
   * which will be used to create a price on the fly.
   *
   * @param params - Checkout session parameters
   * @returns Client secret and session ID for the embedded checkout
   */
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult>;

  /**
   * Retrieve the status of a checkout session
   *
   * @param sessionId - The checkout session ID
   * @returns Current status, subscription/customer IDs, and metadata
   */
  getCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus>;

  /**
   * Create a recurring price with the provider
   *
   * @param amount - Amount in millicents
   * @param currency - ISO 4217 currency code
   * @param interval - Billing interval ('month' or 'year')
   * @returns Provider price ID
   */
  createPrice(amount: number, currency: string, interval: 'month' | 'year'): Promise<string>;
}
