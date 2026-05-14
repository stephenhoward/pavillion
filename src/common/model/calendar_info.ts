import { Calendar } from './calendar';

/**
 * Interface for calendar data that includes user relationship information
 */
export interface CalendarWithRelationship {
  calendar: any; // Calendar object data
  userRelationship: 'owner' | 'editor';
  canReviewReports?: boolean;
}

/**
 * Extended calendar information that includes the user's relationship to the calendar
 */
export class CalendarInfo {
  public calendar: Calendar;
  public userRelationship: 'owner' | 'editor';
  // Mirrors CalendarService.userCanReviewReports for this account+calendar:
  // true for owners, true for editors with can_review_reports, false otherwise
  // (admin-only access is decided server-side and is not part of this DTO).
  public canReviewReports: boolean;

  constructor(calendar: Calendar, userRelationship: 'owner' | 'editor', canReviewReports: boolean = false) {
    this.calendar = calendar;
    this.userRelationship = userRelationship;
    // Owners always have report-review access; the constructor mirrors the
    // server rule so callers that omit the flag for owners still get true.
    this.canReviewReports = userRelationship === 'owner' ? true : canReviewReports;
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
    const { userRelationship, canReviewReports, ...calendarData } = obj;
    const calendar = Calendar.fromObject(calendarData);
    return new CalendarInfo(calendar, userRelationship, Boolean(canReviewReports));
  }
}
