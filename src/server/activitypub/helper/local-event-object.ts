/**
 * Resolves an ActivityPub URL naming an event on this instance to the event's
 * EventObjectEntity, creating the row when the event has none (for example a
 * seed event inserted directly into the database).
 */

import config from 'config';
import { UniqueConstraintError } from 'sequelize';

import { EventNotFoundError } from '@/common/exceptions/calendar';
import CalendarInterface from '@/server/calendar/interface';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import { EventObject } from '@/server/activitypub/model/object/event';
import { looksLikeUuid } from '@/server/common/helper/uuid';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

/**
 * The path EventObject.eventUrl builds: /calendars/<urlName>/events/<id>.
 * The calendar segment is matched for shape only; the row's ap_id is rebuilt
 * from the event's owning calendar.
 */
const LOCAL_EVENT_PATH = /^\/calendars\/[^/]+\/events\/([^/]+)$/;

/**
 * Returns the event id named by a URL in the exact local event-URL shape, or
 * null for anything else: a parse failure, a scheme other than https, a host
 * other than the configured domain (an explicit non-default port counts as
 * another host), userinfo, a query or fragment, or any other path.
 */
function localEventIdFromUrl(apUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(apUrl);
  }
  catch {
    return null;
  }

  if (url.protocol !== 'https:'
    || url.host.toLowerCase() !== String(config.get('domain')).toLowerCase()
    || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '') {
    return null;
  }

  const match = url.pathname.match(LOCAL_EVENT_PATH);
  if (!match || !looksLikeUuid(match[1])) {
    return null;
  }
  return match[1];
}

/**
 * Finds the EventObjectEntity for a local event named by its ActivityPub URL,
 * creating one if the event has none.
 *
 * Returns null, and creates nothing, unless the URL has the exact local
 * event-URL shape on this instance's domain and names an existing event that
 * belongs to a calendar. A created row carries the canonical ap_id
 * (EventObject.eventUrl of the owning calendar) and the owning calendar's
 * actor as attribution.
 *
 * Safe under concurrent calls for the same event: a create that loses the race
 * on the entity's unique indexes re-reads the winner by event_id.
 */
export async function findOrCreateLocalEventObject(
  apUrl: string,
  calendarInterface: CalendarInterface,
): Promise<EventObjectEntity | null> {
  const eventId = localEventIdFromUrl(apUrl);
  if (!eventId) {
    return null;
  }

  let event;
  try {
    event = await calendarInterface.getEventById(eventId);
  }
  catch (error) {
    if (error instanceof EventNotFoundError) {
      return null;
    }
    throw error;
  }
  if (!event?.calendarId) {
    return null;
  }

  const calendar = await calendarInterface.getCalendar(event.calendarId);
  if (!calendar) {
    return null;
  }

  const existing = await EventObjectEntity.findOne({ where: { event_id: event.id } });
  if (existing) {
    return existing;
  }

  try {
    const created = await EventObjectEntity.create({
      event_id: event.id,
      ap_id: EventObject.eventUrl(calendar, event),
      attributed_to: ActivityPubActor.actorUrl(calendar),
    });
    logger.info({ eventId: event.id, calendarId: calendar.id }, 'created EventObjectEntity for local event');
    return created;
  }
  catch (error) {
    if (error instanceof UniqueConstraintError) {
      const winner = await EventObjectEntity.findOne({ where: { event_id: event.id } });
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
}
