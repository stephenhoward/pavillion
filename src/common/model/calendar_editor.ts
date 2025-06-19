import { Model } from './model';

/**
 * Represents a calendar editor relationship
 * Simple binary model: either someone has edit access or they don't
 */
export class CalendarEditor extends Model {
  declare id: string;
  declare calendarId: string;
  declare email: string;

  /**
   * Constructor for CalendarEditor.
   *
   * @param {string} id - Unique identifier for the editor relationship
   * @param {string} calendarId - ID of the calendar
   * @param {string} email - Email of the user with edit access
   */
  constructor(
    id: string,
    calendarId: string,
    email: string,
  ) {
    super();
    this.id = id;
    this.calendarId = calendarId;
    this.email = email;
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
    );

    return editor;
  }
}
