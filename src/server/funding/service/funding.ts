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
  CalendarFundingSummary,
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
import { AccountEntity } from '@/server/common/entity/account';
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
  FundingAccessIndeterminateError,
} from '@/common/exceptions/funding';
import { ValidationError } from '@/common/exceptions/base';
import { buildProviderIdempotencyKey } from '@/server/funding/service/provider/idempotency';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';
import { isValidUuidV4 as isValidUUID } from '@/server/common/helper/uuid';
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';

const logger = createLogger('funding');

// Maximum number of calendar IDs allowed in a single coverage-change call
export const MAX_CALENDAR_IDS = 50;

// Checkout session ID format: cs_test_ or cs_live_ prefix, then 1-190 alphanumeric/underscore chars
const CHECKOUT_SESSION_ID_REGEX = /^cs_(test|live)_[a-zA-Z0-9_]{1,190}$/;

// PWYC amount bounds in millicents
export const MIN_PWYC_AMOUNT = 100000; // $1.00
export const MAX_PWYC_AMOUNT = 10000000000; // $100,000.00

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
  private accountsInterface?: AccountsInterface;

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
   * Injects AccountsInterface for cross-domain account role checks.
   *
   * @param accountsInterface - The AccountsInterface instance from the accounts domain
   */
  setAccountsInterface(accountsInterface: AccountsInterface): void {
    this.accountsInterface = accountsInterface;
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
   * Read the instance funding settings for a decision that cannot proceed
   * without them, converting an unreadable read into the indeterminate signal.
   *
   * Every path that reports or gates funding needs the same two things from
   * this row — whether the instance charges at all, and the grace period the
   * access boundary is measured with — and none of them can answer safely
   * without it. Failing to read it is therefore never "not covered": it is "we
   * cannot say", and it is thrown as {@link FundingAccessIndeterminateError} so
   * a consumer branching on that class (see CalendarService's widget gate)
   * cannot answer it commercially with a 402.
   *
   * Routing all of these reads through one helper is what keeps the error
   * identity independent of ordering. getCalendarFundingSummary reads the
   * settings three times over — once for the display status, once for the
   * dates, once per gated feature inside checkFundingAccess — and before this
   * existed only the checkFundingAccess read produced the declared class, so
   * which error a consumer saw depended on which identical read happened to
   * run first.
   *
   * @param context - Log context describing the decision that needed settings
   * @returns The instance funding settings
   * @throws FundingAccessIndeterminateError if the settings could not be read
   */
  private async settingsForFundingDecision(context: string): Promise<FundingSettings> {
    try {
      return await this.getSettings();
    }
    catch (error) {
      logError(error, context);
      throw new FundingAccessIndeterminateError(
        'Instance funding settings could not be read',
      );
    }
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
      // Fixed message: this reaches the caller verbatim via sendValidationError,
      // so it must not echo the account or calendar id back in the body.
      throw new ValidationError('Account does not own calendar');
    }
  }

  /**
   * Check whether an account holds the instance admin role, asking the
   * accounts domain via AccountsInterface.
   *
   * Errors from the accounts domain propagate to the caller, which decides
   * what an unanswerable check means for its own decision.
   *
   * @param accountId - Account ID to check
   * @returns True if the account is an instance admin
   */
  private async isAccountAdmin(accountId: string): Promise<boolean> {
    if (!this.accountsInterface) {
      return false;
    }

    return this.accountsInterface.accountIsAdmin(accountId);
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
   * reconciliation job, and `getFundingStatusForCalendar` grants `covered` on
   * the mere existence of an active allocation row without ever consulting the
   * provider. Committing the rows first and calling the provider after would
   * mean any provider failure permanently grants covered status for an amount
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
      { idempotencyKey: buildProviderIdempotencyKey('plan-amount', fundingPlanEntity.id) },
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
   * provider, the later call wins, and the plan ends up covering more
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
   * row is rolled back rather than left granting a calendar covered status the
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

    // Validate amount: same floor as the checkout path, so an allocation can
    // never cover a calendar for less than checkout would have charged
    if (!Number.isInteger(amount)) {
      throw new InvalidAmountError('Amount must be a positive integer in millicents');
    }
    if (amount < MIN_PWYC_AMOUNT) {
      throw new InvalidAmountError(`Amount must be at least ${MIN_PWYC_AMOUNT} millicents ($1.00)`);
    }

    await db.transaction(async (tx: Transaction) => {
      // Lock the plan row first: every read below derives the provider total
      // from it, so it must not move under a concurrent allocation change
      const fundingPlanEntity = await this.resolveActiveFundingPlan(accountId, tx);

      // Verify account owns the calendar
      await this.verifyCalendarOwnership(accountId, calendarId);

      // Scoped to the calendar, not to this plan. The invariant, and the unique
      // index that now carries it, are that a calendar has one open allocation
      // anywhere — so a check scoped to `funding_plan_id` would pass on a
      // calendar already open under a *different* plan and hand the index an
      // insert it must reject.
      //
      // That is a reachable purchase, not a corrupt-database hypothetical: a
      // plan that goes `suspended` keeps its allocations open, and a suspended
      // plan neither blocks a fresh checkout nor gets its calendars closed. So
      // an account can hold a live plan while a stranded row from the suspended
      // one still covers the calendar it is now trying to add.
      const openElsewhere = await CalendarFundingPlanEntity.findOne({
        where: {
          calendar_id: calendarId,
          end_time: { [Op.is]: null as any },
        },
        transaction: tx,
      });

      if (openElsewhere?.funding_plan_id === fundingPlanEntity.id) {
        // Already covered by the plan being added to: the caller's request is
        // genuinely a duplicate.
        throw new DuplicateCalendarFundingPlanError(fundingPlanEntity.id, calendarId);
      }

      if (openElsewhere) {
        // Coverage moves to the plan the account actually holds, the same way
        // it moves on a fresh checkout (processCheckoutCompleted). Refusing
        // instead would be a dead end rather than a safeguard: the calendar
        // would be uncoverable by any plan, because removeCalendarFromFundingPlan
        // only looks under the *active* plan and would answer 404 for a row
        // stranded on the old one.
        //
        // Deliberately local. The superseded plan's provider-side total is not
        // adjusted from here: this transaction does not hold its row, and it is
        // a plan already in a failed billing state whose provider reconciliation
        // belongs to pv-ez63. What is fixed here is that the local record stops
        // claiming two plans cover one calendar.
        //
        // Close-and-insert, never re-parent — and that is a lock-ordering
        // constraint, not a style choice. Writing only `end_time` leaves the
        // funding_plan_id FK untouched, so Postgres never re-checks it and never
        // takes FOR KEY SHARE on the superseded plan's row. Re-parenting this row
        // instead would take that lock, and this path already holds its own plan
        // row FOR UPDATE — giving a genuine cycle against cancel() and
        // processWebhookEvent, which lock a plan row and then its allocations.
        openElsewhere.end_time = new Date();
        await openElsewhere.save({ transaction: tx });
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
   * calendar keeps reporting `covered`. That direction has no compensation path.
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

      // Covered through the date already paid for. `?? new Date()` for the same
      // reason cancel() needs it: current_period_end is nullable, and a null
      // written here would leave the row open — the removal would report
      // success while the calendar stayed covered, still counted towards the
      // plan's total, and still blocking the calendar from any other plan.
      calendarSub.end_time = fundingPlanEntity.current_period_end ?? new Date();
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
   * Describe how a calendar is currently covered, for its owner.
   *
   * Checks in priority order: ownership verification, admin exemption, active
   * grant, qualifying funding plan allocation.
   *
   * ## Relationship to checkFundingAccess — read this before using the result
   *
   * The funding domain holds several predicates that each answer a version of
   * "is this calendar entitled", and they are NOT interchangeable:
   *
   *  - {@link checkFundingAccess} — the gate. The only one that decides
   *    whether a feature may be used.
   *  - this method — the display status of one calendar, for its owner.
   *  - {@link getPlanStatusForCalendars} — a separate bulk vocabulary
   *    ('subscribed' | 'grant' | 'none') for admin listings, deliberately not
   *    migrated to FundingStatus. Plan status only, no access boundary.
   *  - {@link hasActiveFundingPlan} / {@link hasFundingAccess} — deprecated
   *    legacy baselines kept only for the parity test. Do not call.
   *
   * This method and the gate now apply the SAME rule to grants and to plan
   * allocations: both go through hasActiveGrant and hasQualifyingFundingPlan,
   * so a plan that has passed its access boundary — cancelled, or past its
   * paid-through date plus grace, whether or not Stripe ever told us — reports
   * `not_covered` here exactly as the gate denies it. Before this was aligned,
   * this method read the allocation row alone with no join to the plan's
   * status and no boundary, so a calendar whose plan had been cancelled was
   * displayed as `covered` while every gate refused it.
   *
   * Two divergences remain. Both are cases the gate distinguishes and
   * FundingStatus does not, and leaving the union at four values is a choice,
   * not a constraint — the union is defined one directory over and this epic
   * edits it freely. A fifth value would have to be named in the client's copy
   * of the type, rendered by settings.vue's status branches and given an i18n
   * key in every locale, for two states that screen already suppresses: it does
   * not render the funding section at all when funding is off, and an
   * indeterminate read never reaches it because the endpoint answers 500. The
   * cost is real and the benefit is currently zero — but a consumer that does
   * need to tell these apart should extend the union rather than infer them
   * from `not_covered`, which is why they are recorded here:
   *
   *  1. Instance funding switched off. The gate opens every feature
   *     (invariant 1, DEC-001 instance autonomy); this method still reports the
   *     calendar's own coverage, which is normally `not_covered`. A new
   *     consumer must not read `not_covered` here as "this calendar may not
   *     use feature X".
   *  2. Indeterminate reads. The gate throws FundingAccessIndeterminateError
   *     rather than returning a denial it cannot substantiate. This method has
   *     no third value, so it does not swallow the failure into `not_covered`
   *     either: an unreadable settings row propagates as that same error class
   *     and the endpoint answers 500. Reporting `not_covered` during our own
   *     outage would invite an operator to pay to fix it.
   *  3. Display-only read failures. The gate wraps each of its sources in
   *     readAccessSource so that a determinate allow beats an indeterminate
   *     sibling read; this method leaves the same reads (grant table, plan
   *     allocation) unguarded, for the reason in 2. So an unreadable grant
   *     table with a healthy paid allocation is a case where the gate still
   *     allows and this method throws. getCalendarFundingSummary therefore
   *     takes the gate's answer first, in isolation, and withholds the status
   *     (null) when this method fails — the display half degrades, the
   *     access half does not. It does not wrap this method in
   *     readAccessSource, which would reintroduce "unreadable displays as
   *     unfunded".
   *
   * The consequence for callers: use {@link getCalendarFundingSummary}'s
   * `features` — never this status — to decide what a calendar may do.
   *
   * @param accountId - Account ID requesting the funding status (must own the calendar)
   * @param calendarId - Calendar ID to check
   * @returns Funding status: 'admin_exempt' | 'grant' | 'covered' | 'not_covered'
   * @throws ValidationError if accountId does not own the calendar
   * @throws FundingAccessIndeterminateError if the instance funding settings
   *   could not be read — a server-side failure, never a "not covered" answer
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

    return this.resolveFundingStatus(calendarId);
  }

  /**
   * The display-status rules behind getFundingStatusForCalendar, with no
   * ownership check of their own. Split out so getCalendarFundingSummary can
   * verify ownership once, take the gate's answer first, and then run these
   * reads in isolation — see the third divergence in that method's note.
   *
   * @param calendarId - Calendar ID to check (already validated and owned)
   * @returns Funding status: 'admin_exempt' | 'grant' | 'covered' | 'not_covered'
   * @throws FundingAccessIndeterminateError if the instance funding settings
   *   could not be read
   */
  private async resolveFundingStatus(calendarId: string): Promise<FundingStatus> {
    // Neither guard below is reachable, and neither is a funding decision:
    // verifyCalendarOwnership has already thrown if calendarInterface is
    // absent, and it only returns having found an owner membership row — the
    // same rows getCalendarOwnerAccountId reads. They are kept to narrow the
    // optional interface and to stay fail-closed rather than crash if that
    // ever stops holding. The funding rules start below.
    if (!this.calendarInterface) {
      return 'not_covered';
    }

    // Find the calendar owner via CalendarInterface
    const ownerId = await this.calendarInterface.getCalendarOwnerAccountId(calendarId);

    if (!ownerId) {
      return 'not_covered';
    }

    // Check if owner is admin
    if (await this.isAccountAdmin(ownerId)) {
      return 'admin_exempt';
    }

    // Check for active grant targeting this calendar
    const hasGrant = await this.hasActiveGrant(calendarId);

    if (hasGrant) {
      return 'grant';
    }

    // Same predicate the gate applies, so a plan past its access boundary is
    // not displayed as covered while every feature refuses it.
    const settings = await this.settingsForFundingDecision(
      'getFundingStatusForCalendar: instance funding settings unreadable',
    );

    if (await this.hasQualifyingFundingPlan(calendarId, settings.gracePeriodDays)) {
      return 'covered';
    }

    return 'not_covered';
  }

  /**
   * Everything the owner of a calendar may be told about its coverage.
   *
   * Composes the display status with the gate's per-feature decisions. Both
   * halves are here on purpose: they can disagree (see
   * getFundingStatusForCalendar), and a consumer holding only one of them
   * would be guessing at the other.
   *
   * The gate is computed first and in isolation; the display status is then
   * read on its own and withheld (`status: null`) if that read fails. A
   * display-only failure therefore never costs the owner the features the
   * gate would have allowed (divergence 3 on getFundingStatusForCalendar).
   *
   * The summary deliberately carries no plan dates. `currentPeriodEnd` and
   * `accessExpiresAt` were once reported here, but nothing client-side ever
   * read them, and unread wire surface sits against DEC-004's send-what-is-
   * needed posture while drifting untested. Cancel-at-period-end gave the
   * client its first reason to display an access boundary, and that boundary
   * is surfaced on the *account-level* plan status (GET /v1/status, which
   * carries `cancelAt`) rather than being reintroduced here: it is a property
   * of the plan the account holds, and the calendar screen has no question it
   * answers. Should a per-calendar consumer ever appear, reintroduce the
   * fields together with it — the plan lookup they need is
   * qualifyingFundingPlan plus planAccessExpiry, both still exercised by
   * checkFundingAccess.
   *
   * @param accountId - Account ID requesting the summary (must own the calendar)
   * @param calendarId - Calendar ID to describe
   * @returns The calendar's coverage status (null if unreadable) and feature decisions
   * @throws ValidationError if accountId does not own the calendar
   * @throws FundingAccessIndeterminateError if the gate could not read the
   *   instance funding settings — a server-side failure, never a "not
   *   covered" answer
   */
  async getCalendarFundingSummary(accountId: string, calendarId: string): Promise<CalendarFundingSummary> {
    if (!isValidUUID(calendarId)) {
      throw new ValidationError('Invalid calendarId: must be a valid UUID');
    }

    if (!isValidUUID(accountId)) {
      throw new ValidationError('Invalid accountId: must be a valid UUID');
    }

    // Verify ownership - throws ValidationError if not owner
    await this.verifyCalendarOwnership(accountId, calendarId);

    // The gate goes first and alone. Its answer is the authoritative half of
    // this response and it carries its own partial-failure tolerance, so
    // nothing the display path reads may run before it or throw over it.
    const featureKeys = Object.keys(FUNDING_GATED_FEATURES) as FundingGatedFeature[];
    const decisions = await Promise.all(
      featureKeys.map((feature) => this.checkFundingAccess(calendarId, feature)),
    );

    // The display status is read in isolation: a failure here withholds the
    // status (null) and never touches the decisions above. It is not run
    // through readAccessSource — that would display an unreadable calendar
    // as `not_covered`, which divergence 2 rejects.
    let status: FundingStatus | null;
    try {
      status = await this.resolveFundingStatus(calendarId);
    }
    catch (error) {
      logError(error, 'getCalendarFundingSummary: coverage status unreadable, withholding it');
      status = null;
    }

    return {
      status,
      features: Object.fromEntries(
        featureKeys.map((feature, index) => [feature, decisions[index]]),
      ) as Record<FundingGatedFeature, boolean>,
    };
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
    // Validate billing cycle
    if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
      throw new InvalidBillingCycleError();
    }

    // Validate return URL origin (defense in depth)
    this.validateReturnUrlOrigin(returnUrl);

    // One account, one plan. A plan that is winding down towards its `cancel_at`
    // boundary is still that one plan and still blocks a second: it is active,
    // it is being honoured, and its calendars are covered by it.
    //
    // Which leaves the resubscribe-during-the-cancellation-window case, and the
    // answer to that is NOT to relax this gate. A customer who changes their
    // mind before the boundary should have the pending cancellation *reversed*
    // on the plan they already hold — clear `cancel_at` and send
    // `cancel_at_period_end: false` to the provider — so they resume rather than
    // accumulate a second subscription. That path belongs to pv-jdot.3.3; this
    // gate is what holds the invariant until it lands.
    //
    // What this gate actually provides is the common case, and no more. It is
    // an unlocked read one or more HTTP round trips before the only site that
    // creates a plan (processCheckoutCompleted), and `funding_plan` carries no
    // unique constraint on account_id, provider_subscription_id or
    // provider_event_id to catch what slips past. At least three routes reach
    // two plans on one account anyway: concurrent creation for a single
    // subscription, two checkout sessions paid in parallel, and a suspended
    // plan revived through the billing portal after a second was bought — the
    // terminal-status guard in processWebhookEvent does not cover that last one
    // because it only pins 'cancelled'. Closing those needs a database-level
    // constraint and a decision about what to do with the loser; pv-ez63 owns
    // it.
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

    return adapter.createCheckoutSession(params, {
      idempotencyKey: buildProviderIdempotencyKey('checkout-session', accountId),
    });
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
   * The two modes end entitlement at different instants, and the local row has
   * to say which:
   *
   *  - `immediate` — access ends now. Status goes to 'cancelled', `cancelled_at`
   *    records it, and the plan's open calendar allocations are closed in the
   *    same transaction. The allocation close has to happen here rather than
   *    waiting for `customer.subscription.deleted`, because that event arrives
   *    to find the plan already 'cancelled' and so cannot be what finalizes it.
   *  - period-end (the default, and what the user-facing cancel button does) —
   *    the customer has paid through `current_period_end` and keeps every
   *    entitlement until then. The status therefore stays 'active' and the
   *    boundary is recorded in `cancel_at`. Writing 'cancelled' here instead
   *    revoked access the customer had paid for, and did not even stick: the
   *    provider's next `customer.subscription.updated` reports a period-end
   *    cancellation as status "active" (that is what one looks like on the
   *    wire), so processWebhookEvent copied 'active' back over it and the
   *    entity hook then cleared `cancelled_at`, leaving a row identical to one
   *    that was never cancelled.
   *
   * `cancelled_at` is deliberately NOT written for a period-end cancellation.
   * It is a request timestamp, and planAccessExpiry would read one on an
   * 'active' plan as an access boundary — revoking at the instant the customer
   * clicked cancel, which is precisely what this mode exists to avoid.
   *
   * Finalization to 'cancelled' is the provider's to report: it arrives as
   * `customer.subscription.deleted` and is applied by processWebhookEvent.
   *
   * A lost deletion event costs the customer no access they paid for — the
   * `cancel_at` boundary bounds that on its own, with no webhook involved — but
   * it is not free. The plan is left `active` forever with an elapsed boundary,
   * and nothing reaps that: the checkout gate keys on status, so the account
   * cannot buy a replacement plan, and its calendars are covered by nothing.
   * A sweep that finalizes plans whose `cancel_at` has passed is the missing
   * half; pv-6g42 owns it.
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
   *   its calendars keep reporting `covered` — entitlement retained, billing
   *   stopped, with no compensation path.
   *
   * The plan row is resolved FOR UPDATE (in the caller's transaction, or in
   * one opened here for a standalone cancel) *before* the provider call, so a
   * cancel racing an allocation change queues behind it instead of cancelling
   * at the provider while the other transaction is still pushing a new total.
   * Same Postgres-only caveat as `resolveActiveFundingPlan`.
   */
  async cancel(fundingPlanId: string, immediate: boolean = false, tx?: Transaction): Promise<void> {
    const run = async (t: Transaction): Promise<void> => {
      const entity = await FundingPlanEntity.findByPk(fundingPlanId, {
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!entity) {
        throw new Error('Funding plan not found');
      }

      // Get provider configuration
      const providerEntity = await ProviderConfigEntity.findByPk(entity.provider_config_id, {
        transaction: t,
      });
      if (!providerEntity) {
        throw new Error('Provider configuration not found');
      }

      const adapter = ProviderFactory.getAdapter(providerEntity);

      // Cancel via provider
      await adapter.cancelSubscription(entity.provider_subscription_id, immediate, {
        idempotencyKey: buildProviderIdempotencyKey('plan-cancel', entity.id),
      });

      if (immediate) {
        entity.status = 'cancelled';
        entity.cancelled_at = new Date();
      }
      else {
        // Paid through the period end, so that is when access stops. A plan
        // with no recorded period end has no paid-through date to run to, so
        // the cancellation takes effect now rather than never.
        entity.cancel_at = entity.current_period_end ?? new Date();
      }

      await entity.save({ transaction: t });

      if (immediate) {
        // An immediate cancellation ends here, not at a later provider event:
        // the plan is already 'cancelled', so the deletion webhook that
        // eventually arrives finds nothing to transition and would leave every
        // allocation open forever. Coverage ended now, so that is the end_time.
        await this.endCalendarAllocations(entity.id, null, t);
      }

      // Emit event
      emitAfterTx(this.eventBus, 'funding:plan:cancelled', {
        fundingPlan: entity.toModel(),
        immediate,
      }, t);
    };

    if (tx) {
      await run(tx);
    }
    else {
      await db.transaction(run);
    }
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

    return adapter.getBillingPortalUrl(fundingPlan.providerCustomerId, returnUrl, {
      idempotencyKey: buildProviderIdempotencyKey('billing-portal', fundingPlan.id),
    });
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

    // Fetch account emails in a single batch query for admin display
    const accountIds = [...new Set(rows.map((row) => row.account_id))];
    const accounts = accountIds.length > 0
      ? await AccountEntity.findAll({
        where: { id: accountIds },
        attributes: ['id', 'email'],
      })
      : [];
    const emailByAccountId = new Map(accounts.map((a) => [a.id, a.email]));

    return {
      fundingPlans: rows.map((entity) => {
        const plan = entity.toModel();
        plan.accountEmail = emailByAccountId.get(entity.account_id);
        return plan;
      }),
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
   * Two rules govern how a provider event may move a local plan:
   *
   *  - 'cancelled' is terminal here. A provider that reports any other status
   *    for a plan already cancelled locally is ignored, not applied. The
   *    provider genuinely sends such events — a period-end cancellation is
   *    reported as status "active" — and applying one would resurrect a
   *    cancelled plan and, through the entity's status-transition hook, wipe
   *    its `cancelled_at` as well. Resubscribing creates a new plan
   *    (processCheckoutCompleted); it never revives a cancelled one, so
   *    nothing legitimate needs this transition.
   *  - A plan that is 'cancelled' once the event has been applied is finalized:
   *    the calendar allocations it was paying for get their `end_time` written,
   *    so the coverage record shows when it actually ended rather than staying
   *    open forever behind a plan that no longer grants anything. Keyed on the
   *    resulting status rather than on the transition into it, so the write is
   *    idempotent (it matches only allocations still open) and so a plan
   *    cancelled by some path that left its allocations open is repaired by the
   *    next event it receives.
   *
   * Everything after the dedupe check runs in ONE transaction, including the
   * plan read. The read takes `FOR UPDATE`, because the guard above is a
   * read-then-write on a contended row: the provider delivers concurrently, and
   * a handler that evaluated `previousStatus` against a snapshot taken before a
   * sibling handler committed a cancellation would write its own stale status
   * straight over that cancellation — Sequelize marks the column dirty against
   * the snapshot it loaded, so the UPDATE lands. `cancel()` locks this row for
   * the same reason.
   *
   * The `funding_event` dedupe row is enlisted in that transaction rather than
   * committed ahead of it. Committed first, a mutation that then failed would
   * be unrecoverable: the provider's retry would match the dedupe row, return
   * early, and the cancellation would never be applied — no status change, no
   * `end_time`, and nothing to reconcile from. Sharing the transaction means a
   * failed mutation takes the dedupe row with it and the retry does the work.
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

    await db.transaction(async (t: Transaction) => {
      // Find the local FundingPlan by provider subscription ID before logging,
      // so we can store the local UUID (not the Stripe sub_xxx ID) in the
      // funding_plan_id FK. Locked, so the status guard below decides on state
      // no concurrent handler can move underneath it.
      const fundingPlanRecord = event.subscriptionId
        ? await FundingPlanEntity.findOne({
          where: {
            provider_subscription_id: event.subscriptionId,
            provider_config_id: providerConfigId,
          },
          transaction: t,
          lock: Transaction.LOCK.UPDATE,
        })
        : null;

      // Log event for funding plan lifecycle events. When no local plan matches,
      // funding_plan_id is NULL (never '' — Postgres rejects '' for a UUID column,
      // which would abort this insert and leave the provider retrying forever).
      // The row is still written so provider_event_id dedupe ends the retry loop.
      const eventEntity = new FundingEventEntity();
      eventEntity.id = uuidv4();
      eventEntity.funding_plan_id = fundingPlanRecord?.id ?? null;
      eventEntity.event_type = event.eventType;
      eventEntity.provider_event_id = event.eventId;
      eventEntity.payload = this.summarizeProviderEvent(event.status ?? null);
      eventEntity.processed_at = new Date();
      await eventEntity.save({ transaction: t });

      if (!fundingPlanRecord) {
        return;
      }

      // The cancellation boundary as it stood before this event, read before
      // any of the writes below can overwrite it. It is what the allocations
      // were covered through, so finalization has to date them from it.
      const scheduledCancelAt = fundingPlanRecord.cancel_at;

      if (event.status) {
        const previousStatus = fundingPlanRecord.status;

        if (previousStatus === 'cancelled' && event.status !== 'cancelled') {
          logger.warn({
            eventId: event.eventId,
            eventType: event.eventType,
            fundingPlanId: fundingPlanRecord.id,
            reportedStatus: event.status,
          }, 'Ignoring provider status for a funding plan that is already cancelled');
        }
        else {
          fundingPlanRecord.status = event.status;

          // Emitted after commit: a listener must never act on a lifecycle
          // change the transaction went on to roll back.
          if (previousStatus === 'active' && event.status === 'past_due') {
            emitAfterTx(this.eventBus, 'funding:plan:payment_failed', {
              fundingPlan: fundingPlanRecord.toModel(),
            }, t);
          }
          else if (previousStatus === 'past_due' && event.status === 'suspended') {
            emitAfterTx(this.eventBus, 'funding:plan:suspended', {
              fundingPlan: fundingPlanRecord.toModel(),
            }, t);
          }
          else if (event.status === 'active' && previousStatus !== 'active') {
            emitAfterTx(this.eventBus, 'funding:plan:reactivated', {
              fundingPlan: fundingPlanRecord.toModel(),
            }, t);
          }
        }
      }

      // Tri-state: absent leaves the stored boundary alone, null clears it (a
      // pending cancellation the customer reversed), a date schedules one.
      if (event.cancelAt !== undefined) {
        fundingPlanRecord.cancel_at = event.cancelAt;
      }

      if (event.currentPeriodStart) {
        fundingPlanRecord.current_period_start = event.currentPeriodStart;
      }

      if (event.currentPeriodEnd) {
        fundingPlanRecord.current_period_end = event.currentPeriodEnd;
      }

      await fundingPlanRecord.save({ transaction: t });

      if (fundingPlanRecord.status === 'cancelled') {
        await this.endCalendarAllocations(fundingPlanRecord.id, scheduledCancelAt, t);
      }
    });
  }

  /**
   * Close out the calendar allocations of a funding plan that has just ended
   *
   * `end_time` is the date each calendar was covered through, so it takes the
   * cancellation boundary the plan was running to when one was scheduled — the
   * customer paid through it, and dating the allocation from the moment the
   * provider got around to sending its deletion event would understate what
   * they bought. An immediate cancellation has no such boundary and ends now.
   *
   * Only open allocations are touched. One already closed carries its own
   * earlier end date (a calendar removed from the plan mid-period keeps it),
   * and that date is the more specific answer.
   *
   * @param fundingPlanId - Plan whose allocations are ending
   * @param scheduledCancelAt - Boundary the plan was cancelling at, if any
   * @param tx - Transaction the plan's own status write is enlisted in
   * @private
   */
  private async endCalendarAllocations(
    fundingPlanId: string,
    scheduledCancelAt: Date | null,
    tx: Transaction,
  ): Promise<void> {
    await CalendarFundingPlanEntity.update(
      { end_time: scheduledCancelAt ?? new Date() },
      {
        where: {
          funding_plan_id: fundingPlanId,
          end_time: { [Op.is]: null as any },
        },
        transaction: tx,
      },
    );
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
    const fundingPlan = await db.transaction(async (t: Transaction): Promise<FundingPlan | null> => {
      // Re-run the idempotency check under the plan row lock: the webhook and
      // the session-return path both reach here for the same subscription, and
      // the unlocked pre-transaction check cannot see the other's uncommitted
      // row. Locking the existing row (when there is one) also serialises this
      // path against a concurrent allocation change or cancel on that plan.
      const lockedExisting = await FundingPlanEntity.findOne({
        where: {
          provider_subscription_id: event.subscriptionId,
          provider_config_id: providerConfigId,
        },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });

      if (lockedExisting) {
        return null;
      }

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
      // A subscription can arrive already carrying a cancellation schedule —
      // one created through the provider's own surfaces, or a checkout the
      // customer cancelled between paying and our seeing it. Dropping it would
      // give the new plan no boundary at all, so access would run to the period
      // end plus grace on a subscription the provider is about to delete.
      plan.cancelAt = providerSubscription.cancelAt ?? null;

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
        // A calendar belongs to one plan at a time, so coverage moving to this
        // plan closes whatever allocation was still open for the same calendar
        // under an earlier one.
        //
        // Not defensive tidying — without it this insert fails. A plan that
        // went `suspended` keeps its allocations open (it may yet be revived)
        // and does not block a fresh checkout, so buying a new plan for the
        // same calendar is an ordinary, reachable sequence that would otherwise
        // present the unique index on (calendar_id) WHERE end_time IS NULL with
        // a second open row. The webhook would then fail, and the provider
        // would retry it forever.
        //
        // addCalendarToFundingPlan carries the matching close for the same
        // reason. The two must stay symmetric: every path that opens an
        // allocation has to close whatever it supersedes, or the index turns a
        // reachable purchase into a hard failure.
        //
        // In the same transaction as the insert, so the two rows can never be
        // observed open at once.
        await CalendarFundingPlanEntity.update(
          { end_time: new Date() },
          {
            where: {
              calendar_id: { [Op.in]: ownedCalendarIds },
              funding_plan_id: { [Op.ne]: plan.id },
              end_time: { [Op.is]: null as any },
            },
            transaction: t,
          },
        );

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

    if (!fundingPlan) {
      return;
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
   * @deprecated Use {@link checkFundingAccess}. This reports only the plan's
   * status, so it keeps granting access to a plan whose cancellation was never
   * reported to us — and, since a cancel-at-period-end deliberately leaves the
   * status 'active', to one past its own `cancel_at` boundary as well. It also
   * knows nothing about instance-level funding settings or admin exemption.
   * It survives only as part of the legacy baseline that
   * the parity test in service.test.ts measures checkFundingAccess against —
   * that is the reason not to delete it, not a reason to call it. Do not add
   * callers.
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
   * @deprecated Use {@link checkFundingAccess}. This answers only the
   * grant-or-plan half of a gate decision, leaving every caller to remember
   * the instance-enabled and admin-exemption checks for itself, and it applies
   * no cancellation boundary. It has no callers left in or out of this domain
   * — the FundingInterface wrapper that exposed it across the boundary is
   * gone. It is retained only as the legacy baseline that the parity test in
   * service.test.ts measures checkFundingAccess against, which is the reason
   * not to delete it, not a reason to call it. Do not add callers.
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
   *     tell" is not "has access". Where the indeterminate read is the
   *     instance-level settings themselves, the closure is signalled by
   *     throwing rather than returning false — see the return contract below.
   *
   * Note the deliberate split in invariants 1 and 4: a *known* absence of
   * funding opens gates, an *unknown* funding state closes them.
   *
   * Where invariants 3 and 4 meet, the tie-break is: **a determinate allow
   * beats an indeterminate sibling read.** The admin, grant and plan checks
   * are read independently; one of them failing means "unknown from that
   * source", never a denial of what another source can still answer. A
   * complimentary-grant table that is unreadable must not deny a calendar with
   * a healthy paid allocation. The gate closes only when no source produced an
   * allow.
   *
   * The return contract carries three outcomes, not two, because a denial from
   * this method is not always "not covered":
   *
   *  - `true`  — the gate is open.
   *  - `false` — a determinate denial. This calendar is not covered on an
   *    instance that does charge. Consumers may answer it commercially
   *    (402 / SubscriptionRequiredError, an upsell prompt).
   *  - throws {@link FundingAccessIndeterminateError} — the instance-level
   *    funding state could not be read, so we cannot even say whether this
   *    instance charges for anything. Still a denial, but a server-side one:
   *    consumers must surface it as a server error and must NEVER answer it
   *    with 402 / SubscriptionRequiredError, which would tell an operator to
   *    buy something to fix our outage.
   *
   * The distinction is thrown rather than returned deliberately: a bare
   * boolean cannot express it, and every consumer that forgets it produces the
   * exact wrong answer (a bill during an outage). Throwing makes the correct
   * handling the default — an unhandled throw is a 500, which is what this
   * case should be — and leaves a consumer that wants to degrade differently
   * free to catch.
   *
   * The feature key carries no policy of its own today — every gated feature
   * is decided the same way — but it is validated against the registry so an
   * unregistered key can never be answered, and so per-feature policy has a
   * place to live if it is ever needed.
   *
   * A calendarId with no resolvable owner — a deleted or never-existing
   * calendar — is answered as a determinate `false`, not as an existence
   * error. This method decides funding and nothing else, and it is composed
   * only after existence has been established; where a consumer reaches it
   * with an unknown id anyway, the resulting 402 is safe because calendar
   * existence is already public information under DEC-004. The one visible
   * consequence is that an ownerless calendar's widget read answers 402 rather
   * than 404 on a funding-enabled instance.
   *
   * @param calendarId - Calendar the feature would be used on
   * @param feature - Key from FUNDING_GATED_FEATURES naming the gated feature
   * @returns True if the gate is open for this calendar, false if this
   *   calendar is determinately not covered
   * @throws ValidationError if calendarId is not a UUID or feature is not a
   *   registered funding-gated feature
   * @throws FundingAccessIndeterminateError if the instance funding settings
   *   could not be read
   */
  async checkFundingAccess(calendarId: string, feature: FundingGatedFeature): Promise<boolean> {
    if (!isValidUUID(calendarId)) {
      throw new ValidationError('Invalid calendarId: must be a valid UUID');
    }

    if (!Object.prototype.hasOwnProperty.call(FUNDING_GATED_FEATURES, feature)) {
      throw new ValidationError('Unknown funding-gated feature');
    }

    // Invariant 1: funding not enabled on this instance -> all gates open.
    // Invariant 4, instance scope: we cannot establish that funding is switched
    // off, so we cannot open the gate on that basis either. The helper throws
    // rather than returning, so consumers cannot mistake it for "not covered".
    const settings = await this.settingsForFundingDecision(
      'checkFundingAccess: instance funding settings unreadable, closing gate',
    );

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
   * A missing CalendarInterface throws rather than answering false: "nobody
   * injected the calendar domain" is this source being unable to answer, not
   * an owner who turned out not to be an admin. Callers run this through
   * readAccessSource, so the throw produces the same denial a false would have
   * — with a logged reason instead of silence. Not a production path
   * (server.ts wires the interface unconditionally); it guards construction
   * order in tests and future wiring.
   *
   * @param calendarId - Calendar ID to check
   * @returns True if the calendar has a resolvable owner holding the admin role
   * @throws Error if no CalendarInterface has been injected
   */
  private async isCalendarOwnerAdmin(calendarId: string): Promise<boolean> {
    if (!this.calendarInterface) {
      throw new Error('CalendarInterface not injected; calendar owner admin status is unknowable');
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
    return await this.qualifyingFundingPlan(calendarId, gracePeriodDays) !== null;
  }

  /**
   * The funding plan currently qualifying a calendar, or null if none does.
   *
   * The predicate behind hasQualifyingFundingPlan, returning the plan itself so
   * a caller that needs to *report* the funding (its period end, its access
   * boundary) reads exactly the plan the gate decided on. Any second query
   * shaped slightly differently would be a fifth way to answer this question.
   *
   * @param calendarId - Calendar ID to check
   * @param gracePeriodDays - Instance grace period applied after the paid-through date
   * @returns The qualifying funding plan, or null if none currently grants access
   */
  private async qualifyingFundingPlan(
    calendarId: string,
    gracePeriodDays: number,
  ): Promise<FundingPlanEntity | null> {
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
      return null;
    }

    const expiry = this.planAccessExpiry(allocation.fundingPlan, gracePeriodDays);

    return expiry === null || Date.now() < expiry.getTime() ? allocation.fundingPlan : null;
  }

  /**
   * The instant at which a funding plan stops granting access to its
   * calendars, or null if nothing on the plan sets an end.
   *
   * These dates never widen access: the caller has already required
   * status 'active', so a plan Stripe moved to past_due or suspended is
   * denied by the join before any date is read. The boundaries only
   * discriminate among plans that still claim to be active.
   *
   * Two candidate boundaries are considered and the EARLIEST wins, because a
   * gate helper must never round permissive:
   *
   *  - cancel_at, the instant a scheduled cancellation takes effect. A
   *    cancel-at-period-end leaves the plan 'active' — the customer is paid up
   *    and fully entitled until the boundary — so this is the only marker that
   *    reveals it. It is what makes the missed-webhook case harmless: access
   *    ends here whether or not the provider's deletion event ever arrives.
   *  - current_period_end plus the instance grace period. This is the boundary
   *    written on the happy path, on every renewal, so it is the one that
   *    still applies when a cancellation is never reported to us at all — the
   *    silent-renewal-failure and missed-deletion cases. The grace window
   *    exists for the plan that is still 'active' with a renewal webhook in
   *    flight or lost: it keeps a paying customer from being cut off the
   *    instant their period rolls over. It is not the dunning window —
   *    suspendExpiredFundingPlans measures its own grace from updatedAt on
   *    past_due rows, and those rows never reach this helper.
   *
   * ## Precedence among the end-of-entitlement markers
   *
   * Four stored values can end a calendar's coverage. They are not competing
   * answers to one question; each answers a different one, and only two are
   * read here:
   *
   *  1. CalendarFundingPlanEntity.end_time — when THIS CALENDAR's allocation
   *     ends, whatever the plan goes on to do. Applied by qualifyingFundingPlan's
   *     allocation query before this helper is reached, so it wins outright: a
   *     calendar removed from a plan mid-period loses coverage on its own date
   *     while the plan keeps covering the others.
   *  2. FundingPlanEntity.cancel_at — when the PLAN stops granting. Read here.
   *  3. FundingPlanEntity.current_period_end + grace — the paid-through
   *     backstop. Read here.
   *  4. FundingPlanEntity.cancelled_at — when cancellation was REQUESTED.
   *     Deliberately not read here. It is a request timestamp, not an
   *     effective-end one, and it is only ever written together with
   *     status 'cancelled', which the caller's join has already denied. Adding
   *     it back would be actively wrong rather than merely redundant: on a
   *     period-end cancellation the request instant is the moment the customer
   *     clicked cancel, so an earliest-wins reduce would revoke access they
   *     had paid weeks ahead for — the exact outcome cancel_at exists to
   *     prevent.
   *
   * Two predicates still read plan status with no boundary at all, and both
   * are documented as such where they are defined: hasActiveFundingPlan
   * (deprecated, retained only for the parity test) and
   * getPlanStatusForCalendars (the un-migrated bulk admin vocabulary, deferred
   * to pv-1u3s). Neither is an entitlement decision. Every gate and every
   * single-calendar display status goes through this helper.
   *
   * @param plan - Funding plan the allocation belongs to
   * @param gracePeriodDays - Instance grace period applied after the paid-through date
   * @returns Access expiry instant, or null if the plan sets none
   */
  private planAccessExpiry(plan: FundingPlanEntity, gracePeriodDays: number): Date | null {
    const graceMs = Math.max(gracePeriodDays, 0) * 24 * 60 * 60 * 1000;

    const boundaries = [
      plan.cancel_at,
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
   * for the same calendar, which is the same ordering the single-calendar
   * predicates use — but only the ordering. This method is NOT in parity with
   * getFundingStatusForCalendar: it reads plan status alone, with no access
   * boundary and no admin exemption, so a calendar whose plan was cancelled,
   * has passed the `cancel_at` boundary of a period-end cancellation, or has
   * run past its paid-through date is still reported 'subscribed' here
   * while the single-calendar path reports it not_covered and every gate refuses
   * it. That is tolerable only because this vocabulary feeds admin listings,
   * never an entitlement decision. Migrating it is deferred to pv-1u3s.
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
