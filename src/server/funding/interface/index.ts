import { EventEmitter } from 'events';
import FundingService from '@/server/funding/service/funding';
import {
  ProviderConnectionService,
  type AdminUser,
  type StripeCredentialInputs,
  type StripeConfigureResult,
  type ProviderStatus,
  type DisconnectionResult,
} from '@/server/funding/service/provider_connection';
import { FundingPlan, FundingSettings, ProviderConfig, FundingStatus, CalendarFundingSummary, BillingCycle, ProviderType, FundingGatedFeature } from '@/common/model/funding-plan';
import type { ProviderInfo } from '@/server/funding/service/funding';
import type { ProviderCredentials } from '@/server/funding/service/provider/adapter';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { CheckoutSessionResult } from '@/server/funding/service/provider/adapter';
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';

/**
 * Funding domain interface for cross-domain communication
 *
 * Exposes funding operations to other domains and internal API handlers.
 * Following the pattern from CalendarInterface and AccountsInterface.
 */
export default class FundingInterface {
  private fundingService: FundingService;
  private providerConnectionService: ProviderConnectionService;

  constructor(eventBus: EventEmitter) {
    this.fundingService = new FundingService(eventBus);
    this.providerConnectionService = new ProviderConnectionService(eventBus);
  }

  /**
   * Injects CalendarInterface into the funding service for cross-domain
   * calendar ownership and existence checks. Called after CalendarDomain is
   * initialized to avoid circular construction dependencies.
   *
   * @param calendarInterface - The CalendarInterface instance from the calendar domain
   */
  setCalendarInterface(calendarInterface: CalendarInterface): void {
    this.fundingService.setCalendarInterface(calendarInterface);
  }

  /**
   * Injects AccountsInterface into the funding service for cross-domain
   * account role checks (admin exemption from funding gates).
   *
   * @param accountsInterface - The AccountsInterface instance from the accounts domain
   */
  setAccountsInterface(accountsInterface: AccountsInterface): void {
    this.fundingService.setAccountsInterface(accountsInterface);
  }

  // Cross-domain query methods

  /**
   * Decide whether a calendar may use a funding-gated feature.
   *
   * The single entry point for funding gates: feature domains pass a key from
   * FUNDING_GATED_FEATURES and act on the answer, holding no funding state of
   * their own. See FundingService.checkFundingAccess for the four invariants
   * that produce the decision.
   *
   * This answers a funding question and nothing else. It is NOT an
   * authorization check: when funding is not enabled on the instance it
   * returns true for any well-formed UUID, including calendars that do not
   * exist and calendars the caller has no business touching. Compose it only
   * AFTER authentication, ownership and existence checks have run.
   *
   * Three outcomes, not two: `true` opens the gate, `false` is a determinate
   * "this calendar is unfunded" that may be answered commercially, and a
   * thrown {@link FundingAccessIndeterminateError} is a denial caused by an
   * unreadable instance funding state — a server-side failure that must
   * surface as a server error, never as 402 / SubscriptionRequiredError.
   *
   * Consumers get that mapping for free by doing the obvious thing: throw
   * {@link SubscriptionRequiredError} on a determinate `false` and let the
   * indeterminate throw propagate. The handler's existing error serialization
   * then answers the first with 402 and the second with 500, so the split is
   * preserved by the repo's normal error convention rather than by a bespoke
   * gate. Do not catch the indeterminate throw in order to answer it
   * commercially.
   *
   * @param calendarId - Calendar the feature would be used on
   * @param feature - Key from FUNDING_GATED_FEATURES naming the gated feature
   * @returns True if the gate is open for this calendar, false if this
   *   calendar is determinately unfunded
   * @throws FundingAccessIndeterminateError if the instance funding settings
   *   could not be read
   */
  async checkFundingAccess(calendarId: string, feature: FundingGatedFeature): Promise<boolean> {
    return this.fundingService.checkFundingAccess(calendarId, feature);
  }

  /**
   * Get the funding-plan status for a set of calendars in bulk.
   *
   * Returns enum values only — no funding entities cross the domain boundary.
   * Calendars with no matching record are omitted from the returned Map so
   * callers can default to 'none' on lookup miss.
   *
   * @param ids - Calendar IDs to look up
   * @returns Map of calendar_id -> 'subscribed' | 'grant' | 'none'; unknown
   *          IDs are absent from the map
   */
  async getPlanStatusForCalendars(
    ids: string[],
  ): Promise<Map<string, 'subscribed' | 'grant' | 'none'>> {
    return this.fundingService.getPlanStatusForCalendars(ids);
  }

  // Settings management

  async getSettings(): Promise<FundingSettings> {
    return this.fundingService.getSettings();
  }

  async updateSettings(settings: FundingSettings): Promise<void> {
    return this.fundingService.updateSettings(settings);
  }

  // Provider management

  async getProviders(): Promise<ProviderConfig[]> {
    return this.fundingService.getProviders();
  }

  async updateProvider(providerType: ProviderType, displayName: string | undefined, enabled: boolean): Promise<boolean> {
    return this.fundingService.updateProvider(providerType, displayName, enabled);
  }

  async disconnectProvider(providerType: ProviderType): Promise<boolean> {
    return this.fundingService.disconnectProvider(providerType);
  }

  // Provider connection (credential) management

  /**
   * Get the connection status for a payment provider
   *
   * @param providerType - Provider to inspect ('stripe' or 'paypal')
   * @returns Whether the provider has credentials configured, plus metadata
   */
  async getProviderStatus(providerType: ProviderType): Promise<ProviderStatus> {
    return this.providerConnectionService.getProviderStatus(providerType);
  }

  /**
   * Configure Stripe credentials via direct API key entry
   *
   * @param credentials - Stripe credentials (publishable_key, secret_key, webhook_secret)
   * @param adminUser - Admin user performing the configuration
   * @returns Object with connectionVerified indicating if the Stripe API call succeeded
   */
  async configureStripe(credentials: StripeCredentialInputs, adminUser: AdminUser): Promise<StripeConfigureResult> {
    return this.providerConnectionService.configureStripe(credentials, adminUser);
  }

  /**
   * Configure PayPal credentials manually
   *
   * @param credentials - PayPal credentials (client_id, client_secret, environment)
   * @param adminUser - Admin user performing the configuration
   * @returns True if configuration succeeded
   */
  async configurePayPal(credentials: ProviderCredentials, adminUser: AdminUser): Promise<boolean> {
    return this.providerConnectionService.configurePayPal(credentials, adminUser);
  }

  /**
   * Disconnect a payment provider's connection (credentials)
   *
   * Named distinctly from {@link disconnectProvider} because this routes to the
   * provider-connection lifecycle, which supports the confirmation flow and
   * returns a {@link DisconnectionResult}.
   *
   * @param providerType - Provider to disconnect ('stripe' or 'paypal')
   * @param confirmed - Whether the admin has confirmed disconnection of active plans
   * @returns Disconnection result, including a confirmation requirement when needed
   */
  async disconnectProviderConnection(providerType: ProviderType, confirmed: boolean = false): Promise<DisconnectionResult> {
    return this.providerConnectionService.disconnectProvider(providerType, confirmed);
  }

  // User funding plan operations

  async getOptions(): Promise<{
    enabled: boolean;
    providers: ProviderInfo[];
    monthlyPrice: number;
    yearlyPrice: number;
    currency: string;
    payWhatYouCan: boolean;
    payWhatYouCanYearlyDiscount: number;
  }> {
    return this.fundingService.getOptions();
  }

  async getStatus(accountId: string): Promise<FundingPlan | undefined> {
    return this.fundingService.getStatus(accountId);
  }

  async cancel(fundingPlanId: string, immediate: boolean): Promise<void> {
    return this.fundingService.cancel(fundingPlanId, immediate);
  }

  async getBillingPortalUrl(accountId: string, returnUrl: string): Promise<string> {
    return this.fundingService.getBillingPortalUrl(accountId, returnUrl);
  }

  // Checkout session operations

  /**
   * Create a Stripe checkout session for embedded checkout
   *
   * @param accountId - Authenticated account ID
   * @param billingCycle - 'monthly' or 'yearly'
   * @param returnUrl - URL to return to after checkout
   * @param amount - Optional amount in millicents (for PWYC pricing)
   * @param calendarIds - Optional array of calendar IDs the plan should cover
   * @returns Client secret and session ID for the embedded checkout
   */
  async createCheckoutSession(
    accountId: string,
    billingCycle: BillingCycle,
    returnUrl: string,
    amount?: number,
    calendarIds?: string[],
    colorMode?: 'light' | 'dark',
  ): Promise<CheckoutSessionResult> {
    return this.fundingService.createCheckoutSession(accountId, billingCycle, returnUrl, amount, calendarIds, colorMode);
  }

  /**
   * Get the status of a checkout session
   *
   * Validates sessionId format and performs IDOR protection.
   *
   * @param accountId - Authenticated account ID
   * @param sessionId - The checkout session ID to check
   * @returns Status of the checkout session
   */
  async getCheckoutSessionStatus(
    accountId: string,
    sessionId: string,
  ): Promise<{ status: string }> {
    return this.fundingService.getCheckoutSessionStatus(accountId, sessionId);
  }

  // Calendar funding plan operations

  /**
   * Get all calendars in the account's active funding plan
   *
   * @param accountId - Account ID to look up
   * @returns Array of funded calendar allocations (calendarId, amount, createdAt)
   */
  async getCalendarsInFundingPlan(
    accountId: string,
  ): Promise<{ calendarId: string; amount: number; createdAt: Date }[]> {
    return this.fundingService.getCalendarsInFundingPlan(accountId);
  }

  /**
   * Add a calendar to the account's active funding plan
   *
   * @param accountId - Account ID (funding plan resolved internally)
   * @param calendarId - Calendar ID to add
   * @param amount - Amount to allocate in millicents
   */
  async addCalendarToFundingPlan(accountId: string, calendarId: string, amount: number): Promise<void> {
    return this.fundingService.addCalendarToFundingPlan(accountId, calendarId, amount);
  }

  /**
   * Remove a calendar from the account's active funding plan
   *
   * @param accountId - Account ID (funding plan resolved internally)
   * @param calendarId - Calendar ID to remove
   */
  async removeCalendarFromFundingPlan(accountId: string, calendarId: string): Promise<void> {
    return this.fundingService.removeCalendarFromFundingPlan(accountId, calendarId);
  }

  /**
   * Get funding status for a calendar
   *
   * Verifies ownership internally and returns the funding status. This is the
   * calendar's funding *relationship*, not an entitlement — use
   * checkFundingAccess, or the feature flags on getCalendarFundingSummary, to
   * decide whether a feature may be used.
   *
   * @param accountId - Account ID requesting the status (must own the calendar)
   * @param calendarId - Calendar ID to check
   * @returns Funding status: 'admin_exempt' | 'grant' | 'funded' | 'unfunded'
   * @throws ValidationError if accountId does not own the calendar
   */
  async getFundingStatusForCalendar(accountId: string, calendarId: string): Promise<FundingStatus> {
    return this.fundingService.getFundingStatusForCalendar(accountId, calendarId);
  }

  /**
   * Get everything a calendar's owner may be told about its funding.
   *
   * Verifies ownership internally. Carries the display status, the funding
   * plan dates bounding it, and the gate's per-feature decisions — and
   * nothing that identifies an account or a Stripe object.
   *
   * @param accountId - Account ID requesting the summary (must own the calendar)
   * @param calendarId - Calendar ID to describe
   * @returns The calendar's funding status, plan dates and feature decisions
   * @throws ValidationError if accountId does not own the calendar
   */
  async getCalendarFundingSummary(accountId: string, calendarId: string): Promise<CalendarFundingSummary> {
    return this.fundingService.getCalendarFundingSummary(accountId, calendarId);
  }

  // Admin operations

  async listFundingPlans(page: number, limit: number): Promise<{
    fundingPlans: FundingPlan[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalCount: number;
      limit: number;
    };
  }> {
    return this.fundingService.listFundingPlans(page, limit);
  }

  async forceCancel(fundingPlanId: string): Promise<void> {
    return this.fundingService.forceCancel(fundingPlanId);
  }

  // Complimentary grant operations

  /**
   * Create a complimentary grant for a calendar
   *
   * @param calendarId - Calendar ID to grant access to
   * @param grantedBy - Account ID of the admin granting access
   * @param reason - Optional reason for the grant
   * @param expiresAt - Optional expiration date for the grant
   * @returns The created ComplimentaryGrant
   */
  async createGrant(calendarId: string, grantedBy: string, reason?: string, expiresAt?: Date): Promise<ComplimentaryGrant> {
    return this.fundingService.createGrant(calendarId, grantedBy, reason, expiresAt);
  }

  /**
   * Revoke a complimentary grant
   *
   * @param grantId - ID of the grant to revoke
   * @param revokedBy - Account ID of the admin revoking the grant
   */
  async revokeGrant(grantId: string, revokedBy: string): Promise<void> {
    return this.fundingService.revokeGrant(grantId, revokedBy);
  }

  /**
   * List all complimentary grants
   *
   * @param includeRevoked - Whether to include revoked grants in the list
   * @returns Array of ComplimentaryGrant objects
   */
  async listGrants(includeRevoked?: boolean): Promise<ComplimentaryGrant[]> {
    return this.fundingService.listGrants(includeRevoked);
  }

  /**
   * Check if a calendar has an active complimentary grant
   *
   * @param calendarId - Calendar ID to check
   * @returns True if calendar has an active grant, false otherwise
   */
  async hasActiveGrant(calendarId: string): Promise<boolean> {
    return this.fundingService.hasActiveGrant(calendarId);
  }

  /**
   * Get the complimentary grant for a specific calendar
   *
   * @param calendarId - Calendar ID to look up
   * @returns The ComplimentaryGrant if found, null otherwise
   */
  async getGrantForCalendar(calendarId: string): Promise<ComplimentaryGrant | null> {
    return this.fundingService.getGrantForCalendar(calendarId);
  }

  // Webhook processing

  async handleStripeWebhook(rawBody: string, signature: string): Promise<void> {
    return this.fundingService.handleStripeWebhook(rawBody, signature);
  }
}
