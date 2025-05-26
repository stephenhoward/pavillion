import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

export interface CalendarEventCreatedPayload {
  calendar: Calendar;
  event: CalendarEvent;
}

export interface CalendarEventUpdatedPayload {
  calendar: Calendar;
  event: CalendarEvent;
}

export interface CalendarEventDeletedPayload {
  calendar: Calendar;
  eventId: string;
}

export interface CalendarCreatedPayload {
  calendar: Calendar;
}

export interface CalendarUpdatedPayload {
  calendar: Calendar;
}

export interface CalendarDeletedPayload {
  calendarId: string;
}
