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

/**
 * Bus event names.
 *
 * Colon-delimited `{domain}:{resource}:{action}` events emitted on editor
 * membership transitions. These are consumed by the notifications domain
 * to record activity rows and address an explicit single-recipient audience
 * (the invitee / revoked editor).
 *
 * The pre-existing camelCase events on this bus (`eventCreated`,
 * `eventUpdated`, `remoteEditorRevoked`, etc.) are retained for their
 * existing handlers and are not displaced by these new bus events.
 */
export const CALENDAR_BUS_EVENTS = {
  EDITOR_INVITED: 'calendar:editor:invited',
  EDITOR_REVOKED: 'calendar:editor:revoked',
} as const;

/**
 * Payload for `calendar:editor:invited`.
 *
 * Fires when an existing local account is granted editor access to a
 * calendar (the local-account path inside `grantEditorAccess`). The
 * `accountId` is the invitee — the notifications handler uses it to
 * build an `audience.kind='explicit'` (single recipient, no role
 * resolution needed).
 *
 * Pending invitations sent to email addresses that have no local
 * account yet do NOT fire this event — there is no account_id to
 * address until the invitation is accepted. Those flows continue to
 * deliver an `editor_invitation_email` independently.
 */
export interface EditorInvitedPayload {
  calendarId: string;
  accountId: string;
  grantedBy: string;
}

/**
 * Payload for `calendar:editor:revoked`.
 *
 * Fires when a local editor's access to a calendar is removed (the
 * local-account path inside `removeEditAccess` / `revokeEditorAccess`).
 * The `accountId` is the revoked editor — the notifications handler
 * uses it to build an `audience.kind='explicit'` (single recipient).
 *
 * Remote (federated) editor removal continues to emit the pre-existing
 * `remoteEditorRevoked` event and is not handled here.
 */
export interface EditorRevokedPayload {
  calendarId: string;
  accountId: string;
  revokedBy: string;
}
