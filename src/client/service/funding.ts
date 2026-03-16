import axios from 'axios';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';

/**
 * Funding settings returned from API
 */
export type FundingSettings = {
  enabled: boolean;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  payWhatYouCan: boolean;
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
 * Provider disconnection response
 */
export type DisconnectResponse = {
  success?: boolean;
  requiresConfirmation?: boolean;
  activeFundingPlanCount?: number;
  message?: string;
};

/**
 * Funding plan status for a user
 */
export type FundingPlanStatus = {
  id: string;
  status: 'active' | 'past_due' | 'suspended' | 'cancelled';
  billing_cycle: 'monthly' | 'yearly';
  amount: number;
  currency: string;
  current_period_start: string;
  current_period_end: string;
  cancelled_at?: string;
  suspended_at?: string;
  provider_type: string;
};

/**
 * Funding options available to users
 */
export type FundingOptions = {
  enabled: boolean;
  providers: Array<{
    provider_type: string;
    display_name: string;
  }>;
  monthly_price: number;
  yearly_price: number;
  currency: string;
  pay_what_you_can: boolean;
};

/**
 * Funding plan request parameters
 */
export type FundingParams = {
  provider_type: 'stripe' | 'paypal';
  billing_cycle: 'monthly' | 'yearly';
  amount?: number; // For PWYC
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
 * Funding status for a calendar
 */
export type FundingStatus = {
  status: 'funded' | 'unfunded' | 'grant' | 'admin-exempt';
  grantInfo?: { reason?: string; expiresAt?: string };
};

/**
 * Resolved public calendar information
 */
export type ResolvedCalendar = {
  id: string;
  title: string;
};

/**
 * Funding service for managing funding plan payments.
 * Provides methods to configure funding settings (admin) and
 * manage user funding plans.
 */
export default class FundingService {

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
    return new Intl.NumberFormat('en-US', {
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
   * Get funding status for a specific calendar
   *
   * @param {string} calendarId - The calendar ID to check funding for
   * @returns {Promise<FundingStatus>} The funding status of the calendar
   */
  async getFundingStatus(calendarId: string): Promise<FundingStatus> {
    try {
      const response = await axios.get(`/api/funding/v1/calendars/${calendarId}/funding`);
      return response.data;
    }
    catch (error) {
      console.error('Failed to get funding status:', error);
      throw error;
    }
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
   * Create a new funding plan for the current user
   *
   * @param {FundingParams} params - Funding plan parameters
   * @param {string[]} calendarIds - Optional array of calendar IDs to include
   * @returns {Promise<any>} Funding plan result (may include redirect URL for payment)
   */
  async subscribe(params: FundingParams, calendarIds?: string[]): Promise<any> {
    try {
      const body = calendarIds ? { ...params, calendarIds } : params;
      const response = await axios.post('/api/funding/v1/subscribe', body);
      return response.data;
    }
    catch (error) {
      console.error('Failed to create funding plan:', error);
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
}
