import { PrimaryModel } from './model';

/**
 * Model representing a calendar that the user is following
 */
class FollowingCalendar extends PrimaryModel {
  calendarActorId: string;
  calendarId: string;
  autoRepostOriginals: boolean;
  autoRepostReposts: boolean;

  constructor(
    id: string,
    calendarActorId: string,
    calendarId: string,
    autoRepostOriginals: boolean = false,
    autoRepostReposts: boolean = false,
  ) {
    super(id);
    this.calendarActorId = calendarActorId;
    this.calendarId = calendarId;
    this.autoRepostOriginals = autoRepostOriginals;
    this.autoRepostReposts = autoRepostReposts;
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      remoteCalendarId: this.calendarActorId,
      calendarId: this.calendarId,
      autoRepostOriginals: this.autoRepostOriginals,
      autoRepostReposts: this.autoRepostReposts,
    };
  }

  static fromObject(obj: Record<string, any>): FollowingCalendar {
    return new FollowingCalendar(
      obj.id,
      obj.calendarActorId,
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
  calendarActorId: string;
  calendarId: string;

  constructor(id: string, calendarActorId: string, calendarId: string) {
    super(id);
    this.calendarActorId = calendarActorId;
    this.calendarId = calendarId;
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      calendarActorId: this.calendarActorId,
      calendarId: this.calendarId,
    };
  }

  static fromObject(obj: Record<string, any>): FollowerCalendar {
    return new FollowerCalendar(
      obj.id,
      obj.calendarActorId,
      obj.calendarId,
    );
  }
}

export { FollowingCalendar, FollowerCalendar };
