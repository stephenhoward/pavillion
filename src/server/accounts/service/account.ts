import { scryptSync, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';
import config from 'config';

import { Account } from "@/common/model/account";
import AccountInvitation from '@/common/model/invitation';
import AccountApplication from '@/common/model/application';
import EmailService from "@/server/common/service/mail";
import { AccountEntity, AccountSecretsEntity, AccountRoleEntity, AccountApplicationEntity } from "@/server/common/entity/account";
import AccountInvitationEntity from '@/server/accounts/entity/account_invitation';
import { AccountApplicationAlreadyExistsError, noAccountInviteExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError, AccountInvitationPermissionError } from '@/server/accounts/exceptions';
import AccountRegistrationEmail from '@/server/accounts/model/registration_email';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import ApplicationAcceptedEmail from '@/server/accounts/model/application_accepted_email';
import ApplicationRejectedEmail from '@/server/accounts/model/application_rejected_email';
import ApplicationAcknowledgmentEmail from '@/server/accounts/model/application_acknowledgment_email';
import ConfigurationInterface from '@/server/configuration/interface';
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
    EmailService.sendEmail(message.buildMessage(accountInfo.account.language));
    return accountInfo.account;
  }

  /**
     * Allows a user to apply for an account when registration mode is set to 'apply'
     *
     * @param email - The email address of the applicant
     * @param message - Any message the applicant wants to include with their application
     * @returns A promise that resolves to true if the application was successfully created
     * @throws AccountApplicationsClosedError if registration mode is not set to 'apply'
     * @throws AccountApplicationAlreadyExistsError if an application already exists for the provided email
     */
  async applyForNewAccount(email:string, message: string): Promise<boolean> {

    const settings = await this.configurationInterface.getAllSettings();
    if ( settings.registrationMode != 'apply' ) {
      throw new AccountApplicationsClosedError();
    }

    if ( await AccountApplicationEntity.findOne({ where: { email: email }}) ) {
      throw new AccountApplicationAlreadyExistsError();
    }

    const application = AccountApplicationEntity.build({
      id: uuidv4(),
      email: email,
      message: message,
    });

    await application.save();

    // Send acknowledgment email to the applicant
    const acknowledgmentEmail = new ApplicationAcknowledgmentEmail(application.toModel());
    await EmailService.sendEmail(acknowledgmentEmail.buildMessage('en'));

    return true;
  }

  /**
   * Sets up a new account with the provided email address and optional password.
   * Creates necessary account entities and secrets.
   *
   * @param {string} email - The email address for the new account
   * @param {string} [password] - Optional password for the account
   * @returns {Promise<AccountInfo>} Account information including the model and password reset code if no password was provided
   * @throws {AccountAlreadyExistsError} If an account with the email already exists
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

    EmailService.sendEmail(message.buildMessage('en'));
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
    EmailService.sendEmail(message.buildMessage(accountInfo.account.language));

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
      await EmailService.sendEmail(message.buildMessage('en'));
    }
  }

  /**
   * Lists all account invitations in the system.
   *
   * @returns {Promise<AccountInvitation[]>} Array of account invitations
   */
  async listInvitations(): Promise<AccountInvitation[]> {
    return (await AccountInvitationEntity.findAll()).map( (invitation) => invitation.toModel() );
  }

  /**
   * Lists pending account invitations for a specific calendar.
   *
   * @param calendarId - The calendar ID to filter invitations by
   * @returns {Promise<AccountInvitation[]>} Array of pending calendar invitations
   */
  async listPendingInvitationsForCalendar(calendarId: string): Promise<AccountInvitation[]> {
    const invitations = await AccountInvitationEntity.findAll({
      where: {
        calendar_id: calendarId,
      },
      include: [{
        model: AccountEntity,
        as: 'inviter',
      }],
    });
    return invitations.map(invitation => invitation.toModel());
  }

  /**
   * Lists all account applications in the system.
   *
   * @returns {Promise<AccountApplication[]>} Array of account applications
   */
  async listAccountApplications(): Promise<AccountApplication[]> {
    return (await AccountApplicationEntity.findAll()).map( (application) => application.toModel() );
  }

  /**
     * Deletes an account invitation by ID
     * @param id - The ID of the invitation to delete
     * @returns a promise that resolves to true if successful, false if not found
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
   * Retrieves an account by its ID.
   *
   * @param {string} id - The ID of the account to retrieve
   * @returns {Promise<Account|null>} The account if found, otherwise null
   */
  async getAccount(id: string): Promise<Account|null> {
    const account = await AccountEntity.findByPk(id);
    return account ? account.toModel() : null;
  }

  /**
   * Finds an account by username and optionally domain.
   *
   * @param {string} name - The username to search for
   * @param {string} [domain] - Optional domain to filter by
   * @returns {Promise<Account|null>} The account if found, otherwise null
   */
  async getAccountFromUsername(name: string, domain?: string): Promise<Account|null> {

    let account = !domain || config.get('domain') == domain
      ? await AccountEntity.findOne({ where: {
        username: name,
      } })
      : await AccountEntity.findOne({ where: {
        username: name,
        domain: domain,
      } });

    if ( account ) {
      return account.toModel();
    }
    return null;
  }

  /**
   * Checks if an account is in the registration process (no password set yet).
   *
   * @param {Account} account - The account to check
   * @returns {Promise<boolean>} True if the account is still registering, false if already registered
   */
  async isRegisteringAccount(account: Account): Promise<boolean> {
    const secretsEntity = await AccountSecretsEntity.findByPk(account.id);
    if ( secretsEntity ) {
      if ( secretsEntity.password?.length ) {
        return false;
      }
    }
    return true;
  }

  async loadAccountRoles(account: Account): Promise<Account> {
    let roles = await AccountRoleEntity.findAll({ where: { account_id: account.id } });
    if ( roles ) {
      account.roles = roles.map( (role) => role.role );
    }
    else {
      account.roles = [];
    }
    return account;
  }

  async getAccountByEmail(email: string): Promise<Account|undefined> {
    const account = await AccountEntity.findOne({ where: {email: email}});

    if ( account ) {
      return await this.loadAccountRoles(account.toModel());
    }
  }

  async getAccountById(id: string): Promise<Account|undefined> {
    const account = await AccountEntity.findByPk(id);

    if ( account ) {
      return await this.loadAccountRoles(account.toModel());
    }
  }

  async setPassword(account:Account, password:string): Promise<boolean> {
    const secret = await AccountSecretsEntity.findByPk(account.id);

    if ( secret ) {
      let salt = randomBytes(16).toString('hex');
      let hashed_password = scryptSync(password, salt, 64 ).toString('hex');

      secret.salt = salt;
      secret.password = hashed_password;
      secret.password_reset_code = null;
      secret.password_reset_expiration = null;

      await secret.save();

      return true;
    }
    return false;
  }
}
