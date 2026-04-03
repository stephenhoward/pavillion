import config from 'config';
import { Op } from 'sequelize';
import { CalendarEvent } from '@/common/model/events';
// Deliberate cross-domain import: EventObjectEntity is needed to resolve the
// attributed_to actor URI for remote reposted events. This is a known DEC-003
// violation to be cleaned up in Phase 4 domain boundary work.
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';

/**
 * Contextual information needed to detect whether an event is a repost
 * and resolve its source calendar.
 */
export interface RepostContext {
  /** The event model to enrich */
  event: CalendarEvent;
  /** The calendar_id of the instance displaying this event */
  displayCalendarId: string;
  /** The event's owning calendar_id (null for remote/federated events) */
  eventCalendarId: string | null;
  /** The url_name from the eager-loaded CalendarEntity, if available */
  sourceCalendarUrlName?: string;
}

/**
 * Enriches events with sourceCalendar information based on repost status.
 *
 * Repost detection:
 * - event.calendarId === null → remote repost (federated event)
 * - event.calendarId !== displayCalendarId → local repost
 * - otherwise → not a repost
 *
 * For local reposts, source calendar info is resolved from the eager-loaded
 * CalendarEntity. For remote reposts, EventObjectEntity is batch-queried
 * to parse the attributed_to actor URI.
 */
export async function resolveSourceCalendars(contexts: RepostContext[]): Promise<void> {
  const remoteEventIds: string[] = [];

  for (const ctx of contexts) {
    if (ctx.eventCalendarId === null) {
      // Remote repost — will resolve via EventObjectEntity below
      ctx.event.isRepost = true;
      remoteEventIds.push(ctx.event.id);
    }
    else if (ctx.eventCalendarId !== ctx.displayCalendarId) {
      // Local repost — resolve from eager-loaded calendar data
      ctx.event.isRepost = true;
      if (ctx.sourceCalendarUrlName) {
        const domain: string = config.get('domain');
        ctx.event.sourceCalendar = {
          urlName: ctx.sourceCalendarUrlName,
          host: domain,
          url: `/view/${ctx.sourceCalendarUrlName}`,
        };
      }
    }
    // else: not a repost — defaults are already correct
  }

  // Batch-resolve remote reposts via EventObjectEntity
  if (remoteEventIds.length > 0) {
    const eventObjects = await EventObjectEntity.findAll({
      where: { event_id: { [Op.in]: remoteEventIds } },
    });

    const objectMap = new Map<string, EventObjectEntity>();
    for (const obj of eventObjects) {
      objectMap.set(obj.event_id, obj);
    }

    for (const ctx of contexts) {
      if (ctx.event.isRepost && ctx.event.sourceCalendar === null) {
        const eventObject = objectMap.get(ctx.event.id);
        if (eventObject?.attributed_to) {
          const parsed = parseAttributedToUri(eventObject.attributed_to);
          if (parsed) {
            ctx.event.sourceCalendar = parsed;
          }
        }
      }
    }
  }
}

/**
 * Parses an ActivityPub attributed_to URI to extract source calendar information.
 * Expected format: https://{host}/calendars/{urlName}
 *
 * @param uri - The attributed_to URI to parse
 * @returns Source calendar info or null if parsing fails
 */
export function parseAttributedToUri(uri: string): { urlName: string; host: string; url: string } | null {
  try {
    const url = new URL(uri);

    // Only allow HTTP(S) schemes — reject javascript:, data:, ftp:, etc.
    // to prevent stored XSS via crafted federation data.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    // Remove trailing slash and split path segments
    const segments = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);

    // Expected pattern: /calendars/{urlName}
    const calendarIndex = segments.indexOf('calendars');
    if (calendarIndex === -1 || calendarIndex + 1 >= segments.length) {
      return null;
    }

    const urlName = segments[calendarIndex + 1];
    return {
      urlName,
      host: url.host,
      url: `${url.protocol}//${url.host}/view/${urlName}`,
    };
  }
  catch {
    // Malformed URI — return null gracefully
    return null;
  }
}
