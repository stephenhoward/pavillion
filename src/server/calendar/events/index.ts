import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '../interface';

/**
 * Payload for the eventReposted event bus emission.
 * Emitted by the AP members service when a calendar reposts an event.
 * The calendar property is the REPOSTING calendar, not the original owner.
 */
export interface EventRepostedPayload {
  event: CalendarEvent;
  calendar: Calendar;
}

/**
 * Payload for the activitypub:event:unreposted event bus emission.
 * Emitted by the AP members service for both flows:
 *   - Local unpost (owner-initiated): a local editor un-reposts an event on
 *     their calendar via members.unshareEvent. Carries the editor identity
 *     (actorAccountId set, actorUrl null).
 *   - Inbound unshare (federation-initiated): a remote calendar sends an
 *     Undo(Announce) for an event we currently auto-repost. Carries the
 *     remote actor identity (actorAccountId null, actorUrl set to the
 *     remote actor's https:// URL).
 *
 * Local-event invariant: the event being unreposted is local to this
 * instance. Inbound unshare for remote-origin events is out of scope and
 * filtered at the inbox emit site.
 *
 * Idempotency: emit fires once per destroyed SharedEventEntity row. A
 * second unshare on an already-dismissed event has no row to destroy and
 * therefore no emit (see DEC-008 sticky-dismissal flow).
 *
 * Note: The payload asymmetry with EventRepostedPayload is intentional.
 * eventReposted sends full objects because the event data is needed to generate
 * instances. activitypub:event:unreposted sends primitive IDs because only
 * deletion by compound key is needed, and by the time the event fires the
 * share record may already be destroyed.
 *
 * `actorAccountId` identifies the local editor who performed the unpost so
 * the notifications-domain handler can exclude the actor from the co-editor
 * fan-out. `actorUrl` carries the remote actor's profile URL on the inbound
 * branch so the notification can link back to them. Exactly one of the two
 * is non-null depending on which flow emitted.
 */
export interface EventUnrepostedPayload {
  eventId: string;
  calendarId: string;
  actorName: string;
  actorUrl: string | null;
  actorAccountId: string | null;
}

/**
 * Payload for the eventInstanceCancelled event bus emission.
 * Emitted by EventInstanceService.cancelOccurrenceByDate when a calendar
 * editor cancels a single occurrence of a (possibly recurring) event.
 *
 * Downstream responsibility:
 *   - Propagate the change to federation followers through the existing
 *     AP Update(Event) outbound path (via a re-emission of `eventUpdated`,
 *     which the ActivityPub domain handler listens on).
 *
 * Note: cancellation state lives in EventScheduleEntity exclusion rows, not
 * on event_instance rows (there is no is_cancelled column). The cancel /
 * restore handlers therefore intentionally do NOT call buildEventInstances
 * — read-time queries derive cancelled state from exclusions. Calling
 * buildEventInstances here would only delete-then-reinsert identical rows,
 * and racing dangling promises from rapid cancel→restore sequences could
 * collide with the unique (event_id, start_time) index restored in
 * pv-hr72.3, surfacing as SequelizeUniqueConstraintError.
 *
 * Note on naming: the bus event name `eventInstanceCancelled` intentionally
 * retains the legacy camelCase shape rather than the `{domain}:{resource}:{action}`
 * convention, because ActivityPub domain handlers already subscribe to this
 * exact name. Renaming would silently break federation propagation.
 */
export interface EventInstanceCancelledPayload {
  calendar: Calendar;
  event: CalendarEvent;
  hideFromPublic: boolean;
}

/**
 * Payload for the eventInstanceRestored event bus emission.
 * Emitted by EventInstanceService.restoreOccurrenceByDate when a calendar
 * editor reverses a previous occurrence cancellation.
 *
 * Downstream responsibility matches {@link EventInstanceCancelledPayload}:
 * re-emit `eventUpdated` so the AP outbound Update(Event) is sent to
 * followers. No instance row regeneration — cancellation state is
 * exclusion-row-based.
 *
 * Note on naming: the bus event name `eventInstanceRestored` intentionally
 * retains the legacy camelCase shape rather than the `{domain}:{resource}:{action}`
 * convention, because ActivityPub domain handlers already subscribe to this
 * exact name. Renaming would silently break federation propagation.
 */
export interface EventInstanceRestoredPayload {
  calendar: Calendar;
  event: CalendarEvent;
}

/**
 * Payload for the eventCreated event bus emission.
 *
 * `calendar` may be null when the event originated from a remote instance
 * (emitted by EventService.addRemoteEvent). The calendar-domain handler
 * calls buildEventInstances on the event regardless, while the AP handler
 * early-returns on null to avoid re-Announcing a remote-origin event back
 * to federation. Mirrors EventUpdatedPayload's nullable shape.
 */
export interface EventCreatedPayload {
  calendar: Calendar | null;
  event: CalendarEvent;
}

/**
 * Payload for the eventUpdated event bus emission.
 *
 * `skipRebuild` is an internal flag set by the cancel / restore handlers
 * when re-emitting eventUpdated solely to drive AP outbound propagation.
 * It instructs the calendar-domain eventUpdated handler to skip the
 * buildEventInstances call, which would otherwise delete-then-reinsert
 * the canonical instance rows. Skipping the rebuild is correct because
 * cancellation state lives in exclusion rows, not on event_instance, and
 * dangling rebuild promises racing across cancel→restore can collide with
 * the unique (event_id, start_time) index.
 *
 * The ActivityPub eventUpdated handler ignores the flag — outbound
 * Update(Event) propagation must still run.
 */
export interface EventUpdatedPayload {
  calendar: Calendar | null;
  event: CalendarEvent;
  skipRebuild?: boolean;
}

export default class CalendarEventHandlers implements DomainEventHandlers {
  private service: CalendarInterface;

  constructor(service: CalendarInterface) {
    this.service = service;
  }

  install(eventBus: EventEmitter): void {
    // Single-producer model (pv-hr72): only the originating calendar
    // materializes instance rows. When `calendar` is present, the create
    // originated locally — rebuild on the owning calendar. When `calendar`
    // is absent (emitted by EventService.addRemoteEvent), the create
    // originated from a remote instance (incoming AP Create); we still call
    // buildEventInstances so the canonical row(s) for the remote event are
    // materialized at receive time. Without this, list views on follower
    // calendars would miss freshly-federated remote events (pv-13xg).
    eventBus.on('eventCreated', async (e: EventCreatedPayload) => this.service.buildEventInstances(e.event));

    eventBus.on('eventUpdated', async (e: EventUpdatedPayload) => {
      // Cancel / restore handlers re-emit eventUpdated with skipRebuild:true
      // purely to drive AP outbound propagation. Rebuilding here would
      // race with concurrent cancel↔restore writes against the unique
      // (event_id, start_time) index — and is unnecessary work besides,
      // since cancellation state lives in exclusion rows, not event_instance.
      if (e?.skipRebuild) {
        return;
      }
      // Single-producer model (pv-hr72): only the originating calendar
      // materializes instance rows. When `calendar` is present, the update
      // originated locally — rebuild on the owning calendar. When `calendar`
      // is absent, the update originated from a remote instance (incoming AP
      // Update) and the event is owned remotely; we still call
      // buildEventInstances against the event so its canonical row(s) reflect
      // the new schedule. Repost-display calendars derive visibility through
      // the listing-time union (EventService.listEventIdsForCalendar) and
      // need no per-calendar fan-out.
      await this.service.buildEventInstances(e.event);
    });

    eventBus.on('eventDeleted', async (e) => this.service.removeEventInstances(e.event));

    // Signal preservation only — under the single-producer model the
    // originating-calendar instance rows already exist; reposting a published
    // event never adds a new row. Listing for the reposting calendar picks
    // the event up via the visible-id union driven by the repost link.
    // Handler retained as a one-line stub so future hooks (analytics,
    // notifications, etc.) have a documented integration point.
    eventBus.on('eventReposted', async () => {
      /* signal preservation: no instance fan-out under pv-hr72 single-producer */
    });

    // Signal preservation only — un-reposting removes the link row, which is
    // sufficient to stop the calendar from showing the event via the listing
    // union. No per-calendar instance rows exist to delete under the
    // single-producer model.
    eventBus.on('activitypub:event:unreposted', async () => {
      /* signal preservation: no instance fan-out under pv-hr72 single-producer */
    });

    eventBus.on('eventInstanceCancelled', async (e: EventInstanceCancelledPayload) => {
      // Runtime guard: protect against malformed payloads missing the
      // required event/calendar identity before outbound emit.
      if (!e.event?.id || !e.calendar?.id) {
        return;
      }
      // No buildEventInstances call: cancellation state is represented by
      // EventScheduleEntity exclusion rows (already written by
      // cancelOccurrenceByDate). event_instance has no is_cancelled column,
      // so a rebuild here would only delete-then-reinsert identical rows
      // and risk racing the unique (event_id, start_time) index across
      // rapid cancel→restore sequences.
      //
      // Re-emit eventUpdated so the existing AP handler dispatches an
      // outbound Update(Event) to federation followers. skipRebuild:true
      // tells the calendar-domain eventUpdated handler to skip its
      // buildEventInstances call for the same race-avoidance reason.
      // Payload shape matches ActivityPubEventUpdatedPayload (extra
      // skipRebuild field is ignored by the AP handler).
      eventBus.emit('eventUpdated', {
        calendar: e.calendar,
        event: e.event,
        skipRebuild: true,
      });
    });

    eventBus.on('eventInstanceRestored', async (e: EventInstanceRestoredPayload) => {
      // Runtime guard: mirror the cancellation handler.
      if (!e.event?.id || !e.calendar?.id) {
        return;
      }
      // See eventInstanceCancelled: no rebuild on restore either, because
      // exclusion-row deletion (already done by restoreOccurrenceByDate) is
      // the sole state change and event_instance rows are unaffected.
      eventBus.emit('eventUpdated', {
        calendar: e.calendar,
        event: e.event,
        skipRebuild: true,
      });
    });
  }
}
