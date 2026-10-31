import { DateTime } from 'luxon';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventLocation } from '@/common/model/location';

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
 * Generates an ICS file string for a calendar event.
 *
 * @param event - The calendar event
 * @param dtstart - Start datetime for the VEVENT
 * @param dtend - Optional end datetime for the VEVENT
 * @param eventName - Localized event name
 * @param eventDescription - Localized event description
 * @param hostname - The instance hostname for UID generation
 *
 * The UID is scoped to the occurrence (event id plus its UTC start), so two
 * downloaded occurrences of one recurring event stay separate entries in the
 * attendee's calendar while re-downloading the same occurrence still updates
 * it in place. The start, not the instance id, keys it because instance rows
 * are regenerated when a schedule is re-expanded.
 */
function generateIcs(
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
    `UID:${escapeIcsText(event.id)}-${formatIcsDate(dtstart)}@${escapeIcsText(hostname)}`,
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

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * Generates an ICS file string for a single occurrence of an event: one
 * VEVENT spanning the instance's start and end, with no recurrence. Public
 * events reach the site without schedules, so a single occurrence is all the
 * site can export.
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
