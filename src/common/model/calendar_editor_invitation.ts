import { Model } from './model';

/**
 * Represents an invitation to become an editor of a calendar.
 * Contains information about the invitation, including recipient email and calendar details.
 */
export class CalendarEditorInvitation extends Model {
  declare id: string;
  declare calendarId: string;
  declare email: string;
  declare invitedBy: string; // Account ID of who sent the invitation
  declare message: string;
  declare expirationTime: Date | null;
  declare createdAt: Date;

  /**
   * Constructor for CalendarEditorInvitation.
   *
   * @param {string} id - Unique identifier for the invitation
   * @param {string} calendarId - ID of the calendar the user is being invited to edit
   * @param {string} email - Email address of the invitation recipient
   * @param {string} invitedBy - Account ID of who sent the invitation
   * @param {string} [message] - Optional message to include with the invitation
   * @param {Date} [expirationTime] - Optional expiration time for the invitation
   * @param {Date} [createdAt] - When the invitation was created
   */
  constructor(
    id: string,
    calendarId: string,
    email: string,
    invitedBy: string,
    message?: string,
    expirationTime?: Date,
    createdAt?: Date,
  ) {
    super();
    this.id = id;
    this.calendarId = calendarId;
    this.email = email;
    this.invitedBy = invitedBy;
    this.message = message ?? '';
    this.expirationTime = expirationTime ?? null;
    this.createdAt = createdAt ?? new Date();
  }

  /**
   * Check if the invitation has expired
   */
  get isExpired(): boolean {
    if (!this.expirationTime) {
      return false;
    }
    return new Date() > this.expirationTime;
  }

  /**
   * Check if the invitation is still valid
   */
  get isValid(): boolean {
    return !this.isExpired;
  }

  /**
   * Converts the invitation to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation of the invitation
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarId: this.calendarId,
      email: this.email,
      invitedBy: this.invitedBy,
      message: this.message,
      expirationTime: this.expirationTime,
      createdAt: this.createdAt,
      isExpired: this.isExpired,
      isValid: this.isValid,
    };
  }

  /**
   * Creates a CalendarEditorInvitation instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing invitation data
   * @returns {CalendarEditorInvitation} A new CalendarEditorInvitation instance
   */
  static fromObject(obj: Record<string, any>): CalendarEditorInvitation {
    return new CalendarEditorInvitation(
      obj.id || '',
      obj.calendarId || '',
      obj.email || '',
      obj.invitedBy || '',
      obj.message,
      obj.expirationTime ? new Date(obj.expirationTime) : undefined,
      obj.createdAt ? new Date(obj.createdAt) : undefined,
    );
  }
}
