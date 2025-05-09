/**
 * Represents an application to join the platform.
 */
class AccountApplication {
  declare id: string;
  declare email: string;
  declare message: string;
  declare status: string;
  declare statusTimestamp: Date | null;

  /**
   * Constructor for AccountApplication.
   *
   * @param {string} id - Unique identifier for the application
   * @param {string} email - Email address of the applicant
   * @param {string} [message] - Optional message from the applicant
   * @param {string} [status] - Current status of the application (defaults to 'pending')
   * @param {Date} [statusTimestamp] - When the status was last updated
   */
  constructor(id: string, email: string, message?: string, status?: string, statusTimestamp?: Date) {
    this.id = id;
    this.email = email;
    this.message = message ?? '';
    this.status = status ?? 'pending';
    this.statusTimestamp = statusTimestamp ?? null;
  }
};

export default AccountApplication;
