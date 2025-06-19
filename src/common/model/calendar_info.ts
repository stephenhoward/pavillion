import { Calendar } from './calendar';

/**
 * Interface for calendar data that includes user relationship information
 */
export interface CalendarWithRelationship {
  calendar: any; // Calendar object data
  userRelationship: 'owner' | 'editor';
}

/**
 * Extended calendar information that includes the user's relationship to the calendar
 */
export class CalendarInfo {
  public calendar: Calendar;
  public userRelationship: 'owner' | 'editor';

  constructor(calendar: Calendar, userRelationship: 'owner' | 'editor') {
    this.calendar = calendar;
    this.userRelationship = userRelationship;
  }

  /**
   * Check if the user is the owner of this calendar
   */
  get isOwner(): boolean {
    return this.userRelationship === 'owner';
  }

  /**
   * Check if the user is an editor (but not owner) of this calendar
   */
  get isEditor(): boolean {
    return this.userRelationship === 'editor';
  }

  /**
   * Get a display name for the calendar with relationship indicator
   */
  get displayName(): string {
    const baseName = this.calendar.content?.('en')?.name || this.calendar.urlName;
    return this.isEditor ? `${baseName} (Editor)` : baseName;
  }

  /**
   * Create CalendarInfo from API response object
   */
  static fromObject(obj: any): CalendarInfo {
    const { userRelationship, ...calendarData } = obj;
    const calendar = Calendar.fromObject(calendarData);
    return new CalendarInfo(calendar, userRelationship);
  }
}
