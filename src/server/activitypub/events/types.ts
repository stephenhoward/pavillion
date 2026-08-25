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

/**
 * Provenance discriminator for the `activitypub:event:reposted` bus event.
 *
 * All three values describe how the Announce reached this instance, not how
 * the resulting notification is classified — the notifications domain stores
 * `origin='federated'` for every value because the activity always routes
 * through the AP layer (see `handleEventReposted` in the notifications
 * domain). Named `provenance` rather than `origin` precisely so it cannot be
 * confused with that stored column.
 *
 * - `local-manual`: a signed-in user shared the event onto one of this
 *   instance's calendars (`ActivityPubService.shareEvent`).
 * - `local-auto`: this instance's auto-repost policy created the share
 *   (`ProcessInboxService.checkAndPerformAutoRepost`, or `shareEvent` with
 *   `autoPosted=true`).
 * - `federated-inbound`: a remote actor's Announce of a locally-owned event
 *   arrived at the AP inbox (`ProcessInboxService.processShareEvent`). This
 *   path also fires for DEC-013 `local_dispatch` round-trips of a local
 *   share; notification dedup collapses those with the direct emission.
 */
export type EventRepostProvenance = 'local-manual' | 'local-auto' | 'federated-inbound';

/**
 * Payload for the `activitypub:event:reposted` bus event — the single
 * canonical repost signal, emitted on every repost path. The notifications
 * domain is the sole subscriber.
 *
 * - `eventId` / `calendarId`: the announced event and its owning (source)
 *   calendar. Emitters only fire this event when the event is locally owned
 *   (`calendarId` is never null on the wire) — a repost of a remote-origin
 *   event has no local source calendar to notify.
 * - `provenance`: see {@link EventRepostProvenance}.
 * - `reposterDisplayName`: display name of the reposting actor, computed at
 *   emit time by the AP service from the object it already holds (the local
 *   reposting Calendar, or the remote actor's cached display name). Omitted
 *   when no non-empty name is in hand; the notifications handler then falls
 *   back to its local-actor URI resolution.
 * - `reposterUrl`: the reposting actor's AP URI; nullable purely for
 *   defensive payload-construction.
 * - `reposterCalendarId`: set when the repost originated from a local
 *   calendar (manual or auto). The notifications handler uses it to exclude
 *   the reposting calendar's editors from the source-calendar audience.
 *   Omitted for purely federated reposts.
 */
export interface ActivityPubEventRepostedPayload {
  eventId: string;
  calendarId: string;
  provenance: EventRepostProvenance;
  reposterDisplayName?: string;
  reposterUrl: string | null;
  reposterCalendarId?: string;
}

/**
 * Emitted by `ActivityPubService.unfollowCalendar` after the local follow
 * row(s) are destroyed and the Undo(Follow) is queued. The calendar domain
 * consumes it to clear the `origin_uri` dedup stamps on Places/Spaces the
 * follower mirrored from the unfollowed source.
 *
 * - `calendarId`: id of the local Calendar that unfollowed.
 * - `sourceActorUri`: actor URI of the remote calendar that was unfollowed.
 */
export interface ActivityPubCalendarUnfollowedPayload {
  calendarId: string;
  sourceActorUri: string;
}
