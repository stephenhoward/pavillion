import { Model } from './model';

/**
 * Represents a calendar editor relationship
 * Simple binary model: either someone has edit access or they don't
 */
export class CalendarEditor extends Model {
  declare id: string;
  declare calendarId: string;
  declare email: string;
  declare displayName: string | null;
  declare username: string | null;

  /**
   * Constructor for CalendarEditor.
   *
   * @param {string} id - Unique identifier for the editor relationship
   * @param {string} calendarId - ID of the calendar
   * @param {string} email - Email of the user with edit access
   * @param {string | null} [displayName] - Display name of the user, if set
   * @param {string | null} [username] - Username of the user
   */
  constructor(
    id: string,
    calendarId: string,
    email: string,
    displayName: string | null = null,
    username: string | null = null,
  ) {
    super();
    this.id = id;
    this.calendarId = calendarId;
    this.email = email;
    this.displayName = displayName;
    this.username = username;
  }

  /**
   * Converts the calendar editor to a plain JavaScript object.
   *
   * @returns {Record<string, any>} Plain object representation
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarId: this.calendarId,
      email: this.email,
      displayName: this.displayName,
      username: this.username,
    };
  }

  /**
   * Creates a CalendarEditor instance from a plain object.
   *
   * @param {Record<string, any>} obj - Plain object containing editor data
   * @returns {CalendarEditor} A new CalendarEditor instance
   */
  static fromObject(obj: Record<string, any>): CalendarEditor {
    const editor = new CalendarEditor(
      obj.id || '',
      obj.calendarId || '',
      obj.email || '',
      obj.displayName ?? null,
      obj.username ?? null,
    );

    return editor;
  }
}
