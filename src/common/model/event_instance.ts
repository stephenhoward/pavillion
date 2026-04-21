import { DateTime } from 'luxon';
import { CalendarEvent } from '@/common/model/events';

export default class CalendarEventInstance {
  id: string;
  start: DateTime;
  end: DateTime | null;
  event: CalendarEvent;
  calendarId: string = '';
  /**
   * Flag indicating the occurrence has been cancelled by the calendar owner.
   * Set by the service layer at listing time based on the presence of a
   * RECURRENCE-ID exclusion schedule for this instance. This is an explicit
   * serialized flag — {@link fromObject} reads it as-is rather than recomputing
   * so it survives client/server round trips.
   */
  isCancelled: boolean = false;

  constructor(id: string, event: CalendarEvent, start: DateTime, end: DateTime | null) {
    this.id = id;
    this.event = event;
    this.calendarId = event.calendarId;
    this.start = start;
    this.end = end;
  }
  static fromObject(obj: Record<string,any>): CalendarEventInstance {
    const instance = new CalendarEventInstance(
      obj.id,
      CalendarEvent.fromObject(obj.event),
      DateTime.fromISO(obj.start),
      obj.end ? DateTime.fromISO(obj.end) : null,
    );
    // Read the flag as-is — do not recompute. The service layer owns the
    // decision of whether an instance is cancelled at listing time.
    instance.isCancelled = obj.isCancelled === true;
    return instance;
  }
  toObject(): Record<string, any> {
    return {
      id: this.id,
      event: this.event.toObject(),
      calendarId: this.calendarId,
      start: this.start.toISO(),
      end: this.end ? this.end.toISO() : null,
      isCancelled: this.isCancelled,
    };
  }
}
