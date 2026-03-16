import Stripe from 'stripe';
import {
  PaymentProviderAdapter,
  CreateSubscriptionParams,
  ProviderSubscription,
  ProviderCredentials,
  WebhookEvent,
  WebhookRegistration,
} from './adapter';
import { ProviderType } from '@/common/model/funding-plan';

/**
 * Stripe payment provider adapter
 *
 * Implements the PaymentProviderAdapter interface using Stripe SDK.
 * Handles subscription management, webhook verification, and billing portal.
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
   * Register a webhook endpoint with Stripe
   *
   * @param webhookUrl - The URL to receive webhook events
   * @param credentials - Provider credentials for authentication
   * @returns Webhook ID and secret for verification
   */
  async registerWebhook(
    webhookUrl: string,
    credentials: ProviderCredentials,
  ): Promise<WebhookRegistration> {
    const stripeUserId = credentials.stripeUserId as string;

    // Define subscription-related events to listen for
    const enabledEvents = [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
    ];

    // Create webhook endpoint with Stripe-Account header for connected accounts
    const webhookEndpoint = await this.stripe.webhookEndpoints.create(
      {
        url: webhookUrl,
        enabled_events: enabledEvents,
      },
      {
        stripeAccount: stripeUserId,
      },
    );

    return {
      webhookId: webhookEndpoint.id,
      webhookSecret: webhookEndpoint.secret,
    };
  }

  /**
   * Delete a webhook endpoint from Stripe
   *
   * @param webhookId - The webhook endpoint ID to delete
   * @param credentials - Provider credentials for authentication
   */
  async deleteWebhook(webhookId: string, credentials: ProviderCredentials): Promise<void> {
    const stripeUserId = credentials.stripeUserId as string;

    await this.stripe.webhookEndpoints.del(webhookId, {
      stripeAccount: stripeUserId,
    });
  }

  /**
   * Validate provider credentials format
   *
   * @param credentials - Provider credentials to validate
   * @returns True if credentials are valid format
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    // Check that required fields exist
    if (!credentials.apiKey || !credentials.stripeUserId) {
      return false;
    }

    // Optionally, could make a test API call to verify credentials work
    // For now, just check format
    return true;
  }

  /**
   * Create a new subscription for a customer
   *
   * @param params - Subscription creation parameters
   * @returns Provider subscription data
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<ProviderSubscription> {
    // Create or retrieve customer
    let customer: Stripe.Customer;

    // Try to find existing customer by email
    const existingCustomers = await this.stripe.customers.list({
      email: params.accountEmail,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    }
    else {
      // Create new customer
      customer = await this.stripe.customers.create({
        email: params.accountEmail,
        metadata: {
          pavillion_account_id: params.accountId,
        },
      });
    }

    // Create or use existing price
    let priceId = params.priceId;
    if (!priceId) {
      // Create a price for this subscription
      const price = await this.stripe.prices.create({
        unit_amount: Math.round(params.amount / 1000), // Convert millicents to cents
        currency: params.currency.toLowerCase(),
        recurring: {
          interval: params.billingCycle === 'monthly' ? 'month' : 'year',
        },
        product_data: {
          name: 'Pavillion Subscription',
        },
      });
      priceId = price.id;
    }

    // Create subscription
    const subscription = await this.stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      metadata: {
        pavillion_account_id: params.accountId,
      },
    });

    // Convert Stripe subscription to ProviderSubscription format
    return this.convertStripeSubscription(subscription);
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
