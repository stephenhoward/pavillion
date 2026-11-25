import { describe, it, expect, beforeAll } from 'vitest';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import ical from 'node-ical';
import type { EventInstance, VEvent } from 'node-ical';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import EventInstanceService from '@/server/calendar/service/event_instance';
import { serializeCalendarToIcs } from '@/server/calendar/service/export/ics_serializer';

/**
 * The exported file read back by an independent parser. node-ical expands the
 * VEVENTs by its own reading of RFC 5545, and the result must be the dates
 * Pavillion itself lists for the same events, instant for instant.
 *
 * No database: the events are built in memory. The test lives under
 * integration/ only because node-ical cannot load in the unit run's vmThreads
 * pool.
 */

const NEW_YORK = 'America/New_York';
const BERLIN = 'Europe/Berlin';

const SYDNEY = 'Australia/Sydney';

const SERIES_EVENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BERLIN_EVENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WEDNESDAYS_EVENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const NOW = new Date('2026-06-01T12:00:00Z');
// One year either side of now. The window holds a daylight-saving change in
// each direction for both zones.
const FROM = new Date('2025-06-01T12:00:00Z');
const TO = new Date('2027-06-01T12:00:00Z');

const newYork = (year: number, month: number, day: number, hour: number) =>
  DateTime.fromObject({ year, month, day, hour }, { zone: NEW_YORK });

const HIDDEN = newYork(2026, 3, 16, 18);
const SHOWN_CANCELLED = newYork(2026, 11, 9, 18);
const EXTRA_DATE = newYork(2026, 7, 4, 10);
// An extra date entered in another zone than the series: 20:00 in Berlin
const EXTRA_DATE_ABROAD = DateTime.fromObject({ year: 2026, month: 8, day: 15, hour: 20 }, { zone: BERLIN });
// The series ends on one of its own Mondays, inside the window, so the last
// occurrence's instant is the UNTIL instant itself.
const SERIES_END = newYork(2027, 3, 29, 18);

// Monday 21 September 2026, 19:00 in Sydney: the start of a Wednesdays-only
// rule, so the start itself is never an occurrence.
const WEDNESDAYS_START = DateTime.fromObject({ year: 2026, month: 9, day: 21, hour: 19 }, { zone: SYDNEY });
const WEDNESDAYS_COUNT = 6;

function schedule(id: string, start: DateTime, extra: Partial<CalendarEventSchedule> = {}): CalendarEventSchedule {
  const s = new CalendarEventSchedule(id, start);
  Object.assign(s, extra);
  return s;
}

/**
 * Mondays at 18:00 in New York from January 2026 until the last Monday of
 * March 2027, with one date hidden, one shown as cancelled, an extra Saturday
 * morning, and an extra date entered in Berlin time.
 */
function seriesEvent(): CalendarEvent {
  const start = newYork(2026, 1, 5, 18);
  const event = new CalendarEvent(SERIES_EVENT, 'calendar-id');
  event.addContent(new CalendarEventContent('en', 'Monday Supper', 'Bring a dish to share.'));
  event.schedules = [
    schedule('11111111-1111-4111-8111-111111111111', start, {
      frequency: EventFrequency.WEEKLY,
      interval: 1,
      eventEndTime: start.plus({ hours: 2 }),
      endDate: SERIES_END,
    }),
    schedule('22222222-2222-4222-8222-222222222222', EXTRA_DATE),
    schedule('66666666-6666-4666-8666-666666666666', EXTRA_DATE_ABROAD),
    schedule('33333333-3333-4333-8333-333333333333', HIDDEN.toUTC(), { isExclusion: true, hideFromPublic: true }),
    schedule('44444444-4444-4444-8444-444444444444', SHOWN_CANCELLED.toUTC(), { isExclusion: true, hideFromPublic: false }),
  ];
  return event;
}

/** The first Thursday of each month at 19:30 in Berlin, 24 times from September 2025. */
function berlinEvent(): CalendarEvent {
  const start = DateTime.fromObject({ year: 2025, month: 9, day: 4, hour: 19, minute: 30 }, { zone: BERLIN });
  const event = new CalendarEvent(BERLIN_EVENT, 'calendar-id');
  event.addContent(new CalendarEventContent('en', 'Stammtisch'));
  event.schedules = [
    schedule('55555555-5555-4555-8555-555555555555', start, {
      frequency: EventFrequency.MONTHLY,
      interval: 1,
      byDay: ['1TH'],
      count: 24,
      eventEndTime: start.plus({ hours: 1, minutes: 30 }),
    }),
  ];
  return event;
}

/**
 * Every second Wednesday at 19:00 in Sydney, six times, from a rule whose
 * stored start is a Monday. Pavillion never lists the Monday and counts six
 * Wednesdays; an importer counts DTSTART, so the two only agree if the file
 * starts the series on the first Wednesday.
 */
function wednesdaysEvent(): CalendarEvent {
  const event = new CalendarEvent(WEDNESDAYS_EVENT, 'calendar-id');
  event.addContent(new CalendarEventContent('en', 'Midweek Run'));
  event.schedules = [
    schedule('77777777-7777-4777-8777-777777777777', WEDNESDAYS_START, {
      frequency: EventFrequency.WEEKLY,
      interval: 2,
      byDay: ['WE'],
      count: WEDNESDAYS_COUNT,
      eventEndTime: WEDNESDAYS_START.plus({ minutes: 45 }),
    }),
  ];
  return event;
}

const key = (eventId: string, ms: number) => `${eventId} ${new Date(ms).toISOString()}`;

/** What Pavillion lists for an event inside the window, hidden dates left out. */
async function pavillionOccurrences(event: CalendarEvent): Promise<string[]> {
  const service = new EventInstanceService(new EventEmitter());
  const { occurrences, hasMore } = await service.listUpcomingOccurrences(event, DateTime.fromJSDate(FROM), 1000);
  expect(hasMore).toBe(false);
  return occurrences
    .filter(occurrence => occurrence.state !== 'hidden' && occurrence.start.toMillis() <= TO.getTime())
    .map(occurrence => key(event.id, occurrence.start.toMillis()));
}

describe('calendar export read back by node-ical', () => {
  const events = [seriesEvent(), berlinEvent(), wednesdaysEvent()];
  const startsOf = (eventId: string) => instances
    .filter(found => found.eventId === eventId)
    .map(({ instance }) => instance.start.getTime())
    .sort((a, b) => a - b);
  let instances: Array<{ eventId: string; instance: EventInstance }>;

  beforeAll(() => {
    const { ics } = serializeCalendarToIcs({
      calendar: new Calendar('calendar-id', 'townhall'),
      events: events.map(event => ({ event, lastModified: new Date('2026-05-01T00:00:00Z') })),
      language: 'en',
      fallbackLanguages: [],
      domain: 'events.example',
      now: NOW,
      accessibilityHeading: () => 'Accessibility',
    });

    const vevents = Object.values(ical.sync.parseICS(ics))
      .filter((component): component is VEvent => component?.type === 'VEVENT');
    instances = vevents.flatMap(vevent => ical
      .expandRecurringEvent(vevent, { from: FROM, to: TO })
      // The event id is the first 36 characters of every UID the export derives
      .map(instance => ({ eventId: vevent.uid.slice(0, 36), instance })));
  });

  it('yields the occurrences Pavillion lists, instant for instant', async () => {
    const expected = (await Promise.all(events.map(pavillionOccurrences))).flat().sort();
    const actual = instances.map(({ eventId, instance }) => key(eventId, instance.start.getTime())).sort();

    expect(actual).toEqual(expected);
    // Enough dates that both zones' clock changes fall inside the comparison
    expect(expected.length).toBeGreaterThan(85);
    expect(expected).toContain(key(SERIES_EVENT, EXTRA_DATE.toMillis()));
    expect(expected).toContain(key(SERIES_EVENT, EXTRA_DATE_ABROAD.toMillis()));
    expect(expected).toContain(key(SERIES_EVENT, Date.parse('2026-03-02T23:00:00Z')));
    expect(expected).toContain(key(SERIES_EVENT, Date.parse('2026-03-09T22:00:00Z')));
    expect(expected).toContain(key(BERLIN_EVENT, Date.parse('2025-10-02T17:30:00Z')));
    expect(expected).toContain(key(BERLIN_EVENT, Date.parse('2025-11-06T18:30:00Z')));
  });

  it('ends a series on its end date, which is its last occurrence', async () => {
    const listed = await pavillionOccurrences(seriesEvent());
    const weekAfter = SERIES_END.plus({ weeks: 1 });

    // Pavillion lists the end date itself and nothing a week later, well inside the window
    expect(listed).toContain(key(SERIES_EVENT, SERIES_END.toMillis()));
    expect(listed).not.toContain(key(SERIES_EVENT, weekAfter.toMillis()));
    expect(weekAfter.toMillis()).toBeLessThan(TO.getTime());
    // and so does the file read back
    expect(startsOf(SERIES_EVENT).at(-1)).toBe(SERIES_END.toMillis());
  });

  it('ends a counted series after the same occurrences, the first being the first one listed', async () => {
    const wednesday = (month: number, day: number) =>
      DateTime.fromObject({ year: 2026, month, day, hour: 19 }, { zone: SYDNEY }).toMillis();
    // Sydney's clocks go forward on 4 October 2026, between the first two
    const everySecondWednesday = [
      wednesday(9, 23), wednesday(10, 7), wednesday(10, 21), wednesday(11, 4), wednesday(11, 18), wednesday(12, 2),
    ];

    expect(await pavillionOccurrences(wednesdaysEvent()))
      .toEqual(everySecondWednesday.map(ms => key(WEDNESDAYS_EVENT, ms)));
    expect(startsOf(WEDNESDAYS_EVENT)).toEqual(everySecondWednesday);
    expect(startsOf(WEDNESDAYS_EVENT)).toHaveLength(WEDNESDAYS_COUNT);
    expect(startsOf(WEDNESDAYS_EVENT)).not.toContain(WEDNESDAYS_START.toMillis());
  });

  it('reads an extra date entered in another zone at the same instant', () => {
    const abroad = instances.find(({ instance }) => instance.start.getTime() === EXTRA_DATE_ABROAD.toMillis());

    expect(abroad?.eventId).toBe(SERIES_EVENT);
    expect(abroad?.instance.start.tz).toBe(BERLIN);
  });

  it('leaves the hidden date out', () => {
    const starts = instances.map(({ instance }) => instance.start.getTime());

    expect(starts).not.toContain(HIDDEN.toMillis());
    expect(starts).toContain(HIDDEN.plus({ weeks: 1 }).toMillis());
  });

  it('reports the date shown as cancelled, and only that date, as CANCELLED', () => {
    const cancelled = instances.filter(({ instance }) => instance.event.status === 'CANCELLED');

    expect(cancelled.map(({ eventId, instance }) => key(eventId, instance.start.getTime())))
      .toEqual([key(SERIES_EVENT, SHOWN_CANCELLED.toMillis())]);
    expect(cancelled[0].instance.isOverride).toBe(true);
  });

  it('gives every occurrence the event\'s length', () => {
    const lengthsInMinutes = (eventId: string) => new Set(instances
      .filter(found => found.eventId === eventId)
      .map(({ instance }) => (instance.end.getTime() - instance.start.getTime()) / 60_000));

    expect(lengthsInMinutes(SERIES_EVENT)).toEqual(new Set([120]));
    expect(lengthsInMinutes(BERLIN_EVENT)).toEqual(new Set([90]));
    expect(lengthsInMinutes(WEDNESDAYS_EVENT)).toEqual(new Set([45]));
  });
});
