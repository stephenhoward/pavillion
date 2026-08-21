import { DateTime } from 'luxon';

import { CalendarEvent } from '@/common/model/events';

/**
 * Resolves an event's start time as an ISO 8601 string for outbound
 * ActivityPub serialization. Shared by EventObject (`startTime` property) and
 * NoteObject (rendered into the Note content), so the paired Event/Note
 * emissions for a single event can never report different start times.
 *
 * Resolution order: the first schedule's startDate; falling back to parsing
 * the event's `date` field as YYYY-MM-DD at midnight UTC; falling back to the
 * current time as a last defensive resort.
 *
 * The string is ISO 8601 so the rendered surface is locale-independent and
 * unambiguous — Mastodon clients render Note content verbatim, so the wire
 * string is what the user sees.
 */
function resolveEventStartTime(event: CalendarEvent): string {
  const firstSchedule = event.schedules[0];
  if (firstSchedule?.startDate) {
    return firstSchedule.startDate.toISO()!;
  }

  if (event.date) {
    const parsed = DateTime.fromISO(String(event.date), { zone: 'utc' });
    if (parsed.isValid) {
      return parsed.toISO()!;
    }
  }

  return DateTime.utc().toISO()!;
}

export { resolveEventStartTime };
