import axios from 'axios';
import i18next from 'i18next';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { FUNDING_GATED_FEATURES } from '@/common/model/funding-plan';
import type { CalendarFundingSummary, FundingGatedFeature } from '@/common/model/funding-plan';
import { useFundingStore } from '@/client/stores/fundingStore';

/**
 * Funding settings returned from API
 */
export type FundingSettings = {
  enabled: boolean;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  payWhatYouCan: boolean;
  payWhatYouCanYearlyDiscount: number;
  gracePeriodDays: number;
};

/**
 * Payment provider configuration
 */
export type ProviderConfig = {
  id?: string;
  provider_type: 'stripe' | 'paypal';
  enabled: boolean;
  display_name: string;
  configured: boolean;
  webhook_url?: string;
};

/**
 * PayPal configuration credentials
 */
export type PayPalCredentials = {
  client_id: string;
  client_secret: string;
  environment: 'sandbox' | 'production';
};

/**
 * Stripe configuration credentials
 */
export type StripeCredentials = {
  publishable_key: string;
  secret_key: string;
  webhook_secret: string;
};

/**
 * Provider disconnection response
 */
export type DisconnectResponse = {
  success?: boolean;
  requiresConfirmation?: boolean;
  activeFundingPlanCount?: number;
  message?: string;
};

/**
 * Body of GET /api/funding/v1/status — the account's own funding plan.
 *
 * camelCase throughout, because that is what the endpoint sends
 * (server/funding/api/v1/funding-plan.ts). This type used to describe the
 * fields in snake_case, so every one of them but `id` and `status` read back
 * `undefined` at runtime and the page rendered "Invalid Date" for its dates —
 * a drift only a hand-written envelope type can produce, and the reason the
 * shape is now stated in the same spelling the wire uses.
 *
 * `status` alone does not tell a continuing plan from a cancelling one: a
 * cancel-at-period-end stays 'active' until its boundary. `cancelAt` is what
 * distinguishes them.
 */
export type FundingPlanStatus = {
  id: string;
  status: 'active' | 'past_due' | 'suspended' | 'cancelled';
  billingCycle: 'monthly' | 'yearly';
  amount: number;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** When cancellation was requested; set only once the plan is cancelled. */
  cancelledAt?: string | null;
  /** When a scheduled cancellation takes effect, or null if none is scheduled. */
  cancelAt?: string | null;
  suspendedAt?: string | null;
};

/**
 * Provider info returned from the options API
 */
export type FundingProvider = {
  providerType: string;
  displayName: string;
  publishableKey?: string;
};

/**
 * Funding options available to users
 */
export type FundingOptions = {
  enabled: boolean;
  providers: FundingProvider[];
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  payWhatYouCan: boolean;
  payWhatYouCanYearlyDiscount: number;
};

/**
 * Account search result
 */
export type AccountSearchResult = {
  id: string;
  username: string;
  email: string;
};

/**
 * The wire form of a server-side type: JSON carries no Date, so every
 * Date-valued field arrives here as an ISO-8601 string. Every other field
 * keeps the server's type, and a field added on the server appears here
 * without anything being retyped by hand.
 *
 * Only as far as the shapes it has been asked to carry, though: the Date arm
 * matches `Date | null` exactly, so a non-nullable `Date` is widened to
 * `string | null` and a `Date | undefined` is not converted at all, and a
 * field typed as a model class passes through claiming a class the JSON does
 * not carry. Widen the mapping when the summary grows a field of a shape it
 * does not handle — do not assume it already did.
 */
type Wire<T> = { [K in keyof T]: T[K] extends Date | null ? string | null : T[K] };

/**
 * Body of GET /api/funding/v1/calendars/:calendarId/funding.
 *
 * Derived from CalendarFundingSummary rather than restated, because that type
 * is the endpoint's field allowlist and it can only be "expressed once" if the
 * client reads it instead of describing the envelope again. An earlier
 * hand-written version of this type had already drifted: it carried a
 * `grantInfo` the server has never sent, and lacked `features` — the field the
 * gate answer actually lives in.
 *
 * `status` is a relationship label for display. `features` is the entitlement.
 * Decide what a calendar may do from `features`, never from `status`.
 */
export type CalendarFundingSummaryResponse = Wire<CalendarFundingSummary>;

/**
 * The funding-gated feature a failed request was refused for, or null if the
 * failure was not a funding denial.
 *
 * Recognition is deliberately narrow: only a 402 carrying
 * `errorName: 'SubscriptionRequiredError'` and a feature key that is in the
 * registry counts. Everything else — a 5xx above all — returns null, because
 * an unreadable instance funding state is *indeterminate*, not "not covered", and
 * must never be rendered as a closed gate.
 *
 * The membership test is `Object.hasOwn` on a string, not `feature in
 * FUNDING_GATED_FEATURES`. `in` walks the prototype chain, so a response
 * naming `toString` or `constructor` would pass as a registered feature; it
 * also coerces its left operand, so a non-string — an array, or an object with
 * a `toString` — would pass and be handed back behind the return-type cast,
 * making that type a runtime lie. Both then reach the store as a feature key:
 * one writes an entry a Vue template throws on interpolating, the other
 * reports a refusal as recorded while writing nothing. No first-party emitter
 * can produce either today, but this function's contract is to be handed an
 * error caught from *any* request, which is the case it exists to reject.
 *
 * @param error - An error caught from any axios call
 * @returns The denied feature, or null when this is not a funding denial
 */
export function fundingGateDenial(error: unknown): FundingGatedFeature | null {
  const response = (error as {
    response?: { status?: number; data?: { errorName?: string; feature?: unknown } };
  } | null)?.response;

  if (response?.status !== 402 || response.data?.errorName !== 'SubscriptionRequiredError') {
    return null;
  }

  const feature = response.data?.feature;
  return typeof feature === 'string' && Object.hasOwn(FUNDING_GATED_FEATURES, feature)
    ? feature as FundingGatedFeature
    : null;
}

/**
 * Resolved public calendar information
 */
export type ResolvedCalendar = {
  id: string;
  title: string;
};

/**
 * Calendar funding information within a user's funding plan
 */
export type CoveredCalendarInfo = {
  calendarId: string;
  amount: number;
  createdAt?: string;
};

/**
 * Checkout session creation response
 */
export type CheckoutSessionResponse = {
  clientSecret: string;
  sessionId: string;
};

/**
 * Checkout session status response
 */
export type CheckoutSessionStatus = {
  status: string;
  customer_email?: string;
};

/**
 * Funding service for managing funding plan payments.
 * Provides methods to configure funding settings (admin) and
 * manage user funding plans.
 */
export default class FundingService {
  private _store?: ReturnType<typeof useFundingStore>;

  /**
   * Lazily access the funding store. Only initializes when first accessed, so
   * the many HTTP-only methods on this service keep working without an active
   * Pinia instance.
   */
  private get store(): ReturnType<typeof useFundingStore> {
    if (!this._store) {
      this._store = useFundingStore();
    }
    return this._store;
  }

  /**
   * Convert millicents to display amount (dollars)
   */
  static millicentsToDisplay(millicents: number): number {
    return millicents / 100000;
  }

  /**
   * Convert display amount (dollars) to millicents
   */
  static displayToMillicents(amount: number): number {
    return Math.round(amount * 100000);
  }

  /**
   * Format currency amount for display
   */
  static formatCurrency(millicents: number, currency: string): string {
    const amount = this.millicentsToDisplay(millicents);
    return new Intl.NumberFormat(i18next.language, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  }

  // ========================================
  // Admin Methods
  // ========================================

  /**
   * Get current funding settings (admin only)
   *
   * @returns {Promise<FundingSettings>} Current funding settings
   */
  async getSettings(): Promise<FundingSettings> {
    try {
      const response = await axios.get('/api/funding/v1/admin/settings');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get funding settings:', error);
      throw error;
    }
  }

  /**
   * Update funding settings (admin only)
   *
   * @param {Partial<FundingSettings>} settings - Settings to update
   * @returns {Promise<boolean>} True if update was successful
   */
  async updateSettings(settings: Partial<FundingSettings>): Promise<boolean> {
    try {
      const response = await axios.post('/api/funding/v1/admin/settings', settings);
      return response.status === 200;
    }
    catch (error) {
      console.error('Failed to update funding settings:', error);
      return false;
    }
  }

  /**
   * Get all configured payment providers (admin only)
   *
   * @returns {Promise<ProviderConfig[]>} List of provider configurations
   */
  async getProviders(): Promise<ProviderConfig[]> {
    try {
      const response = await axios.get('/api/funding/v1/admin/providers');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get providers:', error);
      throw error;
    }
  }

  /**
   * Configure PayPal credentials manually (admin only)
   *
   * @param {PayPalCredentials} credentials - PayPal credentials
   * @returns {Promise<boolean>} True if configuration was successful
   */
  async configurePayPal(credentials: PayPalCredentials): Promise<boolean> {
    try {
      const response = await axios.post('/api/funding/v1/admin/providers/paypal/configure', credentials);
      return response.status === 200;
    }
    catch (error) {
      console.error('Failed to configure PayPal:', error);
      throw error;
    }
  }

  /**
   * Configure Stripe credentials manually (admin only)
   *
   * @param {StripeCredentials} credentials - Stripe credentials
   * @returns {Promise<{ success: boolean; connectionVerified: boolean }>} Configuration result with connection verification status
   */
  async configureStripe(credentials: StripeCredentials): Promise<{ success: boolean; connectionVerified: boolean }> {
    try {
      const response = await axios.post('/api/funding/v1/admin/providers/stripe/configure', credentials);
      return {
        success: response.status === 200,
        connectionVerified: response.data?.connectionVerified === true,
      };
    }
    catch (error) {
      console.error('Failed to configure Stripe:', error);
      throw error;
    }
  }
  /**
   * Update provider configuration (admin only)
   *
   * @param {string} providerType - Provider type
   * @param {Partial<ProviderConfig>} config - Configuration to update
   * @returns {Promise<boolean>} True if update was successful
   */
  async updateProvider(providerType: string, config: Partial<ProviderConfig>): Promise<boolean> {
    try {
      const response = await axios.put(`/api/funding/v1/admin/providers/${providerType}`, config);
      return response.status === 200;
    }
    catch (error) {
      console.error(`Failed to update provider ${providerType}:`, error);
      return false;
    }
  }

  /**
   * Disconnect/remove a payment provider (admin only)
   *
   * @param {string} providerType - Provider type to disconnect
   * @param {boolean} confirmed - Whether user has confirmed the disconnection
   * @returns {Promise<DisconnectResponse>} Disconnection result
   */
  async disconnectProvider(providerType: string, confirmed: boolean = false): Promise<DisconnectResponse> {
    try {
      const url = `/api/funding/v1/admin/providers/${providerType}${confirmed ? '?confirm=true' : ''}`;
      const response = await axios.delete(url);
      return response.data;
    }
    catch (error) {
      console.error(`Failed to disconnect provider ${providerType}:`, error);
      throw error;
    }
  }

  /**
   * Get all funding plans (admin only)
   *
   * @param {number} page - Page number (1-indexed)
   * @param {number} limit - Results per page
   * @returns {Promise<any>} Paginated funding plan list
   */
  async listFundingPlans(page: number = 1, limit: number = 50): Promise<any> {
    try {
      const response = await axios.get('/api/funding/v1/admin/funding-plans', {
        params: { page, limit },
      });
      return response.data;
    }
    catch (error) {
      console.error('Failed to list funding plans:', error);
      throw error;
    }
  }

  /**
   * Force cancel a funding plan (admin only)
   *
   * @param {string} fundingPlanId - Funding plan ID to cancel
   * @returns {Promise<boolean>} True if cancellation was successful
   */
  async forceCancelFundingPlan(fundingPlanId: string): Promise<boolean> {
    try {
      const response = await axios.post(`/api/funding/v1/admin/funding-plans/${fundingPlanId}/cancel`);
      return response.status === 200;
    }
    catch (error) {
      console.error(`Failed to force cancel funding plan ${fundingPlanId}:`, error);
      return false;
    }
  }

  /**
   * List complimentary grants (admin only)
   *
   * @param {boolean} includeRevoked - Whether to include revoked grants (default: false)
   * @returns {Promise<ComplimentaryGrant[]>} List of complimentary grants
   */
  async listGrants(includeRevoked: boolean = false): Promise<ComplimentaryGrant[]> {
    try {
      const response = await axios.get('/api/funding/v1/admin/grants', {
        params: { includeRevoked },
      });
      return response.data.map((grant: Record<string, any>) => ComplimentaryGrant.fromObject(grant));
    }
    catch (error) {
      console.error('Failed to list grants:', error);
      throw error;
    }
  }

  /**
   * Create a complimentary grant for an account (admin only)
   *
   * @param {string} accountId - The account ID to grant access to
   * @param {string} reason - Optional reason for the grant
   * @param {Date} expiresAt - Optional expiration date for the grant
   * @param {string} calendarId - Optional calendar ID to scope the grant to
   * @returns {Promise<ComplimentaryGrant>} The created complimentary grant
   */
  async createGrant(accountId: string, reason?: string, expiresAt?: Date, calendarId?: string): Promise<ComplimentaryGrant> {
    try {
      const response = await axios.post('/api/funding/v1/admin/grants', {
        accountId,
        reason,
        expiresAt,
        calendarId,
      });
      return ComplimentaryGrant.fromObject(response.data);
    }
    catch (error) {
      console.error('Failed to create grant:', error);
      throw error;
    }
  }

  /**
   * Revoke a complimentary grant (admin only)
   *
   * @param {string} grantId - The ID of the grant to revoke
   * @returns {Promise<void>}
   */
  async revokeGrant(grantId: string): Promise<void> {
    try {
      await axios.delete(`/api/funding/v1/admin/grants/${grantId}`);
    }
    catch (error) {
      console.error(`Failed to revoke grant ${grantId}:`, error);
      throw error;
    }
  }

  /**
   * Search accounts by username or email (admin only)
   *
   * @param {string} query - Search query string
   * @param {number} limit - Maximum number of results to return
   * @returns {Promise<AccountSearchResult[]>} Matching accounts
   */
  async searchAccounts(query: string, limit: number = 10): Promise<AccountSearchResult[]> {
    try {
      const response = await axios.get('/api/v1/admin/accounts', {
        params: { search: query, limit },
      });
      return (response.data || []).map((a: Record<string, any>) => ({
        id: a.id,
        username: a.username || a.name || '',
        email: a.email || '',
      }));
    }
    catch (error) {
      console.error('Failed to search accounts:', error);
      throw error;
    }
  }

  /**
   * Resolve a public calendar by its URL name
   *
   * @param {string} urlName - The URL name of the calendar to resolve
   * @returns {Promise<ResolvedCalendar | null>} Resolved calendar info or null if not found
   */
  async resolvePublicCalendar(urlName: string): Promise<ResolvedCalendar | null> {
    try {
      const response = await axios.get(`/api/public/v1/calendar/${encodeURIComponent(urlName)}`);
      if (response.data && response.data.id) {
        const title = response.data.content?.title || response.data.urlName || urlName;
        return { id: response.data.id, title };
      }
      return null;
    }
    catch {
      return null;
    }
  }

  // ========================================
  // Calendar Funding Methods
  // ========================================

  /**
   * Get all calendars in the user's funding plan
   *
   * @returns {Promise<CoveredCalendarInfo[]>} List of covered calendars with amounts
   */
  async getCalendarsInFundingPlan(): Promise<CoveredCalendarInfo[]> {
    try {
      const response = await axios.get('/api/funding/v1/calendars');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get calendars in funding plan:', error);
      throw error;
    }
  }

  /**
   * Add a calendar to the user's funding plan
   *
   * @param {string} calendarId - The calendar ID to add
   * @param {number} amount - The funding amount for this calendar
   * @returns {Promise<void>}
   */
  async addCalendarToFundingPlan(calendarId: string, amount: number): Promise<void> {
    try {
      await axios.post('/api/funding/v1/calendars', {
        calendarId,
        amount,
      });
    }
    catch (error) {
      console.error('Failed to add calendar to funding plan:', error);
      throw error;
    }
  }

  /**
   * Remove a calendar from the user's funding plan
   *
   * @param {string} calendarId - The calendar ID to remove
   * @returns {Promise<void>}
   */
  async removeCalendarFromFundingPlan(calendarId: string): Promise<void> {
    try {
      await axios.delete(`/api/funding/v1/calendars/${calendarId}`);
    }
    catch (error) {
      console.error('Failed to remove calendar from funding plan:', error);
      throw error;
    }
  }

  /**
   * Get the funding summary for a specific calendar.
   *
   * Named for the status it originally returned; the endpoint now answers with
   * the whole summary — the display status, the plan dates and the per-feature
   * gate decisions.
   *
   * @param {string} calendarId - The calendar ID to check funding for
   * @returns {Promise<CalendarFundingSummaryResponse>} The calendar's funding summary
   */
  async getFundingStatus(calendarId: string): Promise<CalendarFundingSummaryResponse> {
    try {
      const response = await axios.get(`/api/funding/v1/calendars/${calendarId}/funding`);
      return response.data;
    }
    catch (error) {
      console.error('Failed to get funding status:', error);
      throw error;
    }
  }

  /**
   * Load a calendar's funding summary and cache it in the funding store.
   *
   * The store is a read-through cache only: it is populated here, never by a
   * component, and it holds nothing that is not on the wire.
   *
   * @param {string} calendarId - The calendar ID to load funding for
   * @returns {Promise<CalendarFundingSummaryResponse>} The loaded summary
   */
  async loadFundingSummary(calendarId: string): Promise<CalendarFundingSummaryResponse> {
    const summary = await this.getFundingStatus(calendarId);
    this.store.setSummary(calendarId, summary);
    return summary;
  }

  // ========================================
  // User Methods
  // ========================================

  /**
   * Get available funding options for the current user
   *
   * @returns {Promise<FundingOptions>} Available funding options
   */
  async getOptions(): Promise<FundingOptions> {
    try {
      const response = await axios.get('/api/funding/v1/options');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get funding options:', error);
      throw error;
    }
  }

  /**
   * Get current funding plan status for the authenticated user
   *
   * @returns {Promise<FundingPlanStatus | null>} Current funding plan status or null if none
   */
  async getStatus(): Promise<FundingPlanStatus | null> {
    try {
      const response = await axios.get('/api/funding/v1/status');
      return response.data;
    }
    catch (error: any) {
      if (error.response?.status === 404) {
        return null; // No funding plan
      }
      console.error('Failed to get funding plan status:', error);
      throw error;
    }
  }

  /**
   * Cancel the current funding plan (end of billing period)
   *
   * @returns {Promise<boolean>} True if cancellation was successful
   */
  async cancel(): Promise<boolean> {
    try {
      const response = await axios.post('/api/funding/v1/cancel');
      return response.status === 200;
    }
    catch (error) {
      console.error('Failed to cancel funding plan:', error);
      return false;
    }
  }

  /**
   * Get billing portal URL for managing payment method
   *
   * @returns {Promise<string>} Billing portal URL
   */
  async getPortalUrl(): Promise<string> {
    try {
      const response = await axios.get('/api/funding/v1/portal');
      return response.data.portalUrl;
    }
    catch (error) {
      console.error('Failed to get portal URL:', error);
      throw error;
    }
  }

  // ========================================
  // Checkout Session Methods (Stripe Embedded Checkout)
  // ========================================

  /**
   * Create a Stripe checkout session for embedded checkout
   *
   * @param {object} params - Checkout session parameters
   * @param {string} params.billingCycle - Billing cycle ('monthly' or 'yearly')
   * @param {string} params.returnUrl - URL to redirect to after checkout
   * @param {number} params.amount - Optional custom amount in millicents (for PWYC)
   * @param {string[]} params.calendarIds - Optional array of calendar IDs
   * @returns {Promise<CheckoutSessionResponse>} Client secret and session ID
   */
  async createCheckoutSession(params: {
    billingCycle: string;
    returnUrl: string;
    amount?: number;
    calendarIds?: string[];
    colorMode?: 'light' | 'dark';
  }): Promise<CheckoutSessionResponse> {
    try {
      const response = await axios.post('/api/funding/v1/checkout-sessions', params);
      return response.data;
    }
    catch (error) {
      console.error('Failed to create checkout session:', error);
      throw error;
    }
  }

  /**
   * Get the status of a checkout session
   *
   * @param {string} sessionId - The checkout session ID
   * @returns {Promise<CheckoutSessionStatus>} Session status
   */
  async getCheckoutSessionStatus(sessionId: string): Promise<CheckoutSessionStatus> {
    try {
      const response = await axios.get(`/api/funding/v1/checkout-sessions/${sessionId}/status`);
      return response.data;
    }
    catch (error) {
      console.error('Failed to get checkout session status:', error);
      throw error;
    }
  }
}
