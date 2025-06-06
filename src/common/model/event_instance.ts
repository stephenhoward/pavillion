import { DateTime } from 'luxon';
import { CalendarEvent } from '@/common/model/events';

export default class CalendarEventInstance {
  id: string;
  start: DateTime;
  end: DateTime | null;
  event: CalendarEvent;
  calendarId: string = '';

  constructor(id: string, event: CalendarEvent, start: DateTime, end: DateTime | null) {
    this.id = id;
    this.event = event;
    this.calendarId = event.calendarId;
    this.start = start;
    this.end = end;
  }
  static fromObject(obj: Record<string,any>): CalendarEventInstance {
    return new CalendarEventInstance(
      obj.id,
      CalendarEvent.fromObject(obj.event),
      DateTime.fromISO(obj.start),
      obj.end ? DateTime.fromISO(obj.end) : null,
    );
  }
  toObject(): Record<string, any> {
    return {
      id: this.id,
      event: this.event.toObject(),
      calendarId: this.calendarId,
      start: this.start.toISO(),
      end: this.end ? this.end.toISO() : null,
    };
  }
}
