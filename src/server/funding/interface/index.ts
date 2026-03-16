import { EventEmitter } from 'events';
import FundingService from '@/server/funding/service/funding';
import { FundingPlan, FundingSettings, ProviderConfig, FundingStatus } from '@/common/model/funding-plan';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { ProviderSubscription, WebhookEvent } from '@/server/funding/service/provider/adapter';
import type CalendarInterface from '@/server/calendar/interface';

/**
 * Funding domain interface for cross-domain communication
 *
 * Exposes funding operations to other domains and internal API handlers.
 * Following the pattern from CalendarInterface and AccountsInterface.
 */
export default class FundingInterface {
  private fundingService: FundingService;

  constructor(eventBus: EventEmitter) {
    this.fundingService = new FundingService(eventBus);
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

  // Cross-domain query methods

  /**
   * Check if a calendar has an active funding plan
   *
   * @param calendarId - Calendar ID to check
   * @returns True if calendar has active funding plan, false otherwise
   */
  async hasActiveFundingPlan(calendarId: string): Promise<boolean> {
    return this.fundingService.hasActiveFundingPlan(calendarId);
  }

  /**
   * Check if a calendar has access to funded features
   * (either via active funding plan or complimentary grant)
   *
   * @param calendarId - Calendar ID to check
   * @returns True if calendar has funding access, false otherwise
   */
  async hasFundingAccess(calendarId: string): Promise<boolean> {
    return this.fundingService.hasFundingAccess(calendarId);
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

  async updateProvider(providerType: 'stripe' | 'paypal', displayName: string, enabled: boolean): Promise<void> {
    return this.fundingService.updateProvider(providerType, displayName, enabled);
  }

  async disconnectProvider(providerType: 'stripe' | 'paypal'): Promise<void> {
    return this.fundingService.disconnectProvider(providerType);
  }

  // User funding plan operations

  async getOptions(): Promise<{
    enabled: boolean;
    providers: ProviderConfig[];
    monthlyPrice: number;
    yearlyPrice: number;
    currency: string;
    payWhatYouCan: boolean;
  }> {
    return this.fundingService.getOptions();
  }

  async subscribe(
    accountId: string,
    accountEmail: string,
    providerConfigId: string,
    billingCycle: 'monthly' | 'yearly',
    amount: number,
    calendarIds?: string[],
  ): Promise<FundingPlan> {
    return this.fundingService.subscribe(accountId, accountEmail, providerConfigId, billingCycle, amount, calendarIds);
  }

  async getStatus(accountId: string): Promise<FundingPlan | null> {
    return this.fundingService.getStatus(accountId);
  }

  async cancel(fundingPlanId: string, immediate: boolean): Promise<void> {
    return this.fundingService.cancel(fundingPlanId, immediate);
  }

  async getBillingPortalUrl(accountId: string, returnUrl: string): Promise<string> {
    return this.fundingService.getBillingPortalUrl(accountId, returnUrl);
  }

  // Calendar funding plan operations

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
   * Verifies ownership internally and returns the funding status.
   *
   * @param accountId - Account ID requesting the status (must own the calendar)
   * @param calendarId - Calendar ID to check
   * @returns Funding status: 'admin-exempt' | 'grant' | 'funded' | 'unfunded'
   * @throws ValidationError if accountId does not own the calendar
   */
  async getFundingStatusForCalendar(accountId: string, calendarId: string): Promise<FundingStatus> {
    return this.fundingService.getFundingStatusForCalendar(accountId, calendarId);
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

  async processWebhookEvent(event: WebhookEvent, providerConfigId: string): Promise<void> {
    return this.fundingService.processWebhookEvent(event, providerConfigId);
  }
}
