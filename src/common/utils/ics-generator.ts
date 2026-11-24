import { DateTime } from 'luxon';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { escapeIcsText, foldLine, formatLocation } from '@/common/utils/ics-text';

/**
 * Formats a Luxon DateTime as an ICS datetime string (YYYYMMDDTHHMMSSZ).
 */
function formatIcsDate(dt: DateTime): string {
  return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
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
