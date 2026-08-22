import { PrimaryModel } from '@/common/model/model';

/**
 * Funding plan status enum
 */
export type FundingPlanStatus = 'active' | 'past_due' | 'suspended' | 'cancelled';

/**
 * Billing cycle enum
 */
export type BillingCycle = 'monthly' | 'yearly';

/**
 * Payment provider type enum
 */
export type ProviderType = 'stripe' | 'paypal';

/**
 * The payment providers this release offers in the UI.
 *
 * DEC-007 descopes PayPal for v1: its scaffolding stays in the tree, inert,
 * and checkout resolves Stripe only. This constant is the funding domain's
 * single answer to "which providers may be shown" — both the admin provider
 * list (src/client/components/admin/funding.vue) and the purchase form
 * (src/client/components/account/FundingForm.vue) filter against it.
 *
 * The server-side checkout gate is separate and deliberately not derived from
 * this constant: resolveEnabledStripeProvider() in
 * src/server/funding/service/funding.ts hard-codes Stripe whatever the UI
 * offers. Re-enabling a provider means adding it here AND revisiting that
 * resolver together — see DEC-007
 * (agent-os/product/decisions/dec-007-community-funding-model.md).
 */
export const SUPPORTED_PROVIDER_TYPES: readonly ProviderType[] = ['stripe'];

/**
 * How a single calendar is currently covered.
 *
 * This is the one vocabulary for a single calendar's coverage, shared verbatim
 * by the service, the calendar funding endpoint and the frontend. snake_case,
 * string-literal union, no TS runtime enum: the values travel over the wire, so
 * a runtime enum would only add a second spelling to keep in sync.
 *
 * The values say `covered`, never `funded`, because the money flows owner →
 * instance (DEC-007): a calendar is covered by a funding plan, and it is the
 * instance that is funded. "This calendar is funded" inverts the model, so it
 * is not a value this union can express.
 *
 * It describes a *relationship*, not an entitlement. `not_covered` means "this
 * calendar has no grant and no paying allocation", which is not the same
 * question as "may this calendar use feature X" — that is
 * FundingService.checkFundingAccess, and the two deliberately disagree in two
 * cases documented at getFundingStatusForCalendar. Read the feature flags on
 * the funding endpoint's response, never this value, to decide what a calendar
 * may do.
 *
 * The bulk admin-dashboard vocabulary ('subscribed' | 'grant' | 'none' from
 * getPlanStatusForCalendars) is a separate, un-migrated vocabulary. Do not map
 * one onto the other casually — they are computed by different queries.
 */
export type FundingStatus = 'admin_exempt' | 'grant' | 'covered' | 'not_covered';

/**
 * The features whose availability depends on funding access.
 *
 * This registry is the implementation surface of the DEC-011 federated value
 * boundary: in-network features are free, and features that bridge to
 * non-federated systems — inbound or outbound — are funding-gated. Every entry
 * records which side of that boundary its feature sits on and why. A feature
 * that cannot state a boundary rationale does not belong here.
 *
 * Ownership (DEC-003): the funding domain owns both the decision to gate a
 * feature and the vocabulary of keys used to name one. Feature domains declare
 * nothing, hold no plan state, and read none — they pass a key from this
 * registry to FundingInterface and act on the answer. Gating a new feature is
 * therefore an entry here plus a call, never funding logic grown inside the
 * feature's own domain.
 */
export const FUNDING_GATED_FEATURES = {
  // Scope (DEC-004): this gates the embedding surface only — the widget data
  // endpoint and the widget-domain configuration. A calendar's own public
  // /view/ pages stay anonymously readable whatever its funding state. The
  // widget is the one gate that legitimately faces an anonymous caller,
  // because embedding into a non-federated site is an outbound bridge; the
  // public read of the calendar itself never is.
  widget_embedding: {
    boundaryRationale:
      'Outside the network. A widget publishes calendar content into non-federated '
      + 'web properties, which is an outbound platform bridge rather than participation '
      + 'in the federated network. Following, reposting, and curating between Pavillion '
      + 'and other ActivityPub event platforms stay free because they are in-network.',
  },
} as const;

/**
 * Key identifying a funding-gated feature.
 *
 * Derived from the registry so the union cannot drift from the entries that
 * carry the boundary rationales.
 */
export type FundingGatedFeature = keyof typeof FUNDING_GATED_FEATURES;

/**
 * Everything a calendar's owner may be told about how that calendar is covered.
 *
 * This type is the field allowlist for GET /v1/calendars/:calendarId/funding,
 * expressed once so the service, the route and the frontend cannot drift. It
 * exists because the alternative — serialising a FundingPlan — leaks:
 * FundingPlan.toObject() carries accountId, and the entity behind it carries
 * the Stripe customer and subscription ids. None of those answer any question
 * the calendar settings screen asks, so none of them appear here.
 *
 * `status` and `features` answer different questions and may disagree; see the
 * divergence note on FundingService.getFundingStatusForCalendar. `features` is
 * the authoritative answer to "may this calendar do X".
 */
export type CalendarFundingSummary = {
  /** How this calendar is covered. Display vocabulary, not an entitlement. */
  status: FundingStatus;
  /** End of the paid-through period of the plan covering this calendar, if any. */
  currentPeriodEnd: Date | null;
  /** When the funding plan stops granting access, if it sets any boundary. */
  accessExpiresAt: Date | null;
  /** Per-feature gate decisions, keyed by FUNDING_GATED_FEATURES. */
  features: Record<FundingGatedFeature, boolean>;
};

/**
 * Instance-wide funding settings
 */
export class FundingSettings extends PrimaryModel {
  enabled: boolean = false;
  monthlyPrice: number = 0; // in millicents
  yearlyPrice: number = 0; // in millicents
  currency: string = 'USD';
  payWhatYouCan: boolean = false;
  payWhatYouCanYearlyDiscount: number = 0;
  gracePeriodDays: number = 7;

  constructor(id?: string) {
    super(id);
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      enabled: this.enabled,
      monthlyPrice: this.monthlyPrice,
      yearlyPrice: this.yearlyPrice,
      currency: this.currency,
      payWhatYouCan: this.payWhatYouCan,
      payWhatYouCanYearlyDiscount: this.payWhatYouCanYearlyDiscount,
      gracePeriodDays: this.gracePeriodDays,
    };
  }

  static fromObject(obj: Record<string, any>): FundingSettings {
    const settings = new FundingSettings(obj.id);
    settings.enabled = obj.enabled ?? false;
    settings.monthlyPrice = obj.monthlyPrice ?? 0;
    settings.yearlyPrice = obj.yearlyPrice ?? 0;
    settings.currency = obj.currency ?? 'USD';
    settings.payWhatYouCan = obj.payWhatYouCan ?? false;
    settings.payWhatYouCanYearlyDiscount = obj.payWhatYouCanYearlyDiscount ?? 0;
    settings.gracePeriodDays = obj.gracePeriodDays ?? 7;
    return settings;
  }

  clone(): FundingSettings {
    return FundingSettings.fromObject(this.toObject());
  }
}

/**
 * Payment provider configuration
 */
export class ProviderConfig extends PrimaryModel {
  providerType: ProviderType = 'stripe';
  enabled: boolean = false;
  displayName: string = '';

  constructor(id?: string, providerType?: ProviderType) {
    super(id);
    if (providerType) {
      this.providerType = providerType;
    }
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      providerType: this.providerType,
      enabled: this.enabled,
      displayName: this.displayName,
    };
  }

  static fromObject(obj: Record<string, any>): ProviderConfig {
    const config = new ProviderConfig(obj.id, obj.providerType);
    config.enabled = obj.enabled ?? false;
    config.displayName = obj.displayName ?? '';
    return config;
  }

  clone(): ProviderConfig {
    return ProviderConfig.fromObject(this.toObject());
  }
}

/**
 * User funding plan
 */
export class FundingPlan extends PrimaryModel {
  accountId: string = '';
  providerConfigId: string = '';
  providerSubscriptionId: string = '';
  providerCustomerId: string = '';
  status: FundingPlanStatus = 'active';
  billingCycle: BillingCycle = 'monthly';
  amount: number = 0; // in millicents
  currency: string = 'USD';
  currentPeriodStart: Date | null = null;
  currentPeriodEnd: Date | null = null;
  cancelledAt: Date | null = null;
  suspendedAt: Date | null = null;
  accountEmail?: string; // display-only, populated by admin listings

  constructor(id?: string) {
    super(id);
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      accountId: this.accountId,
      accountEmail: this.accountEmail,
      status: this.status,
      billingCycle: this.billingCycle,
      amount: this.amount,
      currency: this.currency,
      currentPeriodStart: this.currentPeriodStart,
      currentPeriodEnd: this.currentPeriodEnd,
      cancelledAt: this.cancelledAt,
      suspendedAt: this.suspendedAt,
    };
  }

  static fromObject(obj: Record<string, any>): FundingPlan {
    const plan = new FundingPlan(obj.id);
    plan.accountId = obj.accountId ?? '';
    plan.providerConfigId = obj.providerConfigId ?? '';
    plan.providerSubscriptionId = obj.providerSubscriptionId ?? '';
    plan.providerCustomerId = obj.providerCustomerId ?? '';
    plan.accountEmail = obj.accountEmail ?? undefined;
    plan.status = obj.status ?? 'active';
    plan.billingCycle = obj.billingCycle ?? 'monthly';
    plan.amount = obj.amount ?? 0;
    plan.currency = obj.currency ?? 'USD';
    plan.currentPeriodStart = obj.currentPeriodStart ? new Date(obj.currentPeriodStart) : null;
    plan.currentPeriodEnd = obj.currentPeriodEnd ? new Date(obj.currentPeriodEnd) : null;
    plan.cancelledAt = obj.cancelledAt ? new Date(obj.cancelledAt) : null;
    plan.suspendedAt = obj.suspendedAt ? new Date(obj.suspendedAt) : null;
    return plan;
  }

  clone(): FundingPlan {
    return FundingPlan.fromObject(this.toObject());
  }
}

/**
 * Funding event audit log
 */
export class FundingEvent extends PrimaryModel {
  fundingPlanId: string = '';
  eventType: string = '';
  providerEventId: string = '';
  payload: string = '{}'; // JSON string
  processedAt: Date | null = null;

  constructor(id?: string) {
    super(id);
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      fundingPlanId: this.fundingPlanId,
      eventType: this.eventType,
      providerEventId: this.providerEventId,
      payload: this.payload,
      processedAt: this.processedAt,
    };
  }

  static fromObject(obj: Record<string, any>): FundingEvent {
    const event = new FundingEvent(obj.id);
    event.fundingPlanId = obj.fundingPlanId ?? '';
    event.eventType = obj.eventType ?? '';
    event.providerEventId = obj.providerEventId ?? '';
    event.payload = obj.payload ?? '{}';
    event.processedAt = obj.processedAt ? new Date(obj.processedAt) : null;
    return event;
  }

  clone(): FundingEvent {
    return FundingEvent.fromObject(this.toObject());
  }
}

/**
 * Convert millicents to display amount (for 2-decimal currencies)
 *
 * @param millicents - Amount in millicents
 * @returns Formatted string with 2 decimal places
 */
export function millicentsToDisplay(millicents: number): string {
  return (millicents / 100000).toFixed(2);
}

/**
 * Convert display amount to millicents (for 2-decimal currencies)
 *
 * @param amount - Amount as string or number
 * @returns Amount in millicents
 */
export function displayToMillicents(amount: string | number): number {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return Math.round(numAmount * 100000);
}
