import { Account } from '@/common/model/account';

/**
 * Represents an invitation to create an account on the platform.
 * Contains information about the invitation, including recipient email and expiration.
 */
class AccountInvitation {
  declare id: string;
  declare email: string;
  declare message: string;
  declare invitedBy: Account;
  declare expirationTime: Date | null;

  /**
   * Constructor for AccountInvitation.
   *
   * @param {string} id - Unique identifier for the invitation
   * @param {string} email - Email address of the invitation recipient
   * @param {string} [message] - Optional message to include with the invitation
   * @param {Date} [expirationTime] - Optional expiration time for the invitation
   */
  constructor(id: string, email: string, invitedBy: Account, message?: string, expirationTime?: Date) {
    this.id = id;
    this.email = email;
    this.message = message ?? '';
    this.invitedBy = invitedBy;
    this.expirationTime = expirationTime ?? null;
  }

  /**
   * Converts the invitation to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the invitation
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      email: this.email,
      invitedBy: this.invitedBy.toObject,
      message: this.message,
      expirationTime: this.expirationTime,
    };
  }

  /**
   * Creates an AccountInvitation instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing invitation data
   * @returns {AccountInvitation} A new AccountInvitation instance
   */
  static fromObject(obj: Record<string, any>): AccountInvitation {
    return new AccountInvitation(
      obj.id || '',
      obj.email,
      Account.fromObject(obj.invitedBy),
      obj.message,
      obj.expirationTime ? new Date(obj.expirationTime) : undefined,
    );
  }
};

export default AccountInvitation;
