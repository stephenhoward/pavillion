import { scryptSync, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';
import config from 'config';

import { Account } from "@/common/model/account";
import AccountInvitation from '@/common/model/invitation';
import AccountApplication from '@/common/model/application';
import EmailService from "@/server/common/service/mail";
import { AccountEntity, AccountSecretsEntity, AccountRoleEntity, AccountInvitationEntity, AccountApplicationEntity } from "@/server/common/entity/account";
import ServiceSettings from '@/server/configuration/service/settings';
import { AccountApplicationAlreadyExistsError, noAccountInviteExistsError, AccountRegistrationClosedError, AccountApplicationsClosedError, AccountAlreadyExistsError, AccountInviteAlreadyExistsError, noAccountApplicationExistsError } from '@/server/accounts/exceptions';
import AuthenticationService from '@/server/authentication/service/auth';
import AccountRegistrationEmail from '@/server/accounts/model/registration_email';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import ApplicationAcceptedEmail from '@/server/accounts/model/application_accepted_email';
import ApplicationRejectedEmail from '@/server/accounts/model/application_rejected_email';
import ApplicationAcknowledgmentEmail from '@/server/accounts/model/application_acknowledgment_email';

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
    private eventBus: any,
  ) {}

  /**
     * Sends the owner of the provided email a message inviting them to create an account,
     * if they do not already have an account.
     * @param email
     * @param message
     * @returns a promise that resolves to undefined
     * @throws AccountAlreadyExistsError if an account already exists for the provided email
     * @throws AccountInviteAlreadyExistsError if an invitation already exists for the provided email
     */
  async inviteNewAccount(email:string, message: string): Promise<AccountInvitation> {

    if ( await this.getAccountByEmail(email) ) {
      throw new AccountAlreadyExistsError();
    }

    if ( await AccountInvitationEntity.findOne({ where: { email: email }}) ) {
      throw new AccountInviteAlreadyExistsError();
    }

    const invitation = AccountInvitationEntity.build({
      id: uuidv4(),
      email: email,
      message: message,
      invitation_code: randomBytes(16).toString('hex'),
    });

    await invitation.save();
    this.sendNewAccountInvite(invitation);

    return invitation.toModel();
  }

  /**
     * Resends an invitation email and resets the expiration time
     * @param id - The ID of the invitation to resend
     * @returns a promise that resolves to the updated invitation or undefined if not found
     */
  async resendInvite(id: string): Promise<AccountInvitation|undefined> {
    const invitation = await AccountInvitationEntity.findByPk(id);
    if (!invitation) {
      return undefined;
    }

    // Reset expiration time to 1 week from now
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    invitation.expiration_time = oneWeekFromNow;

    await invitation.save();

    // Resend the invitation email
    await this.sendNewAccountInvite(invitation);

    return invitation.toModel();
  }

  /**
     * Creates a new account for the provided email address, if it does not yet exist
     * @param - email the email address to associate with the new account
     * @returns a promise that resolves to a boolean
     */
  async registerNewAccount(email:string): Promise<Account> {

    const settings = await ServiceSettings.getInstance();
    if ( settings.get('registrationMode') != 'open' ) {
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

    const settings = await ServiceSettings.getInstance();
    if ( settings.get('registrationMode') != 'apply' ) {
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
      const passwordResetCode = await AuthenticationService.generatePasswordResetCodeForAccount(accountEntity.toModel());
      accountInfo.password_code = passwordResetCode;
    }
    return accountInfo;
  }

  /**
   * Validates if an account invitation code is valid and not expired.
   *
   * @param {string} code - The invitation code to validate
   * @returns {Promise<boolean>} True if the code is valid and not expired, false otherwise
   */
  async validateInviteCode(code: string): Promise<boolean> {
    const invitation = await AccountInvitationEntity.findOne({ where: {invitation_code: code}});
    if (!invitation) {
      return false;
    }

    if (!invitation.expiration_time) {
      return false;
    }

    const now = DateTime.utc();
    const expirationTime = DateTime.fromJSDate(invitation.expiration_time);

    if (now > expirationTime) {
      return false;
    }

    return true;
  }

  /**
   * Accepts an account invitation using the provided code and creates an account with the given password.
   *
   * @param {string} code - The invitation code to accept
   * @param {string} password - The password for the new account
   * @returns {Promise<Account>} The created account
   * @throws {Error} If the invitation has expired or does not exist
   * @throws {noAccountInviteExistsError} If no invitation exists with the given code
   */
  async acceptAccountInvite(code: string, password: string): Promise<Account> {
    // Check if invitation code is valid (not expired)
    const isValid = await this.validateInviteCode(code);
    if (!isValid) {
      throw new Error('Invitation has expired or does not exist');
    }

    // At this point, we know the code is valid, so retrieve the invitation
    const invitation = await AccountInvitationEntity.findOne({ where: {invitation_code: code}});

    if (!invitation) {
      throw new noAccountInviteExistsError();
    }

    const accountInfo = await this._setupAccount(invitation.email, password);

    // Remove the invitation after it's been accepted
    await invitation.destroy();

    return accountInfo.account;
  }

  /**
   * Sends an email invitation to a new account.
   *
   * @param {AccountInvitationEntity} invitation - The invitation entity to send
   * @returns {Promise<boolean>} True if the email was sent successfully
   */
  async sendNewAccountInvite(invitation:AccountInvitationEntity): Promise<boolean> {

    const message = new AccountInvitationEmail(invitation.toModel(), invitation.invitation_code);
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
