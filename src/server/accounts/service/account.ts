import { scryptSync, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';
import config from 'config';
import { Op } from 'sequelize';

import { Account } from "@/common/model/account";
import AccountInvitation from '@/common/model/invitation';
import AccountApplication from '@/common/model/application';
import EmailInterface from "@/server/email/interface";
import { AccountEntity, AccountSecretsEntity, AccountRoleEntity, AccountApplicationEntity } from "@/server/common/entity/account";
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import { noAccountInviteExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError, AccountInvitationPermissionError } from '@/server/accounts/exceptions';
import AccountRegistrationEmail from '@/server/accounts/model/registration_email';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import ApplicationAcceptedEmail from '@/server/accounts/model/application_accepted_email';
import ApplicationRejectedEmail from '@/server/accounts/model/application_rejected_email';
import ApplicationAcknowledgmentEmail from '@/server/accounts/model/application_acknowledgment_email';
import ApplicationConfirmationEmail from '@/server/accounts/model/application_confirmation_email';
import AdminApplicationNotificationEmail from '@/server/accounts/model/admin_application_notification_email';
import AccountAlreadyExistsEmail from '@/server/accounts/model/account_already_exists_email';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import CalendarInterface from '@/server/calendar/interface';
import { EventEmitter } from 'events';
import EditorInvitationEmail from '@/server/calendar/model/editor_invitation_email';
import { isValidLanguageCode } from '@/common/i18n/languages';
import { ValidationError } from '@/common/exceptions/base';
import { isValidEmail } from '@/common/validation/email';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('accounts');

type AccountInfo = {
  account: Account,
  password_code: string | ''
};

/**
 * Service class for managing accounts
 *
 * @remarks
 * Use this class to manage the lifecycle of accounts in the system
 */
export default class AccountService {

  constructor(
    private eventBus: EventEmitter,
    private configurationInterface: ConfigurationInterface,
    private setupInterface: SetupInterface,
    private emailInterface: EmailInterface,
    private calendarInterface?: CalendarInterface,
  ) {}

  /**
   * Set the CalendarInterface for enabling calendar editor invitation acceptance functionality.
   * This method is called after domain initialization to avoid circular dependencies.
   * TODO: Refactor invitations into their own domain to eliminate this circular dependency.
   */
  setCalendarInterface(calendarInterface: CalendarInterface): void {
    this.calendarInterface = calendarInterface;
  }

  /**
    * Sends the owner of the provided email a message inviting them to create an account,
    * if they do not already have an account.
    * @param email
    * @param message
    * @returns a promise that resolves to undefined
    * @throws AccountAlreadyExistsError if an account already exists for the provided email
    * @throws AccountInviteAlreadyExistsError if an invitation already exists for the provided email
    * @throws AccountInvitationPermissionError if the inviter lacks permission to send invitations
    */
  async inviteNewAccount(inviter: Account, email:string, message: string, calendarId?: string): Promise<AccountInvitation> {

    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email format', { email: ['invalid_email_format'] });
    }

    // Check if user has permission to send invitations based on registration mode
    const settings = await this.configurationInterface.getAllSettings();
    const registrationMode = settings.registrationMode;

    // Allow invitations based on new mode definitions:
    // - 'open' mode: any authenticated user can invite
    // - 'invitation' mode: any authenticated user can invite
    // - 'apply' and 'closed' modes: only admins can invite
    if (registrationMode !== 'open' && registrationMode !== 'invitation' && !inviter.hasRole('admin')) {
      throw new AccountInvitationPermissionError();
    }

    if ( await this.getAccountByEmail(email) ) {
      throw new AccountAlreadyExistsError();
    }

    if ( await AccountInvitationEntity.findOne({ where: { email: email }}) ) {
      throw new AccountInviteAlreadyExistsError();
    }

    const invitationEntity = AccountInvitationEntity.build({
      id: uuidv4(),
      email: email,
      invited_by: inviter.id,
      message: message,
      invitation_code: randomBytes(16).toString('hex'),
      calendar_id: calendarId,
    });
    invitationEntity.inviter = AccountEntity.fromModel(inviter);

    await invitationEntity.save();

    const invitation = invitationEntity.toModel();
    invitation.invitedBy = inviter;

    this.sendNewAccountInvite(inviter, invitationEntity, calendarId);

    return invitation;
  }

  /**
    * Resends an invitation email and resets the expiration time
    * @param id - The ID of the invitation to resend
    * @returns a promise that resolves to the updated invitation or undefined if not found
    */
  async resendInvite(id: string): Promise<AccountInvitation|undefined> {
    const invitation = await AccountInvitationEntity.findByPk(id, { include: [ 'inviter' ] });
    if (!invitation) {
      return undefined;
    }

    // Reset expiration time to 1 week from now
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    invitation.expiration_time = oneWeekFromNow;

    await invitation.save();

    // Resend the invitation email
    await this.sendNewAccountInvite(invitation.inviter.toModel(), invitation);

    return invitation.toModel();
  }

  /**
   * Cancels an account invitation by ID.
   *
   * @param id - The ID of the invitation to cancel
   * @returns {Promise<boolean>} True if the invitation was successfully cancelled, false if not found
   */
  async cancelInvite(id: string): Promise<boolean> {
    const invitation = await AccountInvitationEntity.findByPk(id);
    if (!invitation) {
      return false;
    }

    await invitation.destroy();
    return true;
  }

  /**
    * Creates a new account for the provided email address, if it does not yet exist
    * @param - email the email address to associate with the new account
    * @returns a promise that resolves to an account
    */
  async registerNewAccount(email:string): Promise<Account> {

    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email format', { email: ['invalid_email_format'] });
    }

    const settings = await this.configurationInterface.getAllSettings();
    if ( settings.registrationMode != 'open' ) {
      throw new AccountRegistrationClosedError();
    }

    let accountInfo;
    try {
      accountInfo = await this._setupAccount(email);
    }
    catch (error) {
      if (error instanceof AccountAlreadyExistsError) {
        const existingAccount = await this.getAccountByEmail(email);
        if (existingAccount) {
          const message = new AccountAlreadyExistsEmail(existingAccount);
          await this.emailInterface.sendEmail(message.buildMessage(existingAccount.language));
        }
        throw error;
      }
      throw error;
    }

    const message = new AccountRegistrationEmail(accountInfo.account, accountInfo.password_code);
    await this.emailInterface.sendEmail(message.buildMessage(accountInfo.account.language));
    return accountInfo.account;
  }

  /**
    * Allows a user to apply for an account when registration mode is set to 'apply'.
    *
    * Implements a two-step lifecycle (epic pv-l9wv): submit creates a row in
    * `pending_confirmation` status and emails a confirmation link; the applicant
    * confirms via {@link confirmAccountApplication} which transitions to `pending`
    * for admin review.
    *
    * Five branches, all of which perform real DB + email work to keep response
    * timing uniform across states (anti-enumeration; DEC-004):
    *
    *   1. New email, no existing account or application: create
    *      `pending_confirmation` row + send `ApplicationConfirmationEmail`.
    *   2. Existing application in `pending_confirmation`: regenerate token,
    *      reset 7-day expiration, refresh message, resend
    *      `ApplicationConfirmationEmail`.
    *   3. Existing application in `pending`: silently swallow
    *      `AccountApplicationAlreadyExistsError`. Touch the row + send a generic
    *      acknowledgment for timing parity.
    *   4. Existing application in `rejected`: silently swallow
    *      `AccountApplicationAlreadyExistsError`. Touch the row + send a generic
    *      acknowledgment for timing parity.
    *   5. Existing account: silently swallow `AccountAlreadyExistsError`. Send
    *      `AccountAlreadyExistsEmail` (mirrors `registerNewAccount` pattern).
    *
    * @param email - The email address of the applicant
    * @param message - Any message the applicant wants to include with their application
    * @returns A promise that resolves to true once the apply request has been processed
    * @throws ValidationError if the email format is invalid
    * @throws AccountApplicationsClosedError if the system is not accepting applications
    */
  async applyForNewAccount(email: string, message?: string): Promise<boolean> {

    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email format', { email: ['invalid_email_format'] });
    }

    const settings = await this.configurationInterface.getAllSettings();

    if (settings.registrationMode !== 'apply') {
      throw new AccountApplicationsClosedError();
    }

    const existingAccount = await this.getAccountByEmail(email);
    const existingApplication = await AccountApplicationEntity.findOne({
      where: { email: email },
    });

    // Branch 5: existing account — silently swallow AccountAlreadyExistsError.
    // Email the account owner (mirrors registerNewAccount) so the work timing
    // matches the create-and-confirm branches.
    if (existingAccount) {
      const accountExistsMessage = new AccountAlreadyExistsEmail(existingAccount);
      await this.emailInterface.sendEmail(
        accountExistsMessage.buildMessage(existingAccount.language),
      );
      return true;
    }

    // Branch 2: existing application awaiting confirmation — regenerate the
    // token, reset the 7-day expiration, refresh the optional message, and
    // resend the confirmation email. Identical email content to first-send
    // (no "we resent your link" copy that would leak prior submission state).
    if (existingApplication && existingApplication.status === 'pending_confirmation') {
      existingApplication.confirmation_token = randomBytes(16).toString('hex');
      existingApplication.confirmation_token_expiration = DateTime.now().plus({ days: 7 }).toJSDate();
      existingApplication.message = message ?? existingApplication.message ?? '';
      existingApplication.status_timestamp = new Date();
      await existingApplication.save();

      const application = existingApplication.toModel();
      const confirmationMessage = new ApplicationConfirmationEmail(
        application,
        existingApplication.confirmation_token,
      );
      await this.emailInterface.sendEmail(confirmationMessage.buildMessage('en'));
      return true;
    }

    // Branches 3 & 4: existing application is already pending or already
    // rejected. Silently swallow AccountApplicationAlreadyExistsError. Touch
    // the row (status_timestamp save) and send a generic acknowledgment so
    // response timing matches the create branches; the user already received
    // the original email and the admin queue/decision is unchanged.
    if (existingApplication) {
      existingApplication.status_timestamp = new Date();
      await existingApplication.save();

      const ackMessage = new ApplicationAcknowledgmentEmail(existingApplication.toModel());
      await this.emailInterface.sendEmail(ackMessage.buildMessage('en'));
      return true;
    }

    // Branch 1: new application — create in pending_confirmation, generate
    // token + 7-day expiration, send confirmation email. The acknowledgment
    // email is held until the applicant confirms (epic pv-l9wv).
    const confirmationToken = randomBytes(16).toString('hex');
    const confirmationExpiration = DateTime.now().plus({ days: 7 }).toJSDate();

    const applicationEntity = AccountApplicationEntity.build({
      id: uuidv4(),
      email: email,
      message: message || '',
      status: 'pending_confirmation',
      status_timestamp: new Date(),
      confirmation_token: confirmationToken,
      confirmation_token_expiration: confirmationExpiration,
    });

    await applicationEntity.save();

    const application = applicationEntity.toModel();
    const confirmationMessage = new ApplicationConfirmationEmail(application, confirmationToken);
    await this.emailInterface.sendEmail(confirmationMessage.buildMessage('en'));

    return true;
  }

  /**
   * Atomically consumes a confirmation token, transitioning the matching
   * account application from `pending_confirmation` to `pending` and clearing
   * the token fields. On success, sends the {@link ApplicationAcknowledgmentEmail}
   * (post-confirmation acknowledgment, deferred from apply-time per epic
   * pv-l9wv).
   *
   * Atomicity is enforced via a conditional `update()` query scoped to the
   * application's primary key, with the original status + expiration in the
   * WHERE clause so a concurrent consume cannot double-flip the row. If
   * affected rows = 0, the call returns false. This collapses every terminal
   * failure state (not found, expired, already-consumed/null, status changed)
   * into the same response — caller cannot distinguish (anti-enumeration;
   * epic pv-l9wv).
   *
   * @param token - The confirmation token from the email link
   * @returns true on successful consume + acknowledgment send; false on any
   *          terminal failure state
   */
  async confirmAccountApplication(token: string): Promise<boolean> {
    if (!token) {
      return false;
    }

    // Look up the row by token. DB-level WHERE clause (no app-layer string
    // compare). All failure paths from here on return identical false.
    const application = await AccountApplicationEntity.findOne({
      where: { confirmation_token: token },
    });

    if (!application) {
      return false;
    }

    if (application.status !== 'pending_confirmation') {
      return false;
    }

    if (!application.confirmation_token_expiration) {
      return false;
    }

    const now = DateTime.utc();
    const expirationTime = DateTime.fromJSDate(application.confirmation_token_expiration);
    if (now > expirationTime) {
      // Defense-in-depth: an expired token has no further use; clear the
      // fields so the row cannot match a future lookup. Status remains
      // `pending_confirmation` so the applicant can re-apply (which
      // regenerates the token via Branch 2 of applyForNewAccount).
      application.confirmation_token = null;
      application.confirmation_token_expiration = null;
      await application.save();
      return false;
    }

    // Atomic conditional update scoped to the application's primary key.
    // The status + token guards in the WHERE clause prevent a concurrent
    // consume from double-flipping the row; if another caller already
    // consumed the token between our findOne and update, affectedRows will
    // be 0 and we return false. This makes the consume single-shot.
    const [affectedRows] = await AccountApplicationEntity.update(
      {
        status: 'pending',
        status_timestamp: new Date(),
        confirmation_token: null,
        confirmation_token_expiration: null,
      },
      {
        where: {
          id: application.id,
          confirmation_token: token,
          status: 'pending_confirmation',
        },
      },
    );

    if (affectedRows === 0) {
      return false;
    }

    // Build the acknowledgment email from the application we already loaded.
    // The model carries the email address; status/timestamp on the model
    // reflect pre-update values but are not surfaced to the recipient.
    const ackMessage = new ApplicationAcknowledgmentEmail(application.toModel());
    await this.emailInterface.sendEmail(ackMessage.buildMessage('en'));

    // Notify instance administrators that an application has reached the
    // `pending` review queue. The status flip already committed above, so any
    // mail failure here cannot roll it back — wrap the whole loop in a
    // best-effort try/catch (one swallow site, one log call). A failure on
    // admin N means admins N+1..end miss this notification; the queue UI
    // remains the source of truth and per-iteration isolation can be added
    // later if observed-needed. The asymmetry with the applicant ack send
    // above is intentional: the applicant ack is the primary user-facing
    // signal of confirm success and should surface failures, whereas the
    // admin notify is a side-effect that must not fail the confirm.
    try {
      const admins = await this.getAdmins();
      for (const admin of admins) {
        if (!admin.email) {
          continue;
        }
        const adminEmail = new AdminApplicationNotificationEmail(admin.email, application.toModel());
        await this.emailInterface.sendEmail(adminEmail.buildMessage(admin.language || 'en'));
      }
    }
    catch (error) {
      // Log application.id only — never the applicant email or message
      // (privacy playbook: PII stays out of error logs).
      logError(error, `[Accounts] Failed to notify admins of pending application ${application.id}`);
    }

    return true;
  }

  /**
   * Creates a new account with optional password.
   *
   * In test environment (NODE_ENV === 'test'), automatically assigns admin role
   * and clears the setup mode cache to allow tests to proceed without setup blocking.
   *
   * @param email - Email address for the new account
   * @param password - Optional password (if not provided, generates reset code)
   * @returns Promise resolving to account info with account and optional password reset code
   * @private
   */
  async _setupAccount(email: string, password?: string): Promise<AccountInfo> {
    if ( await this.getAccountByEmail(email) ) {
      throw new AccountAlreadyExistsError();
    }

    const accountEntity = AccountEntity.build({
      id: uuidv4(),
      email: email,
      username: '',
    });

    await accountEntity.save();

    const accountSecretsEntity = AccountSecretsEntity.build({ account_id: accountEntity.id });
    await accountSecretsEntity.save();

    let accountInfo:AccountInfo = {
      account: accountEntity.toModel(),
      password_code: '',
    };

    if( password ) {
      this.setPassword(accountEntity.toModel(), password);
    }
    else {
      const passwordResetCode = await this.generatePasswordResetCodeForAccount(accountEntity.toModel());
      accountInfo.password_code = passwordResetCode;
    }

    // In test environment, assign admin role to FIRST account only and clear setup cache
    // This allows tests to run without being blocked by setup mode middleware
    // while still allowing permission testing with non-admin accounts
    if (process.env.NODE_ENV === 'test') {
      // Check if there are any existing admin accounts
      const existingAdmins = await AccountRoleEntity.findAll({
        where: { role: 'admin' },
      });

      // Only assign admin role if this is the first account (no admins exist yet)
      if (existingAdmins.length === 0) {
        const roleEntity = AccountRoleEntity.build({
          account_id: accountEntity.id,
          role: 'admin',
        });
        await roleEntity.save();
      }

      // Clear setup mode cache so middleware will query DB fresh and find the admin
      this.setupInterface.clearCache();
    }

    // Emit account.created event for ActivityPub domain to create UserActor
    // Only if username is set (accounts created via invitation may not have username yet)
    if (accountInfo.account.username) {
      try {
        const domain = config.get<string>('domain');
        if (domain) {
          this.eventBus.emit('account.created', {
            accountId: accountInfo.account.id,
            username: accountInfo.account.username,
            domain: domain,
          });
        }
      }
      catch (error) {
        logError(error, `[Accounts] Failed to emit account.created event: ${accountInfo.account.id}`);
        // Don't fail account creation if event emission fails
      }
    }

    return accountInfo;
  }

  /**
   * Generates a password reset code for a specific account.
   *
   * @param {Account} account - The account to generate a password reset code for
   * @returns {Promise<string>} The generated password reset code
   */
  async generatePasswordResetCodeForAccount(account: Account): Promise<string> {
    let secret = await AccountSecretsEntity.findByPk(account.id);
    if ( ! secret ) {
      secret = AccountSecretsEntity.build({
        id: account.id,
      });
    }
    secret.password_reset_code = randomBytes(16).toString('hex');
    secret.password_reset_expiration = DateTime.now().plus({ hours: 1 }).toJSDate();
    await secret.save();

    return secret.password_reset_code;
  }

  /**
   * Validates if an account invitation code is valid and not expired.
   *
   * @param {string} code - The invitation code to validate
   * @returns {Promise<AccountInvitationEntity>} The invitation entity if valid
   * @throws {noAccountInviteExistsError} If invitation does not exist or is expired
   */
  async validateInviteCode(code: string): Promise<AccountInvitationEntity> {
    const invitation = await AccountInvitationEntity.findOne({ where: {invitation_code: code}});
    if (!invitation) {
      throw new noAccountInviteExistsError();
    }

    if (!invitation.expiration_time) {
      throw new noAccountInviteExistsError();
    }

    const now = DateTime.utc();
    const expirationTime = DateTime.fromJSDate(invitation.expiration_time);

    if (now > expirationTime) {
      throw new noAccountInviteExistsError();
    }

    return invitation;
  }

  /**
   * Accepts an account invitation and creates a new account with calendar context information.
   *
   * @param {string} code - The invitation code
   * @param {string} password - The password for the new account
   * @returns {Promise<Map<string, any>>} The created account and calendar ids
   * @throws {noAccountInviteExistsError} If invitation has expired or does not exist
   */
  async acceptAccountInvite(code: string, password: string): Promise<{ account: Account, calendars: string[] }> {
    // Validate invitation code and get the invitation if valid
    const invitation = await this.validateInviteCode(code);

    const accountInfo = await this._setupAccount(invitation.email, password);

    const calendars = await this.processCalendarInvitations(invitation, accountInfo.account );

    // Clean up all invitation records for this email
    await AccountInvitationEntity.destroy({
      where: { email: invitation.email },
    });

    return {
      account: accountInfo.account,
      calendars: calendars,
    };
  }

  private async processCalendarInvitations(invitation: AccountInvitationEntity, account: Account): Promise<string[]> {

    if ( !this.calendarInterface ) {
      return [];
    }

    // Retrieve ALL invitations sent to this email so we can grant
    // access to all relevant calendars and clean up all invitation records
    const allInvitations = await AccountInvitationEntity.findAll({
      where: { email: invitation.email },
      include: [{ model: AccountEntity, as: 'inviter' } ],
    });

    // Process all calendar editor invitations for this email and collect calendar info
    const processedCalendars = new Set<string>();

    for (const inv of allInvitations) {
      if ( ! inv.calendar_id || processedCalendars.has(inv.calendar_id)) {
        continue; // Skip if no calendar ID or already processed
      }

      const grantingAccount = await this.getAccountById(inv.invited_by);
      if (!grantingAccount) {
        logger.error({ invitationId: inv.id }, 'Inviting account not found for invitation');
        continue; // Skip this invitation but continue with others
      }

      try {
        await this.calendarInterface.grantEditAccess(
          grantingAccount,
          inv.calendar_id,
          account.id,
        );
        processedCalendars.add(inv.calendar_id);
      }
      catch (error) {
        logError(error, `[Accounts] Failed to grant calendar editor access for calendar ${inv.calendar_id}`);
      }
    }
    return Array.from(processedCalendars);
  }

  /**
   * Sends an email invitation to a new account.
   *
   * @param {AccountInvitationEntity} invitation - The invitation entity to send
   * @returns {Promise<boolean>} True if the email was sent successfully
   */
  async sendNewAccountInvite(inviter: Account, invitation:AccountInvitationEntity, calendarId?: string): Promise<boolean> {

    const calendar = calendarId
      ? await this.calendarInterface?.getCalendar(calendarId)
      : undefined;

    if ( calendarId && !calendar ) {
      throw new Error('Calendar not found for invitation');
    }

    const message = calendar
      ? new EditorInvitationEmail(invitation.toModel(), invitation.invitation_code, calendar)
      : new AccountInvitationEmail(invitation.toModel(), invitation.invitation_code);

    await this.emailInterface.sendEmail(message.buildMessage('en'));
    return true;
  }

  /**
    * Approves an account application and creates a new account for the applicant
    *
    * @param id - The ID of the application to approve
    * @returns {Promise<Account>} A promise that resolves to the newly created account
    * @throws {noAccountApplicationExistsError} if no application exists with the given ID
    */
  async acceptAccountApplication(id: string): Promise<Account> {

    const application = await AccountApplicationEntity.findByPk(id);

    if (! application ) {
      throw new noAccountApplicationExistsError();
    }

    const accountInfo = await this._setupAccount(application.email);

    // Send email before destroying the application
    const message = new ApplicationAcceptedEmail(accountInfo.account, accountInfo.password_code);
    await this.emailInterface.sendEmail(message.buildMessage(accountInfo.account.language));

    // Delete the application now that it's been accepted and account created
    await application.destroy();

    return accountInfo.account;
  }

  /**
    * Rejects an account application and optionally notifies the applicant
    *
    * @param id - The ID of the application to reject
    * @param silent - If true, no email notification will be sent to the applicant (default: false)
    * @returns A promise that resolves to undefined
    * @throws {noAccountApplicationExistsError} if no application exists with the given ID
    */
  async rejectAccountApplication(id: string, silent: boolean = false): Promise<undefined> {
    const application = await AccountApplicationEntity.findByPk(id);

    if (!application) {
      throw new noAccountApplicationExistsError();
    }

    // Update application status instead of destroying it
    application.status = 'rejected';
    application.status_timestamp = new Date();
    await application.save();

    if (!silent) {
      const message = new ApplicationRejectedEmail(application.toModel());
      await this.emailInterface.sendEmail(message.buildMessage('en'));
    }
  }

  /**
   * Lists account invitations with optional filtering and pagination.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page (max 100)
   * @param inviterId - Optional: Filter by the user who sent the invitation
   * @param calendarId - Optional: Filter by calendar for editor invitations
   * @returns Paginated account invitations
   */
  async listInvitations(
    page: number = 1,
    limit: number = 50,
    inviterId?: string,
    calendarId?: string,
  ): Promise<{
      invitations: AccountInvitation[];
      pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
      };
    }> {
    // Enforce pagination limits
    const sanitizedPage = Math.max(1, page);
    const sanitizedLimit = Math.min(100, Math.max(1, limit));
    const offset = (sanitizedPage - 1) * sanitizedLimit;

    const whereClause: any = {};

    if (inviterId) {
      whereClause.invited_by = inviterId;
    }

    if (calendarId) {
      whereClause.calendar_id = calendarId;
    }

    const { count, rows: entities } = await AccountInvitationEntity.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
      limit: sanitizedLimit,
      offset,
    });

    const invitations = entities.map(e => {
      const invitation = e.toModel();
      invitation.invitedBy = e.inviter.toModel();
      return invitation;
    });

    return {
      invitations,
      pagination: {
        currentPage: sanitizedPage,
        totalPages: Math.ceil(count / sanitizedLimit),
        totalCount: count,
        limit: sanitizedLimit,
      },
    };
  }

  /**
   * Lists account applications with optional status filtering and pagination.
   *
   * Default behavior (no status) excludes `pending_confirmation` rows so the
   * admin queue surfaces only actionable applications. Callers may explicitly
   * request `pending_confirmation` to inspect that bucket. Unknown status
   * values fall back to the default-exclude behavior rather than leaking the
   * pending_confirmation bucket via an unrecognized filter value.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page (max 100)
   * @param status - Optional status filter: `pending_confirmation`, `pending`, or `rejected`
   * @returns Paginated account applications
   */
  async listAccountApplications(
    page: number = 1,
    limit: number = 50,
    status?: string,
  ): Promise<{
      applications: AccountApplication[];
      pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
      };
    }> {
    // Enforce pagination limits
    const sanitizedPage = Math.max(1, page);
    const sanitizedLimit = Math.min(100, Math.max(1, limit));
    const offset = (sanitizedPage - 1) * sanitizedLimit;

    const whereClause: any = {};
    const ALLOWED_STATUSES = ['pending_confirmation', 'pending', 'rejected'];
    const ACTIONABLE_STATUSES = ['pending', 'rejected'];

    if (status && ALLOWED_STATUSES.includes(status)) {
      whereClause.status = status;
    }
    else {
      // Default (and fallback for unknown values): exclude pending_confirmation
      // so admins see only the actionable queue.
      whereClause.status = { [Op.in]: ACTIONABLE_STATUSES };
    }

    const { count, rows: entities } = await AccountApplicationEntity.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: sanitizedLimit,
      offset,
    });

    const applications = entities.map(e => e.toModel());

    return {
      applications,
      pagination: {
        currentPage: sanitizedPage,
        totalPages: Math.ceil(count / sanitizedLimit),
        totalCount: count,
        limit: sanitizedLimit,
      },
    };
  }

  /**
    * Returns the account associated with a given email address, or undefined if no such account exists
    * @param {string} email the email address to search for
    * @returns {Promise<Account | undefined>} a promise that resolves to the account associated with the given email address, or undefined if no such account exists
    */
  async getAccountByEmail(email:string): Promise<Account | undefined> {
    let account = await AccountEntity.findOne({ where: { email: email }});
    if (!account) { return undefined; }

    let roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });

    let accountModel = account.toModel();
    accountModel.roles = roles.map(role => role.role);
    return accountModel;
  }

  /**
    * Returns the account associated with a given ID, or undefined if no such account exists
    * @param {string} id the account ID to search for
    * @returns {Promise<Account | undefined>} a promise that resolves to the account associated with the given ID, or undefined if no such account exists
    */
  async getAccountById(id:string): Promise<Account | undefined> {
    let account = await AccountEntity.findByPk(id);
    if (!account) { return undefined; }

    let roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });

    let accountModel = account.toModel();
    accountModel.roles = roles.map(role => role.role);
    return accountModel;
  }

  /**
   * Returns the account associated with a given username, or undefined if no such account exists
   * @param {string} username the username to search for
   * @returns {Promise<Account | undefined>} a promise that resolves to the account associated with the given username, or undefined if no such account exists
   */
  async getAccountByUsername(username: string): Promise<Account | undefined> {
    let account = await AccountEntity.findOne({ where: { username: username }});
    if (!account) { return undefined; }

    let roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });

    let accountModel = account.toModel();
    accountModel.roles = roles.map(role => role.role);
    return accountModel;
  }

  /**
    * Returns all accounts in the system
    * @returns {Promise<Account[]>} a promise that resolves to an array of all accounts
    */
  async getAllAccounts(): Promise<Account[]> {
    let accounts = await AccountEntity.findAll({
      order: [['createdAt', 'DESC']],
    });

    // Load roles for each account
    const accountsWithRoles = await Promise.all(
      accounts.map(async (account) => {
        let roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });
        let accountModel = account.toModel();
        accountModel.roles = roles.map(role => role.role);
        return accountModel;
      }),
    );

    return accountsWithRoles;
  }

  /**
   * Lists accounts with pagination and optional search filtering.
   *
   * @param page - Page number (1-indexed)
   * @param limit - Number of results per page
   * @param search - Optional search string to filter by email
   * @returns Promise with accounts and pagination info
   */
  async listAccounts(
    page: number = 1,
    limit: number = 50,
    search?: string,
  ): Promise<{
      accounts: Account[];
      pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
      };
    }> {
    const offset = (page - 1) * limit;

    // Build where clause for search
    const whereClause: any = {};
    if (search) {
      whereClause.email = { [Op.like]: `%${search}%` };
    }

    // Get total count for pagination
    const totalCount = await AccountEntity.count({ where: whereClause });

    // Fetch accounts with pagination
    const accounts = await AccountEntity.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    // Load roles for each account
    const accountsWithRoles = await Promise.all(
      accounts.map(async (account) => {
        const roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });
        const accountModel = account.toModel();
        accountModel.roles = roles.map(role => role.role);
        return accountModel;
      }),
    );

    return {
      accounts: accountsWithRoles,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        limit,
      },
    };
  }

  /**
   * Returns all admin accounts in the system
   * @returns {Promise<Account[]>} a promise that resolves to an array of admin accounts
   */
  async getAdmins(): Promise<Account[]> {
    // Find all admin roles
    const adminRoles = await AccountRoleEntity.findAll({
      where: { role: 'admin' },
    });

    // Get account IDs from roles
    const adminAccountIds = adminRoles.map(role => role.account_id);

    if (adminAccountIds.length === 0) {
      return [];
    }

    // Load accounts
    const accounts = await AccountEntity.findAll({
      where: { id: adminAccountIds },
    });

    // Load roles for each account
    const accountsWithRoles = await Promise.all(
      accounts.map(async (account) => {
        let roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });
        let accountModel = account.toModel();
        accountModel.roles = roles.map(role => role.role);
        return accountModel;
      }),
    );

    return accountsWithRoles;
  }

  /**
   * Returns the account IDs of all instance admins.
   *
   * Used by the notifications role resolver to fan out activities with
   * audience `{ kind: 'role', role: 'instance-admins' }` (e.g. `Flag`,
   * `ReportEscalated`). Queries the AccountRole table directly — no account
   * row load — so callers that only need IDs avoid an extra fetch.
   *
   * @returns {Promise<string[]>} a promise that resolves to an array of admin
   *   account IDs; empty array if no admins exist
   */
  async getInstanceAdmins(): Promise<string[]> {
    const adminRoles = await AccountRoleEntity.findAll({
      where: { role: 'admin' },
    });

    return adminRoles.map(role => role.account_id);
  }

  /**
   * Checks credentials against an account, and returns the corresponding Account if successful
   * @param email
   * @param password
   * @returns a promise that resolves to an Account if the credentials match, or undefined if they do not
   */
  async checkCredentials(email: string, password: string): Promise<Account | undefined> {
    let account = await this.getAccountByEmail(email);
    if (!account) { return undefined; }

    let secrets = await AccountSecretsEntity.findByPk(account.id);
    if (!secrets || !secrets.password || !secrets.salt) { return undefined; }

    const hashedPassword = scryptSync(password, secrets.salt, 64).toString('hex');
    if (hashedPassword === secrets.password) {
      return account;
    }
    return undefined;
  }

  /**
   * Validates that a password reset code is valid and not expired.
   *
   * @param {string} code - The password reset code to validate
   * @returns {Promise<Account>} The account associated with the reset code
   * @throws {Error} If the code is invalid or expired
   */
  async validatePasswordResetCode(code: string): Promise<Account> {
    const secret = await AccountSecretsEntity.findOne({ where: { password_reset_code: code } });

    if (!secret) {
      throw new Error('Invalid password reset code');
    }

    if (!secret.password_reset_expiration) {
      throw new Error('Password reset code has no expiration');
    }

    const now = DateTime.utc();
    const expirationTime = DateTime.fromJSDate(secret.password_reset_expiration);

    if (now > expirationTime) {
      throw new Error('Password reset code has expired');
    }

    const account = await this.getAccountById(secret.account_id);
    if (!account) {
      throw new Error('Account not found for password reset code');
    }

    return account;
  }

  /**
    * Sets the password for an account using a valid password reset code
    * @param {string} code - The password reset code
    * @param {string} newPassword - The new password to set
    * @returns {Promise<boolean>} True if the password was successfully set
    * @throws {Error} If the code is invalid, expired, or password validation fails
    */
  async resetPasswordWithCode(code: string, newPassword: string): Promise<boolean> {
    // Validate the reset code and get the account
    const account = await this.validatePasswordResetCode(code);

    // Set the new password
    await this.setPassword(account, newPassword);

    // Clear the reset code after successful password reset
    const secrets = await AccountSecretsEntity.findByPk(account.id);
    if (secrets) {
      secrets.password_reset_code = null;
      secrets.password_reset_expiration = null;
      await secrets.save();
    }

    return true;
  }

  /**
   * Checks if an account is in the process of registering (has no password set yet).
   *
   * @param {Account} account - The account to check
   * @returns {Promise<boolean>} True if the account has no password set (is registering)
   */
  async isRegisteringAccount(account: Account): Promise<boolean> {
    const secrets = await AccountSecretsEntity.findByPk(account.id);
    if (!secrets || !secrets.password) {
      return true;
    }
    return false;
  }

  /**
    * Sets the password for an account
    * @param {Account} account - The account to set the password for
    * @param {string} password - The new password
    * @returns {Promise<boolean>} True if the password was successfully set
    */
  async setPassword(account: Account, password: string): Promise<boolean> {
    let secret = await AccountSecretsEntity.findByPk(account.id);
    if (!secret) {
      secret = AccountSecretsEntity.build({
        account_id: account.id,
      });
    }
    const salt = randomBytes(16).toString('hex');
    const hashedPassword = scryptSync(password, salt, 64).toString('hex');
    secret.salt = salt;
    secret.password = hashedPassword;
    await secret.save();
    return true;
  }

  /**
   * Updates the display name and optionally the language preference for an account.
   *
   * @param account - The account to update
   * @param displayName - The new display name (or null to clear)
   * @param language - Optional language preference code to update
   * @returns The updated account model
   * @throws ValidationError if the provided language code is not supported
   */
  async updateProfile(account: Account, displayName: string | null, language?: string): Promise<Account> {
    if (language !== undefined && !isValidLanguageCode(language)) {
      throw new ValidationError('Invalid language code');
    }

    const accountEntity = await AccountEntity.findByPk(account.id);
    if (!accountEntity) {
      throw new Error('Account not found');
    }

    accountEntity.display_name = displayName;
    if (language !== undefined) {
      accountEntity.language = language;
    }
    await accountEntity.save();

    return accountEntity.toModel();
  }

  /**
   * Loads and populates roles for an existing Account model.
   *
   * Fetches all roles assigned to the account from the database and sets them
   * on the account model. Useful when an Account was retrieved without roles
   * (e.g. from passport JWT deserialization).
   *
   * @param account - The account to load roles for
   * @returns The account with roles populated
   */
  async loadAccountRoles(account: Account): Promise<Account> {
    const roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });
    account.roles = roles.map(role => role.role);
    return account;
  }

  /**
   * Delete an account by its ID.
   * This will also delete all associated data (secrets, roles, invitations sent, etc.)
   *
   * @param {string} accountId - The ID of the account to delete
   * @returns {Promise<boolean>} True if the account was successfully deleted
   * @throws {Error} If the account does not exist
   */
  async deleteAccount(accountId: string): Promise<boolean> {
    const account = await AccountEntity.findByPk(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    // Delete associated secrets
    await AccountSecretsEntity.destroy({ where: { account_id: accountId } });

    // Delete associated roles
    await AccountRoleEntity.destroy({ where: { account_id: accountId } });

    // Delete invitations sent by this account
    await AccountInvitationEntity.destroy({ where: { invited_by: accountId } });

    // Delete the account itself (UserActor will be deleted via CASCADE)
    await account.destroy();

    return true;
  }
}
