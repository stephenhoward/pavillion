import { EventEmitter } from 'events';
import SubscriptionService from '@/server/subscription/service/subscription';
import { Subscription, SubscriptionSettings, ProviderConfig } from '@/common/model/subscription';
import { ProviderSubscription, WebhookEvent } from '@/server/subscription/service/provider/adapter';

/**
 * Subscription domain interface for cross-domain communication
 *
 * Exposes subscription operations to other domains and internal API handlers.
 * Following the pattern from CalendarInterface and AccountsInterface.
 */
export default class SubscriptionInterface {
  private subscriptionService: SubscriptionService;

  constructor(eventBus: EventEmitter) {
    this.subscriptionService = new SubscriptionService(eventBus);
  }

  // Cross-domain query methods

  /**
   * Check if an account has an active subscription
   *
   * @param accountId - Account ID to check
   * @returns True if account has active subscription, false otherwise
   */
  async hasActiveSubscription(accountId: string): Promise<boolean> {
    return this.subscriptionService.hasActiveSubscription(accountId);
  }

  /**
   * Get subscription status for an account
   *
   * @param accountId - Account ID to query
   * @returns Subscription model or null if no subscription exists
   */
  async getSubscriptionStatus(accountId: string): Promise<Subscription | null> {
    return this.subscriptionService.getSubscriptionStatus(accountId);
  }

  // Settings management

  async getSettings(): Promise<SubscriptionSettings> {
    return this.subscriptionService.getSettings();
  }

  async updateSettings(settings: SubscriptionSettings): Promise<void> {
    return this.subscriptionService.updateSettings(settings);
  }

  // Provider management

  async getProviders(): Promise<ProviderConfig[]> {
    return this.subscriptionService.getProviders();
  }

  async updateProvider(providerType: 'stripe' | 'paypal', displayName: string, enabled: boolean): Promise<void> {
    return this.subscriptionService.updateProvider(providerType, displayName, enabled);
  }

  async disconnectProvider(providerType: 'stripe' | 'paypal'): Promise<void> {
    return this.subscriptionService.disconnectProvider(providerType);
  }

  // User subscription operations

  async getOptions(): Promise<{
    settings: SubscriptionSettings;
    providers: ProviderConfig[];
  }> {
    return this.subscriptionService.getOptions();
  }

  async subscribe(
    accountId: string,
    providerType: 'stripe' | 'paypal',
    billingCycle: 'monthly' | 'yearly',
    amount?: number,
  ): Promise<ProviderSubscription> {
    return this.subscriptionService.subscribe(accountId, providerType, billingCycle, amount);
  }

  async getStatus(accountId: string): Promise<Subscription | null> {
    return this.subscriptionService.getStatus(accountId);
  }

  async cancel(subscriptionId: string, immediate: boolean): Promise<void> {
    return this.subscriptionService.cancel(subscriptionId, immediate);
  }

  async getBillingPortalUrl(accountId: string, returnUrl: string): Promise<string> {
    return this.subscriptionService.getBillingPortalUrl(accountId, returnUrl);
  }

  // Admin operations

  async listSubscriptions(page: number, limit: number): Promise<{
    subscriptions: Subscription[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalCount: number;
      limit: number;
    };
  }> {
    return this.subscriptionService.listSubscriptions(page, limit);
  }

  async forceCancel(subscriptionId: string): Promise<void> {
    return this.subscriptionService.forceCancel(subscriptionId);
  }

  // Platform OAuth configuration

  async isPlatformOAuthConfigured(): Promise<boolean> {
    return this.subscriptionService.isPlatformOAuthConfigured();
  }

  async configurePlatformOAuth(credentials: {
    stripeClientId: string;
    stripeClientSecret: string;
  }): Promise<void> {
    return this.subscriptionService.configurePlatformOAuth(credentials);
  }

  // Webhook processing

  async processWebhookEvent(event: WebhookEvent, providerConfigId: string): Promise<void> {
    return this.subscriptionService.processWebhookEvent(event, providerConfigId);
  }
}
