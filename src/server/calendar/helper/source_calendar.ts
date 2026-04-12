import config from 'config';
import { CalendarEvent } from '@/common/model/events';

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
 * - event.calendarId === null -> remote repost (federated event)
 * - event.calendarId !== displayCalendarId -> local repost
 * - otherwise -> not a repost
 *
 * For local reposts, source calendar info is resolved from the eager-loaded
 * CalendarEntity. For remote reposts, the caller provides a pre-resolved map
 * of eventId -> attributed_to actor URI (fetched via ActivityPubInterface).
 *
 * @param contexts - Array of repost contexts to enrich
 * @param remoteActorUriMap - Pre-resolved map of eventId to attributed_to actor URI
 */
export async function resolveSourceCalendars(
  contexts: RepostContext[],
  remoteActorUriMap: Map<string, string>,
): Promise<void> {
  for (const ctx of contexts) {
    if (ctx.eventCalendarId === null) {
      // Remote repost — resolve via pre-resolved actor URI map.
      // Without SharedEventEntity context here we default to 'manual';
      // callers that know the actual auto/manual distinction should set it.
      if (ctx.event.repostStatus === 'none') {
        ctx.event.repostStatus = 'manual';
      }
      const attributedTo = remoteActorUriMap.get(ctx.event.id);
      if (attributedTo) {
        const parsed = parseAttributedToUri(attributedTo);
        if (parsed) {
          ctx.event.sourceCalendar = parsed;
        }
      }
    }
    else if (ctx.eventCalendarId !== ctx.displayCalendarId) {
      // Local repost — resolve from eager-loaded calendar data.
      // Default to 'manual' when no more specific status has been set.
      if (ctx.event.repostStatus === 'none') {
        ctx.event.repostStatus = 'manual';
      }
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
