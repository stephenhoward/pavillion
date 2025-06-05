import { DateTime } from 'luxon';
import { CalendarEvent } from '@/common/model/events';

export default class CalendarEventInstance {
  start: DateTime;
  end: DateTime | null;
  event: CalendarEvent;
  calendarId: string = '';

  constructor(event: CalendarEvent, start: DateTime, end: DateTime | null) {
    this.event = event;
    this.calendarId = event.calendarId;
    this.start = start;
    this.end = end;
  }
  static fromObject(obj: Record<string,any>): CalendarEventInstance {
    return new CalendarEventInstance(
      CalendarEvent.fromObject(obj.event),
      DateTime.fromISO(obj.start),
      obj.end ? DateTime.fromISO(obj.end) : null,
    );
  }
  toObject(): Record<string, any> {
    return {
      event: this.event.toObject(),
      calendarId: this.calendarId,
      start: this.start.toISO(),
      end: this.end ? this.end.toISO() : null,
    };
  }
}
