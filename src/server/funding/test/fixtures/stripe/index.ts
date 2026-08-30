import checkoutSessionCompleted from './checkout-session-completed.json';
import customerSubscriptionDeleted from './customer-subscription-deleted.json';
import customerSubscriptionUpdated from './customer-subscription-updated.json';
import invoicePaid from './invoice-paid.json';
import invoicePaymentFailed from './invoice-payment-failed.json';
import invoicePaymentSucceeded from './invoice-payment-succeeded.json';

/**
 * Real Stripe webhook payloads, captured in test mode
 *
 * Every JSON file beside this one is a complete, unedited event envelope that
 * Stripe actually delivered to a Pavillion sandbox endpoint on 2026-08-29,
 * serialized at api_version 2026-02-25.clover — the version StripeAdapter pins.
 * Hand-written fixtures defeat the purpose of these files: they encode whatever
 * shape the author believed Stripe uses, which is exactly the belief that
 * drifted and broke subscription resolution before pv-jdot.2.1. Do not
 * "correct" a captured payload to match an expectation; capture a new one.
 *
 * Provenance, and what each fixture can therefore prove:
 *
 * - checkout.session.completed — a real embedded-checkout purchase through the
 *   calendar-management upsell. The only fixture carrying live
 *   metadata.pavillion_account_id and metadata.pavillion_calendar_ids, and the
 *   only one that cannot be synthesized from another Stripe surface.
 * - invoice.paid / invoice.payment_succeeded — the first invoice of that same
 *   checkout.
 * - invoice.payment_failed — from an API-built subscription rather than from
 *   Checkout, because embedded Checkout validates the card before it creates a
 *   subscription: a declining card there produces no subscription and no
 *   invoice at all. Invoice events carry no Pavillion metadata whatsoever, so
 *   nothing the parser reads can distinguish the two origins.
 * - customer.subscription.updated — a cancel-at-period-end. It carries
 *   status "active" together with cancel_at_period_end true, which is what a
 *   period-end cancellation genuinely looks like on the wire, and is the
 *   payload that reproduces pv-jdot.3.1. It is not a mis-capture; do not edit
 *   it to status "canceled".
 * - customer.subscription.deleted — an immediate cancel of that subscription,
 *   status "canceled".
 *
 * Two shapes these captures pin, both confirmed present on every relevant file:
 *
 * - data.object.parent.subscription_details.subscription is set on all three
 *   invoice events, and the pre-Basil top-level data.object.subscription is
 *   null on all three. The legacy field is genuinely absent at this API
 *   version, so extractInvoiceSubscriptionId's legacy fallback cannot be
 *   exercised by a capture — the tests that cover it are hand-built by
 *   necessity, and say so.
 * - items.data[0].current_period_start / _end are set on both subscription
 *   events, and the legacy top-level period fields are absent.
 *
 * metadata.pavillion_calendar_ids is a JSON-encoded *string*, not an array;
 * Stripe metadata values are always strings. Assertions written against it must
 * keep that distinction.
 *
 * REDACTION RULE — apply to every capture before it is committed. This
 * repository is public, so a fixture is a publication, and two separate classes
 * of value have to come out:
 *
 * 1. Direct PII: customer_details.email / .name, customer_email,
 *    customer_name, and every address component. These captures were made with
 *    a synthetic email and name (funding+capture@example.com / "Capture Test"),
 *    but Checkout requires a postal code and retains whatever is typed, so a
 *    real one survived and was replaced with "00000".
 *
 * 2. Capability URLs and secrets: hosted_invoice_url, invoice_pdf,
 *    receipt_url, client_secret, and any other value that is itself an
 *    authorization. Stripe's invoice links are unauthenticated by design — the
 *    token in the path IS the credential, because the link is meant to be
 *    emailed to a customer — so a committed one grants anyone who reads the
 *    repo access to Stripe's own copy of the invoice, which still shows the
 *    un-redacted values that class 1 scrubbed here. The three invoice fixtures
 *    carried a live pair each; both fields are now fixed placeholders on the
 *    reserved .invalid TLD, which can never resolve.
 *
 * Class 2 is the reason the redaction rule is stated as two classes rather than
 * one regex: a name-based PII sweep matches on key names like "email" or
 * "postal" and cannot see that "invoice_pdf" is sensitive. Sweep for both after
 * any re-capture — the first command lists PII-shaped fields, the second lists
 * every URL and secret-shaped field for eyeball review:
 *
 *   jq -r '[paths(scalars) as $p
 *     | select($p[-1] | tostring
 *         | test("email|name|address|phone|line1|postal|last4"; "i"))
 *     | "\(($p|join("."))) = \(getpath($p))"] | .[]' "$F"
 *
 *   jq -r '[paths(scalars) as $p
 *     | select((getpath($p)|tostring|test("^https?://"))
 *         or ($p[-1]|tostring|test("url|pdf|secret|token"; "i")))
 *     | "\(($p|join("."))) = \(getpath($p))"] | .[]' "$F"
 *
 * redaction.test.ts enforces the mechanical half of this in PR CI — there are
 * no git hooks here, so it blocks a merge, not the local commit that then has
 * to be amended. The sweeps above are for the judgement half a pattern cannot
 * make.
 */

/**
 * Stripe event envelope, typed only as far as these helpers reach into it
 */
export interface CapturedStripeEvent {
  id: string;
  type: string;
  api_version: string;
  data: { object: Record<string, unknown> };
}

/**
 * Event types Pavillion's Stripe adapter parses, one capture each
 */
export type CapturedStripeEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.deleted'
  | 'customer.subscription.updated'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.payment_succeeded';

/**
 * Where a given event shape carries its subscription reference
 *
 * Stripe puts it in a different place per resource, and the whole point of
 * these fixtures is that tests never hardcode the wrong one.
 */
type SubscriptionLocation = 'session' | 'invoice-parent' | 'subscription-object';

interface CapturedEventDescriptor {
  event: CapturedStripeEvent;
  subscriptionAt: SubscriptionLocation;
  carriesPavillionMetadata: boolean;
}

const CAPTURED_EVENTS: Record<CapturedStripeEventType, CapturedEventDescriptor> = {
  'checkout.session.completed': {
    event: checkoutSessionCompleted as unknown as CapturedStripeEvent,
    subscriptionAt: 'session',
    carriesPavillionMetadata: true,
  },
  'customer.subscription.deleted': {
    event: customerSubscriptionDeleted as unknown as CapturedStripeEvent,
    subscriptionAt: 'subscription-object',
    carriesPavillionMetadata: false,
  },
  'customer.subscription.updated': {
    event: customerSubscriptionUpdated as unknown as CapturedStripeEvent,
    subscriptionAt: 'subscription-object',
    carriesPavillionMetadata: false,
  },
  'invoice.paid': {
    event: invoicePaid as unknown as CapturedStripeEvent,
    subscriptionAt: 'invoice-parent',
    carriesPavillionMetadata: false,
  },
  'invoice.payment_failed': {
    event: invoicePaymentFailed as unknown as CapturedStripeEvent,
    subscriptionAt: 'invoice-parent',
    carriesPavillionMetadata: false,
  },
  'invoice.payment_succeeded': {
    event: invoicePaymentSucceeded as unknown as CapturedStripeEvent,
    subscriptionAt: 'invoice-parent',
    carriesPavillionMetadata: false,
  },
};

/**
 * Identity fields a test may rebind on a captured payload
 *
 * Stripe's own identifiers are meaningless to a test that has to line a webhook
 * up with a locally-seeded funding plan, so these five may be swapped. Anything
 * else — field placement, absent fields, unexpected combinations — is the shape
 * under test and must be left as captured.
 */
export interface CapturedStripeEventOverrides {
  eventId?: string;
  subscriptionId?: string;
  customerId?: string;
  accountId?: string;
  calendarIds?: string[];
}

/**
 * Load a captured Stripe event as a mutable deep copy
 *
 * Tests that need a shape the captures do not contain (metadata removed, a
 * field blanked) mutate the returned object directly; the fixture on disk is
 * never touched.
 *
 * @param type - Event type to load
 * @param overrides - Identity fields to rebind
 * @returns Deep copy of the captured event envelope
 */
export function capturedStripeEvent(
  type: CapturedStripeEventType,
  overrides: CapturedStripeEventOverrides = {},
): CapturedStripeEvent {
  const descriptor = CAPTURED_EVENTS[type];
  const event = structuredClone(descriptor.event);
  const object = event.data.object;

  if (overrides.eventId !== undefined) {
    event.id = overrides.eventId;
  }

  if (overrides.customerId !== undefined) {
    object.customer = overrides.customerId;
  }

  if (overrides.subscriptionId !== undefined) {
    switch (descriptor.subscriptionAt) {
      case 'session':
        object.subscription = overrides.subscriptionId;
        break;
      case 'invoice-parent': {
        const parent = object.parent as { subscription_details: { subscription: string } };
        parent.subscription_details.subscription = overrides.subscriptionId;
        break;
      }
      case 'subscription-object':
        object.id = overrides.subscriptionId;
        break;
    }
  }

  if (overrides.accountId !== undefined || overrides.calendarIds !== undefined) {
    if (!descriptor.carriesPavillionMetadata) {
      throw new Error(`Captured ${type} payloads carry no Pavillion metadata; overriding it would test a shape Stripe never sends`);
    }

    const metadata = object.metadata as Record<string, string>;
    if (overrides.accountId !== undefined) {
      metadata.pavillion_account_id = overrides.accountId;
    }
    if (overrides.calendarIds !== undefined) {
      // Stripe metadata values are strings; the adapter writes this key as
      // JSON, so a fixture must too.
      metadata.pavillion_calendar_ids = JSON.stringify(overrides.calendarIds);
    }
  }

  return event;
}

/**
 * Load a captured Stripe event as the raw JSON body a webhook request carries
 *
 * @param type - Event type to load
 * @param overrides - Identity fields to rebind
 * @returns Serialized event envelope
 */
export function capturedStripeEventPayload(
  type: CapturedStripeEventType,
  overrides: CapturedStripeEventOverrides = {},
): string {
  return JSON.stringify(capturedStripeEvent(type, overrides));
}
