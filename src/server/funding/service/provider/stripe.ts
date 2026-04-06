import Stripe from 'stripe';
import {
  PaymentProviderAdapter,
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  CheckoutSessionStatus,
  ProviderSubscription,
  ProviderCredentials,
  WebhookEvent,
} from './adapter';
import { ProviderType } from '@/common/model/funding-plan';

/**
 * Stripe payment provider adapter
 *
 * Implements the PaymentProviderAdapter interface using Stripe SDK.
 * Handles subscription management, checkout sessions, webhook verification,
 * and billing portal.
 *
 * Webhook registration is managed manually by the instance administrator
 * via the Stripe dashboard. The admin enters the webhook signing secret
 * (whsec_) directly through the credential configuration form.
 */
export class StripeAdapter implements PaymentProviderAdapter {
  readonly providerType: ProviderType = 'stripe';
  private stripe: Stripe;
  private webhookSecret: string;
  private credentials: ProviderCredentials;

  /**
   * Initialize Stripe adapter with credentials
   *
   * @param credentials - Provider credentials containing apiKey
   * @param webhookSecret - Webhook signature verification secret
   */
  constructor(credentials: ProviderCredentials, webhookSecret: string) {
    const apiKey = credentials.apiKey as string;
    if (!apiKey) {
      throw new Error('Stripe API key is required');
    }

    this.stripe = new Stripe(apiKey, {
      apiVersion: '2025-12-15.clover',
    });
    this.webhookSecret = webhookSecret;
    this.credentials = credentials;
  }

  /**
   * Validate provider credentials by making a test API call
   *
   * Attempts a balance.retrieve() call to verify that the configured
   * API key is valid. All errors are swallowed and result in false.
   *
   * @param _credentials - Provider credentials (unused; adapter already initialized with key)
   * @returns True if the Stripe API key is valid
   */
  async validateCredentials(_credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.stripe.balance.retrieve();
      return true;
    }
    catch {
      return false;
    }
  }

  /**
   * Validate Stripe API key formats by prefix
   *
   * Checks that publishable key starts with pk_test_ or pk_live_,
   * secret key starts with sk_test_ or sk_live_,
   * and webhook secret starts with whsec_.
   * Format check only - no test API call.
   *
   * @param publishableKey - Stripe publishable key
   * @param secretKey - Stripe secret key
   * @param webhookSecret - Stripe webhook signing secret
   * @returns Object with valid flag and error message if invalid
   */
  static validateKeyFormats(
    publishableKey: string,
    secretKey: string,
    webhookSecret: string,
  ): { valid: boolean; error?: string } {
    if (!publishableKey || (!publishableKey.startsWith('pk_test_') && !publishableKey.startsWith('pk_live_'))) {
      return { valid: false, error: 'Invalid publishable key format. Must start with pk_test_ or pk_live_' };
    }

    if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
      return { valid: false, error: 'Invalid secret key format. Must start with sk_test_ or sk_live_' };
    }

    if (!webhookSecret || !webhookSecret.startsWith('whsec_')) {
      return { valid: false, error: 'Invalid webhook secret format. Must start with whsec_' };
    }

    return { valid: true };
  }

  /**
   * Cancel an existing subscription
   *
   * @param subscriptionId - Provider's subscription ID
   * @param immediate - If true, cancel immediately; otherwise at period end
   */
  async cancelSubscription(subscriptionId: string, immediate: boolean): Promise<void> {
    if (immediate) {
      // Cancel immediately
      await this.stripe.subscriptions.cancel(subscriptionId);
    }
    else {
      // Cancel at period end
      await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }
  }

  /**
   * Stripe supports in-place subscription amount updates
   *
   * @returns True
   */
  supportsAmountUpdates(): boolean {
    return true;
  }

  /**
   * Update the amount on an existing subscription
   *
   * Creates a new price and updates the subscription item to reflect the new amount.
   * Uses no proration to avoid mid-cycle charges; the new amount applies at the next billing cycle.
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
    // Retrieve the current subscription to get the existing item
    const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
    const currentItem = subscription.items.data[0];

    if (!currentItem) {
      throw new Error('Subscription has no items to update');
    }

    // Determine the billing interval from the current price
    const currentInterval = currentItem.price?.recurring?.interval || 'month';

    // Create a new price with the updated amount
    const newPrice = await this.stripe.prices.create({
      unit_amount: Math.round(newAmount / 1000), // Convert millicents to cents
      currency: currency.toLowerCase(),
      recurring: {
        interval: currentInterval,
      },
      product_data: {
        name: 'Pavillion Subscription',
      },
    });

    // Update the subscription item with the new price, no proration
    await this.stripe.subscriptions.update(providerSubscriptionId, {
      items: [
        {
          id: currentItem.id,
          price: newPrice.id,
        },
      ],
      proration_behavior: 'none',
    });
  }

  /**
   * Retrieve current subscription status from provider
   *
   * @param subscriptionId - Provider's subscription ID
   * @returns Current subscription data
   */
  async getSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    return this.convertStripeSubscription(subscription);
  }

  /**
   * Get URL to Stripe's billing portal for customer self-service
   *
   * @param customerId - Provider's customer ID
   * @param returnUrl - URL to return to after portal session
   * @returns Billing portal URL
   */
  async getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session.url;
  }

  /**
   * Verify webhook signature from Stripe
   *
   * @param payload - Raw webhook payload (string)
   * @param signature - Signature header from webhook request
   * @returns True if signature is valid, false otherwise
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
      return true;
    }
    catch (err) {
      return false;
    }
  }

  /**
   * Parse webhook event from Stripe
   *
   * Handles all Stripe event types relevant to funding plan lifecycle:
   * checkout completion, invoice payments, and subscription updates.
   *
   * @param payload - Raw webhook payload (already verified)
   * @returns Parsed webhook event data
   */
  parseWebhookEvent(payload: string): WebhookEvent {
    const event = JSON.parse(payload) as Stripe.Event;

    // Extract common event data
    const webhookEvent: WebhookEvent = {
      eventId: event.id,
      eventType: event.type,
      rawPayload: event,
    };

    // Parse event-specific data
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        webhookEvent.subscriptionId = session.subscription as string;
        webhookEvent.customerId = session.customer as string;
        webhookEvent.status = 'active';
        webhookEvent.accountId = session.metadata?.pavillion_account_id;
        webhookEvent.calendarIds = session.metadata?.pavillion_calendar_ids;
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        webhookEvent.subscriptionId = invoice.subscription as string;
        webhookEvent.customerId = invoice.customer as string;
        webhookEvent.status = 'active';
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        webhookEvent.subscriptionId = invoice.subscription as string;
        webhookEvent.customerId = invoice.customer as string;
        webhookEvent.status = 'past_due';
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        webhookEvent.subscriptionId = subscription.id;
        webhookEvent.customerId = subscription.customer as string;
        webhookEvent.status = this.mapStripeStatus(subscription.status);
        webhookEvent.currentPeriodStart = new Date(subscription.current_period_start * 1000);
        webhookEvent.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        webhookEvent.subscriptionId = subscription.id;
        webhookEvent.customerId = subscription.customer as string;
        webhookEvent.status = 'cancelled';
        break;
      }
    }

    return webhookEvent;
  }

  /**
   * Create a checkout session for Stripe embedded checkout
   *
   * Uses ui_mode: 'embedded' and mode: 'subscription'. For fixed pricing,
   * uses the provided priceId directly. For PWYC pricing, creates a price
   * on the fly using the provided amount.
   *
   * @param params - Checkout session parameters
   * @returns Client secret and session ID
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    // Determine the price to use
    let priceId = params.priceId;

    if (!priceId && params.amount) {
      // PWYC: create a price on the fly
      priceId = await this.createPrice(params.amount, params.currency, params.interval);
    }

    if (!priceId) {
      throw new Error('Either priceId or amount must be provided');
    }

    // Build metadata
    const metadata: Record<string, string> = {
      pavillion_account_id: params.accountId,
    };
    if (params.calendarIds && params.calendarIds.length > 0) {
      metadata.pavillion_calendar_ids = JSON.stringify(params.calendarIds);
    }

    // Build branding settings based on client color mode
    const brandingSettings: Stripe.Checkout.SessionCreateParams.BrandingSettings = {};
    if (params.colorMode === 'dark') {
      brandingSettings.background_color = '#1C1917'; // Stone 900
      brandingSettings.button_color = '#F97316'; // Orange 500
    }

    // Build return URL with session ID placeholder for redirect-based payments
    const returnUrl = new URL(params.returnUrl);
    returnUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');

    // Create the embedded checkout session
    const session = await this.stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'subscription',
      redirect_on_completion: 'if_required',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata,
      return_url: returnUrl.toString(),
      ...(Object.keys(brandingSettings).length > 0 && { branding_settings: brandingSettings }),
    });

    return {
      clientSecret: session.client_secret as string,
      sessionId: session.id,
    };
  }

  /**
   * Retrieve the status of a checkout session
   *
   * @param sessionId - The checkout session ID
   * @returns Current status, subscription/customer IDs, and metadata
   */
  async getCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);

    return {
      status: session.status as 'complete' | 'open' | 'expired',
      subscriptionId: session.subscription as string | undefined,
      customerId: session.customer as string | undefined,
      metadata: {
        accountId: session.metadata?.pavillion_account_id || '',
        calendarIds: session.metadata?.pavillion_calendar_ids,
      },
    };
  }

  /**
   * Create a recurring price in Stripe
   *
   * Converts millicents to Stripe's cents-based amount.
   *
   * @param amount - Amount in millicents
   * @param currency - ISO 4217 currency code
   * @param interval - Billing interval ('month' or 'year')
   * @returns Stripe Price ID
   */
  async createPrice(amount: number, currency: string, interval: 'month' | 'year'): Promise<string> {
    const price = await this.stripe.prices.create({
      unit_amount: Math.round(amount / 1000), // Convert millicents to cents
      currency: currency.toLowerCase(),
      recurring: {
        interval,
      },
      product_data: {
        name: 'Pavillion Subscription',
      },
    });

    return price.id;
  }

  /**
   * Convert Stripe subscription to ProviderSubscription format
   *
   * @param subscription - Stripe subscription object
   * @returns Standardized subscription data
   * @private
   */
  private convertStripeSubscription(subscription: Stripe.Subscription): ProviderSubscription {
    // Get amount from first subscription item
    const amount = subscription.items.data[0]?.price?.unit_amount || 0;

    return {
      providerSubscriptionId: subscription.id,
      providerCustomerId: subscription.customer as string,
      status: this.mapStripeStatus(subscription.status),
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      amount: amount * 1000, // Convert cents to millicents
      currency: subscription.items.data[0]?.price?.currency?.toUpperCase() || 'USD',
    };
  }

  /**
   * Map Stripe subscription status to our internal status
   *
   * @param stripeStatus - Stripe subscription status
   * @returns Internal subscription status
   * @private
   */
  private mapStripeStatus(
    stripeStatus: Stripe.Subscription.Status,
  ): 'active' | 'past_due' | 'suspended' | 'cancelled' {
    switch (stripeStatus) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'unpaid':
      case 'paused':
        return 'suspended';
      case 'canceled':
      case 'incomplete':
      case 'incomplete_expired':
        return 'cancelled';
      default:
        return 'cancelled';
    }
  }
}
