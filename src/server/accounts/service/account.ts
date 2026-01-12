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
import { AccountApplicationAlreadyExistsError, noAccountInviteExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError, AccountInvitationPermissionError } from '@/server/accounts/exceptions';
import AccountRegistrationEmail from '@/server/accounts/model/registration_email';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import ApplicationAcceptedEmail from '@/server/accounts/model/application_accepted_email';
import ApplicationRejectedEmail from '@/server/accounts/model/application_rejected_email';
import ApplicationAcknowledgmentEmail from '@/server/accounts/model/application_acknowledgment_email';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import CalendarInterface from '@/server/calendar/interface';
import { EventEmitter } from 'events';
import EditorInvitationEmail from '@/server/calendar/model/editor_invitation_email';

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
     * @returns a promise that resolves to a boolean
     */
  async registerNewAccount(email:string): Promise<Account> {

    const settings = await this.configurationInterface.getAllSettings();
    if ( settings.registrationMode != 'open' ) {
      throw new AccountRegistrationClosedError();
    }
    const accountInfo = await this._setupAccount(email);

    const message = new AccountRegistrationEmail(accountInfo.account, accountInfo.password_code);
    this.emailInterface.sendEmail(message.buildMessage(accountInfo.account.language));
    return accountInfo.account;
  }

  /**
     * Allows a user to apply for an account when registration mode is set to 'apply'
     *
     * @param email - The email address of the applicant
     * @param message - Any message the applicant wants to include with their application
     * @returns A promise that resolves to true if the application was successfully created
     * @throws AccountAlreadyExistsError if an account already exists for the provided email
     * @throws AccountApplicationAlreadyExistsError if an application already exists for the provided email
     * @throws AccountApplicationsClosedError if the system is not accepting applications
     */
  async applyForNewAccount(email: string, message?: string): Promise<boolean> {
    const settings = await this.configurationInterface.getAllSettings();

    if (settings.registrationMode !== 'apply') {
      throw new AccountApplicationsClosedError();
    }

    if ( await this.getAccountByEmail(email) ) {
      throw new AccountAlreadyExistsError();
    }

    // Check for existing application with any status
    const existingApplication = await AccountApplicationEntity.findOne({
      where: { email: email },
    });

    if (existingApplication) {
      throw new AccountApplicationAlreadyExistsError();
    }

    const applicationEntity = AccountApplicationEntity.build({
      id: uuidv4(),
      email: email,
      message: message || '',
      status: 'pending',
      status_timestamp: new Date(),
    });

    await applicationEntity.save();

    const application = applicationEntity.toModel();

    // Send acknowledgment email to applicant
    const emailMessage = new ApplicationAcknowledgmentEmail(application);
    this.emailInterface.sendEmail(emailMessage.buildMessage('en'));

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
        console.error('Inviting account not found for invitation ID:', inv.id);
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
        console.error(`Failed to grant calendar editor access for calendar ${inv.calendar_id}:`, error);
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

    this.emailInterface.sendEmail(message.buildMessage('en'));
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
    this.emailInterface.sendEmail(message.buildMessage(accountInfo.account.language));

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
   * Lists account invitations with optional filtering.
   *
   * @param inviterId - Optional: Filter by the user who sent the invitation
   * @param calendarId - Optional: Filter by calendar for editor invitations
   * @returns {Promise<AccountInvitation[]>} Array of account invitations
   */
  async listInvitations(inviterId?: string, calendarId?: string): Promise<AccountInvitation[]> {
    const whereClause: any = {};

    if (inviterId) {
      whereClause.invited_by = inviterId;
    }

    if (calendarId) {
      whereClause.calendar_id = calendarId;
    }

    const entities = await AccountInvitationEntity.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
    });

    return entities.map(e => {
      const invitation = e.toModel();
      invitation.invitedBy = e.inviter.toModel();
      return invitation;
    });
  }

  /**
   * Lists account applications with optional status filtering.
   *
   * @param status - Optional status filter (pending, accepted, rejected)
   * @returns {Promise<AccountApplication[]>} Array of account applications
   */
  async listAccountApplications(status?: string): Promise<AccountApplication[]> {
    const whereClause: any = {};

    if (status) {
      whereClause.status = status;
    }

    const entities = await AccountApplicationEntity.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
    });

    return entities.map(e => e.toModel());
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

    // Delete the account itself
    await account.destroy();

    return true;
  }
}
