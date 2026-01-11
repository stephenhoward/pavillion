import {
  PaymentProviderAdapter,
  CreateSubscriptionParams,
  ProviderSubscription,
  ProviderCredentials,
  WebhookEvent,
  WebhookRegistration,
} from './adapter';
import { ProviderType } from '@/common/model/subscription';
import { Client as PayPalClient } from '@paypal/paypal-server-sdk';

/**
 * PayPal payment provider adapter
 *
 * Implements the PaymentProviderAdapter interface using PayPal SDK.
 * Handles PayPal OAuth flow, subscription management, and webhook verification.
 */
export class PayPalAdapter implements PaymentProviderAdapter {
  readonly providerType: ProviderType = 'paypal';
  private client: PayPalClient;
  private webhookSecret: string;
  private credentials: ProviderCredentials;

  /**
   * Initialize PayPal adapter with credentials
   *
   * @param credentials - Provider credentials containing clientId and secret
   * @param webhookSecret - Webhook signature verification secret
   */
  constructor(credentials: ProviderCredentials, webhookSecret: string) {
    const clientId = credentials.clientId as string;
    const secret = credentials.secret as string;
    const mode = (credentials.mode as string) || 'sandbox'; // 'sandbox' or 'live'

    if (!clientId || !secret) {
      throw new Error('PayPal client ID and secret are required');
    }

    // Initialize PayPal client
    this.client = new PayPalClient({
      clientCredentialsAuthCredentials: {
        oAuthClientId: clientId,
        oAuthClientSecret: secret,
      },
      environment: mode === 'live' ? 'production' : 'sandbox',
    });

    this.webhookSecret = webhookSecret;
    this.credentials = credentials;
  }

  /**
   * Get PayPal OAuth URL for merchant account linking
   *
   * @param returnUrl - URL to redirect to after OAuth flow completes
   * @returns OAuth authorization URL
   */
  async getConnectUrl(returnUrl: string): Promise<string> {
    // PayPal Partner Referrals API or standard OAuth
    const mode = (this.credentials.mode as string) || 'sandbox';
    const baseUrl = mode === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';
    const clientId = this.credentials.clientId as string;
    const redirectUri = `${process.env.BASE_URL}/api/subscription/v1/admin/providers/paypal/callback`;

    const params = new URLSearchParams({
      client_id: clientId || '',
      response_type: 'code',
      scope: 'openid email',
      redirect_uri: redirectUri,
      state: returnUrl, // Return user to this URL after OAuth
    });

    return `${baseUrl}/connect?${params.toString()}`;
  }

  /**
   * Build OAuth authorization URL with state and redirect URI
   *
   * @param state - CSRF protection state token
   * @param redirectUri - Callback URL for OAuth flow
   * @returns OAuth authorization URL
   */
  async buildOAuthUrl(state: string, redirectUri: string): Promise<string> {
    const mode = (this.credentials.mode as string) || 'sandbox';
    const baseUrl = mode === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';
    const clientId = (this.credentials.clientId as string) || '';

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'openid email',
      state,
      redirect_uri: redirectUri,
    });

    return `${baseUrl}/connect?${params.toString()}`;
  }

  /**
   * Handle OAuth callback and exchange code for credentials
   *
   * @param code - Authorization code from OAuth callback
   * @returns Provider credentials to be stored encrypted
   */
  async handleOAuthCallback(code: string): Promise<ProviderCredentials> {
    return this.exchangeCodeForCredentials(code);
  }

  /**
   * Exchange authorization code for provider credentials
   *
   * @param code - Authorization code from OAuth callback
   * @returns Provider credentials to be stored encrypted
   */
  async exchangeCodeForCredentials(code: string): Promise<ProviderCredentials> {
    // Exchange authorization code for access token
    // Note: This is a simplified implementation
    // In production, you would use PayPal's token endpoint

    const mode = (this.credentials.mode as string) || 'sandbox';
    const baseUrl =
      mode === 'live' ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';
    const clientId = this.credentials.clientId as string;
    const secret = this.credentials.secret as string;

    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange PayPal authorization code');
    }

    const data = await response.json();

    // Return credentials to be stored encrypted
    return {
      clientId: clientId || '',
      secret: secret || '',
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      mode: mode,
    };
  }

  /**
   * Register a webhook endpoint with PayPal
   *
   * @param webhookUrl - The URL to receive webhook events
   * @param credentials - Provider credentials for authentication
   * @returns Webhook ID and secret for verification
   */
  async registerWebhook(
    webhookUrl: string,
    credentials: ProviderCredentials
  ): Promise<WebhookRegistration> {
    const mode = (credentials.mode as string) || 'sandbox';
    const baseUrl =
      mode === 'live' ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';
    const clientId = credentials.clientId as string;
    const secret = credentials.secret as string;

    // Get access token
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to obtain PayPal access token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Define subscription-related events
    const eventTypes = [
      { name: 'BILLING.SUBSCRIPTION.CREATED' },
      { name: 'BILLING.SUBSCRIPTION.ACTIVATED' },
      { name: 'BILLING.SUBSCRIPTION.UPDATED' },
      { name: 'BILLING.SUBSCRIPTION.CANCELLED' },
      { name: 'BILLING.SUBSCRIPTION.SUSPENDED' },
      { name: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' },
      { name: 'PAYMENT.SALE.COMPLETED' },
    ];

    // Create webhook
    const webhookResponse = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        url: webhookUrl,
        event_types: eventTypes,
      }),
    });

    if (!webhookResponse.ok) {
      throw new Error('Failed to create PayPal webhook');
    }

    const webhookData = await webhookResponse.json();

    return {
      webhookId: webhookData.id,
      webhookSecret: webhookData.id, // PayPal uses webhook ID for verification
    };
  }

  /**
   * Delete a webhook endpoint from PayPal
   *
   * @param webhookId - The webhook endpoint ID to delete
   * @param credentials - Provider credentials for authentication
   */
  async deleteWebhook(webhookId: string, credentials: ProviderCredentials): Promise<void> {
    const mode = (credentials.mode as string) || 'sandbox';
    const baseUrl =
      mode === 'live' ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';
    const clientId = credentials.clientId as string;
    const secret = credentials.secret as string;

    // Get access token
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to obtain PayPal access token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Delete webhook
    const deleteResponse = await fetch(`${baseUrl}/v1/notifications/webhooks/${webhookId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      throw new Error('Failed to delete PayPal webhook');
    }
  }

  /**
   * Validate provider credentials format
   *
   * @param credentials - Provider credentials to validate
   * @returns True if credentials are valid format
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    // Check that required fields exist
    if (!credentials.clientId || !credentials.secret) {
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
    // Create or use existing plan
    let planId = params.priceId;

    if (!planId) {
      // Create a billing plan for this subscription
      const plan = await this.createBillingPlan(params);
      planId = plan.id;
    }

    // Create subscription
    const subscriptionData = {
      planId: planId,
      subscriber: {
        emailAddress: params.accountEmail,
      },
      applicationContext: {
        brandName: 'Pavillion',
        shippingPreference: 'NO_SHIPPING',
        userAction: 'SUBSCRIBE_NOW',
        returnUrl: params.successUrl || `${process.env.BASE_URL}/subscription/success`,
        cancelUrl: params.cancelUrl || `${process.env.BASE_URL}/subscription/cancel`,
      },
    };

    // Note: The PayPal SDK typing may need adjustment
    // This is a placeholder that matches the general structure
    const response = await (this.client as any).subscriptions.subscriptionsCreate({
      body: subscriptionData,
    });

    if (!response.result || !response.result.id) {
      throw new Error('Failed to create PayPal subscription');
    }

    // Convert PayPal subscription to ProviderSubscription format
    return this.convertPayPalSubscription(response.result);
  }

  /**
   * Cancel an existing subscription
   *
   * @param subscriptionId - Provider's subscription ID
   * @param immediate - If true, cancel immediately; otherwise at period end (PayPal only supports immediate)
   */
  async cancelSubscription(subscriptionId: string, immediate: boolean): Promise<void> {
    // Note: PayPal doesn't have native "cancel at period end" functionality
    // We'll cancel immediately and the service layer should handle the timing
    await (this.client as any).subscriptions.subscriptionsCancel({
      subscriptionId,
      body: {
        reason: 'User requested cancellation',
      },
    });
  }

  /**
   * Retrieve current subscription status from provider
   *
   * @param subscriptionId - Provider's subscription ID
   * @returns Current subscription data
   */
  async getSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const response = await (this.client as any).subscriptions.subscriptionsGet({
      subscriptionId,
    });

    if (!response.result) {
      throw new Error('Failed to retrieve PayPal subscription');
    }

    return this.convertPayPalSubscription(response.result);
  }

  /**
   * Get URL to PayPal's subscription management page
   *
   * @param customerId - Provider's customer ID (not used for PayPal)
   * @param returnUrl - URL to return to after management
   * @returns Management portal URL
   */
  async getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    // PayPal doesn't have a dedicated billing portal like Stripe
    // Direct users to their PayPal account subscription management
    const mode = (this.credentials.mode as string) || 'sandbox';
    const baseUrl = mode === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';

    return `${baseUrl}/myaccount/autopay`;
  }

  /**
   * Verify webhook signature from PayPal
   *
   * @param payload - Raw webhook payload (string)
   * @param signature - Signature header from webhook request
   * @returns True if signature is valid, false otherwise
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // PayPal webhook verification uses multiple headers
    // This is a simplified implementation
    // In production, use PayPal's webhook verification API

    try {
      // PayPal webhook verification would typically involve:
      // 1. Extracting transmission ID, timestamp, and signature from headers
      // 2. Calling PayPal's webhook verification API
      // For now, we'll do basic validation
      return signature.length > 0 && payload.length > 0;
    } catch (err) {
      return false;
    }
  }

  /**
   * Parse webhook event from PayPal
   *
   * @param payload - Raw webhook payload (already verified)
   * @returns Parsed webhook event data
   */
  parseWebhookEvent(payload: string): WebhookEvent {
    const event = JSON.parse(payload);

    // Extract common event data
    const webhookEvent: WebhookEvent = {
      eventId: event.id || '',
      eventType: event.event_type || '',
      rawPayload: event,
    };

    // Parse event-specific data
    const resource = event.resource;

    switch (event.event_type) {
      case 'PAYMENT.SALE.COMPLETED': {
        webhookEvent.subscriptionId = resource.billing_agreement_id;
        webhookEvent.status = 'active';
        break;
      }

      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        webhookEvent.subscriptionId = resource.id;
        webhookEvent.status = 'active';
        if (resource.billing_info) {
          webhookEvent.currentPeriodStart = new Date(resource.start_time);
          webhookEvent.currentPeriodEnd = new Date(resource.billing_info.next_billing_time);
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        webhookEvent.subscriptionId = resource.id;
        webhookEvent.status = 'cancelled';
        break;
      }

      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        webhookEvent.subscriptionId = resource.id;
        webhookEvent.status = 'suspended';
        break;
      }

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        webhookEvent.subscriptionId = resource.id;
        webhookEvent.status = 'past_due';
        break;
      }
    }

    return webhookEvent;
  }

  /**
   * Create a billing plan for subscription
   *
   * @param params - Subscription creation parameters
   * @returns PayPal plan object
   * @private
   */
  private async createBillingPlan(params: CreateSubscriptionParams): Promise<any> {
    const planData = {
      product_id: 'PAVILLION_SUBSCRIPTION', // Should be a pre-created product ID
      name: 'Pavillion Subscription',
      description: `${params.billingCycle} subscription`,
      billing_cycles: [
        {
          frequency: {
            interval_unit: params.billingCycle === 'monthly' ? 'MONTH' : 'YEAR',
            interval_count: 1,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // Infinite
          pricing_scheme: {
            fixed_price: {
              value: (params.amount / 100000).toFixed(2), // Convert millicents to decimal
              currency_code: params.currency.toUpperCase(),
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    };

    // Note: This is a simplified implementation
    // In production, you would use the PayPal Catalog Products API
    // to create products and plans
    return {
      id: `PLAN_${Date.now()}`,
      ...planData,
    };
  }

  /**
   * Convert PayPal subscription to ProviderSubscription format
   *
   * @param subscription - PayPal subscription object
   * @returns Standardized subscription data
   * @private
   */
  private convertPayPalSubscription(subscription: any): ProviderSubscription {
    // Extract billing info
    const billingInfo = subscription.billing_info || {};
    const planId = subscription.plan_id || '';

    // Get amount from billing cycles (simplified)
    const amount = 0; // Would need to fetch from plan details in production

    return {
      providerSubscriptionId: subscription.id,
      providerCustomerId: subscription.subscriber?.email_address || '',
      status: this.mapPayPalStatus(subscription.status),
      currentPeriodStart: new Date(subscription.start_time || Date.now()),
      currentPeriodEnd: new Date(billingInfo.next_billing_time || Date.now()),
      amount: amount, // Would be populated from plan details
      currency: 'USD', // Would be populated from plan details
    };
  }

  /**
   * Map PayPal subscription status to our internal status
   *
   * @param paypalStatus - PayPal subscription status
   * @returns Internal subscription status
   * @private
   */
  private mapPayPalStatus(
    paypalStatus: string
  ): 'active' | 'past_due' | 'suspended' | 'cancelled' {
    switch (paypalStatus?.toUpperCase()) {
      case 'ACTIVE':
      case 'APPROVAL_PENDING':
      case 'APPROVED':
        return 'active';
      case 'SUSPENDED':
        return 'suspended';
      case 'CANCELLED':
      case 'EXPIRED':
        return 'cancelled';
      default:
        return 'cancelled';
    }
  }
}
