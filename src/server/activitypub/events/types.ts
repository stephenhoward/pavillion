import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

export interface ActivityPubEventCreatedPayload {
  // Null indicates the event originated from a remote instance (incoming AP
  // Create). The AP handler must early-return on null to avoid re-Announcing
  // a remote event back to federation. Mirrors ActivityPubEventUpdatedPayload.
  calendar: Calendar | null;
  event: CalendarEvent;
}

export interface ActivityPubEventUpdatedPayload {
  calendar: Calendar | null;
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
