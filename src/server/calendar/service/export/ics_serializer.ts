import { DateTime, IANAZone } from 'luxon';

import type { Calendar } from '@/common/model/calendar';
import {
  CalendarEvent,
  CalendarEventSchedule,
  EventFrequency,
  compareEventsByStart,
  compareSchedulesByStart,
} from '@/common/model/events';
import type { TranslatedContentModel, TranslatedModel } from '@/common/model/model';
import { eventPath } from '@/common/routing/public-paths';
import { escapeIcsText, foldLine, formatLocation } from '@/common/utils/ics-text';
import { hasUnreachableByDayOrdinal, parseByDayEntry } from '@/common/utils/recurrence-by-day';
import {
  expandScheduleOccurrences,
  occurrenceEndTime,
  scheduleOccursAt,
} from '@/server/calendar/service/event_instance';
import { buildVTimezone } from '@/server/calendar/service/export/vtimezone';

/**
 * Serializes a calendar's events to one iCalendar (RFC 5545) file.
 *
 * Pure: the events arrive already loaded, and the current time, the instance
 * domain and the translated heading are all passed in. Nothing here reads the
 * database, configuration, i18next or the process time zone.
 *
 * The file mirrors Pavillion's own expansion rather than the stored rows:
 * a recurring schedule steps in the zone of the event's base schedule and
 * starts at the first occurrence Pavillion actually lists, so an importer
 * that follows RFC 5545 shows the dates the public calendar shows.
 */

/** One event to export, with the modification time the caller derived for it. */
export interface IcsExportEvent {
  /**
   * Content, schedules (positive and exclusion), location, space and
   * categories already populated; categories already limited to the
   * exporting calendar's own.
   */
  event: CalendarEvent;
  /** Latest updatedAt among the event row, its content rows and its schedule rows. */
  lastModified: Date;
}

export interface IcsExportInput {
  /** Only `urlName` is read. */
  calendar: Calendar;
  events: IcsExportEvent[];
  /** Requested language, already validated by the caller. */
  language: string;
  /** Ordered; tried after `language`. */
  fallbackLanguages: string[];
  /** Host only, as config `domain`; used in UIDs and the URL origin. */
  domain: string;
  /** DTSTAMP, and the upper end of each VTIMEZONE span. */
  now: Date;
  /** The "Accessibility" heading in the given language. */
  accessibilityHeading: (language: string) => string;
}

export interface IcsExportResult {
  /** The complete file, every line CRLF-terminated. */
  ics: string;
  /** Events that produced at least one VEVENT. */
  eventCount: number;
  /** Events with no dated occurrence; not in the file. */
  skippedEventIds: string[];
}

/**
 * One event could not be serialized. The export is all-or-nothing: a file
 * that silently lacked the event would pass for a complete backup.
 */
export class IcsSerializationError extends Error {
  /** The event that could not be serialized. */
  readonly eventId: string;

  constructor(eventId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Could not serialize event ${eventId} to iCalendar: ${reason}`, { cause });
    this.name = 'IcsSerializationError';
    this.eventId = eventId;
  }
}

const PRODID = '-//Pavillion//Events//EN';
const UTC = 'UTC';

/** VTIMEZONE spans never start before the epoch, whatever a stored date says. */
const EARLIEST_ZONE_YEAR = 1970;

/** How far past its latest written year a VTIMEZONE keeps declaring rules. */
const ZONE_YEARS_AHEAD = 10;

const FREQUENCY_NAMES: Record<EventFrequency, string> = {
  [EventFrequency.DAILY]: 'DAILY',
  [EventFrequency.WEEKLY]: 'WEEKLY',
  [EventFrequency.MONTHLY]: 'MONTHLY',
  [EventFrequency.YEARLY]: 'YEARLY',
};

/** The first and last year written with each TZID, which sizes its VTIMEZONE. */
class ZoneYears {
  private readonly spans = new Map<string, { first: number; last: number }>();

  note(zoneName: string, year: number): void {
    const span = this.spans.get(zoneName);
    if (!span) {
      this.spans.set(zoneName, { first: year, last: year });
      return;
    }
    span.first = Math.min(span.first, year);
    span.last = Math.max(span.last, year);
  }

  /** Each zone with its span, ordered by zone name. */
  sorted(): Array<{ zoneName: string; first: number; last: number }> {
    return [...this.spans.entries()]
      .map(([zoneName, span]) => ({ zoneName, ...span }))
      .sort((a, b) => (a.zoneName < b.zoneName ? -1 : a.zoneName > b.zoneName ? 1 : 0));
  }
}

function formatUtc(dt: DateTime): string {
  return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function formatInstant(date: Date): string {
  return formatUtc(DateTime.fromJSDate(date, { zone: UTC }));
}

/**
 * A date-time property in the zone the values already carry: the Z form for
 * UTC, otherwise `;TZID=` with local time. Values share one zone.
 */
function dateTimeLine(name: string, values: DateTime[], zoneYears: ZoneYears): string {
  const zoneName = values[0].zoneName ?? UTC;
  if (zoneName === UTC) {
    return `${name}:${values.map(formatUtc).join(',')}`;
  }
  for (const value of values) {
    zoneYears.note(zoneName, value.year);
  }
  return `${name};TZID=${zoneName}:${values.map(v => v.toFormat("yyyyMMdd'T'HHmmss")).join(',')}`;
}

function isRecurring(schedule: CalendarEventSchedule): boolean {
  return schedule.frequency !== null
    && schedule.frequency !== undefined
    && FREQUENCY_NAMES[schedule.frequency] !== undefined;
}

/**
 * Refuses schedule data the file cannot express. Runs before anything is
 * written, so a bad row fails the event rather than shaping its output.
 */
function assertSerializable(schedules: CalendarEventSchedule[]): void {
  for (const schedule of schedules) {
    if (schedule.isExclusion && isRecurring(schedule)) {
      throw new Error(`schedule ${schedule.id} is a recurring exclusion, which iCalendar cannot express`);
    }
    if (!schedule.startDate) {
      continue;
    }
    if (!schedule.startDate.isValid) {
      throw new Error(`schedule ${schedule.id} has an invalid start date`);
    }
    if (schedule.isExclusion) {
      continue;
    }
    const zoneName = schedule.startDate.zoneName;
    if (zoneName !== UTC && !IANAZone.isValidZone(zoneName ?? '')) {
      throw new Error(`schedule ${schedule.id} is in "${zoneName}", which is not an IANA time zone`);
    }
    if (!isRecurring(schedule)) {
      continue;
    }
    if (schedule.count && !(Number.isInteger(schedule.count) && schedule.count > 0)) {
      throw new Error(`schedule ${schedule.id} has an invalid count`);
    }
    if (!schedule.count && schedule.endDate && !schedule.endDate.isValid) {
      throw new Error(`schedule ${schedule.id} has an invalid end date`);
    }
    const takesOrdinal = schedule.frequency === EventFrequency.MONTHLY || schedule.frequency === EventFrequency.YEARLY;
    if (!takesOrdinal && (schedule.byDay ?? []).some(entry => parseByDayEntry(entry)?.ordinal != null)) {
      throw new Error(`schedule ${schedule.id} puts an ordinal weekday on a ${schedule.frequency} rule`);
    }
  }
}

/**
 * The RRULE value, mirroring the options Pavillion's own expansion builds
 * (`buildScheduleRule`): count wins over the end date, and weekday entries
 * that do not parse are dropped.
 */
function recurrenceRule(schedule: CalendarEventSchedule): string {
  const parts = [`FREQ=${FREQUENCY_NAMES[schedule.frequency!]}`];
  if (Number.isInteger(schedule.interval) && schedule.interval > 1) {
    parts.push(`INTERVAL=${schedule.interval}`);
  }
  if (schedule.count) {
    parts.push(`COUNT=${schedule.count}`);
  }
  else if (schedule.endDate) {
    parts.push(`UNTIL=${formatUtc(schedule.endDate)}`);
  }
  const weekdays = (schedule.byDay ?? [])
    .map(entry => parseByDayEntry(entry))
    .filter(parsed => parsed !== null)
    .map(parsed => `${parsed.ordinal ?? ''}${parsed.dayCode}`);
  if (weekdays.length > 0) {
    parts.push(`BYDAY=${weekdays.join(',')}`);
  }
  return parts.join(';');
}

/**
 * The language whose row is used for a translated model: the requested
 * language, then the fallbacks in order, then the model's remaining
 * languages in code order. Null when no row has anything to show.
 */
function contentLanguage(model: TranslatedModel<TranslatedContentModel>, input: IcsExportInput): string | null {
  const preferred = [input.language, ...input.fallbackLanguages];
  const remaining = model.getLanguages().filter(language => !preferred.includes(language)).sort();
  return [...preferred, ...remaining].find(language => model.hasContent(language)) ?? null;
}

/**
 * Stored text made safe for a TEXT value: line breaks normalized to a
 * newline, then every other C0 and C1 control character removed. Tab stays.
 */
function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, char => (char === '\t' || char === '\n' ? char : ''));
}

function textLine(name: string, text: string): string {
  return `${name}:${escapeIcsText(cleanText(text))}`;
}

/** The properties every VEVENT of one event shares. */
interface EventProperties {
  /** DTSTAMP and LAST-MODIFIED. */
  stamps: string[];
  summary: string | null;
  /** DESCRIPTION, LOCATION and CATEGORIES, each when the event has one. */
  details: string[];
  url: string;
}

function eventProperties(entry: IcsExportEvent, input: IcsExportInput): EventProperties {
  const { event, lastModified } = entry;
  if (Number.isNaN(lastModified.getTime())) {
    throw new Error('the last-modified time is not a valid date');
  }

  let summary: string | null = null;
  const details: string[] = [];

  const language = contentLanguage(event, input);
  if (language !== null) {
    const content = event.content(language);
    if (content.name.trim() !== '') {
      summary = textLine('SUMMARY', content.name);
    }
    // Only the event's own accessibility text is exported, under a heading
    // in the language of the row it came from.
    const blocks: string[] = [];
    if (content.description.trim() !== '') {
      blocks.push(content.description);
    }
    if (content.accessibilityInfo.trim() !== '') {
      blocks.push(`${input.accessibilityHeading(language)}:\n${content.accessibilityInfo}`);
    }
    if (blocks.length > 0) {
      details.push(textLine('DESCRIPTION', blocks.join('\n\n')));
    }
  }

  if (event.location) {
    const spaceLanguage = event.space ? contentLanguage(event.space, input) : null;
    const spaceName = spaceLanguage !== null ? event.space!.content(spaceLanguage).name.trim() : '';
    const location = formatLocation(event.location, spaceName);
    if (location !== '') {
      details.push(textLine('LOCATION', location));
    }
  }

  const categoryNames = (event.categories ?? [])
    .map((category) => {
      const categoryLanguage = contentLanguage(category, input);
      return categoryLanguage !== null ? category.content(categoryLanguage).name : '';
    })
    .filter(name => name.trim() !== '')
    .map(name => escapeIcsText(cleanText(name)));
  if (categoryNames.length > 0) {
    // The commas between names are list separators, so they stay unescaped.
    details.push(`CATEGORIES:${categoryNames.join(',')}`);
  }

  return {
    stamps: [`DTSTAMP:${formatInstant(input.now)}`, `LAST-MODIFIED:${formatInstant(lastModified)}`],
    summary,
    details,
    // A URI, not TEXT: never escaped. The path comes from the shared builder.
    url: `URL:https://${input.domain}${eventPath(input.calendar.urlName, event.id)}`,
  };
}

/** DTSTART, and DTEND when the event has a duration, for an occurrence at `start`. */
function occurrenceTimes(event: CalendarEvent, start: DateTime, zoneYears: ZoneYears): string[] {
  const lines = [dateTimeLine('DTSTART', [start], zoneYears)];
  const end = occurrenceEndTime(event, start);
  if (end) {
    lines.push(dateTimeLine('DTEND', [end], zoneYears));
  }
  return lines;
}

/**
 * The VEVENTs of one event, each as its unfolded content lines: the base
 * schedule's first, then the other positive schedules by start, then the
 * overrides for dates shown as cancelled, by instant. Empty when the event
 * has no dated occurrence.
 */
function eventVevents(entry: IcsExportEvent, input: IcsExportInput, zoneYears: ZoneYears): string[][] {
  const { event } = entry;
  const schedules = event.schedules ?? [];
  assertSerializable(schedules);

  const base = event.baseSchedule();
  if (!base?.startDate) {
    return [];
  }
  const baseZone = base.startDate.zone;
  const positives = schedules
    .filter(schedule => !schedule.isExclusion && schedule.startDate)
    .sort(compareSchedulesByStart);
  const recurring = positives.filter(isRecurring);

  // Cancellation rows are matched by instant: the cancel path stores UTC,
  // an import stores the event zone. A hidden row wins over a shown one.
  const hidden = new Set<number>();
  const shown = new Set<number>();
  for (const schedule of schedules) {
    if (schedule.isExclusion && schedule.startDate) {
      (schedule.hideFromPublic ? hidden : shown).add(schedule.startDate.toMillis());
    }
  }
  const hiddenInstants = [...hidden].sort((a, b) => a - b);
  const shownInstants = [...shown].filter(ms => !hidden.has(ms)).sort((a, b) => a - b);

  const properties = eventProperties(entry, input);
  const uidOf = (schedule: CalendarEventSchedule): string => {
    if (schedule === base) {
      return `UID:${escapeIcsText(event.id)}@${escapeIcsText(input.domain)}`;
    }
    if (!schedule.id) {
      throw new Error('a schedule has no id to derive a UID from');
    }
    return `UID:${escapeIcsText(event.id)}-${escapeIcsText(schedule.id)}@${escapeIcsText(input.domain)}`;
  };

  const vevents: string[][] = [];
  const seriesUids = new Map<CalendarEventSchedule, string>();
  const oneOffInstants = new Set<number>();

  for (const schedule of positives) {
    const start = schedule.startDate!;

    if (isRecurring(schedule)) {
      if (hasUnreachableByDayOrdinal(schedule.frequency, schedule.byDay)) {
        continue;
      }
      // RFC 5545 importers always count DTSTART, while Pavillion drops a
      // start its own rule does not produce. Starting at the first real
      // occurrence keeps the two in step, COUNT included.
      const first = expandScheduleOccurrences(schedule, base, null, 1)[0];
      if (!first) {
        continue;
      }
      const uid = uidOf(schedule);
      seriesUids.set(schedule, uid);
      const lines = [
        uid,
        ...properties.stamps,
        ...occurrenceTimes(event, DateTime.fromJSDate(first, { zone: baseZone }), zoneYears),
        `RRULE:${recurrenceRule(schedule)}`,
      ];
      if (!schedule.count && schedule.endDate && baseZone.name !== UTC) {
        zoneYears.note(baseZone.name, schedule.endDate.toUTC().year);
      }
      if (hiddenInstants.length > 0) {
        lines.push(dateTimeLine(
          'EXDATE',
          hiddenInstants.map(ms => DateTime.fromMillis(ms, { zone: baseZone })),
          zoneYears,
        ));
      }
      if (properties.summary) lines.push(properties.summary);
      lines.push(...properties.details, properties.url);
      vevents.push(lines);
      continue;
    }

    // A one-off date. Pavillion dedupes occurrences by instant, so a date a
    // recurring schedule already produces, or a second row for the same
    // instant, is not written twice.
    const instant = start.toMillis();
    if (hidden.has(instant) || oneOffInstants.has(instant)) {
      continue;
    }
    if (recurring.some(rule => scheduleOccursAt(rule, base, start.toJSDate()))) {
      continue;
    }
    oneOffInstants.add(instant);
    const lines = [uidOf(schedule), ...properties.stamps, ...occurrenceTimes(event, start, zoneYears)];
    if (properties.summary) lines.push(properties.summary);
    lines.push(...properties.details, properties.url);
    if (shown.has(instant)) {
      lines.push('STATUS:CANCELLED');
    }
    vevents.push(lines);
  }

  // A date shown as cancelled on a series: an override under the UID of the
  // first schedule whose rule produces it. One that matches no occurrence
  // writes nothing, as Pavillion lists nothing for it.
  for (const instant of shownInstants) {
    const owner = recurring.find(schedule =>
      seriesUids.has(schedule) && scheduleOccursAt(schedule, base, new Date(instant)));
    if (!owner) {
      continue;
    }
    const start = DateTime.fromMillis(instant, { zone: baseZone });
    const lines = [
      seriesUids.get(owner)!,
      ...properties.stamps,
      dateTimeLine('RECURRENCE-ID', [start], zoneYears),
      ...occurrenceTimes(event, start, zoneYears),
    ];
    if (properties.summary) lines.push(properties.summary);
    lines.push(properties.url, 'STATUS:CANCELLED');
    vevents.push(lines);
  }

  return vevents;
}

/**
 * The VCALENDAR text for a calendar's events.
 *
 * Synchronous and deterministic for a given input. An empty `events` list
 * returns a calendar with no VEVENT and no VTIMEZONE, which a strict
 * validator may flag (RFC 5545 asks for at least one component).
 *
 * @throws {IcsSerializationError} When any one event cannot be serialized;
 *   no partial file is returned. Nothing is logged here; the caller logs.
 */
export function serializeCalendarToIcs(input: IcsExportInput): IcsExportResult {
  if (Number.isNaN(input.now.getTime())) {
    throw new TypeError('now must be a valid date');
  }

  const zoneYears = new ZoneYears();
  const eventLines: string[] = [];
  const skippedEventIds: string[] = [];
  let eventCount = 0;

  const ordered = [...input.events].sort((a, b) => compareEventsByStart(a.event, b.event));
  for (const entry of ordered) {
    let vevents: string[][];
    try {
      vevents = eventVevents(entry, input, zoneYears);
    }
    catch (error) {
      throw new IcsSerializationError(entry.event.id, error);
    }
    if (vevents.length === 0) {
      skippedEventIds.push(entry.event.id);
      continue;
    }
    eventCount++;
    for (const vevent of vevents) {
      eventLines.push('BEGIN:VEVENT', ...vevent, 'END:VEVENT');
    }
  }

  const nowYear = DateTime.fromJSDate(input.now, { zone: UTC }).year;
  const timezoneLines = zoneYears.sorted().flatMap(({ zoneName, first, last }) => buildVTimezone(
    zoneName,
    Math.max(EARLIEST_ZONE_YEAR, Math.min(first, nowYear) - 1),
    Math.max(last, nowYear) + ZONE_YEARS_AHEAD,
  ));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...timezoneLines,
    ...eventLines,
    'END:VCALENDAR',
  ];

  return {
    ics: lines.map(line => `${foldLine(line)}\r\n`).join(''),
    eventCount,
    skippedEventIds,
  };
}
