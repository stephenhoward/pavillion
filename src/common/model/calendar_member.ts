import { Model } from './model';

/**
 * Represents a unified calendar membership relationship.
 * A CalendarMember can be either an owner or an editor,
 * and can be either a local account or a remote federated user.
 *
 * Supports membership on both local calendars (via calendarId) and
 * remote calendars (via calendarActorId).
 */
export class CalendarMember extends Model {
  declare id: string;
  declare calendarId: string | null;
  declare calendarActorId: string | null;
  declare role: 'owner' | 'editor';
  declare accountId: string | null;
  declare userActorId: string | null;
  declare grantedBy: string | null;

  /**
   * Constructor for CalendarMember.
   *
   * @param {string} id - Unique identifier for the membership
   * @param {string | null} calendarId - ID of the local calendar (null for remote calendar membership)
   * @param {string | null} calendarActorId - ID of the calendar actor (for remote calendar membership, null for local)
   * @param {'owner' | 'editor'} role - Role of the member
   * @param {string | null} accountId - Local account ID (null for remote members)
   * @param {string | null} userActorId - Remote actor ID (null for local members)
   * @param {string | null} grantedBy - Account ID of who granted access (null for original owner)
   */
  constructor(
    id: string,
    calendarId: string | null,
    calendarActorId: string | null,
    role: 'owner' | 'editor',
    accountId: string | null = null,
    userActorId: string | null = null,
    grantedBy: string | null = null,
  ) {
    super();
    this.id = id;
    this.calendarId = calendarId;
    this.calendarActorId = calendarActorId;
    this.role = role;
    this.accountId = accountId;
    this.userActorId = userActorId;
    this.grantedBy = grantedBy;
  }

  /**
   * Converts the calendar member to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarId: this.calendarId,
      calendarActorId: this.calendarActorId,
      role: this.role,
      accountId: this.accountId,
      userActorId: this.userActorId,
      grantedBy: this.grantedBy,
    };
  }

  /**
   * Creates a CalendarMember instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing member data
   * @returns {CalendarMember} A new CalendarMember instance
   */
  static fromObject(obj: Record<string, any>): CalendarMember {
    return new CalendarMember(
      obj.id || '',
      obj.calendarId || null,
      obj.calendarActorId || null,
      obj.role || 'editor',
      obj.accountId || null,
      obj.userActorId || null,
      obj.grantedBy || null,
    );
  }
}
