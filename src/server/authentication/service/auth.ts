import { randomBytes, scryptSync } from 'crypto';
import { DateTime } from 'luxon';

import { Account } from "@/common/model/account";
import { AccountEntity, AccountSecretsEntity } from "@/server/common/entity/account";
import { noAccountExistsError } from '@/server/accounts/exceptions';
import { normalizeEmail } from '@/common/validation/email';
import { InvalidPasswordError } from '@/server/authentication/exceptions';
import { logError } from '@/server/common/helper/error-logger';
import EmailInterface from '@/server/email/interface';
import PasswordResetEmail from '@/server/authentication/model/password_reset_email';
import EmailChangeConfirmationEmail from '@/server/authentication/model/email_change_confirmation_email';
import AccountsInterface from '@/server/accounts/interface';

/** Confirmation tokens are 16 random bytes rendered as lowercase hex. */
const EMAIL_CHANGE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

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
    private emailInterface: EmailInterface,
  ) {}

  /**
   * Begins a two-step email change after verifying the caller's password.
   *
   * The immediate response is uniform across every outcome (available, taken,
   * no-op) so it carries no information about which emails are already
   * registered — closing the differential-response enumeration oracle that the
   * old synchronous changeEmail exposed via its 409-vs-200 split (epic pv-91a3,
   * DEC-004 anti-enumeration). The new address is never written here; it is
   * stored pending and committed only when a token sent to that address is
   * consumed via {@link confirmEmailChange}.
   *
   * @param {Account} account - The authenticated account requesting the change
   * @param {string} newEmail - The new email address (normalized to lowercase)
   * @param {string} password - The current password for verification
   * @returns {Promise<void>}
   * @throws {InvalidPasswordError} If the provided password is incorrect. This
   *   is the ONLY throw retained: the caller is probing with their own
   *   password, so a password-validity signal leaks no email existence
   *   (epic pv-91a3, out-of-scope OQ2). EmailAlreadyExistsError is NEVER thrown
   *   from this path.
   */
  async initiateEmailChange(account: Account, newEmail: string, password: string): Promise<void> {
    // Verify the password first.
    const passwordValid = await this.checkPassword(account, password);
    if (!passwordValid) {
      throw new InvalidPasswordError();
    }

    // Normalize the email address for case-insensitive comparison.
    const normalizedNewEmail = normalizeEmail(newEmail);

    // No-op if the new email matches the current one. Returns the same uniform
    // (void) response as the available/taken paths.
    if (normalizeEmail(account.email) === normalizedNewEmail) {
      return;
    }

    // Availability check. If the address is taken by another account, write
    // nothing and send nothing — the response is identical to the available
    // path, so the requester cannot distinguish the two (anti-enumeration).
    const existingAccount = await this.accountService.getAccountByEmail(normalizedNewEmail);
    if (existingAccount && existingAccount.id !== account.id) {
      return;
    }

    // Available: stash a pending change on the secrets sidecar (mirrors the
    // password_reset_* lifecycle) and send a confirmation link to the NEW
    // address. The address is not written to AccountEntity until confirm.
    let secret = await AccountSecretsEntity.findByPk(account.id);
    if (!secret) {
      secret = AccountSecretsEntity.build({ id: account.id });
    }
    secret.email_change_code = randomBytes(16).toString('hex');
    secret.email_change_expiration = DateTime.now().plus({ hours: 1 }).toJSDate();
    secret.email_change_new_email = normalizedNewEmail;
    await secret.save();

    const message = new EmailChangeConfirmationEmail(account, normalizedNewEmail, secret.email_change_code);
    await this.emailInterface.sendEmail(message.buildMessage(account.language));
  }

  /**
   * Consumes an email-change confirmation token and commits the pending
   * address.
   *
   * Returns a boolean rather than throwing BY DESIGN: every terminal failure
   * (bad token format, unknown token, expired, address-now-taken) collapses to
   * the same `false` so a caller cannot distinguish them. Keeping the collapse
   * in the service avoids a handler catch block that would re-expand the error
   * set (anti-enumeration; mirrors accounts' consumeConfirmationToken). Tokens
   * and the pending address are NEVER logged, including on the error path
   * (DEC-004).
   *
   * @param {string} token - The confirmation token from the email link
   * @returns {Promise<boolean>} true once the pending address is committed;
   *   false on any terminal failure state
   */
  async confirmEmailChange(token: string): Promise<boolean> {
    // Validate the token shape before touching the database (mirrors the
    // reset-password / UUID pre-check). A malformed token has no row to match.
    if (!EMAIL_CHANGE_TOKEN_PATTERN.test(token)) {
      return false;
    }

    try {
      const secret = await AccountSecretsEntity.findOne({
        where: { email_change_code: token },
        include: AccountEntity,
      });

      // Unknown token: no row to clear, uniform negative.
      if (!secret || !secret.account) {
        return false;
      }

      const pendingEmail = secret.email_change_new_email;
      const expired = !secret.email_change_expiration
        || DateTime.now() >= DateTime.fromJSDate(secret.email_change_expiration);

      // Expired: clear the three fields (no retry, no orphaned PII) and fail.
      if (expired || !pendingEmail) {
        await this.clearEmailChangeFields(secret);
        return false;
      }

      // Re-check the pending address is still available at consume time. If it
      // was claimed since initiate, clear the fields and fail — explicitly
      // indistinguishable from token-expiry to the caller.
      const existingAccount = await this.accountService.getAccountByEmail(pendingEmail);
      if (existingAccount && existingAccount.id !== secret.account.id) {
        await this.clearEmailChangeFields(secret);
        return false;
      }

      // Commit: write the pending address to the account and clear the fields.
      secret.account.email = pendingEmail;
      await secret.account.save();
      await this.clearEmailChangeFields(secret);
      return true;
    }
    catch (error) {
      // A transient failure must not produce a distinguishable result. Collapse
      // to the uniform negative. The token and pending address are never
      // included in the log (DEC-004).
      logError(error, 'Error confirming email change');
      return false;
    }
  }

  /**
   * Clears the pending email-change fields on a secrets row. Used on every
   * terminal failure and on success so no orphaned token or PII is left behind.
   */
  private async clearEmailChangeFields(secret: AccountSecretsEntity): Promise<void> {
    secret.email_change_code = null;
    secret.email_change_expiration = null;
    secret.email_change_new_email = null;
    await secret.save();
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
    const passwordResetCode = await this.accountService.generatePasswordResetCodeForAccount(account);

    // Send the email
    const message = new PasswordResetEmail(account, passwordResetCode);
    await this.emailInterface.sendEmail(message.buildMessage(account.language));
  }

  /**
   * Validates if a password reset code is valid and not expired, and returns the associated account.
   *
   * @param {string} code - The password reset code to validate
   * @returns {Promise<Account|undefined>} The account if the code is valid and not expired, undefined otherwise
   */
  async validatePasswordResetCode(code: string): Promise<Account|undefined> {
    const secret = await AccountSecretsEntity.findOne({
      where: {password_reset_code: code},
      include: AccountEntity,
    });

    if ( secret && secret.account ) {
      if ( secret.password_reset_expiration && DateTime.now() < DateTime.fromJSDate(secret.password_reset_expiration) ) {
        return secret.account.toModel();
      }
    }
    return undefined;
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
