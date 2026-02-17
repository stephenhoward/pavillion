import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

export interface ActivityPubEventCreatedPayload {
  calendar: Calendar;
  event: CalendarEvent;
}

export interface ActivityPubEventUpdatedPayload {
  calendar: Calendar;
  event: CalendarEvent;
}

export interface ActivityPubEventDeletedPayload {
  calendar: Calendar;
  event: CalendarEvent;
}

export interface AccountCreatedPayload {
  accountId: string;
  username: string;
  domain: string;
}

export interface CalendarCreatedPayload {
  calendarId: string;
  urlName: string;
  domain: string;
}

export interface RemoteEditorRevokedPayload {
  calendarId: string;
  actorUri: string;
}
