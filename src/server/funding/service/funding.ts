import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Op, Transaction } from 'sequelize';
import config from 'config';
import {
  FundingSettings,
  ProviderConfig,
  FundingPlan,
  ProviderType,
  BillingCycle,
  FundingStatus,
  FundingPlanStatus,
  FUNDING_GATED_FEATURES,
  FundingGatedFeature,
} from '@/common/model/funding-plan';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { FundingSettingsEntity } from '@/server/funding/entity/funding_settings';
import { ProviderConfigEntity } from '@/server/funding/entity/provider_config';
import { FundingPlanEntity } from '@/server/funding/entity/funding_plan';
import { FundingEventEntity } from '@/server/funding/entity/funding_event';
import { ComplimentaryGrantEntity } from '@/server/funding/entity/complimentary_grant';
import { CalendarFundingPlanEntity } from '@/server/funding/entity/calendar_funding_plan';
import { AccountEntity, AccountRoleEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';
import { emitAfterTx } from '@/server/common/helper/emit-after-tx';
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
import { logError } from '@/server/common/helper/error-logger';
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
 * Sanitized provider info safe for client responses.
 * Never contains secret keys or webhook secrets.
 */
export interface ProviderInfo {
  id: string;
  providerType: ProviderType;
  displayName: string;
  publishableKey?: string;
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
      entity.pay_what_you_can_yearly_discount = settings.payWhatYouCanYearlyDiscount;
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
    displayName: string | undefined,
    enabled: boolean,
  ): Promise<boolean> {
    // Validate provider type
    if (providerType !== 'stripe' && providerType !== 'paypal') {
      throw new InvalidProviderTypeError();
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

    if (typeof displayName === 'string') {
      entity.display_name = displayName;
    }
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
    providers: ProviderInfo[];
    monthlyPrice: number;
    yearlyPrice: number;
    currency: string;
    payWhatYouCan: boolean;
    payWhatYouCanYearlyDiscount: number;
  }> {
    const settings = await this.getSettings();

    await this.ensureDefaultProviders();
    const entities = await ProviderConfigEntity.findAll({
      where: { enabled: true },
    });

    // Build sanitized provider info with publishable key extracted at the service layer
    const providers: ProviderInfo[] = entities.map((entity) => {
      const info: ProviderInfo = {
        id: entity.id,
        providerType: entity.provider_type,
        displayName: entity.display_name,
      };

      if (entity.provider_type === 'stripe') {
        try {
          const creds = JSON.parse(entity.decryptCredentials());
          const key = creds.publishableKey;
          if (typeof key === 'string' && (key.startsWith('pk_test_') || key.startsWith('pk_live_'))) {
            info.publishableKey = key;
          }
        }
        catch {
          // Malformed credentials — omit publishable key
        }
      }

      return info;
    });

    return {
      enabled: settings.enabled,
      providers,
      monthlyPrice: settings.monthlyPrice,
      yearlyPrice: settings.yearlyPrice,
      currency: settings.currency,
      payWhatYouCan: settings.payWhatYouCan,
      payWhatYouCanYearlyDiscount: settings.payWhatYouCanYearlyDiscount,
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
   * Check whether an account holds the instance admin role.
   *
   * @param accountId - Account ID to check
   * @returns True if the account is an instance admin
   */
  private async isAccountAdmin(accountId: string): Promise<boolean> {
    const adminRole = await AccountRoleEntity.findOne({
      where: {
        account_id: accountId,
        role: 'admin',
      },
    });

    return !!adminRole;
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

    // Build allowed origins from configured domain and server host
    const instanceDomain = config.get<string>('domain');
    const allowedOrigins = new Set<string>();

    // Add the configured federation domain
    allowedOrigins.add(
      instanceDomain.includes('localhost')
        ? `http://${instanceDomain}`
        : `https://${instanceDomain}`,
    );

    // Add the local server origin (covers dev where domain differs from listen address)
    const hostPort = config.get<number>('host.port');
    if (hostPort) {
      allowedOrigins.add(`http://localhost:${hostPort}`);
    }

    if (!allowedOrigins.has(parsed.origin)) {
      throw new ValidationError('returnUrl origin does not match this instance');
    }
  }

  /**
   * Calculate the total amount from all active calendar funding plan allocations
   *
   * @param fundingPlanId - Funding plan ID
   * @param tx - Optional transaction to read under, so the total reflects
   *   allocation writes made earlier in the same transaction
   * @returns Total amount in millicents
   */
  private async calculateActiveCalendarTotal(fundingPlanId: string, tx?: Transaction): Promise<number> {
    const activeCalendarSubs = await CalendarFundingPlanEntity.findAll({
      where: {
        funding_plan_id: fundingPlanId,
        end_time: { [Op.is]: null as any },
      },
      transaction: tx,
    });

    return activeCalendarSubs.reduce((sum, cs) => sum + cs.amount, 0);
  }

  /**
   * Update the funding plan amount at the payment provider
   *
   * Skips the provider call if the adapter does not support in-place amount updates
   * (e.g. PayPal funding plans have fixed amounts set at creation time).
   *
   * Deliberately called from *inside* the allocation transaction, which is the
   * opposite of how the rest of the codebase orders remote calls against
   * transactions. `processCheckoutCompleted` below calls `adapter.getSubscription`
   * before it opens its transaction, and `activitypub/service/members.ts`
   * (`addToOutbox` after `db.transaction`) fires outbound requests only after
   * commit. Both can do that because their remote call is either a read or an
   * operation that is safe to repeat.
   *
   * This one is neither. The provider amount is a function of the local
   * allocation rows, and nothing else ever recomputes it — there is no
   * reconciliation job, and `getFundingStatusForCalendar` grants `funded` on the
   * mere existence of an active allocation row without ever consulting the
   * provider. Committing the rows first and calling the provider after would
   * mean any provider failure permanently grants funded status for an amount
   * nobody is billing. Holding the transaction open across the call is the
   * cheaper exposure. Do not "fix" this by moving the call after commit unless
   * a reconciliation path exists to catch what it drops.
   *
   * @param fundingPlanEntity - Funding plan entity
   * @param newAmount - New total amount in millicents
   * @param tx - Optional transaction to read the provider config under
   */
  private async updateProviderAmount(
    fundingPlanEntity: FundingPlanEntity,
    newAmount: number,
    tx?: Transaction,
  ): Promise<void> {
    const providerEntity = await ProviderConfigEntity.findByPk(
      fundingPlanEntity.provider_config_id,
      { transaction: tx },
    );
    if (!providerEntity) {
      throw new Error('Provider configuration not found');
    }

    const adapter = ProviderFactory.getAdapter(providerEntity);

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
   * When a transaction is supplied the plan row is selected `FOR UPDATE`, which
   * serialises every allocation change against a single plan. Allocation totals
   * are computed by summing sibling rows, so two concurrent changes that lock
   * nothing conflict on nothing — neither the plan row nor the partial unique
   * index on (funding_plan_id, calendar_id) — and each computes its total from a
   * snapshot missing the other's insert. Both then push their total to the
   * provider, the later call wins, and the plan ends up with more funded
   * calendars than it is billing for. Taking the plan row lock first forces the
   * second caller to wait, and under READ COMMITTED its subsequent statements
   * then see the first caller's committed rows.
   *
   * SQLite ignores the lock clause (Sequelize omits it for dialects without
   * lock support), so this is a Postgres-only guarantee. SQLite's whole-database
   * write serialisation makes the race unreachable there anyway.
   *
   * @param accountId - Account ID
   * @param tx - Optional transaction; when supplied, the row is locked FOR UPDATE
   * @returns Active funding plan entity
   * @throws FundingPlanNotFoundError if no active funding plan exists
   */
  private async resolveActiveFundingPlan(accountId: string, tx?: Transaction): Promise<FundingPlanEntity> {
    const fundingPlanEntity = await FundingPlanEntity.findOne({
      where: { account_id: accountId, status: 'active' },
      transaction: tx,
      ...(tx ? { lock: Transaction.LOCK.UPDATE } : {}),
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
   * The plan lock, the duplicate check, the allocation row, and the provider
   * amount update run in one transaction. What that buys is local atomicity on
   * provider rejection: if the provider refuses the new total, the allocation
   * row is rolled back rather than left granting a calendar funded status the
   * provider is not billing for.
   *
   * It does not make the pair atomic in the other direction. The provider call
   * is a remote mutation that rollback cannot unwind, so a commit failure after
   * the provider accepted leaves the provider billing the new total with no
   * local allocation row — the account is charged for a calendar it did not get.
   * There is no compensation path for that window; it is accepted as the rarer
   * and less harmful of the two failure orderings, and it fails toward
   * over-charging rather than toward unbilled entitlement.
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

    await db.transaction(async (tx: Transaction) => {
      // Lock the plan row first: every read below derives the provider total
      // from it, so it must not move under a concurrent allocation change
      const fundingPlanEntity = await this.resolveActiveFundingPlan(accountId, tx);

      // Verify account owns the calendar
      await this.verifyCalendarOwnership(accountId, calendarId);

      // Check for existing active calendar funding plan
      const existing = await CalendarFundingPlanEntity.findOne({
        where: {
          funding_plan_id: fundingPlanEntity.id,
          calendar_id: calendarId,
          end_time: { [Op.is]: null as any },
        },
        transaction: tx,
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
      }, { transaction: tx });

      // Recalculate total and update provider
      const newTotal = await this.calculateActiveCalendarTotal(fundingPlanEntity.id, tx);
      await this.updateProviderAmount(fundingPlanEntity, newTotal, tx);
    });
  }

  /**
   * Remove a calendar from a funding plan
   *
   * Resolves the active funding plan for the account internally.
   * Sets end_time to the funding plan's current_period_end (calendar retains access until then).
   * Reduces the provider amount immediately. If this is the last active calendar,
   * cancels the entire funding plan.
   *
   * The plan lock, the end_time write, and the provider-side change (amount
   * update, or plan cancellation when the last calendar leaves) run in one
   * transaction, so a provider rejection rolls the end_time back rather than
   * dropping the calendar from a plan the provider is still billing in full.
   *
   * The lock also decides the last-calendar branch correctly under concurrency.
   * Two unlocked removals from a two-calendar plan would each see one remaining
   * allocation — neither can see the other's uncommitted end_time — so neither
   * would cancel, leaving an active plan billing for nothing.
   *
   * As on the add path, the provider call is a remote mutation that rollback
   * cannot unwind: a commit failure after the provider accepted leaves the
   * provider reduced or cancelled while the local plan stays `active` and the
   * calendar keeps reporting `funded`. That direction has no compensation path.
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

    await db.transaction(async (tx: Transaction) => {
      // Lock the plan row first: the remaining-active count below decides
      // whether the whole plan is cancelled, so it must not race
      const fundingPlanEntity = await this.resolveActiveFundingPlan(accountId, tx);

      // Verify account owns the calendar
      await this.verifyCalendarOwnership(accountId, calendarId);

      // Find the active calendar funding plan
      const calendarSub = await CalendarFundingPlanEntity.findOne({
        where: {
          funding_plan_id: fundingPlanEntity.id,
          calendar_id: calendarId,
          end_time: { [Op.is]: null as any },
        },
        transaction: tx,
      });

      if (!calendarSub) {
        throw new CalendarFundingPlanNotFoundError(fundingPlanEntity.id, calendarId);
      }

      // Set end_time to funding plan's current_period_end
      calendarSub.end_time = fundingPlanEntity.current_period_end;
      await calendarSub.save({ transaction: tx });

      // Check remaining active calendar funding plans
      const remainingActive = await CalendarFundingPlanEntity.findAll({
        where: {
          funding_plan_id: fundingPlanEntity.id,
          end_time: { [Op.is]: null as any },
        },
        transaction: tx,
      });

      if (remainingActive.length === 0) {
        // Last calendar removed: cancel the entire funding plan
        await this.cancel(fundingPlanEntity.id, false, tx);
      }
      else {
        // Recalculate total and update provider
        const newTotal = remainingActive.reduce((sum, cs) => sum + cs.amount, 0);
        await this.updateProviderAmount(fundingPlanEntity, newTotal, tx);
      }
    });
  }

  /**
   * Get all active calendar allocations for an account's funding plan
   *
   * Resolves the active funding plan for the account, then queries
   * CalendarFundingPlanEntity for active allocations (end_time IS NULL).
   * Returns an empty array if the account has no active funding plan
   * (does not throw an error).
   *
   * @param accountId - Account ID
   * @returns Array of active calendar allocations with calendarId, amount, and createdAt
   */
  async getCalendarsInFundingPlan(
    accountId: string,
  ): Promise<{ calendarId: string; amount: number; createdAt: Date }[]> {
    if (!isValidUUID(accountId)) {
      throw new ValidationError('Invalid accountId: must be a valid UUID');
    }

    const fundingPlanEntity = await FundingPlanEntity.findOne({
      where: { account_id: accountId, status: 'active' },
    });

    if (!fundingPlanEntity) {
      return [];
    }

    const activeAllocations = await CalendarFundingPlanEntity.findAll({
      where: {
        funding_plan_id: fundingPlanEntity.id,
        end_time: { [Op.is]: null as any },
      },
    });

    return activeAllocations.map((alloc) => ({
      calendarId: alloc.calendar_id,
      amount: alloc.amount,
      createdAt: alloc.created_at,
    }));
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
    if (await this.isAccountAdmin(ownerId)) {
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
    colorMode?: 'light' | 'dark',
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
    const adapter = ProviderFactory.getAdapter(stripeEntity);
    const params: CreateCheckoutSessionParams = {
      amount: checkoutAmount,
      currency: settings.currency,
      interval,
      accountId,
      calendarIds,
      returnUrl,
      colorMode,
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
    const adapter = ProviderFactory.getAdapter(stripeEntity);

    // Retrieve session status from provider
    const sessionStatus: CheckoutSessionStatus = await adapter.getCheckoutSessionStatus(sessionId);

    // IDOR check: compare metadata.accountId to requesting user
    // Return generic "not found" error (not 403) to avoid leaking session existence
    // Guard against missing metadata first to prevent empty/undefined bypass
    if (!sessionStatus.metadata.accountId || sessionStatus.metadata.accountId !== accountId) {
      throw new FundingPlanNotFoundError(sessionId);
    }

    // When the session is complete, eagerly create the funding plan instead of
    // waiting for the Stripe webhook. This closes the timing gap where the user
    // returns to the app before the webhook arrives (or in local dev where
    // webhooks never arrive without `stripe listen --forward-to`).
    // The idempotency check in processCheckoutCompleted prevents duplicate
    // creation if the webhook has already arrived or arrives later.
    if (sessionStatus.status === 'complete' && sessionStatus.subscriptionId) {
      await this.processCheckoutCompleted({
        eventId: `session_return_${sessionId}`,
        eventType: 'checkout.session.completed',
        subscriptionId: sessionStatus.subscriptionId,
        customerId: sessionStatus.customerId,
        accountId: sessionStatus.metadata.accountId,
        calendarIds: sessionStatus.metadata.calendarIds,
        rawPayload: { source: 'session_verification', sessionId },
      }, stripeEntity.id);
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
   * @param tx - Optional caller-owned transaction to enlist the status write in.
   *   Supplied by the allocation path when removing the last calendar, so a
   *   provider rejection rolls the allocation end_time and the local
   *   cancellation back together. The cancellation event is deferred until that
   *   transaction commits, so no listener acts on a cancellation that rolled
   *   back. Note the asymmetry: `adapter.cancelSubscription` runs before
   *   `entity.save()` and before commit, so if the provider succeeds and the
   *   commit then fails, Stripe has cancelled while the plan stays `active` and
   *   its calendars keep reporting `funded` — entitlement retained, billing
   *   stopped, with no compensation path.
   */
  async cancel(fundingPlanId: string, immediate: boolean = false, tx?: Transaction): Promise<void> {
    const entity = await FundingPlanEntity.findByPk(fundingPlanId, { transaction: tx });
    if (!entity) {
      throw new Error('Funding plan not found');
    }

    // Get provider configuration
    const providerEntity = await ProviderConfigEntity.findByPk(entity.provider_config_id, {
      transaction: tx,
    });
    if (!providerEntity) {
      throw new Error('Provider configuration not found');
    }

    const adapter = ProviderFactory.getAdapter(providerEntity);

    // Cancel via provider
    await adapter.cancelSubscription(entity.provider_subscription_id, immediate);

    // Update status
    entity.status = 'cancelled';
    entity.cancelled_at = new Date();
    await entity.save({ transaction: tx });

    // Emit event
    emitAfterTx(this.eventBus, 'funding:plan:cancelled', {
      fundingPlan: entity.toModel(),
      immediate,
    }, tx);
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

    const adapter = ProviderFactory.getAdapter(providerEntity);

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

    const adapter = ProviderFactory.getAdapter(stripeConfig);

    if (!adapter.verifyWebhookSignature(rawBody, signature)) {
      throw new WebhookSignatureError();
    }

    const webhookEvent = adapter.parseWebhookEvent(rawBody);
    await this.processWebhookEvent(webhookEvent, stripeConfig.id);
  }

  /**
   * Build the minimal JSON summary stored in FundingEventEntity.payload.
   *
   * Data minimization (DEC-004): the raw provider event carries customer
   * records, payment-method details and billing addresses that Pavillion has
   * no reason to retain. The event type, provider event ID and funding plan ID
   * all have their own columns, so only the resolved lifecycle status is kept
   * here — enough to reconstruct a plan's status history from the event log.
   *
   * @param status - Lifecycle status the event resolved to, if any
   * @returns JSON string safe to persist
   * @private
   */
  private summarizeProviderEvent(status: FundingPlanStatus | null): string {
    return JSON.stringify({ status });
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
    eventEntity.payload = this.summarizeProviderEvent(event.status ?? null);
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

    const adapter = ProviderFactory.getAdapter(providerEntity);
    const providerSubscription = await adapter.getSubscription(event.subscriptionId);

    // Determine billing cycle from provider subscription period
    const periodMs = providerSubscription.currentPeriodEnd.getTime()
      - providerSubscription.currentPeriodStart.getTime();
    const billingCycle: BillingCycle = periodMs > 60 * 24 * 60 * 60 * 1000 ? 'yearly' : 'monthly';

    // Parse and re-validate calendarIds from metadata before entering the transaction
    let ownedCalendarIds: string[] = [];
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
      for (const cId of validCalendarIds) {
        try {
          await this.verifyCalendarOwnership(event.accountId, cId);
          ownedCalendarIds.push(cId);
        }
        catch {
          // Calendar not owned by this account, skip it
        }
      }
    }

    // Wrap all mutations in a transaction to prevent orphaned records
    const fundingPlan = await db.transaction(async (t: Transaction) => {
      // Create local FundingPlan record
      const plan = new FundingPlan(uuidv4());
      plan.accountId = event.accountId!;
      plan.providerConfigId = providerConfigId;
      plan.providerSubscriptionId = event.subscriptionId!;
      plan.providerCustomerId = event.customerId!;
      plan.status = providerSubscription.status;
      plan.billingCycle = billingCycle;
      plan.amount = providerSubscription.amount;
      plan.currency = providerSubscription.currency;
      plan.currentPeriodStart = providerSubscription.currentPeriodStart;
      plan.currentPeriodEnd = providerSubscription.currentPeriodEnd;

      const entity = FundingPlanEntity.fromModel(plan);
      await entity.save({ transaction: t });

      // Log the checkout event
      const eventEntity = new FundingEventEntity();
      eventEntity.id = uuidv4();
      eventEntity.funding_plan_id = plan.id;
      eventEntity.event_type = event.eventType;
      eventEntity.provider_event_id = event.eventId;
      eventEntity.payload = this.summarizeProviderEvent(plan.status);
      eventEntity.processed_at = new Date();
      await eventEntity.save({ transaction: t });

      // Allocate funding to validated calendars
      if (ownedCalendarIds.length > 0) {
        const perCalendarAmount = Math.floor(plan.amount / ownedCalendarIds.length);

        for (const calendarId of ownedCalendarIds) {
          await CalendarFundingPlanEntity.create({
            id: uuidv4(),
            funding_plan_id: plan.id,
            calendar_id: calendarId,
            amount: perCalendarAmount,
            end_time: null,
          }, { transaction: t });
        }
      }

      return plan;
    });

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

  /**
   * Decide whether a calendar may use a funding-gated feature.
   *
   * This is the single access decision behind every funding gate. It applies
   * four invariants, in this order:
   *
   *  1. Funding is not enabled on this instance -> the gate is OPEN. An
   *     operator who has not turned funding on runs an instance with no paid
   *     tier, so no feature may be withheld (DEC-001 instance autonomy).
   *  2. The calendar's owner is an instance admin -> open.
   *  3. An active complimentary grant, or a funding plan allocation that has
   *     not passed its access boundary -> open. The boundary comes from the
   *     plan's own dates rather than its webhook-driven status, so a missed
   *     customer.subscription.deleted cannot grant access indefinitely.
   *  4. Funding is enabled but the answer is indeterminate (database error,
   *     credential decrypt failure, provider unreachable) -> CLOSED. "Cannot
   *     tell" is not "has access".
   *
   * Note the deliberate split in invariants 1 and 4: a *known* absence of
   * funding opens gates, an *unknown* funding state closes them. Neither is
   * the ambiguous "fail-secure" the earlier hasFundingAccess implemented,
   * which had no notion of an instance with funding switched off.
   *
   * Where invariants 3 and 4 meet, the tie-break is: **a determinate allow
   * beats an indeterminate sibling read.** The admin, grant and plan checks
   * are read independently; one of them failing means "unknown from that
   * source", never a denial of what another source can still answer. A
   * complimentary-grant table that is unreadable must not deny a calendar with
   * a healthy paid allocation. The gate closes only when no source produced an
   * allow.
   *
   * Constraint on consumers (middleware, API handlers, upsell UI): a denial
   * from this method is not always "unfunded". When the instance-level funding
   * state itself could not be read, the denial is a server-side failure and
   * must surface as a server error — never as 402 / SubscriptionRequiredError,
   * which would tell an operator to buy something to fix our outage.
   *
   * The feature key carries no policy of its own today — every gated feature
   * is decided the same way — but it is validated against the registry so an
   * unregistered key can never be answered, and so per-feature policy has a
   * place to live if it is ever needed.
   *
   * @param calendarId - Calendar the feature would be used on
   * @param feature - Key from FUNDING_GATED_FEATURES naming the gated feature
   * @returns True if the gate is open for this calendar
   * @throws ValidationError if calendarId is not a UUID or feature is not a
   *   registered funding-gated feature
   */
  async checkFundingAccess(calendarId: string, feature: FundingGatedFeature): Promise<boolean> {
    if (!isValidUUID(calendarId)) {
      throw new ValidationError('Invalid calendarId: must be a valid UUID');
    }

    if (!Object.prototype.hasOwnProperty.call(FUNDING_GATED_FEATURES, feature)) {
      throw new ValidationError('Unknown funding-gated feature');
    }

    // Invariant 1: funding not enabled on this instance -> all gates open.
    let settings: FundingSettings;
    try {
      settings = await this.getSettings();
    }
    catch (error) {
      // Invariant 4, instance scope: we cannot establish that funding is
      // switched off, so we cannot open the gate on that basis either. This is
      // the denial that consumers must report as a server error.
      logError(error, 'checkFundingAccess: instance funding settings unreadable, closing gate');
      return false;
    }

    if (!settings.enabled) {
      return true;
    }

    // Invariant 2: admin-owned calendars are exempt.
    if (await this.readAccessSource(
      () => this.isCalendarOwnerAdmin(calendarId),
      'checkFundingAccess: calendar owner admin check unreadable',
    )) {
      return true;
    }

    // Invariant 3: an active grant, or a plan allocation still inside its
    // access boundary.
    if (await this.readAccessSource(
      () => this.hasActiveGrant(calendarId),
      'checkFundingAccess: complimentary grant lookup unreadable',
    )) {
      return true;
    }

    return this.readAccessSource(
      () => this.hasQualifyingFundingPlan(calendarId, settings.gracePeriodDays),
      'checkFundingAccess: funding plan lookup unreadable',
    );
  }

  /**
   * Read one source of funding access, treating a failure as "this source
   * cannot answer" rather than as a denial.
   *
   * Keeping each source independent is what implements the tie-break rule in
   * checkFundingAccess: an unreadable source contributes no allow, but it also
   * never suppresses the allow a sibling source can still produce. With no
   * allow from any source the gate closes, so a failure can only ever cost
   * access it was not able to justify.
   *
   * @param read - The access check to run
   * @param context - Log context describing which source failed
   * @returns The check's answer, or false if it could not be read
   */
  private async readAccessSource(read: () => Promise<boolean>, context: string): Promise<boolean> {
    try {
      return await read();
    }
    catch (error) {
      logError(error, context);
      return false;
    }
  }

  /**
   * Check whether a calendar's owner is an instance admin.
   *
   * @param calendarId - Calendar ID to check
   * @returns True if the calendar has a resolvable owner holding the admin role
   */
  private async isCalendarOwnerAdmin(calendarId: string): Promise<boolean> {
    if (!this.calendarInterface) {
      return false;
    }

    const ownerId = await this.calendarInterface.getCalendarOwnerAccountId(calendarId);

    return ownerId ? this.isAccountAdmin(ownerId) : false;
  }

  /**
   * Check whether the calendar has a funding plan allocation that still grants
   * access: an active allocation, on an active plan, inside the plan's access
   * boundary.
   *
   * Stricter than hasActiveFundingPlan, which trusts the plan's status alone
   * and therefore keeps granting access to a plan whose ending was never
   * reported to us.
   *
   * @param calendarId - Calendar ID to check
   * @param gracePeriodDays - Instance grace period applied after the paid-through date
   * @returns True if a funding plan allocation currently grants access
   */
  private async hasQualifyingFundingPlan(calendarId: string, gracePeriodDays: number): Promise<boolean> {
    const allocation = await CalendarFundingPlanEntity.findOne({
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

    if (!allocation?.fundingPlan) {
      return false;
    }

    const expiry = this.planAccessExpiry(allocation.fundingPlan, gracePeriodDays);

    return expiry === null || Date.now() < expiry.getTime();
  }

  /**
   * The instant at which a funding plan stops granting access to its
   * calendars, or null if nothing on the plan sets an end.
   *
   * Two candidate boundaries are considered and the EARLIEST wins, because a
   * gate helper must never round permissive:
   *
   *  - cancelled_at, the recorded cancellation. An immediate cancellation ends
   *    access when it happens, even though the interrupted billing period may
   *    still have weeks to run. pv-jdot.3.1 adds an explicit cancel_at for
   *    cancel-at-period-end plans, and this is where it joins the list.
   *  - current_period_end plus the instance grace period. This is the boundary
   *    written on the happy path, on every renewal, so it is the one that
   *    still applies when a cancellation is never reported to us at all — the
   *    silent-renewal-failure and missed-deletion cases. The grace period is
   *    the same window suspendExpiredFundingPlans uses, so a customer in
   *    dunning is not cut off before the instance's own policy says so.
   *
   * @param plan - Funding plan the allocation belongs to
   * @param gracePeriodDays - Instance grace period applied after the paid-through date
   * @returns Access expiry instant, or null if the plan sets none
   */
  private planAccessExpiry(plan: FundingPlanEntity, gracePeriodDays: number): Date | null {
    const graceMs = Math.max(gracePeriodDays, 0) * 24 * 60 * 60 * 1000;

    const boundaries = [
      plan.cancelled_at,
      plan.current_period_end
        ? new Date(plan.current_period_end.getTime() + graceMs)
        : null,
    ].filter((boundary): boundary is Date => boundary instanceof Date);

    if (boundaries.length === 0) {
      return null;
    }

    return boundaries.reduce((earliest, boundary) => boundary < earliest ? boundary : earliest);
  }

  /**
   * Get the funding-plan status for a set of calendars in bulk.
   *
   * Issues two bulk IN queries (one against complimentary grants, one against
   * calendar funding plans) so the cost is constant regardless of the number
   * of calendar IDs provided. No per-ID loop over single-calendar helpers.
   *
   * Calendars with no matching record are intentionally omitted from the
   * returned Map — callers (e.g. admin calendar listing) default to 'none'
   * on lookup miss. Grant takes priority over funding plan when both exist
   * for the same calendar, matching the precedence used by
   * hasFundingAccess / getFundingStatusForCalendar.
   *
   * Returns enum values only; no FundingPlan / CalendarFundingPlan /
   * ComplimentaryGrant entities cross the boundary.
   *
   * @param ids - Calendar IDs to look up
   * @returns Map of calendar_id -> 'subscribed' | 'grant' | 'none'; unknown
   *          IDs are absent from the map
   */
  async getPlanStatusForCalendars(
    ids: string[],
  ): Promise<Map<string, 'subscribed' | 'grant' | 'none'>> {
    const result = new Map<string, 'subscribed' | 'grant' | 'none'>();

    if (!ids || ids.length === 0) {
      return result;
    }

    const now = new Date();

    // Bulk query 1: active complimentary grants (takes precedence)
    const grants = await ComplimentaryGrantEntity.findAll({
      where: {
        calendar_id: { [Op.in]: ids },
        revoked_at: { [Op.is]: null as any },
        [Op.or]: [
          { expires_at: { [Op.is]: null as any } },
          { expires_at: { [Op.gt]: now } },
        ],
      },
      attributes: ['calendar_id'],
    });

    for (const grant of grants) {
      if (grant.calendar_id) {
        result.set(grant.calendar_id, 'grant');
      }
    }

    // Bulk query 2: active calendar funding plan allocations
    const calendarSubs = await CalendarFundingPlanEntity.findAll({
      where: {
        calendar_id: { [Op.in]: ids },
        [Op.or]: [
          { end_time: { [Op.is]: null as any } },
          { end_time: { [Op.gt]: now } },
        ],
      },
      attributes: ['calendar_id'],
      include: [{
        model: FundingPlanEntity,
        where: { status: 'active' },
        required: true,
        attributes: [],
      }],
    });

    for (const sub of calendarSubs) {
      // Grant precedence: only set 'subscribed' if no grant was recorded
      if (sub.calendar_id && !result.has(sub.calendar_id)) {
        result.set(sub.calendar_id, 'subscribed');
      }
    }

    return result;
  }
}
