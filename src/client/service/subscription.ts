import axios from 'axios';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';

/**
 * Subscription settings returned from API
 */
export type SubscriptionSettings = {
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
  activeSubscriptionCount?: number;
  message?: string;
};

/**
 * Subscription status for a user
 */
export type SubscriptionStatus = {
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
 * Subscription options available to users
 */
export type SubscriptionOptions = {
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
 * Subscribe request parameters
 */
export type SubscribeParams = {
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
 * Subscription service for managing subscription payments.
 * Provides methods to configure subscription settings (admin) and
 * manage user subscriptions.
 */
export default class SubscriptionService {

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
   * Get current subscription settings (admin only)
   *
   * @returns {Promise<SubscriptionSettings>} Current subscription settings
   */
  async getSettings(): Promise<SubscriptionSettings> {
    try {
      const response = await axios.get('/api/subscription/v1/admin/settings');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get subscription settings:', error);
      throw error;
    }
  }

  /**
   * Update subscription settings (admin only)
   *
   * @param {Partial<SubscriptionSettings>} settings - Settings to update
   * @returns {Promise<boolean>} True if update was successful
   */
  async updateSettings(settings: Partial<SubscriptionSettings>): Promise<boolean> {
    try {
      const response = await axios.post('/api/subscription/v1/admin/settings', settings);
      return response.status === 200;
    }
    catch (error) {
      console.error('Failed to update subscription settings:', error);
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
      const response = await axios.get('/api/subscription/v1/admin/providers');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get providers:', error);
      throw error;
    }
  }

  /**
   * Initiate OAuth connection flow for Stripe (admin only)
   *
   * @param {string} returnUrl - URL to return to after OAuth completion
   * @returns {Promise<string>} OAuth redirect URL
   */
  async connectStripe(returnUrl: string): Promise<string> {
    try {
      const response = await axios.post('/api/subscription/v1/admin/providers/stripe/connect', {
        returnUrl,
      });
      return response.data.redirectUrl;
    }
    catch (error) {
      console.error('Failed to connect Stripe:', error);
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
      const response = await axios.post('/api/subscription/v1/admin/providers/paypal/configure', credentials);
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
      const response = await axios.put(`/api/subscription/v1/admin/providers/${providerType}`, config);
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
      const url = `/api/subscription/v1/admin/providers/${providerType}${confirmed ? '?confirm=true' : ''}`;
      const response = await axios.delete(url);
      return response.data;
    }
    catch (error) {
      console.error(`Failed to disconnect provider ${providerType}:`, error);
      throw error;
    }
  }

  /**
   * Get all subscriptions (admin only)
   *
   * @param {number} page - Page number (1-indexed)
   * @param {number} limit - Results per page
   * @returns {Promise<any>} Paginated subscription list
   */
  async listSubscriptions(page: number = 1, limit: number = 50): Promise<any> {
    try {
      const response = await axios.get('/api/subscription/v1/admin/subscriptions', {
        params: { page, limit },
      });
      return response.data;
    }
    catch (error) {
      console.error('Failed to list subscriptions:', error);
      throw error;
    }
  }

  /**
   * Force cancel a subscription (admin only)
   *
   * @param {string} subscriptionId - Subscription ID to cancel
   * @returns {Promise<boolean>} True if cancellation was successful
   */
  async forceCancelSubscription(subscriptionId: string): Promise<boolean> {
    try {
      const response = await axios.post(`/api/subscription/v1/admin/subscriptions/${subscriptionId}/cancel`);
      return response.status === 200;
    }
    catch (error) {
      console.error(`Failed to force cancel subscription ${subscriptionId}:`, error);
      return false;
    }
  }

  /**
   * Get platform OAuth configuration status (super admin only)
   *
   * @returns {Promise<{ configured: boolean }>} Platform OAuth configuration status
   */
  async getPlatformOAuthStatus(): Promise<{ configured: boolean }> {
    try {
      const response = await axios.get('/api/subscription/v1/admin/platform/oauth/status');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get platform OAuth status:', error);
      return { configured: false };
    }
  }

  /**
   * Configure platform OAuth credentials (super admin only)
   *
   * @param {Object} credentials - Platform OAuth credentials
   * @param {string} credentials.stripeClientId - Stripe Connect client ID
   * @param {string} credentials.stripeClientSecret - Stripe Connect client secret
   * @returns {Promise<boolean>} True if configuration was successful
   */
  async configurePlatformOAuth(credentials: {
    stripeClientId: string;
    stripeClientSecret: string;
  }): Promise<boolean> {
    try {
      const response = await axios.post('/api/subscription/v1/admin/platform/oauth', credentials);
      return response.status === 200;
    }
    catch (error) {
      console.error('Failed to configure platform OAuth:', error);
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
      const response = await axios.get('/api/subscription/v1/admin/grants', {
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
   * @returns {Promise<ComplimentaryGrant>} The created complimentary grant
   */
  async createGrant(accountId: string, reason?: string, expiresAt?: Date): Promise<ComplimentaryGrant> {
    try {
      const response = await axios.post('/api/subscription/v1/admin/grants', {
        accountId,
        reason,
        expiresAt,
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
      await axios.delete(`/api/subscription/v1/admin/grants/${grantId}`);
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

  // ========================================
  // User Methods
  // ========================================

  /**
   * Get available subscription options for the current user
   *
   * @returns {Promise<SubscriptionOptions>} Available subscription options
   */
  async getOptions(): Promise<SubscriptionOptions> {
    try {
      const response = await axios.get('/api/subscription/v1/options');
      return response.data;
    }
    catch (error) {
      console.error('Failed to get subscription options:', error);
      throw error;
    }
  }

  /**
   * Create a new subscription for the current user
   *
   * @param {SubscribeParams} params - Subscription parameters
   * @returns {Promise<any>} Subscription result (may include redirect URL for payment)
   */
  async subscribe(params: SubscribeParams): Promise<any> {
    try {
      const response = await axios.post('/api/subscription/v1/subscribe', params);
      return response.data;
    }
    catch (error) {
      console.error('Failed to subscribe:', error);
      throw error;
    }
  }

  /**
   * Get current subscription status for the authenticated user
   *
   * @returns {Promise<SubscriptionStatus | null>} Current subscription status or null if no subscription
   */
  async getStatus(): Promise<SubscriptionStatus | null> {
    try {
      const response = await axios.get('/api/subscription/v1/status');
      return response.data;
    }
    catch (error: any) {
      if (error.response?.status === 404) {
        return null; // No subscription
      }
      console.error('Failed to get subscription status:', error);
      throw error;
    }
  }

  /**
   * Cancel the current subscription (end of billing period)
   *
   * @returns {Promise<boolean>} True if cancellation was successful
   */
  async cancel(): Promise<boolean> {
    try {
      const response = await axios.post('/api/subscription/v1/cancel');
      return response.status === 200;
    }
    catch (error) {
      console.error('Failed to cancel subscription:', error);
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
      const response = await axios.get('/api/subscription/v1/portal');
      return response.data.portalUrl;
    }
    catch (error) {
      console.error('Failed to get portal URL:', error);
      throw error;
    }
  }
}
