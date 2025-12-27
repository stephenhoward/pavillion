import { PrimaryModel } from './model';

/**
 * Enum for auto-repost policy options
 */
enum AutoRepostPolicy {
  MANUAL = 'manual',
  ORIGINAL = 'original',
  ALL = 'all',
}

/**
 * Model representing a calendar that the user is following
 */
class FollowingCalendar extends PrimaryModel {
  remoteCalendarId: string;
  calendarId: string;
  repostPolicy: AutoRepostPolicy;

  constructor(id: string, remoteCalendarId: string, calendarId: string, repostPolicy: AutoRepostPolicy = AutoRepostPolicy.MANUAL) {
    super(id);
    this.remoteCalendarId = remoteCalendarId;
    this.calendarId = calendarId;
    this.repostPolicy = repostPolicy;
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      remoteCalendarId: this.remoteCalendarId,
      calendarId: this.calendarId,
      repostPolicy: this.repostPolicy,
    };
  }

  static fromObject(obj: Record<string, any>): FollowingCalendar {
    return new FollowingCalendar(
      obj.id,
      obj.remoteCalendarId,
      obj.calendarId,
      obj.repostPolicy || AutoRepostPolicy.MANUAL,
    );
  }
}

/**
 * Model representing a calendar that is following the user
 */
class FollowerCalendar extends PrimaryModel {
  remoteCalendarId: string;
  calendarId: string;

  constructor(id: string, remoteCalendarId: string, calendarId: string) {
    super(id);
    this.remoteCalendarId = remoteCalendarId;
    this.calendarId = calendarId;
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      remoteCalendarId: this.remoteCalendarId,
      calendarId: this.calendarId,
    };
  }

  static fromObject(obj: Record<string, any>): FollowerCalendar {
    return new FollowerCalendar(
      obj.id,
      obj.remoteCalendarId,
      obj.calendarId,
    );
  }
}

export { FollowingCalendar, FollowerCalendar, AutoRepostPolicy };
