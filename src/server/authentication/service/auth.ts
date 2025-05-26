import { scryptSync } from 'crypto';
import { DateTime } from 'luxon';
import { randomBytes } from 'crypto';

import { Account } from "@/common/model/account";
import { AccountEntity, AccountSecretsEntity } from "@/server/common/entity/account";
import { noAccountExistsError } from '@/server/accounts/exceptions';
import { EmailAlreadyExistsError, InvalidPasswordError } from '@/server/authentication/exceptions';
import EmailService from '@/server/common/service/mail';
import PasswordResetEmail from '@/server/authentication/model/password_reset_email';
import AccountsInterface from '@/server/accounts/interface';

/**
 * Service class for managing accounts
 *
 * @remarks
 * Use this class to manage the lifecycle of accounts in the system
 */
export default class AuthenticationService {
  constructor(
    private eventBus: any,
    private accountService: AccountsInterface,
  ) {}

  /**
   * Changes the email address for an account after verifying the password
   *
   * @param {Account} account - The account to change email for
   * @param {string} newEmail - The new email address
   * @param {string} password - The current password for verification
   * @returns {Promise<Account>} The updated account
   * @throws {InvalidPasswordError} If the provided password is incorrect
   * @throws {EmailAlreadyExistsError} If the new email is already in use by another account
   */
  async changeEmail(account: Account, newEmail: string, password: string): Promise<Account> {
    // Verify the password first
    const passwordValid = await this.checkPassword(account, password);
    if (!passwordValid) {
      throw new InvalidPasswordError();
    }

    // Normalize the email address for case-insensitive comparison
    const normalizedNewEmail = newEmail.toLowerCase();

    // If the new email is the same as current (case-insensitive), just return the account
    if (account.email.toLowerCase() === normalizedNewEmail) {
      return account;
    }

    // Check if email is already in use by another account
    const existingAccount = await this.accountService.getAccountByEmail(normalizedNewEmail);
    if (existingAccount && existingAccount.id !== account.id) {
      throw new EmailAlreadyExistsError();
    }

    // Update the email in the database
    const accountEntity = await AccountEntity.findByPk(account.id);
    if (accountEntity) {
      accountEntity.email = normalizedNewEmail;
      await accountEntity.save();

      // Return the updated account
      return await this.accountService.getAccountById(account.id) as Account;
    }

    throw new noAccountExistsError();
  }

  /**
   * Resets a user's password using a valid password reset code.
   *
   * @param {string} code - The password reset code to validate
   * @param {string} password - The new password to set
   * @returns {Promise<Account|undefined>} The account if password was reset successfully, undefined otherwise
   */
  async resetPassword(code: string, password: string): Promise<Account| undefined> {
    const secret = await AccountSecretsEntity.findOne({ where: {password_reset_code: code}, include: AccountEntity});

    if ( secret ) {

      if ( secret.password_reset_expiration && DateTime.now() < DateTime.fromJSDate(secret.password_reset_expiration) ) {
        const account = secret.account.toModel();

        if ( await this.accountService.setPassword(account, password) == true ) {
          secret.password_reset_code = '';
          secret.password_reset_expiration = null;
          await secret.save();
          return account;
        }
      }
      else {
        secret.password_reset_code = '';
        secret.password_reset_expiration = null;
        await secret.save();
      }
    }
  }

  /**
   * Generates a password reset code for an account with the given email and sends a reset email.
   *
   * @param {string} email - Email address of the account to generate a reset code for
   * @returns {Promise<void>}
   * @throws {noAccountExistsError} If no account exists with the given email
   */
  async generatePasswordResetCode(email: string) {
    const account = await this.accountService.getAccountByEmail(email);
    if ( ! account ) {
      throw new noAccountExistsError();
    }

    let secret = await AccountSecretsEntity.findByPk(account.id);
    if ( ! secret ) {
      secret = AccountSecretsEntity.build({
        id: account.id,
      });
    }
    const passwordResetCode = await this.generatePasswordResetCodeForAccount(account);

    // Send the email
    const message = new PasswordResetEmail(account, passwordResetCode);
    await EmailService.sendEmail(message.buildMessage(account.language));
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
   * Validates if a password reset code is valid and not expired.
   *
   * @param {string} code - The password reset code to validate
   * @returns {Promise<boolean>} True if the code is valid and not expired, false otherwise
   */
  async validatePasswordResetCode(code: string): Promise<boolean> {
    const secret = await AccountSecretsEntity.findOne({where: {password_reset_code: code}});

    if ( secret ) {
      if ( secret.password_reset_expiration && DateTime.now() < DateTime.fromJSDate(secret.password_reset_expiration) ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if the provided password is correct for the given account.
   *
   * @param {Account} account - The account to check the password for
   * @param {string} password - The password to verify
   * @returns {Promise<boolean>} True if the password is correct, false otherwise
   */
  async checkPassword(account:Account, password:string): Promise<boolean> {
    const secret = await AccountSecretsEntity.findByPk(account.id);

    if ( secret && secret.salt ) {
      let hashed_password = scryptSync(password, secret.salt, 64 ).toString('hex');
      if ( hashed_password === secret.password ) {
        return true;
      }
    }
    return false;
  }
}
