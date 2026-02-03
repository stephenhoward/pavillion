import { PrimaryModel } from '@/common/model/model';

/**
 * Represents a user account in the system.
 */
class Account extends PrimaryModel {
  username: string = '';
  email: string = '';
  displayName: string | null = null;
  roles: string[] | null = null;
  calendarLanguages: string[] = ['en'];
  language: string = 'en';

  /**
   * Constructor for the Account class.
   *
   * @param {string} [id] - Unique identifier for the account
   * @param {string} [username] - Username for the account
   * @param {string} [email] - Email address for the account
   */
  constructor (id?: string, username?: string, email?: string) {
    super(id);
    this.username = username ?? '';
    this.email = email ?? '';
  };

  /**
   * Checks if the account has a specific role.
   *
   * @param {string} role - The role to check for
   * @returns {boolean} True if the account has the specified role
   */
  hasRole(role: string): boolean {
    if ( this.roles ) {
      return this.roles.includes(role);
    }
    return false;
  }

  /**
   * Converts the account to a plain JavaScript object.
   *
   * @returns {Record<string,any>} Plain object representation of the account
   */
  toObject(): Record<string,any> {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      displayName: this.displayName,
      roles: this.roles,
    };
  };

  /**
   * Creates an Account instance from a plain object.
   *
   * @param {Record<string,any>} obj - Plain object containing account data
   * @returns {Account} A new Account instance
   */
  static fromObject(obj: Record<string,any>): Account {
    let account = new Account(obj.id, obj.username, obj.email);
    account.displayName = obj.displayName ?? null;
    account.roles = obj.roles;
    return account;
  }

  /**
   * Creates a deep copy of this account.
   *
   * @returns {Account} A new Account instance with the same properties
   */
  clone(): Account { return Account.fromObject(this.toObject()); }
};

export { Account };
