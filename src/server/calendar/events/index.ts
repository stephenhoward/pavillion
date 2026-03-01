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
  }
}
