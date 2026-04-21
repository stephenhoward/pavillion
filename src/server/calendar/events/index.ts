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
 * Payload for the eventUnreposted event bus emission.
 * Emitted by the AP members service when a calendar un-reposts an event.
 *
 * Note: The payload asymmetry with EventRepostedPayload is intentional.
 * eventReposted sends full objects because the event data is needed to generate
 * instances. eventUnreposted sends primitive IDs because only deletion by
 * compound key is needed, and by the time the event fires the share record
 * may already be destroyed.
 */
export interface EventUnrepostedPayload {
  eventId: string;
  calendarId: string;
}

/**
 * Payload for the eventInstanceCancelled event bus emission.
 * Emitted by EventInstanceService.cancelOccurrenceByDate when a calendar
 * editor cancels a single occurrence of a (possibly recurring) event.
 *
 * Downstream responsibilities:
 *   1. Rebuild the owner calendar's event_instance rows so the cancellation
 *      is reflected in list/detail queries (via buildEventInstances).
 *   2. Propagate the change to federation followers through the existing
 *      AP Update(Event) outbound path (via a re-emission of `eventUpdated`,
 *      which the ActivityPub domain handler listens on).
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
 * Downstream responsibilities match {@link EventInstanceCancelledPayload}:
 * rebuild the owner's instances, and re-emit `eventUpdated` so the AP
 * outbound Update(Event) is sent to followers.
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

export default class CalendarEventHandlers implements DomainEventHandlers {
  private service: CalendarInterface;

  constructor(service: CalendarInterface) {
    this.service = service;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('eventCreated', async (e) => this.service.buildEventInstances(e.event));

    eventBus.on('eventUpdated', async (e) => {
      // Guard on e.calendar before building instances for the owner calendar.
      // When calendar is null/undefined, the update originated from a remote
      // instance (incoming AP Update) so we skip owner instance rebuilding.
      if (e.calendar) {
        await this.service.buildEventInstances(e.event);
      }

      // Always rebuild repost instances regardless of calendar presence,
      // because remote event updates still need to propagate to local reposters.
      await this.service.rebuildAllRepostInstances(e.event);
    });

    eventBus.on('eventDeleted', async (e) => this.service.removeEventInstances(e.event));

    eventBus.on('eventReposted', async (e: EventRepostedPayload) => {
      // Runtime guard: protect against malformed payloads that could cause
      // silent data corruption from missing calendar or event information
      if (!e.calendar?.id) {
        return;
      }
      await this.service.buildRepostInstances(e.event, e.calendar.id);
    });

    eventBus.on('eventUnreposted', async (e: EventUnrepostedPayload) => {
      // Runtime guard: both eventId and calendarId are required for targeted
      // deletion by compound key; skip if either is falsy
      if (!e.eventId || !e.calendarId) {
        return;
      }
      await this.service.removeRepostInstances(e.eventId, e.calendarId);
    });

    eventBus.on('eventInstanceCancelled', async (e: EventInstanceCancelledPayload) => {
      // Runtime guard: protect against malformed payloads missing the
      // required event/calendar identity before rebuild + outbound emit.
      if (!e.event?.id || !e.calendar?.id) {
        return;
      }
      // Rebuild instances on the owning calendar so shown cancellations
      // flip the materialized row's isCancelled flag at list/detail time
      // and hidden cancellations drop the row entirely.
      await this.service.buildEventInstances(e.event);
      // Also refresh every local calendar that reposts this event.
      await this.service.rebuildAllRepostInstances(e.event);
      // Re-emit eventUpdated so the existing AP handler dispatches an
      // outbound Update(Event) to federation followers. Payload shape
      // matches ActivityPubEventUpdatedPayload.
      eventBus.emit('eventUpdated', { calendar: e.calendar, event: e.event });
    });

    eventBus.on('eventInstanceRestored', async (e: EventInstanceRestoredPayload) => {
      // Runtime guard: mirror the cancellation handler.
      if (!e.event?.id || !e.calendar?.id) {
        return;
      }
      await this.service.buildEventInstances(e.event);
      await this.service.rebuildAllRepostInstances(e.event);
      eventBus.emit('eventUpdated', { calendar: e.calendar, event: e.event });
    });
  }
}
