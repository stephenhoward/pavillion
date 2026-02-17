import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import {
  SubscriptionSettings,
  ProviderConfig,
  Subscription,
  SubscriptionEvent,
  ProviderType,
  BillingCycle,
} from '@/common/model/subscription';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { SubscriptionSettingsEntity } from '@/server/subscription/entity/subscription_settings';
import { ProviderConfigEntity } from '@/server/subscription/entity/provider_config';
import { SubscriptionEntity } from '@/server/subscription/entity/subscription';
import { SubscriptionEventEntity } from '@/server/subscription/entity/subscription_event';
import { PlatformOAuthConfigEntity } from '@/server/subscription/entity/platform_oauth_config';
import { ComplimentaryGrantEntity } from '@/server/subscription/entity/complimentary_grant';
import { AccountEntity } from '@/server/common/entity/account';
import { ProviderFactory } from '@/server/subscription/service/provider/factory';
import { WebhookEvent, CreateSubscriptionParams } from '@/server/subscription/service/provider/adapter';
import {
  InvalidBillingCycleError,
  InvalidAmountError,
  InvalidCurrencyError,
  MissingRequiredFieldError,
  InvalidProviderTypeError,
  AccountNotFoundError,
  DuplicateGrantError,
  GrantNotFoundError,
} from '@/server/subscription/exceptions';
import { ValidationError } from '@/common/exceptions/base';

// UUID v4 validation regex
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a valid UUID v4
 */
function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_V4_REGEX.test(id);
}

/**
 * Service for managing subscription operations
 *
 * Handles subscription lifecycle, provider management, and webhook processing.
 */
export default class SubscriptionService {
  private eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
  }

  /**
   * Get instance subscription settings
   *
   * @returns Subscription settings or default settings if none exist
   */
  async getSettings(): Promise<SubscriptionSettings> {
    const entity = await SubscriptionSettingsEntity.findOne();

    if (!entity) {
      // Return default settings if none exist
      const defaultSettings = new SubscriptionSettings();
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
   * Update instance subscription settings
   *
   * @param settings - Updated settings
   * @returns True if update successful
   */
  async updateSettings(settings: SubscriptionSettings): Promise<boolean> {
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

    let entity = await SubscriptionSettingsEntity.findOne();

    if (!entity) {
      // Create new settings if none exist
      entity = SubscriptionSettingsEntity.fromModel(settings);
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

    return true;
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

    // Check if any active subscriptions use this provider
    const activeSubscriptions = await SubscriptionEntity.count({
      where: {
        provider_config_id: entity.id,
        status: {
          [Op.in]: ['active', 'past_due'],
        },
      },
    });

    if (activeSubscriptions > 0) {
      throw new Error(
        `Cannot disconnect provider with ${activeSubscriptions} active subscription(s)`,
      );
    }

    // Clear cache before deleting
    ProviderFactory.clearCache(entity.id);

    await entity.destroy();
    return true;
  }

  /**
   * Get subscription options available to users
   *
   * @returns Subscription options including providers and pricing
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
   * Create a new subscription for a user
   *
   * @param accountId - Account ID
   * @param accountEmail - Account email
   * @param providerConfigId - Provider configuration ID
   * @param billingCycle - monthly or yearly
   * @param amount - Amount in millicents (for PWYC)
   * @returns Created subscription
   */
  async subscribe(
    accountId: string,
    accountEmail: string,
    providerConfigId: string,
    billingCycle: BillingCycle,
    amount: number,
  ): Promise<Subscription> {
    // Validate required fields
    if (!providerConfigId) {
      throw new MissingRequiredFieldError('providerConfigId');
    }

    if (!billingCycle) {
      throw new MissingRequiredFieldError('billingCycle');
    }

    // Validate billing cycle
    if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
      throw new InvalidBillingCycleError();
    }

    // Validate amount for PWYC
    if (amount !== undefined && amount < 0) {
      throw new InvalidAmountError();
    }

    // Get provider configuration
    const providerEntity = await ProviderConfigEntity.findByPk(providerConfigId);
    if (!providerEntity) {
      throw new Error('Provider not found');
    }

    const providerConfig = providerEntity.toModel();

    if (!providerConfig.enabled) {
      throw new Error('Provider is not enabled');
    }

    // Get adapter
    const adapter = ProviderFactory.getAdapter(providerConfig);

    // Get settings for currency
    const settings = await this.getSettings();

    // Create subscription parameters
    const params: CreateSubscriptionParams = {
      accountEmail,
      accountId,
      amount,
      currency: settings.currency,
      billingCycle,
    };

    // Create subscription via provider
    const providerSubscription = await adapter.createSubscription(params);

    // Create subscription entity
    const subscription = new Subscription(uuidv4());
    subscription.accountId = accountId;
    subscription.providerConfigId = providerConfigId;
    subscription.providerSubscriptionId = providerSubscription.providerSubscriptionId;
    subscription.providerCustomerId = providerSubscription.providerCustomerId;
    subscription.status = providerSubscription.status;
    subscription.billingCycle = billingCycle;
    subscription.amount = amount;
    subscription.currency = providerSubscription.currency;
    subscription.currentPeriodStart = providerSubscription.currentPeriodStart;
    subscription.currentPeriodEnd = providerSubscription.currentPeriodEnd;

    const entity = SubscriptionEntity.fromModel(subscription);
    await entity.save();

    // Emit event
    this.eventBus.emit('subscription:created', { subscription });

    return subscription;
  }

  /**
   * Cancel a subscription
   *
   * @param subscriptionId - Subscription ID
   * @param immediate - If true, cancel immediately; otherwise at period end
   */
  async cancel(subscriptionId: string, immediate: boolean = false): Promise<void> {
    const entity = await SubscriptionEntity.findByPk(subscriptionId);
    if (!entity) {
      throw new Error('Subscription not found');
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
    this.eventBus.emit('subscription:cancelled', {
      subscription: entity.toModel(),
      immediate,
    });
  }

  /**
   * Get subscription status for an account
   *
   * @param accountId - Account ID
   * @returns Subscription or undefined if no subscription exists
   */
  async getStatus(accountId: string): Promise<Subscription | undefined> {
    const entity = await SubscriptionEntity.findOne({
      where: { account_id: accountId },
      order: [['createdAt', 'DESC']],
    });

    return entity?.toModel();
  }

  /**
   * Get billing portal URL for subscription management
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

    const subscription = await this.getStatus(accountId);
    if (!subscription) {
      throw new Error('No subscription found');
    }

    // Get provider configuration
    const providerEntity = await ProviderConfigEntity.findByPk(subscription.providerConfigId);
    if (!providerEntity) {
      throw new Error('Provider configuration not found');
    }

    const providerConfig = providerEntity.toModel();
    const adapter = ProviderFactory.getAdapter(providerConfig);

    return adapter.getBillingPortalUrl(subscription.providerCustomerId, returnUrl);
  }

  /**
   * List all subscriptions (admin)
   *
   * @param page - Page number
   * @param limit - Items per page
   * @returns Paginated subscription list
   */
  async listSubscriptions(
    page: number = 1,
    limit: number = 50,
  ): Promise<{
      subscriptions: Subscription[];
      pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
      };
    }> {
    const offset = (page - 1) * limit;

    const { rows, count } = await SubscriptionEntity.findAndCountAll({
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return {
      subscriptions: rows.map((entity) => entity.toModel()),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalCount: count,
        limit,
      },
    };
  }

  /**
   * Force cancel a subscription (admin)
   *
   * @param subscriptionId - Subscription ID
   */
  async forceCancel(subscriptionId: string): Promise<void> {
    await this.cancel(subscriptionId, true);
  }

  /**
   * Process webhook event from payment provider
   *
   * @param event - Webhook event data
   * @param providerConfigId - Provider configuration ID
   */
  async processWebhookEvent(event: WebhookEvent, providerConfigId: string): Promise<void> {
    // Check for duplicate event
    const existingEvent = await SubscriptionEventEntity.findOne({
      where: { provider_event_id: event.eventId },
    });

    if (existingEvent) {
      // Event already processed, skip
      return;
    }

    // Log event
    const eventEntity = new SubscriptionEventEntity();
    eventEntity.id = uuidv4();
    eventEntity.subscription_id = event.subscriptionId || '';
    eventEntity.event_type = event.eventType;
    eventEntity.provider_event_id = event.eventId;
    eventEntity.payload = JSON.stringify(event.rawPayload);
    eventEntity.processed_at = new Date();
    await eventEntity.save();

    // Find subscription by provider subscription ID
    if (!event.subscriptionId) {
      return;
    }

    const subscription = await SubscriptionEntity.findOne({
      where: {
        provider_subscription_id: event.subscriptionId,
        provider_config_id: providerConfigId,
      },
    });

    if (!subscription) {
      return;
    }

    // Update subscription based on event
    if (event.status) {
      const previousStatus = subscription.status;
      subscription.status = event.status;

      // Emit appropriate event based on status transition
      if (previousStatus === 'active' && event.status === 'past_due') {
        this.eventBus.emit('subscription:payment_failed', {
          subscription: subscription.toModel(),
        });
      }
      else if (previousStatus === 'past_due' && event.status === 'suspended') {
        this.eventBus.emit('subscription:suspended', {
          subscription: subscription.toModel(),
        });
      }
      else if (event.status === 'active' && previousStatus !== 'active') {
        this.eventBus.emit('subscription:reactivated', {
          subscription: subscription.toModel(),
        });
      }
    }

    if (event.currentPeriodStart) {
      subscription.current_period_start = event.currentPeriodStart;
    }

    if (event.currentPeriodEnd) {
      subscription.current_period_end = event.currentPeriodEnd;
    }

    await subscription.save();
  }

  /**
   * Suspend subscriptions that have exceeded grace period
   *
   * Called by scheduled job to handle expired grace periods
   */
  async suspendExpiredSubscriptions(): Promise<void> {
    const settings = await this.getSettings();
    const gracePeriodMs = settings.gracePeriodDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - gracePeriodMs);

    const expiredSubscriptions = await SubscriptionEntity.findAll({
      where: {
        status: 'past_due',
        updatedAt: {
          [Op.lt]: cutoffDate,
        },
      },
    });

    for (const subscription of expiredSubscriptions) {
      subscription.status = 'suspended';
      subscription.suspended_at = new Date();
      await subscription.save();

      this.eventBus.emit('subscription:suspended', {
        subscription: subscription.toModel(),
      });
    }
  }

  /**
   * Check if account has an active subscription
   *
   * @param accountId - Account ID
   * @returns True if account has active subscription
   */
  async hasActiveSubscription(accountId: string): Promise<boolean> {
    const subscription = await SubscriptionEntity.findOne({
      where: {
        account_id: accountId,
        status: 'active',
      },
    });

    return !!subscription;
  }

  /**
   * Get subscription status for cross-domain queries
   *
   * @param accountId - Account ID
   * @returns Subscription status or null
   */
  async getSubscriptionStatus(accountId: string): Promise<Subscription | null> {
    const subscription = await this.getStatus(accountId);
    return subscription || null;
  }

  /**
   * Check if platform OAuth is configured (for Stripe Connect)
   *
   * @returns True if platform OAuth credentials are configured
   */
  async isPlatformOAuthConfigured(): Promise<boolean> {
    const config = await PlatformOAuthConfigEntity.findOne({
      where: {
        provider_type: 'stripe',
      },
    });

    return !!config;
  }

  /**
   * Configure platform OAuth credentials (for Stripe Connect)
   *
   * @param credentials - Platform OAuth credentials
   */
  async configurePlatformOAuth(credentials: {
    stripeClientId: string;
    stripeClientSecret: string;
  }): Promise<void> {
    // Check if config already exists
    let config = await PlatformOAuthConfigEntity.findOne({
      where: {
        provider_type: 'stripe',
      },
    });

    if (config) {
      // Update existing config
      config = PlatformOAuthConfigEntity.fromCredentials(
        config.id,
        'stripe',
        credentials.stripeClientId,
        credentials.stripeClientSecret,
      );
      await config.save();
    }
    else {
      // Create new config
      config = PlatformOAuthConfigEntity.fromCredentials(
        uuidv4(),
        'stripe',
        credentials.stripeClientId,
        credentials.stripeClientSecret,
      );
      await config.save();
    }
  }

  /**
   * Create a complimentary grant for an account
   *
   * @param accountId - Account ID to grant access to
   * @param grantedBy - Admin account ID granting access
   * @param reason - Optional reason for the grant (max 500 chars)
   * @param expiresAt - Optional future expiry date
   * @returns Created complimentary grant
   */
  async createGrant(
    accountId: string,
    grantedBy: string,
    reason?: string,
    expiresAt?: Date,
  ): Promise<ComplimentaryGrant> {
    // Validate UUIDs
    if (!isValidUUID(accountId)) {
      throw new ValidationError('Invalid accountId: must be a valid UUID');
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

    // Check account exists
    const account = await AccountEntity.findByPk(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    // Check for existing active grant
    const existingGrant = await ComplimentaryGrantEntity.findOne({
      where: {
        account_id: accountId,
        revoked_at: { [Op.is]: null as any },
        [Op.or]: [
          { expires_at: { [Op.is]: null as any } },
          { expires_at: { [Op.gt]: new Date() } },
        ],
      },
    });

    if (existingGrant) {
      throw new DuplicateGrantError(accountId);
    }

    // Create the grant
    const grant = new ComplimentaryGrant(uuidv4());
    grant.accountId = accountId;
    grant.grantedBy = grantedBy;
    grant.reason = reason ?? null;
    grant.expiresAt = expiresAt ?? null;

    const entity = ComplimentaryGrantEntity.build({
      id: grant.id,
      account_id: grant.accountId,
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
   * List all complimentary grants, including account email for display.
   *
   * Fetches account emails in a single batch query to avoid N+1 queries.
   *
   * @param includeRevoked - If true, include revoked grants; otherwise only active grants
   * @returns List of complimentary grants with accountEmail populated
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

    return entities.map((entity) => {
      const grant = entity.toModel();
      grant.accountEmail = emailByAccountId.get(entity.account_id);
      grant.grantedByEmail = emailByAccountId.get(entity.granted_by);
      return grant;
    });
  }

  /**
   * Check if an account has an active complimentary grant
   *
   * @param accountId - Account ID to check
   * @returns True if account has an active, non-expired grant
   */
  async hasActiveGrant(accountId: string): Promise<boolean> {
    const grant = await ComplimentaryGrantEntity.findOne({
      where: {
        account_id: accountId,
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
   * Get the active complimentary grant for an account, if any
   *
   * @param accountId - Account ID to check
   * @returns Active grant or null if none exists
   */
  async getGrantForAccount(accountId: string): Promise<ComplimentaryGrant | null> {
    const entity = await ComplimentaryGrantEntity.findOne({
      where: {
        account_id: accountId,
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
   * Check if an account has access via subscription or complimentary grant.
   *
   * Uses fail-secure error handling: if checks throw errors, access is denied.
   * Grant check runs first (smaller table); subscription check runs second.
   *
   * @param accountId - Account ID to check
   * @returns True if account has an active grant or active subscription
   */
  async hasSubscriptionAccess(accountId: string): Promise<boolean> {
    try {
      const hasGrant = await this.hasActiveGrant(accountId);
      if (hasGrant) return true;
    }
    catch {
      // Log error but continue to subscription check (fail-open for grant errors)
    }

    try {
      const hasSub = await this.hasActiveSubscription(accountId);
      return hasSub;
    }
    catch {
      // Fail-secure: deny access on subscription check error
      return false;
    }
  }
}
