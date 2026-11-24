// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { DateTime, Settings } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import { EventLocation, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import {
  IcsSerializationError,
  serializeCalendarToIcs,
  type IcsExportEvent,
  type IcsExportInput,
} from '@/server/calendar/service/export/ics_serializer';
import { buildVTimezone } from '@/server/calendar/service/export/vtimezone';

const NEW_YORK = 'America/New_York';
const BERLIN = 'Europe/Berlin';

const EVENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCHEDULE_1 = '11111111-1111-4111-8111-111111111111';
const SCHEDULE_2 = '22222222-2222-4222-8222-222222222222';
const SCHEDULE_3 = '33333333-3333-4333-8333-333333333333';

const NOW = new Date('2026-06-01T12:00:00Z');
const LAST_MODIFIED = new Date('2026-04-20T08:30:45Z');

/** Monday 4 May 2026, 18:00 in New York (22:00Z). */
const MONDAY_EVENING = DateTime.fromObject({ year: 2026, month: 5, day: 4, hour: 18 }, { zone: NEW_YORK });

const HEADINGS: Record<string, string> = { en: 'Accessibility', es: 'Accesibilidad', fr: 'Accessibilité' };

const octets = (text: string) => new TextEncoder().encode(text).length;

function schedule(id: string, start: DateTime | null, extra: Partial<CalendarEventSchedule> = {}): CalendarEventSchedule {
  const s = new CalendarEventSchedule(id, start ?? undefined);
  Object.assign(s, extra);
  return s;
}

function weekly(id: string, start: DateTime, extra: Partial<CalendarEventSchedule> = {}): CalendarEventSchedule {
  return schedule(id, start, { frequency: EventFrequency.WEEKLY, interval: 1, ...extra });
}

/** A cancellation row as the cancel path stores it: a UTC instant. */
function exclusion(id: string, at: DateTime, hideFromPublic: boolean): CalendarEventSchedule {
  return schedule(id, at.toUTC(), { isExclusion: true, hideFromPublic });
}

function makeEvent(id: string, schedules: CalendarEventSchedule[], name = 'Community Meetup'): CalendarEvent {
  const event = new CalendarEvent(id, 'calendar-id');
  event.addContent(new CalendarEventContent('en', name));
  event.schedules = schedules;
  return event;
}

function entry(event: CalendarEvent, lastModified = LAST_MODIFIED): IcsExportEvent {
  return { event, lastModified };
}

function serialize(events: CalendarEvent[], overrides: Partial<IcsExportInput> = {}) {
  return serializeCalendarToIcs({
    calendar: new Calendar('calendar-id', 'townhall'),
    events: events.map(event => entry(event)),
    language: 'en',
    fallbackLanguages: [],
    domain: 'events.example',
    now: NOW,
    accessibilityHeading: language => HEADINGS[language] ?? HEADINGS.en,
    ...overrides,
  });
}

/** The logical content lines: folds undone, the final CRLF's empty tail dropped. */
function contentLines(ics: string): string[] {
  const lines = ics.replace(/\r\n /g, '').split('\r\n');
  expect(lines.pop()).toBe('');
  return lines;
}

/** The inner lines of every component of one type, in file order. */
function components(ics: string, type: string): string[][] {
  const found: string[][] = [];
  let current: string[] | null = null;
  for (const line of contentLines(ics)) {
    if (line === `BEGIN:${type}`) {
      current = [];
    }
    else if (line === `END:${type}`) {
      found.push(current!);
      current = null;
    }
    else if (current) {
      current.push(line);
    }
  }
  return found;
}

const vevents = (ics: string) => components(ics, 'VEVENT');

/** The whole line of a property (name, parameters and value), or undefined. */
function property(lines: string[], name: string): string | undefined {
  return lines.find(line => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
}

/** The single VEVENT of a one-event, one-schedule file. */
function onlyVevent(events: CalendarEvent[], overrides: Partial<IcsExportInput> = {}): string[] {
  const blocks = vevents(serialize(events, overrides).ics);
  expect(blocks).toHaveLength(1);
  return blocks[0];
}

describe('serializeCalendarToIcs', () => {
  describe('file structure', () => {
    const weeklyEvent = () => makeEvent(EVENT_A, [
      weekly(SCHEDULE_1, MONDAY_EVENING, { eventEndTime: MONDAY_EVENING.plus({ hours: 2 }) }),
    ]);

    it('carries no organizer, attendee, account or email data', () => {
      const { ics } = serialize([weeklyEvent()]);
      const lines = contentLines(ics);

      expect(lines.filter(line => /^(ORGANIZER|ATTENDEE|CONTACT)[:;]/.test(line))).toEqual([]);
      expect(ics.toLowerCase()).not.toContain('mailto:');
      // The only "@" in the file scopes a UID to the instance domain
      expect(lines.filter(line => line.includes('@'))).toEqual([`UID:${EVENT_A}@events.example`]);
      // The owning calendar's id is on the event model and stays there
      expect(ics).not.toContain('calendar-id');
    });

    it('writes this exact file for one weekly event', () => {
      const result = serialize([weeklyEvent()]);

      expect(result.eventCount).toBe(1);
      expect(result.skippedEventIds).toEqual([]);
      expect(result.ics).toBe([
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Pavillion//Events//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        ...buildVTimezone(NEW_YORK, 2025, 2036),
        'BEGIN:VEVENT',
        `UID:${EVENT_A}@events.example`,
        'DTSTAMP:20260601T120000Z',
        'LAST-MODIFIED:20260420T083045Z',
        'DTSTART;TZID=America/New_York:20260504T180000',
        'DTEND;TZID=America/New_York:20260504T200000',
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Community Meetup',
        // 79 octets, so folded after the 75th
        'URL:https://events.example/townhall/events/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa',
        ' aaaa',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'));
    });

    it('returns a calendar with no VEVENT and no VTIMEZONE for no events', () => {
      const result = serialize([]);

      expect(result).toEqual({
        ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Pavillion//Events//EN\r\n'
          + 'CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n',
        eventCount: 0,
        skippedEventIds: [],
      });
    });

    it('ends every line with CRLF and keeps every line within 75 octets', () => {
      const event = makeEvent(EVENT_A, [weekly(SCHEDULE_1, MONDAY_EVENING)], 'Fête de la musique '.repeat(12));
      event.content('en').description = 'Línea uno\nLínea dos, con coma; y punto y coma. 日本語のテキスト😀 '.repeat(20);

      const { ics } = serialize([event]);

      expect(ics.endsWith('\r\n')).toBe(true);
      expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      const physical = ics.split('\r\n');
      expect(physical.length).toBeGreaterThan(30);
      for (const line of physical) {
        expect(octets(line)).toBeLessThanOrEqual(75);
      }
      expect(property(vevents(ics)[0], 'SUMMARY')).toBe('SUMMARY:' + 'Fête de la musique '.repeat(12));
    });

    it('orders events by start and counts those written', () => {
      const later = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING.plus({ days: 3 }))]);
      const earlier = makeEvent(EVENT_B, [schedule(SCHEDULE_2, MONDAY_EVENING)]);

      const result = serialize([later, earlier]);

      expect(vevents(result.ics).map(lines => property(lines, 'UID'))).toEqual([
        `UID:${EVENT_B}@events.example`,
        `UID:${EVENT_A}@events.example`,
      ]);
      expect(result.eventCount).toBe(2);
    });

    it('gives the same file on a second call', () => {
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        schedule(SCHEDULE_2, MONDAY_EVENING.plus({ days: 2 })),
      ]);

      expect(serialize([event]).ics).toBe(serialize([event]).ics);
    });
  });

  describe('recurrence rule', () => {
    it.each([
      [EventFrequency.DAILY, 'RRULE:FREQ=DAILY'],
      [EventFrequency.WEEKLY, 'RRULE:FREQ=WEEKLY'],
      [EventFrequency.MONTHLY, 'RRULE:FREQ=MONTHLY'],
      [EventFrequency.YEARLY, 'RRULE:FREQ=YEARLY'],
    ])('maps the %s frequency', (frequency, expected) => {
      const lines = onlyVevent([makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING, { frequency })])]);

      expect(property(lines, 'RRULE')).toBe(expected);
    });

    it.each([
      ['an interval above one', { interval: 2 }, 'RRULE:FREQ=WEEKLY;INTERVAL=2'],
      ['an interval of one', { interval: 1 }, 'RRULE:FREQ=WEEKLY'],
      ['an interval of zero', { interval: 0 }, 'RRULE:FREQ=WEEKLY'],
      ['a fractional interval', { interval: 2.5 }, 'RRULE:FREQ=WEEKLY'],
      ['a count', { count: 6 }, 'RRULE:FREQ=WEEKLY;COUNT=6'],
      [
        'an end date, as a UTC instant',
        { endDate: MONDAY_EVENING.plus({ weeks: 8 }) },
        'RRULE:FREQ=WEEKLY;UNTIL=20260629T220000Z',
      ],
      [
        'a count in preference to an end date',
        { count: 3, endDate: MONDAY_EVENING.plus({ weeks: 8 }) },
        'RRULE:FREQ=WEEKLY;COUNT=3',
      ],
      ['weekdays', { byDay: ['MO', 'WE'] }, 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE'],
      ['weekdays, dropping entries that do not parse', { byDay: ['MO', 'XX', '0'] }, 'RRULE:FREQ=WEEKLY;BYDAY=MO'],
      ['no BYDAY when no entry parses', { byDay: ['XX'] }, 'RRULE:FREQ=WEEKLY'],
    ])('writes %s', (_label, fields, expected) => {
      const lines = onlyVevent([makeEvent(EVENT_A, [weekly(SCHEDULE_1, MONDAY_EVENING, fields)])]);

      expect(property(lines, 'RRULE')).toBe(expected);
    });

    it('writes an ordinal weekday on a monthly rule', () => {
      const lines = onlyVevent([makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, MONDAY_EVENING, { frequency: EventFrequency.MONTHLY, interval: 1, byDay: ['1MO', '-1FR'] }),
      ])]);

      expect(property(lines, 'RRULE')).toBe('RRULE:FREQ=MONTHLY;BYDAY=1MO,-1FR');
    });

    it('starts the series at the first real occurrence when the start misses BYDAY', () => {
      // A Monday start on a Wednesdays-only rule: Pavillion never lists the Monday
      const lines = onlyVevent([makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING, {
          byDay: ['WE'],
          eventEndTime: MONDAY_EVENING.plus({ hours: 1, minutes: 30, seconds: 15 }),
        }),
      ])]);

      expect(property(lines, 'DTSTART')).toBe('DTSTART;TZID=America/New_York:20260506T180000');
      expect(property(lines, 'DTEND')).toBe('DTEND;TZID=America/New_York:20260506T193015');
    });

    it('writes no VEVENT for a rule whose ordinal can never match', () => {
      const result = serialize([makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, MONDAY_EVENING, { frequency: EventFrequency.MONTHLY, byDay: ['6MO'] }),
      ])]);

      expect(vevents(result.ics)).toEqual([]);
      expect(result.skippedEventIds).toEqual([EVENT_A]);
      expect(result.eventCount).toBe(0);
    });

    it('omits DTEND when the event has no end time', () => {
      const lines = onlyVevent([makeEvent(EVENT_A, [weekly(SCHEDULE_1, MONDAY_EVENING)])]);

      expect(property(lines, 'DTEND')).toBeUndefined();
    });
  });

  describe('time zones', () => {
    it('writes a UTC schedule in Z form with no TZID and no VTIMEZONE', () => {
      const start = MONDAY_EVENING.toUTC();
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, start, { eventEndTime: start.plus({ hours: 1 }), endDate: start.plus({ weeks: 4 }) }),
        exclusion(SCHEDULE_2, start.plus({ weeks: 1 }), true),
        exclusion(SCHEDULE_3, start.plus({ weeks: 2 }), false),
      ]);

      const { ics } = serialize([event]);
      const [series, override] = vevents(ics);

      expect(property(series, 'DTSTART')).toBe('DTSTART:20260504T220000Z');
      expect(property(series, 'DTEND')).toBe('DTEND:20260504T230000Z');
      expect(property(series, 'EXDATE')).toBe('EXDATE:20260511T220000Z');
      expect(property(override, 'RECURRENCE-ID')).toBe('RECURRENCE-ID:20260518T220000Z');
      expect(ics).not.toContain('TZID');
      expect(components(ics, 'VTIMEZONE')).toEqual([]);
    });

    it('steps a recurring schedule in the base schedule\'s zone, not its own', () => {
      // The one-off in New York is the base schedule. 19:00 in Berlin is 13:00
      // in New York, and Pavillion keeps the series at 13:00 New York time.
      const event = makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, DateTime.fromObject({ year: 2026, month: 10, day: 1, hour: 9 }, { zone: NEW_YORK })),
        weekly(SCHEDULE_2, DateTime.fromObject({ year: 2026, month: 10, day: 19, hour: 19 }, { zone: BERLIN })),
      ]);

      const { ics } = serialize([event]);
      const [, series] = vevents(ics);

      expect(property(series, 'DTSTART')).toBe('DTSTART;TZID=America/New_York:20261019T130000');
      expect(components(ics, 'VTIMEZONE').map(lines => property(lines, 'TZID'))).toEqual(['TZID:America/New_York']);
    });

    it('writes a one-off in its own zone', () => {
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        schedule(SCHEDULE_2, DateTime.fromObject({ year: 2026, month: 7, day: 9, hour: 19 }, { zone: BERLIN })),
      ]);

      const [, oneOff] = vevents(serialize([event]).ics);

      expect(property(oneOff, 'DTSTART')).toBe('DTSTART;TZID=Europe/Berlin:20260709T190000');
    });

    it('writes one VTIMEZONE for every TZID used, ordered by TZID', () => {
      const berlinEvent = makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, DateTime.fromObject({ year: 2026, month: 7, day: 9, hour: 19 }, { zone: BERLIN })),
      ]);
      const newYorkEvent = makeEvent(EVENT_B, [weekly(SCHEDULE_2, MONDAY_EVENING)]);

      const { ics } = serialize([berlinEvent, newYorkEvent]);

      const declared = components(ics, 'VTIMEZONE').map(lines => property(lines, 'TZID')!.slice('TZID:'.length));
      const used = new Set([...ics.replace(/\r\n /g, '').matchAll(/;TZID=([^:;]+)/g)].map(match => match[1]));
      expect(declared).toEqual(['America/New_York', 'Europe/Berlin']);
      expect(new Set(declared)).toEqual(used);
    });

    it('spans each VTIMEZONE from the year before its earliest value to ten years past its latest', () => {
      // Values in 2019, and a rule that runs until 2031: 2018 to 2041, not 2025 to 2036
      const start = DateTime.fromObject({ year: 2019, month: 5, day: 6, hour: 18 }, { zone: NEW_YORK });
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, start, { endDate: DateTime.fromObject({ year: 2031, month: 3, day: 1 }, { zone: NEW_YORK }) }),
      ]);

      const [timezone] = components(serialize([event]).ics, 'VTIMEZONE');

      expect(['BEGIN:VTIMEZONE', ...timezone, 'END:VTIMEZONE']).toEqual(buildVTimezone(NEW_YORK, 2018, 2041));
    });

    it('never starts a VTIMEZONE before 1970', () => {
      const event = makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, DateTime.fromObject({ year: 1965, month: 5, day: 3, hour: 18 }, { zone: NEW_YORK })),
      ]);

      const [timezone] = components(serialize([event]).ics, 'VTIMEZONE');

      expect(['BEGIN:VTIMEZONE', ...timezone, 'END:VTIMEZONE']).toEqual(buildVTimezone(NEW_YORK, 1970, 2036));
      expect(property(timezone, 'DTSTART')).toBe('DTSTART:19700101T000000');
    });

    it('runs a VTIMEZONE ten years past a date later than now', () => {
      // The United States changed its rule in 2007. From a clock in 1990 a
      // span ending ten years after now (2000) would declare the old rule;
      // ten years after the 1998 date (2008) reaches the new one.
      const event = makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, DateTime.fromObject({ year: 1998, month: 5, day: 4, hour: 18 }, { zone: NEW_YORK })),
      ]);

      const [timezone] = components(serialize([event], { now: new Date('1990-06-01T12:00:00Z') }).ics, 'VTIMEZONE');

      expect(['BEGIN:VTIMEZONE', ...timezone, 'END:VTIMEZONE']).toEqual(buildVTimezone(NEW_YORK, 1989, 2008));
      expect(timezone).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    });

    describe('a stored date in the far future', () => {
      // A clock in 1946 puts the cap at 2006 (fifty years past now, plus the
      // ten ahead), the last year of the United States' pre-2007 rule. A
      // span that ran on to the stored year would declare the 2007 rule
      // instead, so the cap is visible in the file itself.
      const LONG_AGO = new Date('1946-06-01T12:00:00Z');

      it.each([
        [
          'a one-off date in the year 9999',
          () => schedule(SCHEDULE_1, DateTime.fromObject({ year: 9999, month: 5, day: 4, hour: 18 }, { zone: NEW_YORK })),
          'DTSTART;TZID=America/New_York:99990504T180000',
        ],
        [
          'a rule that ends in the year 9999',
          () => weekly(SCHEDULE_1, MONDAY_EVENING, {
            endDate: DateTime.fromObject({ year: 9999, month: 12, day: 31, hour: 18 }, { zone: NEW_YORK }),
          }),
          'RRULE:FREQ=WEEKLY;UNTIL=99991231T230000Z',
        ],
      ])('serializes %s without stretching the VTIMEZONE to it', (_label, makeSchedule, expectedLine) => {
        const { ics } = serialize([makeEvent(EVENT_A, [makeSchedule()])], { now: LONG_AGO });
        const [timezone] = components(ics, 'VTIMEZONE');

        expect(vevents(ics)[0]).toContain(expectedLine);
        expect(['BEGIN:VTIMEZONE', ...timezone, 'END:VTIMEZONE']).toEqual(buildVTimezone(NEW_YORK, 1970, 2006));
        expect(timezone).toContain('RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU');
        expect(timezone).not.toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
      });
    });

    it('accepts a zone name the platform knows under another spelling, and writes it as stored', () => {
      // Intl canonicalizes Asia/Kolkata to Asia/Calcutta on some runtimes; the
      // stored name is still a zone, and is the TZID the VTIMEZONE declares.
      const event = makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, DateTime.fromObject({ year: 2026, month: 5, day: 4, hour: 18 }, { zone: 'Asia/Kolkata' })),
      ]);

      const { ics } = serialize([event]);

      expect(property(vevents(ics)[0], 'DTSTART')).toBe('DTSTART;TZID=Asia/Kolkata:20260504T180000');
      expect(components(ics, 'VTIMEZONE').map(lines => property(lines, 'TZID'))).toEqual(['TZID:Asia/Kolkata']);
    });

    describe('process time zone', () => {
      const processZone = Settings.defaultZone;

      afterEach(() => {
        Settings.defaultZone = processZone;
      });

      it('writes the same file whatever zone the process runs in', () => {
        const fixture = () => [makeEvent(EVENT_A, [
          weekly(SCHEDULE_1, MONDAY_EVENING, { eventEndTime: MONDAY_EVENING.plus({ hours: 2 }) }),
          schedule(SCHEDULE_2, MONDAY_EVENING.plus({ days: 2 })),
          exclusion(SCHEDULE_3, MONDAY_EVENING.plus({ weeks: 2 }), true),
          exclusion('exclusion-shown', MONDAY_EVENING.plus({ weeks: 3 }), false),
        ])];
        const inProcessZone = serialize(fixture()).ics;

        Settings.defaultZone = 'Asia/Tokyo';
        const inTokyo = serialize(fixture()).ics;

        expect(DateTime.local().zoneName).toBe('Asia/Tokyo');
        expect(inTokyo).toBe(inProcessZone);
        expect(vevents(inTokyo)).toHaveLength(3);
      });
    });
  });

  describe('schedules and UIDs', () => {
    it('writes one VEVENT per positive schedule, the base one under the bare event id', () => {
      const event = makeEvent(EVENT_A, [
        schedule(SCHEDULE_3, MONDAY_EVENING.plus({ days: 10 })),
        weekly(SCHEDULE_2, MONDAY_EVENING.plus({ days: 1 })),
        schedule(SCHEDULE_1, MONDAY_EVENING),
      ]);

      const first = vevents(serialize([event]).ics).map(lines => property(lines, 'UID'));
      const second = vevents(serialize([event]).ics).map(lines => property(lines, 'UID'));

      expect(first).toEqual([
        `UID:${EVENT_A}@events.example`,
        `UID:${EVENT_A}-${SCHEDULE_2}@events.example`,
        `UID:${EVENT_A}-${SCHEDULE_3}@events.example`,
      ]);
      expect(second).toEqual(first);
    });

    it('skips a one-off date that a recurring schedule of the event already produces', () => {
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        schedule(SCHEDULE_2, MONDAY_EVENING.plus({ weeks: 3 })),
        schedule(SCHEDULE_3, MONDAY_EVENING.plus({ weeks: 3, days: 1 })),
      ]);

      expect(vevents(serialize([event]).ics).map(lines => property(lines, 'UID'))).toEqual([
        `UID:${EVENT_A}@events.example`,
        `UID:${EVENT_A}-${SCHEDULE_3}@events.example`,
      ]);
    });

    it('lists an event with no dated schedule as skipped and leaves it out of the file', () => {
      const undated = makeEvent(EVENT_A, [schedule(SCHEDULE_1, null)]);
      const dated = makeEvent(EVENT_B, [schedule(SCHEDULE_2, MONDAY_EVENING)]);

      const result = serialize([undated, dated]);

      expect(result.skippedEventIds).toEqual([EVENT_A]);
      expect(result.eventCount).toBe(1);
      expect(result.ics).not.toContain(EVENT_A);
    });
  });

  describe('cancellations', () => {
    it('writes hidden dates as one sorted EXDATE in the VEVENT\'s zone', () => {
      const lines = onlyVevent([makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        exclusion(SCHEDULE_3, MONDAY_EVENING.plus({ weeks: 4 }), true),
        exclusion(SCHEDULE_2, MONDAY_EVENING.plus({ weeks: 2 }), true),
      ])]);

      expect(property(lines, 'EXDATE')).toBe('EXDATE;TZID=America/New_York:20260518T180000,20260601T180000');
    });

    it('writes a hidden date on every recurring VEVENT of the event, the one it falls on included', () => {
      // Mondays and Tuesdays; the hidden date is a Tuesday
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        weekly(SCHEDULE_2, MONDAY_EVENING.plus({ days: 1 })),
        exclusion(SCHEDULE_3, MONDAY_EVENING.plus({ weeks: 2, days: 1 }), true),
      ]);

      const [mondays, tuesdays] = vevents(serialize([event]).ics);

      expect(property(tuesdays, 'UID')).toBe(`UID:${EVENT_A}-${SCHEDULE_2}@events.example`);
      expect(property(tuesdays, 'DTSTART')).toBe('DTSTART;TZID=America/New_York:20260505T180000');
      expect(property(tuesdays, 'EXDATE')).toBe('EXDATE;TZID=America/New_York:20260519T180000');
      expect(property(mondays, 'EXDATE')).toBe('EXDATE;TZID=America/New_York:20260519T180000');
    });

    it('matches a hidden date stored in another zone by its instant', () => {
      // An imported cancellation row carries the event zone rather than UTC
      const lines = onlyVevent([makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        schedule(SCHEDULE_2, MONDAY_EVENING.plus({ weeks: 2 }).setZone(BERLIN), { isExclusion: true, hideFromPublic: true }),
      ])]);

      expect(property(lines, 'EXDATE')).toBe('EXDATE;TZID=America/New_York:20260518T180000');
    });

    it('writes a date shown as cancelled as an override VEVENT with the series UID', () => {
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING, { eventEndTime: MONDAY_EVENING.plus({ hours: 2 }) }),
        exclusion(SCHEDULE_2, MONDAY_EVENING.plus({ weeks: 3 }), false),
      ]);

      const [series, override] = vevents(serialize([event]).ics);

      expect(property(series, 'EXDATE')).toBeUndefined();
      expect(property(series, 'STATUS')).toBeUndefined();
      expect(override).toEqual([
        `UID:${EVENT_A}@events.example`,
        'DTSTAMP:20260601T120000Z',
        'LAST-MODIFIED:20260420T083045Z',
        'RECURRENCE-ID;TZID=America/New_York:20260525T180000',
        'DTSTART;TZID=America/New_York:20260525T180000',
        'DTEND;TZID=America/New_York:20260525T200000',
        'SUMMARY:Community Meetup',
        `URL:https://events.example/townhall/events/${EVENT_A}`,
        'STATUS:CANCELLED',
      ]);
    });

    it('attaches an override to the schedule that produces the date, and orders overrides by instant', () => {
      const tuesdays = weekly(SCHEDULE_2, MONDAY_EVENING.plus({ days: 1 }));
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        tuesdays,
        exclusion('exclusion-late', MONDAY_EVENING.plus({ weeks: 5 }), false),
        exclusion('exclusion-early', MONDAY_EVENING.plus({ weeks: 2, days: 1 }), false),
      ]);

      const blocks = vevents(serialize([event]).ics);

      expect(blocks.map(lines => [property(lines, 'UID'), property(lines, 'RECURRENCE-ID')])).toEqual([
        [`UID:${EVENT_A}@events.example`, undefined],
        [`UID:${EVENT_A}-${SCHEDULE_2}@events.example`, undefined],
        [`UID:${EVENT_A}-${SCHEDULE_2}@events.example`, 'RECURRENCE-ID;TZID=America/New_York:20260519T180000'],
        [`UID:${EVENT_A}@events.example`, 'RECURRENCE-ID;TZID=America/New_York:20260608T180000'],
      ]);
    });

    it('writes nothing for a cancellation that matches no occurrence', () => {
      const event = makeEvent(EVENT_A, [
        weekly(SCHEDULE_1, MONDAY_EVENING),
        exclusion(SCHEDULE_2, MONDAY_EVENING.plus({ weeks: 2, hours: 3 }), false),
      ]);

      expect(vevents(serialize([event]).ics)).toHaveLength(1);
    });

    it('omits a one-off date that is hidden', () => {
      const event = makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, MONDAY_EVENING),
        schedule(SCHEDULE_2, MONDAY_EVENING.plus({ days: 2 })),
        exclusion(SCHEDULE_3, MONDAY_EVENING.plus({ days: 2 }), true),
      ]);

      const result = serialize([event]);

      expect(vevents(result.ics).map(lines => property(lines, 'DTSTART'))).toEqual([
        'DTSTART;TZID=America/New_York:20260504T180000',
      ]);
      expect(result.eventCount).toBe(1);
    });

    it('skips an event whose only date is hidden', () => {
      const result = serialize([makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, MONDAY_EVENING),
        exclusion(SCHEDULE_2, MONDAY_EVENING, true),
      ])]);

      expect(vevents(result.ics)).toEqual([]);
      expect(result.skippedEventIds).toEqual([EVENT_A]);
    });

    it('marks a one-off date shown as cancelled with STATUS and no RECURRENCE-ID', () => {
      const lines = onlyVevent([makeEvent(EVENT_A, [
        schedule(SCHEDULE_1, MONDAY_EVENING),
        exclusion(SCHEDULE_2, MONDAY_EVENING, false),
      ])]);

      expect(property(lines, 'STATUS')).toBe('STATUS:CANCELLED');
      expect(property(lines, 'RECURRENCE-ID')).toBeUndefined();
      expect(property(lines, 'DTSTART')).toBe('DTSTART;TZID=America/New_York:20260504T180000');
    });
  });

  describe('text', () => {
    function multilingualEvent(): CalendarEvent {
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)], 'Town Meeting');
      event.content('en').description = 'All welcome.';
      event.addContent(new CalendarEventContent('es', 'Reunión del pueblo', 'Todos son bienvenidos.'));
      event.addContent(new CalendarEventContent('fr', 'Réunion publique', 'Ouvert à tous.'));
      return event;
    }

    it('writes the requested language', () => {
      const lines = onlyVevent([multilingualEvent()], { language: 'es', fallbackLanguages: ['en'] });

      expect(property(lines, 'SUMMARY')).toBe('SUMMARY:Reunión del pueblo');
      expect(property(lines, 'DESCRIPTION')).toBe('DESCRIPTION:Todos son bienvenidos.');
    });

    it('falls back through the fallback languages in order', () => {
      const lines = onlyVevent([multilingualEvent()], { language: 'de', fallbackLanguages: ['it', 'fr', 'en'] });

      expect(property(lines, 'SUMMARY')).toBe('SUMMARY:Réunion publique');
    });

    it('falls back to the event\'s first language in code order when no listed language has content', () => {
      // Rows added out of order: code order picks es, load order would pick fr
      const event = new CalendarEvent(EVENT_A, 'calendar-id');
      event.addContent(new CalendarEventContent('fr', 'Réunion publique'));
      event.addContent(new CalendarEventContent('es', 'Reunión del pueblo'));
      event.schedules = [schedule(SCHEDULE_1, MONDAY_EVENING)];

      const lines = onlyVevent([event], { language: 'de', fallbackLanguages: ['it'] });

      expect(property(lines, 'SUMMARY')).toBe('SUMMARY:Reunión del pueblo');
    });

    it('takes the whole row from one language, never mixing fields', () => {
      const event = multilingualEvent();
      event.content('es').description = '';

      const lines = onlyVevent([event], { language: 'es', fallbackLanguages: ['en'] });

      expect(property(lines, 'SUMMARY')).toBe('SUMMARY:Reunión del pueblo');
      expect(property(lines, 'DESCRIPTION')).toBeUndefined();
    });

    it('omits SUMMARY when the chosen row has no name', () => {
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)], '');
      event.content('en').description = 'Details to follow.';

      const lines = onlyVevent([event]);

      expect(property(lines, 'SUMMARY')).toBeUndefined();
      expect(property(lines, 'DESCRIPTION')).toBe('DESCRIPTION:Details to follow.');
    });

    it('appends the accessibility text under its heading, in the language of the row used', () => {
      const event = multilingualEvent();
      event.content('fr').accessibilityInfo = 'Rampe d\'accès; boucle magnétique.';

      const lines = onlyVevent([event], { language: 'fr' });

      expect(property(lines, 'DESCRIPTION'))
        .toBe('DESCRIPTION:Ouvert à tous.\\n\\nAccessibilité:\\nRampe d\'accès\\; boucle magnétique.');
    });

    it('writes the heading block alone when there is no description', () => {
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)]);
      event.content('en').accessibilityInfo = 'Step-free entrance.';

      const lines = onlyVevent([event]);

      expect(property(lines, 'DESCRIPTION')).toBe('DESCRIPTION:Accessibility:\\nStep-free entrance.');
    });

    it('escapes text and removes control characters other than tab and newline', () => {
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)], 'Bake\u0007 sale, round\u0085 two');
      event.content('en').description = 'Bring:\r\n\tcake\u0000\rand; plates\\napkins';

      const lines = onlyVevent([event]);

      expect(property(lines, 'SUMMARY')).toBe('SUMMARY:Bake sale\\, round two');
      expect(property(lines, 'DESCRIPTION')).toBe('DESCRIPTION:Bring:\\n\tcake\\nand\\; plates\\\\napkins');
    });

    it('keeps a line break in a place, space or category name inside its own property', () => {
      const payload = 'x\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:spoof';
      const escaped = 'x\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:spoof';
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)]);
      event.location = new EventLocation('location-1', payload, '100 Main St');
      event.space = new EventLocationSpace('space-1', 'location-1');
      event.space.addContent(new EventLocationSpaceContent('en', payload));
      const category = new EventCategory('category-1', 'calendar-id');
      category.addContent(new EventCategoryContent('en', payload));
      event.categories = [category];

      const { ics } = serialize([event]);
      const blocks = vevents(ics);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].map(line => line.split(/[:;]/)[0])).toEqual([
        'UID', 'DTSTAMP', 'LAST-MODIFIED', 'DTSTART', 'SUMMARY', 'LOCATION', 'CATEGORIES', 'URL',
      ]);
      expect(property(blocks[0], 'SUMMARY')).toBe('SUMMARY:Community Meetup');
      expect(property(blocks[0], 'LOCATION')).toBe(`LOCATION:${escaped}\\, ${escaped}\\, 100 Main St`);
      expect(property(blocks[0], 'CATEGORIES')).toBe(`CATEGORIES:${escaped}`);
      // On the wire too: a folded continuation starts with a space, so no
      // physical line can open or close a component, or pass for a property
      const physical = ics.split('\r\n');
      expect(physical.filter(line => line === 'BEGIN:VEVENT')).toHaveLength(1);
      expect(physical.filter(line => line === 'END:VEVENT')).toHaveLength(1);
      expect(physical.filter(line => line.startsWith('SUMMARY:'))).toEqual(['SUMMARY:Community Meetup']);
    });

    it('writes category names in the chosen language, each escaped, joined by commas', () => {
      const music = new EventCategory('category-1', 'calendar-id');
      music.addContent(new EventCategoryContent('en', 'Music'));
      music.addContent(new EventCategoryContent('es', 'Música'));
      const food = new EventCategory('category-2', 'calendar-id');
      food.addContent(new EventCategoryContent('en', 'Food, drink'));
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)]);
      event.categories = [music, food];

      const lines = onlyVevent([event], { language: 'es', fallbackLanguages: ['en'] });

      expect(property(lines, 'CATEGORIES')).toBe('CATEGORIES:Música,Food\\, drink');
    });

    it('omits CATEGORIES and LOCATION when the event has neither', () => {
      const lines = onlyVevent([makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)])]);

      expect(property(lines, 'CATEGORIES')).toBeUndefined();
      expect(property(lines, 'LOCATION')).toBeUndefined();
    });

    it('writes the location with its space name after the place name', () => {
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)]);
      event.location = new EventLocation('location-1', 'City Hall', '100 Main St', 'Springfield', 'IL', '62701');
      event.space = new EventLocationSpace('space-1', 'location-1');
      event.space.addContent(new EventLocationSpaceContent('en', 'Council Chamber'));
      event.space.addContent(new EventLocationSpaceContent('es', 'Sala del Consejo'));

      const english = onlyVevent([event]);
      const spanish = onlyVevent([event], { language: 'es', fallbackLanguages: ['en'] });

      expect(property(english, 'LOCATION'))
        .toBe('LOCATION:City Hall\\, Council Chamber\\, 100 Main St\\, Springfield\\, IL 62701');
      expect(property(spanish, 'LOCATION'))
        .toBe('LOCATION:City Hall\\, Sala del Consejo\\, 100 Main St\\, Springfield\\, IL 62701');
    });

    it('builds the event URL from the calendar url name and the domain, unescaped', () => {
      const lines = onlyVevent(
        [makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)])],
        { calendar: new Calendar('calendar-id', 'town_hall'), domain: 'cal.example.org' },
      );

      expect(property(lines, 'URL')).toBe(`URL:https://cal.example.org/town_hall/events/${EVENT_A}`);
      expect(property(lines, 'UID')).toBe(`UID:${EVENT_A}@cal.example.org`);
    });

    it('writes each event\'s own last-modified time', () => {
      const event = makeEvent(EVENT_A, [schedule(SCHEDULE_1, MONDAY_EVENING)]);

      const { ics } = serializeCalendarToIcs({
        calendar: new Calendar('calendar-id', 'townhall'),
        events: [entry(event, new Date('2025-12-31T23:59:58Z'))],
        language: 'en',
        fallbackLanguages: [],
        domain: 'events.example',
        now: NOW,
        accessibilityHeading: () => 'Accessibility',
      });

      expect(property(vevents(ics)[0], 'LAST-MODIFIED')).toBe('LAST-MODIFIED:20251231T235958Z');
    });
  });

  describe('events that cannot be serialized', () => {
    function failure(event: CalendarEvent): unknown {
      const healthy = makeEvent(EVENT_B, [schedule(SCHEDULE_3, MONDAY_EVENING)]);
      try {
        serialize([healthy, event]);
      }
      catch (error) {
        return error;
      }
      return null;
    }

    it.each([
      [
        'a schedule in a zone that is not an IANA zone',
        () => [schedule(SCHEDULE_1, DateTime.fromObject({ year: 2026, month: 5, day: 4, hour: 18 }, { zone: 'UTC+5' }))],
      ],
      [
        // Intl accepts a bare offset as a zone, but it has no rules and its
        // colon would break the TZID parameter
        'a schedule in a fixed-offset zone',
        () => [schedule(SCHEDULE_1, DateTime.fromObject({ year: 2026, month: 5, day: 4, hour: 18 }, { zone: '+01:00' }))],
      ],
      [
        'a schedule whose start is not a valid date',
        () => [schedule(SCHEDULE_1, DateTime.invalid('unparseable'))],
      ],
      [
        'an end time that is not a valid date',
        () => [schedule(SCHEDULE_1, MONDAY_EVENING, { eventEndTime: DateTime.invalid('unparseable') })],
      ],
      [
        'a recurring exclusion',
        () => [
          weekly(SCHEDULE_1, MONDAY_EVENING),
          weekly(SCHEDULE_2, MONDAY_EVENING.plus({ weeks: 1 }), { isExclusion: true, interval: 2 }),
        ],
      ],
      [
        'an ordinal weekday on a weekly rule',
        () => [weekly(SCHEDULE_1, MONDAY_EVENING, { byDay: ['2MO'] })],
      ],
    ])('throws IcsSerializationError with the event id for %s', (_label, schedules) => {
      const error = failure(makeEvent(EVENT_A, schedules()));

      expect(error).toBeInstanceOf(IcsSerializationError);
      expect((error as IcsSerializationError).eventId).toBe(EVENT_A);
      expect((error as IcsSerializationError).cause).toBeInstanceOf(Error);
    });
  });
});
