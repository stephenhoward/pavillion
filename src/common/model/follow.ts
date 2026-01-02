import { PrimaryModel } from './model';

/**
 * Model representing a calendar that the user is following
 */
class FollowingCalendar extends PrimaryModel {
  remoteCalendarId: string;
  calendarId: string;
  autoRepostOriginals: boolean;
  autoRepostReposts: boolean;

  constructor(
    id: string,
    remoteCalendarId: string,
    calendarId: string,
    autoRepostOriginals: boolean = false,
    autoRepostReposts: boolean = false,
  ) {
    super(id);
    this.remoteCalendarId = remoteCalendarId;
    this.calendarId = calendarId;
    this.autoRepostOriginals = autoRepostOriginals;
    this.autoRepostReposts = autoRepostReposts;
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      remoteCalendarId: this.remoteCalendarId,
      calendarId: this.calendarId,
      autoRepostOriginals: this.autoRepostOriginals,
      autoRepostReposts: this.autoRepostReposts,
    };
  }

  static fromObject(obj: Record<string, any>): FollowingCalendar {
    return new FollowingCalendar(
      obj.id,
      obj.remoteCalendarId,
      obj.calendarId,
      obj.autoRepostOriginals ?? false,
      obj.autoRepostReposts ?? false,
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

export { FollowingCalendar, FollowerCalendar };
