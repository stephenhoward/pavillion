import Stripe from 'stripe';
import {
  PaymentProviderAdapter,
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  CheckoutSessionStatus,
  ProviderSubscription,
  ProviderCredentials,
  ProviderRequestOptions,
  WebhookEvent,
} from './adapter';
import { ProviderType } from '@/common/model/funding-plan';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('funding');

/**
 * Stripe rejects Idempotency-Key headers longer than this.
 */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Billing period resolved from a Stripe subscription
 */
interface BillingPeriod {
  start: Date;
  end: Date;
}

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

    // Pinned to the version the installed SDK's types describe. Bump this in
    // lockstep with the stripe dependency, or the API will answer in an older
    // shape than the field reads below expect.
    //
    // timeout and maxNetworkRetries are set explicitly because provider calls
    // run inside database transactions, and a transaction pins a connection
    // from the pool the whole application shares. Stripe's timeout is a
    // socket-inactivity timeout (req.setTimeout under the hood), not a cap on
    // total request duration: it fires only after that many milliseconds of
    // silence, so a response that keeps dribbling bytes can run far longer
    // than the configured value without ever tripping it. The hard cap on
    // how long a call can pin a connection is therefore PostgreSQL's
    // idle_in_transaction_session_timeout (60s, config/default.yaml), which
    // terminates the transaction while the app is parked waiting on a slow
    // provider response. Every Stripe call this adapter makes is a short
    // interactive operation; none of them wants the SDK's default 80s of
    // inactivity allowance. Retries are dropped rather than reduced because
    // a caller holding a transaction open is the wrong place to wait out a
    // Stripe outage — failing fast and rolling back is.
    //
    // Dropping retries also drops the idempotency key the SDK would have
    // generated for them, and a local rollback does not roll Stripe back: a
    // request that times out client-side may still have been applied. Every
    // mutating call in this adapter therefore sends an explicit
    // Idempotency-Key derived from the caller's operation identity (see
    // requestOptions), so a caller that replays the operation with the same
    // key gets Stripe's cached result instead of a second mutation. This
    // adapter still does not retry; it only makes a retry safe.
    //
    // ProviderFactory caches one adapter per provider config, so this single
    // client serves every call path.
    this.stripe = new Stripe(apiKey, {
      apiVersion: '2026-02-25.clover',
      timeout: 8000,
      maxNetworkRetries: 0,
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
   * Build Stripe request options for one mutating call
   *
   * Stripe scopes an idempotency key to a single request, so an operation
   * that makes several mutating calls needs a distinct key per call. The
   * step name keeps sibling calls apart while leaving each key a pure
   * function of the caller's key, so a replay of the whole operation hits
   * the same keys in the same order.
   *
   * @param options - Caller-supplied request options
   * @param step - Name of this call within the operation
   * @returns Stripe request options, empty when no key was supplied
   * @private
   */
  private requestOptions(options: ProviderRequestOptions | undefined, step: string): Stripe.RequestOptions {
    if (!options?.idempotencyKey) {
      return {};
    }

    const idempotencyKey = `${options.idempotencyKey}:${step}`;
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new Error(`Stripe idempotency key exceeds ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
    }

    return { idempotencyKey };
  }

  /**
   * Cancel an existing subscription
   *
   * @param subscriptionId - Provider's subscription ID
   * @param immediate - If true, cancel immediately; otherwise at period end
   * @param options - Per-request options (idempotency key)
   */
  async cancelSubscription(
    subscriptionId: string,
    immediate: boolean,
    options?: ProviderRequestOptions,
  ): Promise<void> {
    if (immediate) {
      // Cancel immediately
      await this.stripe.subscriptions.cancel(subscriptionId, {}, this.requestOptions(options, 'cancel'));
    }
    else {
      // Cancel at period end
      await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      }, this.requestOptions(options, 'cancel-at-period-end'));
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
   * @param options - Per-request options (idempotency key)
   */
  async updateSubscriptionAmount(
    providerSubscriptionId: string,
    newAmount: number,
    currency: string,
    options?: ProviderRequestOptions,
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
    }, this.requestOptions(options, 'price'));

    // Update the subscription item with the new price, no proration
    await this.stripe.subscriptions.update(providerSubscriptionId, {
      items: [
        {
          id: currentItem.id,
          price: newPrice.id,
        },
      ],
      proration_behavior: 'none',
    }, this.requestOptions(options, 'update'));
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
   * @param options - Per-request options (idempotency key)
   * @returns Billing portal URL
   */
  async getBillingPortalUrl(
    customerId: string,
    returnUrl: string,
    options?: ProviderRequestOptions,
  ): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    }, this.requestOptions(options, 'portal-session'));

    return session.url;
  }

  /**
   * Verify webhook signature from Stripe
   *
   * Fails closed when no signing secret is configured. `constructEvent` keys an
   * HMAC with the secret, and an empty key still yields a well-defined digest —
   * so an unset secret turns signature verification into something an attacker
   * who knows it is unset can satisfy (CVE-2026-41432 pattern). The secret is
   * admin-supplied at runtime (stored on ProviderConfigEntity, not in config),
   * so it cannot be asserted at startup; the check has to guard the call site.
   *
   * The check is deliberately unconditional rather than production-only. In
   * development with no Stripe credentials at all, ProviderFactory hands back
   * MockStripeAdapter, which skips verification entirely — that is the only
   * intended bypass, and configuring real credentials removes it.
   *
   * @param payload - Raw webhook payload (string)
   * @param signature - Signature header from webhook request
   * @returns True if signature is valid, false otherwise
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret || this.webhookSecret.trim() === '') {
      logger.error({
        providerType: this.providerType,
      }, 'Stripe webhook rejected: no signing secret is configured. Add the whsec_ signing secret to the Stripe provider configuration.');
      return false;
    }

    try {
      this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
      return true;
    }
    catch {
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
        webhookEvent.subscriptionId = this.resolveSubscriptionReference(session.subscription, {
          eventId: event.id,
          eventType: event.type,
        });
        webhookEvent.customerId = session.customer as string;
        webhookEvent.status = 'active';
        webhookEvent.accountId = session.metadata?.pavillion_account_id;
        webhookEvent.calendarIds = session.metadata?.pavillion_calendar_ids;
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        webhookEvent.subscriptionId = this.extractInvoiceSubscriptionId(invoice, event);
        webhookEvent.customerId = invoice.customer as string;
        webhookEvent.status = 'active';
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        webhookEvent.subscriptionId = this.extractInvoiceSubscriptionId(invoice, event);
        webhookEvent.customerId = invoice.customer as string;
        webhookEvent.status = 'past_due';
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        webhookEvent.subscriptionId = subscription.id;
        webhookEvent.customerId = subscription.customer as string;
        webhookEvent.status = this.mapStripeStatus(subscription.status);

        const period = this.extractBillingPeriod(subscription);
        if (period) {
          webhookEvent.currentPeriodStart = period.start;
          webhookEvent.currentPeriodEnd = period.end;
        }
        else {
          logger.warn({
            eventId: event.id,
            eventType: event.type,
            subscriptionId: subscription.id,
            itemCount: subscription.items?.data?.length ?? 0,
          }, 'Stripe subscription webhook has no resolvable billing period');
        }
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
   * Resolve the subscription that generated an invoice
   *
   * Stripe moved this link from the top-level `subscription` field to
   * `parent.subscription_details.subscription` in the Basil API. Webhook
   * payloads are serialized with the API version configured on the endpoint,
   * which the instance administrator sets independently of this adapter's
   * pin, so the legacy field is still honoured as a fallback.
   *
   * The resolved id is used downstream as a lookup and authorization key for
   * the local funding plan, so it is returned only after being confirmed to
   * be a non-empty string.
   *
   * @param invoice - Invoice object from a webhook payload
   * @param event - Enclosing event, used for diagnostic markers only
   * @returns Subscription ID, or undefined for an invoice with no subscription
   * @private
   */
  private extractInvoiceSubscriptionId(invoice: Stripe.Invoice, event: Stripe.Event): string | undefined {
    const parentReference = invoice.parent?.subscription_details?.subscription;
    const legacyReference = (invoice as unknown as {
      subscription?: string | Stripe.Subscription;
    }).subscription;

    // The parent shape wins whenever it is present, so resolution stays
    // deterministic for payloads that carry both.
    const reference = parentReference ?? legacyReference;

    if (reference === undefined || reference === null) {
      if (invoice.parent?.type === 'subscription_details') {
        // The parent claims a subscription but carries no reference: drift.
        logger.warn({
          eventId: event.id,
          eventType: event.type,
        }, 'Stripe invoice parent claims a subscription but carries no reference');
      }
      else {
        // No parent, or a parent of some other kind: an ordinary one-off or
        // quote invoice, not a signal worth raising.
        logger.debug({
          eventId: event.id,
          eventType: event.type,
          parentType: invoice.parent?.type,
        }, 'Stripe invoice webhook has no subscription parent');
      }
      return undefined;
    }

    const subscriptionId = this.resolveSubscriptionReference(reference, {
      eventId: event.id,
      eventType: event.type,
    });

    if (subscriptionId === undefined) {
      return undefined;
    }

    if (parentReference === undefined || parentReference === null) {
      logger.debug({
        eventId: event.id,
        eventType: event.type,
        subscriptionId,
      }, 'Stripe invoice webhook used the legacy top-level subscription field');
    }

    return subscriptionId;
  }

  /**
   * Resolve a Stripe subscription reference to a usable id
   *
   * Stripe types these fields `string | Stripe.Subscription | null`, so a
   * reference may arrive as a bare id or as an expanded subscription object.
   * The resolved id is used downstream as a lookup and authorization key for
   * the local funding plan, so it is returned only after being confirmed to
   * be a non-empty string.
   *
   * @param reference - Subscription reference from a Stripe payload
   * @param logContext - Diagnostic markers identifying the calling context
   * @returns Subscription ID, or undefined when no usable id can be resolved
   * @private
   */
  private resolveSubscriptionReference(
    reference: string | Stripe.Subscription | null | undefined,
    logContext: Record<string, unknown>,
  ): string | undefined {
    if (reference === undefined || reference === null) {
      return undefined;
    }

    const subscriptionId = typeof reference === 'string'
      ? reference
      : (reference as { id?: unknown }).id;

    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
      logger.warn({
        ...logContext,
        referenceType: typeof reference,
      }, 'Stripe subscription reference is not a usable id');
      return undefined;
    }

    return subscriptionId;
  }

  /**
   * Resolve the current billing period of a subscription
   *
   * Stripe moved `current_period_start` / `current_period_end` from the
   * subscription to its items in the Basil API. The legacy top-level fields
   * remain a fallback for webhook payloads serialized with an older API
   * version (see extractInvoiceSubscriptionId).
   *
   * Both bounds are taken from a single shape. Item-level and
   * subscription-level anchors are not guaranteed to describe the same
   * window, and the end bound drives access expiry, so a period spliced from
   * two shapes could grant entitlement beyond what was paid for.
   *
   * @param subscription - Stripe subscription object
   * @returns Billing period, or null when neither shape carries a whole one
   * @private
   */
  private extractBillingPeriod(subscription: Stripe.Subscription): BillingPeriod | null {
    const item = subscription.items?.data?.[0];
    const legacy = subscription as unknown as {
      current_period_start?: number;
      current_period_end?: number;
    };

    return this.toBillingPeriod(item?.current_period_start, item?.current_period_end)
      ?? this.toBillingPeriod(legacy.current_period_start, legacy.current_period_end);
  }

  /**
   * Build a billing period from a pair of Stripe epoch-second timestamps
   *
   * Rejects anything that is not a finite number, so a malformed bound
   * becomes an absent period rather than an invalid Date.
   *
   * @param start - Period start in epoch seconds
   * @param end - Period end in epoch seconds
   * @returns Billing period, or null if either bound is unusable
   * @private
   */
  private toBillingPeriod(start: number | undefined, end: number | undefined): BillingPeriod | null {
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }

    return {
      start: new Date((start as number) * 1000),
      end: new Date((end as number) * 1000),
    };
  }

  /**
   * Create a checkout session for Stripe embedded checkout
   *
   * Uses ui_mode: 'embedded' and mode: 'subscription'. For fixed pricing,
   * uses the provided priceId directly. For PWYC pricing, creates a price
   * on the fly using the provided amount.
   *
   * @param params - Checkout session parameters
   * @param options - Per-request options (idempotency key)
   * @returns Client secret and session ID
   */
  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
    options?: ProviderRequestOptions,
  ): Promise<CheckoutSessionResult> {
    // Determine the price to use
    let priceId = params.priceId;

    if (!priceId && params.amount) {
      // PWYC: create a price on the fly
      priceId = await this.createPrice(params.amount, params.currency, params.interval, options);
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
    }, this.requestOptions(options, 'checkout-session'));

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
      subscriptionId: this.resolveSubscriptionReference(session.subscription, { sessionId }),
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
   * @param options - Per-request options (idempotency key)
   * @returns Stripe Price ID
   */
  async createPrice(
    amount: number,
    currency: string,
    interval: 'month' | 'year',
    options?: ProviderRequestOptions,
  ): Promise<string> {
    const price = await this.stripe.prices.create({
      unit_amount: Math.round(amount / 1000), // Convert millicents to cents
      currency: currency.toLowerCase(),
      recurring: {
        interval,
      },
      product_data: {
        name: 'Pavillion Subscription',
      },
    }, this.requestOptions(options, 'price'));

    return price.id;
  }

  /**
   * Convert Stripe subscription to ProviderSubscription format
   *
   * @param subscription - Stripe subscription object
   * @returns Standardized subscription data
   * @throws Error if the subscription carries no billing period
   * @private
   */
  private convertStripeSubscription(subscription: Stripe.Subscription): ProviderSubscription {
    // Get amount from first subscription item
    const amount = subscription.items.data[0]?.price?.unit_amount || 0;

    const period = this.extractBillingPeriod(subscription);
    if (!period) {
      // A period is required by ProviderSubscription; persisting an invalid
      // date would silently corrupt the local funding plan instead.
      throw new Error(`Stripe subscription ${subscription.id} has no billing period`);
    }

    return {
      providerSubscriptionId: subscription.id,
      providerCustomerId: subscription.customer as string,
      status: this.mapStripeStatus(subscription.status),
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
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
