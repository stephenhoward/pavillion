import { DateTime } from 'luxon';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventLocation } from '@/common/model/location';

const ICS_DAY_MAP = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * Formats a Luxon DateTime as an ICS datetime string (YYYYMMDDTHHMMSSZ).
 */
function formatIcsDate(dt: DateTime): string {
  return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

/**
 * Escapes text for ICS field values per RFC 5545.
 */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

/**
 * Folds long ICS lines at 75 octets per RFC 5545 Section 3.1.
 * Folds on character boundaries to avoid splitting multi-byte UTF-8 sequences.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  const maxLen = 75;

  if (bytes.length <= maxLen) return line;

  const parts: string[] = [];
  let remaining = line;
  let isFirst = true;

  while (remaining.length > 0) {
    const limit = isFirst ? maxLen : maxLen - 1; // account for leading space on continuation lines
    let charCount = 0;
    let byteCount = 0;

    for (const char of remaining) {
      const charBytes = encoder.encode(char).length;
      if (byteCount + charBytes > limit) break;
      byteCount += charBytes;
      charCount += char.length; // handle surrogate pairs
    }

    if (charCount === 0) charCount = 1; // always make progress

    const chunk = remaining.substring(0, charCount);
    parts.push(isFirst ? chunk : ' ' + chunk);
    remaining = remaining.substring(charCount);
    isFirst = false;
  }

  return parts.join('\r\n');
}

/**
 * Converts a CalendarEventSchedule to an ICS RRULE string.
 * Returns null for schedules without a frequency (single-date schedules).
 */
function scheduleToRRule(schedule: CalendarEventSchedule): string | null {
  if (!schedule.frequency) return null;

  const parts: string[] = [`FREQ=${schedule.frequency.toUpperCase()}`];

  // INTERVAL=1 is the RFC 5545 default and can be omitted
  if (schedule.interval > 1) {
    parts.push(`INTERVAL=${schedule.interval}`);
  }

  if (schedule.count > 0) {
    parts.push(`COUNT=${schedule.count}`);
  }
  else if (schedule.endDate) {
    parts.push(`UNTIL=${formatIcsDate(schedule.endDate)}`);
  }

  if (schedule.byDay?.length) {
    const days = schedule.byDay.map(d => ICS_DAY_MAP[parseInt(d)] || d).filter(Boolean);
    if (days.length) {
      parts.push(`BYDAY=${days.join(',')}`);
    }
  }

  return parts.join(';');
}

/**
 * Formats a location into a single ICS LOCATION string.
 */
function formatLocation(location: EventLocation): string {
  const parts: string[] = [];
  if (location.name) parts.push(location.name);
  if (location.address) parts.push(location.address);
  if (location.city) {
    let cityLine = location.city;
    if (location.state) cityLine += `, ${location.state}`;
    if (location.postalCode) cityLine += ` ${location.postalCode}`;
    parts.push(cityLine);
  }
  return parts.join(', ');
}

/**
 * Appends RRULE and EXDATE lines from event schedules to the ICS lines array.
 * EXRULE is deprecated in RFC 5545 and not supported by most calendar clients,
 * so frequency-based exclusion schedules are omitted. Only individual EXDATE
 * entries are emitted for exclusions.
 */
function appendScheduleRules(lines: string[], schedules: CalendarEventSchedule[]): void {
  for (const schedule of schedules) {
    if (schedule.isExclusion) {
      if (schedule.startDate) {
        lines.push(`EXDATE:${formatIcsDate(schedule.startDate)}`);
      }
    }
    else {
      const rrule = scheduleToRRule(schedule);
      if (rrule) {
        lines.push(`RRULE:${rrule}`);
      }
    }
  }
}

/**
 * Generates an ICS file string for a calendar event.
 *
 * @param event - The calendar event
 * @param dtstart - Start datetime for the VEVENT
 * @param dtend - Optional end datetime for the VEVENT
 * @param eventName - Localized event name
 * @param eventDescription - Localized event description
 * @param hostname - The instance hostname for UID generation
 */
export function generateIcs(
  event: CalendarEvent,
  dtstart: DateTime,
  dtend: DateTime | null,
  eventName: string,
  eventDescription: string,
  hostname: string,
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pavillion//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.id)}@${escapeIcsText(hostname)}`,
    `DTSTAMP:${formatIcsDate(DateTime.now())}`,
    `DTSTART:${formatIcsDate(dtstart)}`,
  ];

  if (dtend) {
    lines.push(`DTEND:${formatIcsDate(dtend)}`);
  }

  lines.push(foldLine(`SUMMARY:${escapeIcsText(eventName)}`));

  if (eventDescription) {
    lines.push(foldLine(`DESCRIPTION:${escapeIcsText(eventDescription)}`));
  }

  if (event.location) {
    lines.push(foldLine(`LOCATION:${escapeIcsText(formatLocation(event.location))}`));
  }

  appendScheduleRules(lines, event.schedules);

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * Generates an ICS file string for a calendar event instance.
 * Includes the full RRULE set from the parent event's schedules.
 */
export function generateInstanceIcs(
  instance: CalendarEventInstance,
  eventName: string,
  eventDescription: string,
  hostname: string,
): string {
  return generateIcs(instance.event, instance.start, instance.end, eventName, eventDescription, hostname);
}

/**
 * Generates an ICS file string for a base event (no specific instance).
 * Uses the first schedule's start date as DTSTART.
 */
export function generateEventIcs(
  event: CalendarEvent,
  eventName: string,
  eventDescription: string,
  hostname: string,
): string {
  const primarySchedule = event.schedules.find(s => !s.isExclusion && s.startDate);
  const dtstart = primarySchedule?.startDate ?? DateTime.now();
  const dtend = (primarySchedule?.endDate && !primarySchedule.frequency) ? primarySchedule.endDate : null;
  return generateIcs(event, dtstart, dtend, eventName, eventDescription, hostname);
}

/**
 * Triggers a browser download of an ICS file.
 */
export function downloadIcs(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
