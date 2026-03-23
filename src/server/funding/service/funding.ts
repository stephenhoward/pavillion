import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import config from 'config';
import {
  FundingSettings,
  ProviderConfig,
  FundingPlan,
  ProviderType,
  BillingCycle,
  FundingStatus,
} from '@/common/model/funding-plan';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { ComplimentaryGrantEntity } from '@/server/funding/entity/complimentary_grant';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { AccountEntity, AccountRoleEntity } from '@/server/common/entity/account';
import { ProviderFactory } from '@/server/funding/service/provider/factory';
import {
  WebhookEvent,
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  CheckoutSessionStatus,
} from '@/server/funding/service/provider/adapter';
import {
  InvalidBillingCycleError,
  InvalidAmountError,
  InvalidCurrencyError,
  MissingRequiredFieldError,
  InvalidProviderTypeError,
  DuplicateGrantError,
  GrantNotFoundError,
  FundingPlanNotFoundError,
  CalendarFundingPlanNotFoundError,
  DuplicateCalendarFundingPlanError,
  ActiveFundingPlanExistsError,
  ProviderNotConfiguredError,
  InvalidSessionIdError,
  WebhookSignatureError,
} from '@/common/exceptions/funding';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import type CalendarInterface from '@/server/calendar/interface';

// UUID v4 validation regex
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Maximum number of calendar IDs allowed in a single subscribe call
export const MAX_CALENDAR_IDS = 50;

// Checkout session ID format: cs_test_ or cs_live_ prefix, then 1-190 alphanumeric/underscore chars
const CHECKOUT_SESSION_ID_REGEX = /^cs_(test|live)_[a-zA-Z0-9_]{1,190}$/;

// PWYC amount bounds in millicents
export const MIN_PWYC_AMOUNT = 100000; // $1.00
export const MAX_PWYC_AMOUNT = 10000000000; // $100,000.00

/**
 * Validates if a string is a valid UUID v4
 */
function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_V4_REGEX.test(id);
}

/**
 * Service for managing funding operations
 *
 * Handles funding plan lifecycle, provider management, and webhook processing.
 */
export default class FundingService {
  private eventBus: EventEmitter;
  private calendarInterface?: CalendarInterface;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
  }

  /**
   * Injects CalendarInterface for cross-domain calendar ownership and existence checks.
   * Called after CalendarDomain is initialized to avoid circular construction dependencies.
   *
   * @param calendarInterface - The CalendarInterface instance from the calendar domain
   */
  setCalendarInterface(calendarInterface: CalendarInterface): void {
    this.calendarInterface = calendarInterface;
  }

  /**
   * Get instance funding settings
   *
   * @returns Funding settings or default settings if none exist
   */
  async getSettings(): Promise<FundingSettings> {
    const entity = await FundingSettingsEntity.findOne();

    if (!entity) {
      // Return default settings if none exist
      const defaultSettings = new FundingSettings();
      defaultSettings.enabled = false;
      defaultSettings.monthlyPrice = 0;
      defaultSettings.yearlyPrice = 0;
      defaultSettings.currency = 'USD';
      defaultSettings.payWhatYouCan = false;
      defaultSettings.gracePeriodDays = 7;
      return defaultSettings;
    }

    return entity.toModel();
  }

  /**
   * Update instance funding settings
   *
   * @param settings - Updated settings
   * @returns True if update successful
   */
  async updateSettings(settings: FundingSettings): Promise<void> {
    // Validate settings
    if (settings.monthlyPrice < 0 || settings.yearlyPrice < 0) {
      throw new InvalidAmountError('Prices must be non-negative');
    }

    if (settings.gracePeriodDays < 0) {
      throw new InvalidAmountError('Grace period must be non-negative');
    }

    // Validate currency format (3-letter ISO 4217 code)
    if (!/^[A-Z]{3}$/.test(settings.currency)) {
      throw new InvalidCurrencyError();
    }

    let entity = await FundingSettingsEntity.findOne();

    if (!entity) {
      // Create new settings if none exist
      entity = FundingSettingsEntity.fromModel(settings);
      entity.id = uuidv4();
      await entity.save();
    }
    else {
      // Update existing settings
      entity.enabled = settings.enabled;
      entity.monthly_price = settings.monthlyPrice;
      entity.yearly_price = settings.yearlyPrice;
      entity.currency = settings.currency;
      entity.pay_what_you_can = settings.payWhatYouCan;
      entity.grace_period_days = settings.gracePeriodDays;
      await entity.save();
    }

  }

  /**
   * Ensure default provider entries exist in database
   * Creates unconfigured Stripe and PayPal providers if they don't exist
   */
  private async ensureDefaultProviders(): Promise<void> {
    // Check if Stripe provider exists
    const stripeExists = await ProviderConfigEntity.findOne({
      where: { provider_type: 'stripe' },
    });

    if (!stripeExists) {
      await ProviderConfigEntity.create({
        id: uuidv4(),
        provider_type: 'stripe',
        enabled: false,
        display_name: 'Stripe',
        credentials: '', // Empty - unconfigured
        webhook_secret: '',
      });
    }

    // Check if PayPal provider exists
    const paypalExists = await ProviderConfigEntity.findOne({
      where: { provider_type: 'paypal' },
    });

    if (!paypalExists) {
      await ProviderConfigEntity.create({
        id: uuidv4(),
        provider_type: 'paypal',
        enabled: false,
        display_name: 'PayPal',
        credentials: '', // Empty - unconfigured
        webhook_secret: '',
      });
    }
  }

  /**
   * Get all configured payment providers
   *
   * @returns List of provider configurations
   */
  async getProviders(): Promise<ProviderConfig[]> {
    // Ensure default providers exist before querying
    await this.ensureDefaultProviders();

    const entities = await ProviderConfigEntity.findAll();
    return entities.map((entity) => entity.toModel());
  }

  /**
   * Get a specific provider configuration
   *
   * @param providerType - Type of provider
   * @returns Provider configuration or undefined
   */
  async getProvider(providerType: ProviderType): Promise<ProviderConfig | undefined> {
    const entity = await ProviderConfigEntity.findOne({
      where: { provider_type: providerType },
    });

    return entity?.toModel();
  }

  /**
   * Update provider configuration
   *
   * @param providerType - Type of provider
   * @param displayName - Display name for UI
   * @param enabled - Whether provider is enabled
   * @returns True if update successful
   */
  async updateProvider(
    providerType: ProviderType,
    displayName: string,
    enabled: boolean,
  ): Promise<boolean> {
    // Validate provider type
    if (providerType !== 'stripe' && providerType !== 'paypal') {
      throw new InvalidProviderTypeError();
    }

    // Validate displayName and enabled
    if (typeof displayName !== 'string') {
      throw new MissingRequiredFieldError('displayName');
    }

    if (typeof enabled !== 'boolean') {
      throw new MissingRequiredFieldError('enabled');
    }

    const entity = await ProviderConfigEntity.findOne({
      where: { provider_type: providerType },
    });

    if (!entity) {
      throw new Error(`Provider ${providerType} not found`);
    }

    entity.display_name = displayName;
    entity.enabled = enabled;
    await entity.save();

    // Clear adapter cache when provider is updated
    ProviderFactory.clearCache(entity.id);

    return true;
  }

  /**
   * Disconnect a payment provider
   *
   * @param providerType - Type of provider to disconnect
   * @returns True if disconnect successful
   */
  async disconnectProvider(providerType: ProviderType): Promise<boolean> {
    // Validate provider type
    if (providerType !== 'stripe' && providerType !== 'paypal') {
      throw new InvalidProviderTypeError();
    }

    const entity = await ProviderConfigEntity.findOne({
      where: { provider_type: providerType },
    });

    if (!entity) {
      return false;
    }

    // Check if any active funding plans use this provider
    const activeFundingPlans = await FundingPlanEntity.count({
      where: {
        provider_config_id: entity.id,
        status: {
          [Op.in]: ['active', 'past_due'],
        },
      },
    });

    if (activeFundingPlans > 0) {
      throw new Error(
        `Cannot disconnect provider with ${activeFundingPlans} active funding plan(s)`,
      );
    }

    // Clear cache before deleting
    ProviderFactory.clearCache(entity.id);

    await entity.destroy();
    return true;
  }

  /**
   * Get funding plan options available to users
   *
   * @returns Funding plan options including providers and pricing
   */
  async getOptions(): Promise<{
    enabled: boolean;
    providers: ProviderConfig[];
    monthlyPrice: number;
    yearlyPrice: number;
    currency: string;
    payWhatYouCan: boolean;
  }> {
    const settings = await this.getSettings();
    const allProviders = await this.getProviders();

    // Filter to only enabled providers
    const enabledProviders = allProviders.filter((p) => p.enabled);

    return {
      enabled: settings.enabled,
      providers: enabledProviders,
      monthlyPrice: settings.monthlyPrice,
      yearlyPrice: settings.yearlyPrice,
      currency: settings.currency,
      payWhatYouCan: settings.payWhatYouCan,
    };
  }

  /**
   * Verify that an account owns a calendar via CalendarInterface
   *
   * @param accountId - Account ID to verify
   * @param calendarId - Calendar ID to check ownership of
   * @throws ValidationError if account does not own the calendar
   */
  private async verifyCalendarOwnership(accountId: string, calendarId: string): Promise<void> {
    if (!this.calendarInterface) {
      throw new Error('CalendarInterface not available for ownership verification');
    }

    const isOwner = await this.calendarInterface.isCalendarOwnerById(accountId, calendarId);

    if (!isOwner) {
      throw new ValidationError(`Account ${accountId} does not own calendar ${calendarId}`);
    }
  }

  /**
   * Validates that a return URL origin matches the configured instance domain.
   * Defense in depth: prevents open redirect attacks by ensuring the return URL
   * points back to this Pavillion instance.
   *
   * @param returnUrl - The URL to validate
   * @throws ValidationError if the URL is unparseable, uses a disallowed scheme,
   *   or its origin does not match the configured domain
   */
  private validateReturnUrlOrigin(returnUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(returnUrl);
    }
    catch {
      throw new ValidationError('returnUrl is not a valid URL');
    }

    // Reject non-http(s) schemes (javascript:, data:, ftp:, etc.)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError('returnUrl must use http or https scheme');
    }

    // Build expected origin from configured domain
    const instanceDomain = config.get<string>('domain');
    const expectedOrigin = instanceDomain.includes('localhost')
      ? `http://${instanceDomain}`
      : `https://${instanceDomain}`;

    if (parsed.origin !== expectedOrigin) {
      throw new ValidationError('returnUrl origin does not match this instance');
    }
  }

  /**
   * Calculate the total amount from all active calendar funding plan allocations
   *
   * @param fundingPlanId - Funding plan ID
   * @returns Total amount in millicents
   */
  private async calculateActiveCalendarTotal(fundingPlanId: string): Promise<number> {
    const activeCalendarSubs = await CalendarFundingPlanEntity.findAll({
      where: {
        funding_plan_id: fundingPlanId,
        end_time: { [Op.is]: null as any },
      },
    });

    return activeCalendarSubs.reduce((sum, cs) => sum + cs.amount, 0);
  }

  /**
   * Update the funding plan amount at the payment provider
   *
   * Skips the provider call if the adapter does not support in-place amount updates
   * (e.g. PayPal funding plans have fixed amounts set at creation time).
   *
   * @param fundingPlanEntity - Funding plan entity
   * @param newAmount - New total amount in millicents
   */
  private async updateProviderAmount(
    fundingPlanEntity: FundingPlanEntity,
    newAmount: number,
  ): Promise<void> {
    const providerEntity = await ProviderConfigEntity.findByPk(fundingPlanEntity.provider_config_id);
    if (!providerEntity) {
      throw new Error('Provider configuration not found');
    }

    const providerConfig = providerEntity.toModel();
    const adapter = ProviderFactory.getAdapter(providerConfig);

    // PayPal funding plans have fixed amounts; skip the provider-side update
    if (!adapter.supportsAmountUpdates()) {
      return;
    }

    await adapter.updateSubscriptionAmount(
      fundingPlanEntity.provider_subscription_id,
      newAmount,
      fundingPlanEntity.currency,
    );
  }

  /**
   * Resolve the active funding plan for an account
   *
   * @param accountId - Account ID
   * @returns Active funding plan entity
   * @throws FundingPlanNotFoundError if no active funding plan exists
   */
  private async resolveActiveFundingPlan(accountId: string): Promise<FundingPlanEntity> {
    const fundingPlanEntity = await FundingPlanEntity.findOne({
      where: { account_id: accountId, status: 'active' },
    });

    if (!fundingPlanEntity) {
      throw new FundingPlanNotFoundError(accountId);
    }

    return fundingPlanEntity;
  }

  /**
   * Resolve the enabled Stripe provider configuration
   *
   * @returns Enabled Stripe provider config entity
   * @throws ProviderNotConfiguredError if no Stripe provider is configured or enabled
   */
  private async resolveEnabledStripeProvider(): Promise<ProviderConfigEntity> {
    const stripeEntity = await ProviderConfigEntity.findOne({
      where: { provider_type: 'stripe', enabled: true },
    });

    if (!stripeEntity) {
      throw new ProviderNotConfiguredError();
    }

    return stripeEntity;
  }

  /**
   * Add a calendar to an existing funding plan
   *
   * Resolves the active funding plan for the account internally.
   * Creates a CalendarFundingPlan row and updates the provider total amount.
   *
   * @param accountId - Account ID (used to resolve funding plan and verify ownership)
   * @param calendarId - Calendar ID to add
   * @param amount - Amount to allocate in millicents
   */
  async addCalendarToFundingPlan(
    accountId: string,
    calendarId: string,
    amount: number,
  ): Promise<void> {
    // Validate UUIDs
    if (!isValidUUID(accountId)) {
      throw new ValidationError('Invalid accountId: must be a valid UUID');
    }
    if (!isValidUUID(calendarId)) {
      throw new ValidationError('Invalid calendarId: must be a valid UUID');
    }

    // Validate amount
    if (amount < 0) {
      throw new InvalidAmountError();
    }

    // Resolve the active funding plan for this account
    const fundingPlanEntity = await this.resolveActiveFundingPlan(accountId);

    // Verify account owns the calendar
    await this.verifyCalendarOwnership(accountId, calendarId);

    // Check for existing active calendar funding plan
    const existing = await CalendarFundingPlanEntity.findOne({
      where: {
        funding_plan_id: fundingPlanEntity.id,
        calendar_id: calendarId,
        end_time: { [Op.is]: null as any },
      },
    });

    if (existing) {
      throw new DuplicateCalendarFundingPlanError(fundingPlanEntity.id, calendarId);
    }

    // Create the calendar funding plan row
    await CalendarFundingPlanEntity.create({
      id: uuidv4(),
      funding_plan_id: fundingPlanEntity.id,
      calendar_id: calendarId,
      amount,
      end_time: null,
    });

    // Recalculate total and update provider
    const newTotal = await this.calculateActiveCalendarTotal(fundingPlanEntity.id);
    await this.updateProviderAmount(fundingPlanEntity, newTotal);
  }

  /**
   * Remove a calendar from a funding plan
   *
   * Resolves the active funding plan for the account internally.
   * Sets end_time to the funding plan's current_period_end (calendar retains access until then).
   * Reduces the provider amount immediately. If this is the last active calendar,
   * cancels the entire funding plan.
   *
   * @param accountId - Account ID (used to resolve funding plan and verify ownership)
   * @param calendarId - Calendar ID to remove
   */
  async removeCalendarFromFundingPlan(
    accountId: string,
    calendarId: string,
  ): Promise<void> {
    // Validate UUIDs
    if (!isValidUUID(accountId)) {
      throw new ValidationError('Invalid accountId: must be a valid UUID');
    }
    if (!isValidUUID(calendarId)) {
      throw new ValidationError('Invalid calendarId: must be a valid UUID');
    }

    // Resolve the active funding plan for this account
    const fundingPlanEntity = await this.resolveActiveFundingPlan(accountId);

    // Verify account owns the calendar
    await this.verifyCalendarOwnership(accountId, calendarId);

    // Find the active calendar funding plan
    const calendarSub = await CalendarFundingPlanEntity.findOne({
      where: {
        funding_plan_id: fundingPlanEntity.id,
        calendar_id: calendarId,
        end_time: { [Op.is]: null as any },
      },
    });

    if (!calendarSub) {
      throw new CalendarFundingPlanNotFoundError(fundingPlanEntity.id, calendarId);
    }

    // Set end_time to funding plan's current_period_end
    calendarSub.end_time = fundingPlanEntity.current_period_end;
    await calendarSub.save();

    // Check remaining active calendar funding plans
    const remainingActive = await CalendarFundingPlanEntity.findAll({
      where: {
        funding_plan_id: fundingPlanEntity.id,
        end_time: { [Op.is]: null as any },
      },
    });

    if (remainingActive.length === 0) {
      // Last calendar removed: cancel the entire funding plan
      await this.cancel(fundingPlanEntity.id, false);
    }
    else {
      // Recalculate total and update provider
      const newTotal = remainingActive.reduce((sum, cs) => sum + cs.amount, 0);
      await this.updateProviderAmount(fundingPlanEntity, newTotal);
    }
  }

  /**
   * Get the funding status for a calendar
   *
   * Checks in priority order: ownership verification, admin exemption, active grant,
   * active calendar funding plan.
   *
   * @param accountId - Account ID requesting the funding status (must own the calendar)
   * @param calendarId - Calendar ID to check
   * @returns Funding status: 'admin-exempt' | 'grant' | 'funded' | 'unfunded'
   * @throws ValidationError if accountId does not own the calendar
   */
  async getFundingStatusForCalendar(accountId: string, calendarId: string): Promise<FundingStatus> {
    if (!isValidUUID(calendarId)) {
      throw new ValidationError('Invalid calendarId: must be a valid UUID');
    }

    if (!isValidUUID(accountId)) {
      throw new ValidationError('Invalid accountId: must be a valid UUID');
    }

    // Verify ownership - throws ValidationError if not owner
    await this.verifyCalendarOwnership(accountId, calendarId);

    if (!this.calendarInterface) {
      return 'unfunded';
    }

    // Find the calendar owner via CalendarInterface
    const ownerId = await this.calendarInterface.getCalendarOwnerAccountId(calendarId);

    if (!ownerId) {
      return 'unfunded';
    }

    // Check if owner is admin
    const adminRole = await AccountRoleEntity.findOne({
      where: {
        account_id: ownerId,
        role: 'admin',
      },
    });

    if (adminRole) {
      return 'admin-exempt';
    }

    // Check for active grant targeting this calendar
    const hasGrant = await this.hasActiveGrant(calendarId);

    if (hasGrant) {
      return 'grant';
    }

    // Check for active calendar funding plan
    const calendarSub = await CalendarFundingPlanEntity.findOne({
      where: {
        calendar_id: calendarId,
        [Op.or]: [
          { end_time: { [Op.is]: null as any } },
          { end_time: { [Op.gt]: new Date() } },
        ],
      },
    });

    if (calendarSub) {
      return 'funded';
    }

    return 'unfunded';
  }

  /**
   * Create a Stripe checkout session for embedded payment UI
   *
   * Validates all inputs before delegating to the Stripe adapter:
   * - Rejects if user already has an active funding plan
   * - Rejects if no Stripe provider is configured/enabled
   * - Validates calendarId ownership via calendar interface
   * - Enforces PWYC amount bounds when amount is provided
   * - accountId comes from the authenticated account, never from request body
   *
   * @param accountId - Authenticated account ID
   * @param billingCycle - 'monthly' or 'yearly'
   * @param returnUrl - URL to return to after checkout
   * @param amount - Optional amount in millicents (for PWYC pricing)
   * @param calendarIds - Optional array of calendar IDs to fund
   * @returns Client secret and session ID for the embedded checkout
   */
  async createCheckoutSession(
    accountId: string,
    billingCycle: BillingCycle,
    returnUrl: string,
    amount?: number,
    calendarIds?: string[],
  ): Promise<CheckoutSessionResult> {
    // Validate billing cycle
    if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
      throw new InvalidBillingCycleError();
    }

    // Validate return URL origin (defense in depth)
    this.validateReturnUrlOrigin(returnUrl);

    // Check if user already has an active funding plan
    const existingPlan = await FundingPlanEntity.findOne({
      where: { account_id: accountId, status: 'active' },
    });

    if (existingPlan) {
      throw new ActiveFundingPlanExistsError(accountId);
    }

    // Check for enabled Stripe provider
    const stripeEntity = await this.resolveEnabledStripeProvider();
    const providerConfig = stripeEntity.toModel();

    // Get settings for pricing
    const settings = await this.getSettings();

    // Validate and resolve calendarIds if provided
    if (calendarIds !== undefined) {
      if (calendarIds.length > MAX_CALENDAR_IDS) {
        throw new ValidationError(`calendarIds must not exceed ${MAX_CALENDAR_IDS} entries`);
      }

      for (const cId of calendarIds) {
        if (!isValidUUID(cId)) {
          throw new ValidationError(`Invalid calendarId: ${cId} must be a valid UUID`);
        }
      }

      // Verify ownership for all calendars
      for (const cId of calendarIds) {
        await this.verifyCalendarOwnership(accountId, cId);
      }
    }

    // Determine pricing: either use fixed price from settings or PWYC amount
    let checkoutAmount: number | undefined;

    if (amount !== undefined) {
      // PWYC: validate amount bounds
      if (!Number.isInteger(amount)) {
        throw new InvalidAmountError('Amount must be a positive integer in millicents');
      }
      if (amount < MIN_PWYC_AMOUNT) {
        throw new InvalidAmountError(`Amount must be at least ${MIN_PWYC_AMOUNT} millicents ($1.00)`);
      }
      if (amount > MAX_PWYC_AMOUNT) {
        throw new InvalidAmountError(`Amount must not exceed ${MAX_PWYC_AMOUNT} millicents ($100,000.00)`);
      }
      checkoutAmount = amount;
    }
    else {
      // Fixed pricing: use the settings price for the selected billing cycle
      checkoutAmount = billingCycle === 'monthly' ? settings.monthlyPrice : settings.yearlyPrice;
    }

    // Map billing cycle to Stripe interval
    const interval: 'month' | 'year' = billingCycle === 'monthly' ? 'month' : 'year';

    // Build checkout session params
    const adapter = ProviderFactory.getAdapter(providerConfig);
    const params: CreateCheckoutSessionParams = {
      amount: checkoutAmount,
      currency: settings.currency,
      interval,
      accountId,
      calendarIds,
      returnUrl,
    };

    return adapter.createCheckoutSession(params);
  }

  /**
   * Retrieve the status of a Stripe checkout session
   *
   * Validates sessionId format and performs IDOR protection by comparing the
   * session metadata accountId to the requesting user's accountId.
   * Returns 404-style error (not 403) on mismatch to avoid leaking session existence.
   *
   * @param accountId - Authenticated account ID
   * @param sessionId - The checkout session ID to check
   * @returns Status and customer email for the checkout session
   */
  async getCheckoutSessionStatus(
    accountId: string,
    sessionId: string,
  ): Promise<{ status: string }> {
    // Validate sessionId format
    if (!sessionId || typeof sessionId !== 'string') {
      throw new InvalidSessionIdError('Session ID is required');
    }

    if (sessionId.length > 200) {
      throw new InvalidSessionIdError('Session ID must not exceed 200 characters');
    }

    if (!CHECKOUT_SESSION_ID_REGEX.test(sessionId)) {
      throw new InvalidSessionIdError('Invalid session ID format');
    }

    // Resolve enabled Stripe provider
    const stripeEntity = await this.resolveEnabledStripeProvider();
    const providerConfig = stripeEntity.toModel();
    const adapter = ProviderFactory.getAdapter(providerConfig);

    // Retrieve session status from provider
    const sessionStatus: CheckoutSessionStatus = await adapter.getCheckoutSessionStatus(sessionId);

    // IDOR check: compare metadata.accountId to requesting user
    // Return generic "not found" error (not 403) to avoid leaking session existence
    // Guard against missing metadata first to prevent empty/undefined bypass
    if (!sessionStatus.metadata.accountId || sessionStatus.metadata.accountId !== accountId) {
      throw new FundingPlanNotFoundError(sessionId);
    }

    return {
      status: sessionStatus.status,
    };
  }

  /**
   * Cancel a funding plan
   *
   * @param fundingPlanId - Funding plan ID
   * @param immediate - If true, cancel immediately; otherwise at period end
   */
  async cancel(fundingPlanId: string, immediate: boolean = false): Promise<void> {
    const entity = await FundingPlanEntity.findByPk(fundingPlanId);
    if (!entity) {
      throw new Error('Funding plan not found');
    }

    // Get provider configuration
    const providerEntity = await ProviderConfigEntity.findByPk(entity.provider_config_id);
    if (!providerEntity) {
      throw new Error('Provider configuration not found');
    }

    const providerConfig = providerEntity.toModel();
    const adapter = ProviderFactory.getAdapter(providerConfig);

    // Cancel via provider
    await adapter.cancelSubscription(entity.provider_subscription_id, immediate);

    // Update status
    entity.status = 'cancelled';
    entity.cancelled_at = new Date();
    await entity.save();

    // Emit event
    this.eventBus.emit('funding:plan:cancelled', {
      fundingPlan: entity.toModel(),
      immediate,
    });
  }

  /**
   * Get funding plan status for an account
   *
   * @param accountId - Account ID
   * @returns Funding plan or null if none exists
   */
  async getStatus(accountId: string): Promise<FundingPlan | undefined> {
    const entity = await FundingPlanEntity.findOne({
      where: { account_id: accountId },
      order: [['createdAt', 'DESC']],
    });

    return entity?.toModel();
  }

  /**
   * Get billing portal URL for funding plan management
   *
   * @param accountId - Account ID
   * @param returnUrl - URL to return to after portal session
   * @returns Billing portal URL
   */
  async getBillingPortalUrl(accountId: string, returnUrl: string): Promise<string> {
    // Validate required fields
    if (!returnUrl) {
      throw new MissingRequiredFieldError('returnUrl');
    }

    const fundingPlan = await this.getStatus(accountId);
    if (!fundingPlan) {
      throw new Error('No funding plan found');
    }

    // Get provider configuration
    const providerEntity = await ProviderConfigEntity.findByPk(fundingPlan.providerConfigId);
    if (!providerEntity) {
      throw new Error('Provider configuration not found');
    }

    const providerConfig = providerEntity.toModel();
    const adapter = ProviderFactory.getAdapter(providerConfig);

    return adapter.getBillingPortalUrl(fundingPlan.providerCustomerId, returnUrl);
  }

  /**
   * List all funding plans (admin)
   *
   * @param page - Page number
   * @param limit - Items per page
   * @returns Paginated funding plan list
   */
  async listFundingPlans(
    page: number = 1,
    limit: number = 50,
  ): Promise<{
      fundingPlans: FundingPlan[];
      pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
      };
    }> {
    const offset = (page - 1) * limit;

    const { rows, count } = await FundingPlanEntity.findAndCountAll({
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return {
      fundingPlans: rows.map((entity) => entity.toModel()),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalCount: count,
        limit,
      },
    };
  }

  /**
   * Force cancel a funding plan (admin)
   *
   * @param fundingPlanId - Funding plan ID
   */
  async forceCancel(fundingPlanId: string): Promise<void> {
    await this.cancel(fundingPlanId, true);
  }


  /**
   * Handle a raw Stripe webhook request by looking up provider config,
   * verifying the signature, parsing the event, and delegating to processWebhookEvent.
   *
   * This method encapsulates all business logic that was previously in the API handler,
   * following the service-layer pattern where handlers only extract HTTP params.
   *
   * @param rawBody - Raw request body string for signature verification
   * @param signature - Value of the stripe-signature header
   * @throws ProviderNotConfiguredError if Stripe is not configured
   * @throws WebhookSignatureError if signature verification fails
   */
  async handleStripeWebhook(rawBody: string, signature: string): Promise<void> {
    const stripeConfig = await ProviderConfigEntity.findOne({
      where: { provider_type: 'stripe' },
    });

    if (!stripeConfig) {
      throw new ProviderNotConfiguredError('Stripe provider not configured');
    }

    const providerConfig = stripeConfig.toModel();
    const adapter = ProviderFactory.getAdapter(providerConfig);

    if (!adapter.verifyWebhookSignature(rawBody, signature)) {
      throw new WebhookSignatureError();
    }

    const webhookEvent = adapter.parseWebhookEvent(rawBody);
    await this.processWebhookEvent(webhookEvent, stripeConfig.id);
  }

  /**
   * Process webhook event from payment provider
   *
   * @param event - Webhook event data
   * @param providerConfigId - Provider configuration ID
   */
  async processWebhookEvent(event: WebhookEvent, providerConfigId: string): Promise<void> {
    // Check for duplicate event
    const existingEvent = await FundingEventEntity.findOne({
      where: { provider_event_id: event.eventId },
    });

    if (existingEvent) {
      // Event already processed, skip
      return;
    }

    // Handle checkout.session.completed: create a new FundingPlan
    // Event logging is deferred until after the FundingPlan is created,
    // because funding_plan_id is a FK that requires a valid local UUID
    if (event.eventType === 'checkout.session.completed') {
      await this.processCheckoutCompleted(event, providerConfigId);
      return;
    }

    // Find the local FundingPlan by provider subscription ID before logging,
    // so we can store the local UUID (not the Stripe sub_xxx ID) in funding_plan_id FK
    const fundingPlanRecord = event.subscriptionId
      ? await FundingPlanEntity.findOne({
        where: {
          provider_subscription_id: event.subscriptionId,
          provider_config_id: providerConfigId,
        },
      })
      : null;

    // Log event for funding plan lifecycle events
    const eventEntity = new FundingEventEntity();
    eventEntity.id = uuidv4();
    eventEntity.funding_plan_id = fundingPlanRecord?.id || '';
    eventEntity.event_type = event.eventType;
    eventEntity.provider_event_id = event.eventId;
    eventEntity.payload = JSON.stringify(event.rawPayload);
    eventEntity.processed_at = new Date();
    await eventEntity.save();

    if (!fundingPlanRecord) {
      return;
    }

    // Update funding plan based on event
    if (event.status) {
      const previousStatus = fundingPlanRecord.status;
      fundingPlanRecord.status = event.status;

      // Emit appropriate event based on status transition
      if (previousStatus === 'active' && event.status === 'past_due') {
        this.eventBus.emit('funding:plan:payment_failed', {
          fundingPlan: fundingPlanRecord.toModel(),
        });
      }
      else if (previousStatus === 'past_due' && event.status === 'suspended') {
        this.eventBus.emit('funding:plan:suspended', {
          fundingPlan: fundingPlanRecord.toModel(),
        });
      }
      else if (event.status === 'active' && previousStatus !== 'active') {
        this.eventBus.emit('funding:plan:reactivated', {
          fundingPlan: fundingPlanRecord.toModel(),
        });
      }
    }

    if (event.currentPeriodStart) {
      fundingPlanRecord.current_period_start = event.currentPeriodStart;
    }

    if (event.currentPeriodEnd) {
      fundingPlanRecord.current_period_end = event.currentPeriodEnd;
    }

    await fundingPlanRecord.save();
  }

  /**
   * Process a checkout.session.completed webhook event
   *
   * Creates a local FundingPlan record from the completed checkout session,
   * retrieves subscription details from the provider, re-validates calendar
   * ownership, and allocates funding to validated calendars.
   *
   * @param event - Webhook event with checkout session data
   * @param providerConfigId - Provider configuration ID
   * @private
   */
  private async processCheckoutCompleted(event: WebhookEvent, providerConfigId: string): Promise<void> {
    if (!event.subscriptionId || !event.customerId || !event.accountId) {
      return;
    }

    // Idempotency: check if a FundingPlan already exists for this provider subscription
    const existingPlan = await FundingPlanEntity.findOne({
      where: {
        provider_subscription_id: event.subscriptionId,
        provider_config_id: providerConfigId,
      },
    });

    if (existingPlan) {
      return;
    }

    // Validate accountId from metadata
    if (!isValidUUID(event.accountId)) {
      return;
    }

    // Retrieve subscription details from the provider for amount/currency/period
    const providerEntity = await ProviderConfigEntity.findByPk(providerConfigId);
    if (!providerEntity) {
      return;
    }

    const providerConfig = providerEntity.toModel();
    const adapter = ProviderFactory.getAdapter(providerConfig);
    const providerSubscription = await adapter.getSubscription(event.subscriptionId);

    // Determine billing cycle from provider subscription period
    const periodMs = providerSubscription.currentPeriodEnd.getTime()
      - providerSubscription.currentPeriodStart.getTime();
    const billingCycle: BillingCycle = periodMs > 60 * 24 * 60 * 60 * 1000 ? 'yearly' : 'monthly';

    // Create local FundingPlan record
    const fundingPlan = new FundingPlan(uuidv4());
    fundingPlan.accountId = event.accountId;
    fundingPlan.providerConfigId = providerConfigId;
    fundingPlan.providerSubscriptionId = event.subscriptionId;
    fundingPlan.providerCustomerId = event.customerId;
    fundingPlan.status = providerSubscription.status;
    fundingPlan.billingCycle = billingCycle;
    fundingPlan.amount = providerSubscription.amount;
    fundingPlan.currency = providerSubscription.currency;
    fundingPlan.currentPeriodStart = providerSubscription.currentPeriodStart;
    fundingPlan.currentPeriodEnd = providerSubscription.currentPeriodEnd;

    const entity = FundingPlanEntity.fromModel(fundingPlan);
    await entity.save();

    // Log the checkout event now that we have a valid funding_plan_id
    const eventEntity = new FundingEventEntity();
    eventEntity.id = uuidv4();
    eventEntity.funding_plan_id = fundingPlan.id;
    eventEntity.event_type = event.eventType;
    eventEntity.provider_event_id = event.eventId;
    eventEntity.payload = JSON.stringify(event.rawPayload);
    eventEntity.processed_at = new Date();
    await eventEntity.save();

    // Parse and re-validate calendarIds from metadata
    if (event.calendarIds) {
      let calendarIds: string[];
      try {
        calendarIds = JSON.parse(event.calendarIds);
      }
      catch {
        // Invalid JSON in calendarIds metadata, skip calendar allocation
        return;
      }

      if (!Array.isArray(calendarIds)) {
        return;
      }

      // Filter to only valid UUIDs
      const validCalendarIds = calendarIds.filter((cId) => isValidUUID(cId));

      // Re-validate ownership for each calendar
      const ownedCalendarIds: string[] = [];
      for (const cId of validCalendarIds) {
        try {
          await this.verifyCalendarOwnership(event.accountId, cId);
          ownedCalendarIds.push(cId);
        }
        catch {
          // Calendar not owned by this account, skip it
        }
      }

      // Allocate funding to validated calendars
      if (ownedCalendarIds.length > 0) {
        const perCalendarAmount = Math.floor(fundingPlan.amount / ownedCalendarIds.length);

        for (const calendarId of ownedCalendarIds) {
          await CalendarFundingPlanEntity.create({
            id: uuidv4(),
            funding_plan_id: fundingPlan.id,
            calendar_id: calendarId,
            amount: perCalendarAmount,
            end_time: null,
          });
        }
      }
    }

    this.eventBus.emit('funding:plan:created', {
      fundingPlan: fundingPlan,
    });
  }

  /**
   * Suspend funding plans that have exceeded grace period
   *
   * Called by scheduled job to handle expired grace periods
   */
  async suspendExpiredFundingPlans(): Promise<void> {
    const settings = await this.getSettings();
    const gracePeriodMs = settings.gracePeriodDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - gracePeriodMs);

    const expiredFundingPlans = await FundingPlanEntity.findAll({
      where: {
        status: 'past_due',
        updatedAt: {
          [Op.lt]: cutoffDate,
        },
      },
    });

    for (const fundingPlanRecord of expiredFundingPlans) {
      fundingPlanRecord.status = 'suspended';
      fundingPlanRecord.suspended_at = new Date();
      await fundingPlanRecord.save();

      this.eventBus.emit('funding:plan:suspended', {
        fundingPlan: fundingPlanRecord.toModel(),
      });
    }
  }

  /**
   * Revoke complimentary grants that have passed their expiration date.
   *
   * Finds all grants where expires_at is in the past and revoked_at is null,
   * then soft-deletes them by setting revoked_at to now.
   *
   * Called by scheduled job to auto-revoke expired grants.
   */
  async revokeExpiredGrants(): Promise<void> {
    const expiredGrants = await ComplimentaryGrantEntity.findAll({
      where: {
        revoked_at: { [Op.is]: null as any },
        expires_at: {
          [Op.not]: null as any,
          [Op.lte]: new Date(),
        },
      },
    });

    for (const grant of expiredGrants) {
      grant.revoked_at = new Date();
      grant.revoked_by = null; // Auto-revoked by system, not by an admin
      await grant.save();

      this.eventBus.emit('funding:grant:expired', {
        grant: grant.toModel(),
      });
    }
  }

  /**
   * Check if a calendar has an active funding plan via the calendar_funding_plan join table.
   *
   * Queries CalendarFundingPlanEntity for the given calendarId where the linked
   * funding plan is active and the allocation has not ended (end_time IS NULL or end_time > NOW()).
   *
   * @param calendarId - Calendar ID to check
   * @returns True if calendar has an active funding plan allocation
   */
  async hasActiveFundingPlan(calendarId: string): Promise<boolean> {
    const calendarSub = await CalendarFundingPlanEntity.findOne({
      where: {
        calendar_id: calendarId,
        [Op.or]: [
          { end_time: { [Op.is]: null as any } },
          { end_time: { [Op.gt]: new Date() } },
        ],
      },
      include: [{
        model: FundingPlanEntity,
        where: { status: 'active' },
        required: true,
      }],
    });

    return !!calendarSub;
  }

  /**
   * Create a complimentary grant for a calendar
   *
   * @param calendarId - Calendar ID to grant access to
   * @param grantedBy - Admin account ID granting access
   * @param reason - Optional reason for the grant (max 500 chars)
   * @param expiresAt - Optional future expiry date
   * @returns Created complimentary grant
   */
  async createGrant(
    calendarId: string,
    grantedBy: string,
    reason?: string,
    expiresAt?: Date,
  ): Promise<ComplimentaryGrant> {
    // Validate UUIDs
    if (!isValidUUID(calendarId)) {
      throw new ValidationError('Invalid calendarId: must be a valid UUID');
    }

    if (!isValidUUID(grantedBy)) {
      throw new ValidationError('Invalid grantedBy: must be a valid UUID');
    }

    // Validate reason length
    if (reason !== undefined && reason.length > 500) {
      throw new ValidationError('reason must not exceed 500 characters');
    }

    // Validate expiresAt is in the future
    if (expiresAt !== undefined && expiresAt <= new Date()) {
      throw new ValidationError('expiresAt must be a future date');
    }

    // Validate that the calendar exists via CalendarInterface
    if (this.calendarInterface) {
      const exists = await this.calendarInterface.calendarExists(calendarId);
      if (!exists) {
        throw new CalendarNotFoundError(calendarId);
      }
    }

    // Check for existing active grant for this calendar
    const existingGrant = await ComplimentaryGrantEntity.findOne({
      where: {
        calendar_id: calendarId,
        revoked_at: { [Op.is]: null as any },
        [Op.or]: [
          { expires_at: { [Op.is]: null as any } },
          { expires_at: { [Op.gt]: new Date() } },
        ],
      },
    });

    if (existingGrant) {
      throw new DuplicateGrantError(calendarId);
    }

    // Create the grant
    const grant = new ComplimentaryGrant(uuidv4());
    grant.calendarId = calendarId;
    grant.grantedBy = grantedBy;
    grant.reason = reason ?? null;
    grant.expiresAt = expiresAt ?? null;

    const entity = ComplimentaryGrantEntity.build({
      id: grant.id,
      account_id: grantedBy, // Use grantedBy as the account_id for the entity
      calendar_id: grant.calendarId,
      granted_by: grant.grantedBy,
      reason: grant.reason,
      expires_at: grant.expiresAt,
      revoked_at: null,
      revoked_by: null,
    });

    await entity.save();

    return entity.toModel();
  }

  /**
   * Revoke a complimentary grant (soft delete)
   *
   * @param grantId - Grant ID to revoke
   * @param revokedBy - Admin account ID revoking the grant
   */
  async revokeGrant(grantId: string, revokedBy: string): Promise<void> {
    // Validate UUIDs
    if (!isValidUUID(grantId)) {
      throw new ValidationError('Invalid grantId: must be a valid UUID');
    }

    if (!isValidUUID(revokedBy)) {
      throw new ValidationError('Invalid revokedBy: must be a valid UUID');
    }

    const entity = await ComplimentaryGrantEntity.findByPk(grantId);
    if (!entity) {
      throw new GrantNotFoundError(grantId);
    }

    entity.revoked_at = new Date();
    entity.revoked_by = revokedBy;
    await entity.save();
  }

  /**
   * List all complimentary grants, including account email and calendar URL name for display.
   *
   * Fetches account emails and calendar URL names in batch queries to avoid N+1 queries.
   *
   * @param includeRevoked - If true, include revoked grants; otherwise only active grants
   * @returns List of complimentary grants with accountEmail and calendarUrlName populated
   */
  async listGrants(includeRevoked: boolean = false): Promise<ComplimentaryGrant[]> {
    const queryOptions: Record<string, any> = {
      order: [['created_at', 'DESC']],
    };

    if (!includeRevoked) {
      queryOptions.where = {
        revoked_at: { [Op.is]: null as any },
      };
    }

    const entities = await ComplimentaryGrantEntity.findAll(queryOptions);

    if (entities.length === 0) {
      return [];
    }

    // Fetch account emails in a single batch query (for both accountId and grantedBy)
    const allAccountIds = [...new Set([
      ...entities.map((e) => e.account_id),
      ...entities.map((e) => e.granted_by),
    ])];
    const accounts = await AccountEntity.findAll({
      where: { id: { [Op.in]: allAccountIds } },
      attributes: ['id', 'email'],
    });
    const emailByAccountId = new Map(accounts.map((a) => [a.id, a.email]));

    // Fetch calendar URL names via CalendarInterface
    const urlNameByCalendarId = new Map<string, string>();
    if (this.calendarInterface) {
      const calendarIds = [...new Set(
        entities.map((e) => e.calendar_id).filter((id): id is string => id !== null),
      )];
      const calendars = await Promise.all(
        calendarIds.map((id) => this.calendarInterface!.getCalendar(id)),
      );
      calendars.forEach((calendar) => {
        if (calendar) {
          urlNameByCalendarId.set(calendar.id, calendar.urlName);
        }
      });
    }

    return entities.map((entity) => {
      const grant = entity.toModel();
      grant.accountEmail = emailByAccountId.get(entity.account_id);
      grant.grantedByEmail = emailByAccountId.get(entity.granted_by);
      if (entity.calendar_id) {
        grant.calendarUrlName = urlNameByCalendarId.get(entity.calendar_id);
      }
      return grant;
    });
  }

  /**
   * Check if a calendar has an active complimentary grant
   *
   * @param calendarId - Calendar ID to check
   * @returns True if calendar has an active, non-expired grant
   */
  async hasActiveGrant(calendarId: string): Promise<boolean> {
    const grant = await ComplimentaryGrantEntity.findOne({
      where: {
        calendar_id: calendarId,
        revoked_at: { [Op.is]: null as any },
        [Op.or]: [
          { expires_at: { [Op.is]: null as any } },
          { expires_at: { [Op.gt]: new Date() } },
        ],
      },
    });

    return !!grant;
  }

  /**
   * Get the active complimentary grant for a calendar, if any
   *
   * @param calendarId - Calendar ID to check
   * @returns Active grant or null if none exists
   */
  async getGrantForCalendar(calendarId: string): Promise<ComplimentaryGrant | null> {
    const entity = await ComplimentaryGrantEntity.findOne({
      where: {
        calendar_id: calendarId,
        revoked_at: { [Op.is]: null as any },
        [Op.or]: [
          { expires_at: { [Op.is]: null as any } },
          { expires_at: { [Op.gt]: new Date() } },
        ],
      },
    });

    return entity ? entity.toModel() : null;
  }

  /**
   * Check if a calendar has access via funding plan or complimentary grant.
   *
   * Uses fail-secure error handling: if checks throw errors, access is denied.
   * Grant check runs first (smaller table); funding plan check runs second.
   *
   * @param calendarId - Calendar ID to check
   * @returns True if calendar has an active grant or active funding plan
   */
  async hasFundingAccess(calendarId: string): Promise<boolean> {
    try {
      const hasGrant = await this.hasActiveGrant(calendarId);
      if (hasGrant) return true;
    }
    catch {
      // Grant check failed; fall through to funding plan check which may still deny access
    }

    try {
      const hasSub = await this.hasActiveFundingPlan(calendarId);
      return hasSub;
    }
    catch {
      // Fail-secure: deny access on funding plan check error
      return false;
    }
  }
}
