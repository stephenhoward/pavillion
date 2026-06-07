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

/**
 * Emitted when a remote instance's Accept(Follow) confirms a follow we
 * initiated on a remote-type target. Consumers (the in-domain handler)
 * publish an `activitypub:follow:backfill` pg-boss job so the worker
 * can pull the remote calendar's event history into Pavillion.
 *
 * - `followingCalendarId`: id of the local Calendar that initiated the follow
 *   (FollowingCalendarEntity.calendar_id).
 * - `calendarActorId`: id of the remote CalendarActorEntity being followed
 *   (FollowingCalendarEntity.calendar_actor_id).
 * - `sourceActorUri`: actor URI of the remote calendar whose outbox the
 *   backfill worker will read.
 */
export interface ActivityPubFollowAcceptedPayload {
  followingCalendarId: string;
  calendarActorId: string;
  sourceActorUri: string;
}
