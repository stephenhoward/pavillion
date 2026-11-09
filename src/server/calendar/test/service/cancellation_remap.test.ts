import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('@/server/common/helper/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: warnMock, debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: warnMock, debug: vi.fn() }),
}));

import { CalendarEvent, CalendarEventSchedule, EventFrequency } from '@/common/model/events';
import { remapCancellations, REMAP_MAX_ROWS, type CancellationRemap } from '@/server/calendar/service/cancellation_remap';
import { expandScheduleOccurrences } from '@/server/calendar/service/event_instance';

/**
 * Literal instants throughout. 2026-01-05 is a Monday; US daylight saving
 * starts 2026-03-08; Asia/Tokyo has none.
 */
const LA = 'America/Los_Angeles';
const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

function recurring(id: string, startIso: string, zone: string, opts: {
  frequency?: EventFrequency;
  interval?: number;
  count?: number;
  byDay?: string[];
} = {}): CalendarEventSchedule {
  const schedule = new CalendarEventSchedule(id, DateTime.fromISO(startIso, { zone }));
  schedule.frequency = opts.frequency ?? EventFrequency.WEEKLY;
  schedule.interval = opts.interval ?? 1;
  schedule.count = opts.count ?? 0;
  schedule.byDay = opts.byDay ?? [];
  schedule.isExclusion = false;
  return schedule;
}

function oneOff(id: string, startIso: string, zone: string): CalendarEventSchedule {
  const schedule = new CalendarEventSchedule(id, DateTime.fromISO(startIso, { zone }));
  schedule.frequency = null;
  schedule.isExclusion = false;
  return schedule;
}

/** A single-date cancellation stored the way rows are: a true UTC instant. */
function cancellation(id: string, instantIso: string, hidden: boolean = true): CalendarEventSchedule {
  const row = new CalendarEventSchedule(id, DateTime.fromISO(instantIso, { zone: 'utc' }));
  row.frequency = null;
  row.isExclusion = true;
  row.hideFromPublic = hidden;
  return row;
}

/** The result with instants as UTC ISO strings and ids sorted, for comparison. */
function plain(result: CancellationRemap) {
  return {
    move: result.move
      .map(m => ({ id: m.id, start: m.start.toUTC().toISO(), hidden: m.hidden }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    remove: [...result.remove].sort(),
  };
}

/** Weekly Mondays at 10:00 Los Angeles from 2026-01-05 (18:00Z in winter). */
const mondays = () => recurring('series', '2026-01-05T10:00:00', LA);

/** Weekly Thursdays at the given Los Angeles time from 2026-01-08. */
const thursdays = (time: string = '18:00:00') => recurring('thursdays', `2026-01-08T${time}`, LA);

/** Cancellations on the 2nd and 4th Mondays (positions 1 and 3). */
const mondayRows = () => [
  cancellation('row-a', '2026-01-12T18:00:00Z'),
  cancellation('row-b', '2026-01-26T18:00:00Z'),
];

describe('remapCancellations', () => {
  beforeEach(() => {
    warnMock.mockClear();
  });

  describe('keeps rows still on an occurrence (rule 1)', () => {
    it.each([
      ['an unrelated edit', () => [mondays()]],
      ['Monday becoming Monday and Wednesday', () => [recurring('series', '2026-01-05T10:00:00', LA, { byDay: ['MO', 'WE'] })]],
      ['a shortened count that still covers the rows', () => [recurring('series', '2026-01-05T10:00:00', LA, { count: 5 })]],
      ['the start moved one week later along the pattern', () => [recurring('series', '2026-01-12T10:00:00', LA)]],
      ['a different schedule now holding the occurrences', () => [
        recurring('series', '2026-01-05T10:00:00', LA, { byDay: ['TU'] }),
        recurring('other', '2026-01-05T10:00:00', LA),
      ]],
    ])('on %s', (_label, newPositives) => {
      const result = remapCancellations([mondays()], newPositives(), mondayRows(), 'event-1');
      expect(plain(result)).toEqual({ move: [], remove: [] });
    });
  });

  describe('removes rows that no longer line up (rules 3 and 5)', () => {
    it.each([
      ['byDay Monday → Tuesday', [mondays()], () => [recurring('series', '2026-01-05T10:00:00', LA, { byDay: ['TU'] })], mondayRows],
      ['an interval change', [mondays()], () => [recurring('series', '2026-01-05T10:00:00', LA, { interval: 2 })], mondayRows],
      ['a frequency change', [mondays()], () => [recurring('series', '2026-01-05T10:00:00', LA, { frequency: EventFrequency.MONTHLY })], mondayRows],
      ['the schedule removed', [mondays()], () => [], mondayRows],
      ['a recurring schedule whose id changed beside another schedule', [mondays(), thursdays()],
        () => [recurring('replacement', '2026-01-05T11:00:00', LA), thursdays()], mondayRows],
      ['a one-off whose id is absent beside another schedule', [oneOff('once', '2026-03-03T10:00:00', LA), mondays()],
        () => [oneOff('elsewhere', '2026-03-10T10:00:00', LA), mondays()],
        () => [cancellation('row-a', '2026-03-03T18:00:00Z')]],
      ['a lone recurring schedule replaced by a lone one-off', [mondays()], () => [oneOff('replacement', '2026-01-12T11:00:00', LA)], mondayRows],
      ['a lone schedule whose id and pattern both changed', [mondays()],
        () => [recurring('replacement', '2026-01-05T10:00:00', LA, { byDay: ['TU'] })], mondayRows],
      ['a shift that fails the gate (Mon 10:00 → Tue 09:00)', [mondays()], () => [recurring('series', '2026-01-06T09:00:00', LA)], mondayRows],
    ])('on %s', (_label, oldPositives, newPositives, rows) => {
      const exclusions = rows();
      const result = remapCancellations(oldPositives, newPositives(), exclusions, 'event-1');
      expect(plain(result)).toEqual({ move: [], remove: exclusions.map(r => r.id).sort() });
    });
  });

  describe('moves rows by position (rule 4)', () => {
    it('moves a same-zone time change to the new time on each row\'s own date, keeping its state', () => {
      const rows = [
        cancellation('row-a', '2026-01-12T18:00:00Z', true),
        cancellation('row-b', '2026-01-26T18:00:00Z', false),
      ];
      const result = remapCancellations([mondays()], [recurring('series', '2026-01-05T11:00:00', LA)], rows, 'event-1');
      expect(plain(result)).toEqual({
        move: [
          { id: 'row-a', start: '2026-01-12T19:00:00.000Z', hidden: true },
          { id: 'row-b', start: '2026-01-26T19:00:00.000Z', hidden: false },
        ],
        remove: [],
      });
    });

    it('moves a zone change at the same wall time (Los Angeles → New York) across a DST change', () => {
      const old = recurring('series', '2026-02-23T10:00:00', LA);
      const rows = [
        cancellation('row-a', '2026-03-02T18:00:00Z'), // 10:00 PST
        cancellation('row-b', '2026-03-16T17:00:00Z'), // 10:00 PDT
      ];
      const result = remapCancellations([old], [recurring('series', '2026-02-23T10:00:00', NY)], rows, 'event-1');
      expect(plain(result).move).toEqual([
        { id: 'row-a', start: '2026-03-02T15:00:00.000Z', hidden: true }, // 10:00 EST
        { id: 'row-b', start: '2026-03-16T14:00:00.000Z', hidden: true }, // 10:00 EDT
      ]);
      expect(result.remove).toEqual([]);
    });

    it('moves a zone change with a large offset (Los Angeles → Tokyo) by wall date', () => {
      const result = remapCancellations([mondays()], [recurring('series', '2026-01-05T10:00:00', TOKYO)], mondayRows(), 'event-1');
      expect(plain(result).move).toEqual([
        { id: 'row-a', start: '2026-01-12T01:00:00.000Z', hidden: true },
        { id: 'row-b', start: '2026-01-26T01:00:00.000Z', hidden: true },
      ]);
      expect(result.remove).toEqual([]);
    });

    it('keeps each row on its position when a stored-UTC series is re-saved in a zone at the same instant', () => {
      // 02:00Z on Tuesdays is 18:00 on Mondays in Los Angeles, 17:00 PDT → 01:00Z after the change.
      const old = recurring('series', '2026-02-24T02:00:00', 'UTC');
      const rows = [
        cancellation('row-a', '2026-03-03T02:00:00Z'), // position 1, before the change
        cancellation('row-b', '2026-03-17T02:00:00Z'), // position 3, after it
      ];
      const resaved = recurring('series', '2026-02-23T18:00:00', LA);
      const result = remapCancellations([old], [resaved], rows, 'event-1');
      // row-a is still an occurrence; row-b follows the wall time to 01:00Z.
      expect(plain(result)).toEqual({
        move: [{ id: 'row-b', start: '2026-03-17T01:00:00.000Z', hidden: true }],
        remove: [],
      });
    });

    it('moves each row by position when a stored-UTC series is relabelled with the same digits in a zone', () => {
      const old = recurring('series', '2026-02-24T02:00:00', 'UTC');
      const rows = [
        cancellation('row-a', '2026-03-03T02:00:00Z'),
        cancellation('row-b', '2026-03-17T02:00:00Z'),
      ];
      const relabelled = recurring('series', '2026-02-24T02:00:00', LA);
      const result = remapCancellations([old], [relabelled], rows, 'event-1');
      expect(plain(result).move).toEqual([
        { id: 'row-a', start: '2026-03-03T10:00:00.000Z', hidden: true }, // 02:00 PST
        { id: 'row-b', start: '2026-03-17T09:00:00.000Z', hidden: true }, // 02:00 PDT
      ]);
      expect(result.remove).toEqual([]);
    });

    it('moves rows within a shorter series and removes those past its new end', () => {
      const shorter = recurring('series', '2026-01-05T11:00:00', LA, { count: 3 });
      const result = remapCancellations([mondays()], [shorter], mondayRows(), 'event-1');
      expect(plain(result)).toEqual({
        move: [{ id: 'row-a', start: '2026-01-12T19:00:00.000Z', hidden: true }],
        remove: ['row-b'],
      });
    });
  });

  describe('one-off and multi-schedule events', () => {
    it('moves a one-off\'s row to its new date (rule 3)', () => {
      const result = remapCancellations(
        [oneOff('once', '2026-03-02T10:00:00', LA)],
        [oneOff('once', '2026-03-09T12:00:00', LA)],
        [cancellation('row-a', '2026-03-02T18:00:00Z')],
        'event-1',
      );
      expect(plain(result)).toEqual({
        move: [{ id: 'row-a', start: '2026-03-09T19:00:00.000Z', hidden: true }],
        remove: [],
      });
    });

    it('moves only the changed schedule\'s rows in a two-schedule event', () => {
      const rows = [
        cancellation('monday-row', '2026-01-12T18:00:00Z'),
        cancellation('thursday-row', '2026-01-16T02:00:00Z'), // Thu 15th 18:00 PST
      ];
      const result = remapCancellations(
        [mondays(), thursdays('18:00:00')],
        [mondays(), thursdays('19:00:00')],
        rows,
        'event-1',
      );
      expect(plain(result)).toEqual({
        move: [{ id: 'thursday-row', start: '2026-01-16T03:00:00.000Z', hidden: true }],
        remove: [],
      });
    });

    it('expands each side in the frame CalendarEvent.baseSchedule() picks, ties broken by id', () => {
      // Both start at 18:00Z on 23 Feb; 'aaa' wins the tie, so the series
      // expands in UTC and stays at 18:00Z across the DST change. Framed in
      // the series' own Los Angeles zone (first loaded), 16 March would be
      // 17:00Z and the row would match nothing.
      const series = (time: string) => recurring('series', `2026-02-23T${time}`, LA);
      const anchor = () => oneOff('aaa', '2026-02-23T18:00:00Z', 'UTC');
      const oldPositives = [series('10:00:00'), anchor()];
      const newPositives = [series('11:00:00'), anchor()];
      const event = new CalendarEvent('event-1', null);
      event.schedules = newPositives;
      expect(event.baseSchedule()?.id).toBe('aaa');

      const result = remapCancellations(oldPositives, newPositives, [cancellation('row-a', '2026-03-16T18:00:00Z')], 'event-1');
      const expected = expandScheduleOccurrences(newPositives[0], event.baseSchedule(), new Date('2026-03-31T00:00:00Z'), 10)[3];
      expect(expected.toISOString()).toBe('2026-03-16T19:00:00.000Z');
      expect(plain(result)).toEqual({
        move: [{ id: 'row-a', start: expected.toISOString(), hidden: true }],
        remove: [],
      });
    });
  });

  describe('pairs a lone schedule across an id change', () => {
    it('moves a lone recurring schedule\'s rows on a time change', () => {
      const result = remapCancellations([mondays()], [recurring('replacement', '2026-01-05T11:00:00', LA)], mondayRows(), 'event-1');
      expect(plain(result)).toEqual({
        move: [
          { id: 'row-a', start: '2026-01-12T19:00:00.000Z', hidden: true },
          { id: 'row-b', start: '2026-01-26T19:00:00.000Z', hidden: true },
        ],
        remove: [],
      });
    });

    it('moves a lone one-off\'s row on a date change', () => {
      const result = remapCancellations(
        [oneOff('once', '2026-03-02T10:00:00', LA)],
        [oneOff('replacement', '2026-03-09T10:00:00', LA)],
        [cancellation('row-a', '2026-03-02T18:00:00Z')],
        'event-1',
      );
      expect(plain(result)).toEqual({
        move: [{ id: 'row-a', start: '2026-03-09T17:00:00.000Z', hidden: true }], // 10:00 PDT
        remove: [],
      });
    });
  });

  describe('collisions', () => {
    // Shifting 10:00 → 11:00 moves the mover onto 11:00 on 12 Jan, where a
    // row that was orphaned before the edit now sits on an occurrence.
    const shifted = () => [recurring('series', '2026-01-05T11:00:00', LA)];

    it.each([
      ['mover first', false],
      ['kept row first', true],
    ])('leaves one hidden row when a hidden mover meets a shown kept row (%s)', (_label, reversed) => {
      const rows = [
        cancellation('mover', '2026-01-12T18:00:00Z', true),
        cancellation('kept', '2026-01-12T19:00:00Z', false),
      ];
      const result = remapCancellations([mondays()], shifted(), reversed ? rows.reverse() : rows, 'event-1');
      expect(plain(result)).toEqual({
        move: [{ id: 'kept', start: '2026-01-12T19:00:00.000Z', hidden: true }],
        remove: ['mover'],
      });
    });

    it.each([
      ['mover first', false],
      ['kept row first', true],
    ])('leaves the hidden kept row alone when a shown mover meets it (%s)', (_label, reversed) => {
      const rows = [
        cancellation('mover', '2026-01-12T18:00:00Z', false),
        cancellation('kept', '2026-01-12T19:00:00Z', true),
      ];
      const result = remapCancellations([mondays()], shifted(), reversed ? rows.reverse() : rows, 'event-1');
      expect(plain(result)).toEqual({ move: [], remove: ['mover'] });
    });

    it.each([
      ['recurring row first', false],
      ['one-off row first', true],
    ])('keeps one hidden row when two movers land on one free instant (%s)', (_label, reversed) => {
      // The one-off moves to its new start, 11:00 on 12 Jan; the series'
      // 10:00 occurrence that day shifts onto the same instant.
      const rows = [
        cancellation('a-series-row', '2026-01-12T18:00:00Z', false),
        cancellation('b-one-off-row', '2026-01-20T18:00:00Z', true),
      ];
      const result = remapCancellations(
        [mondays(), oneOff('once', '2026-01-20T10:00:00', LA)],
        [recurring('series', '2026-01-05T11:00:00', LA), oneOff('once', '2026-01-12T11:00:00', LA)],
        reversed ? rows.reverse() : rows,
        'event-1',
      );
      expect(plain(result)).toEqual({
        move: [{ id: 'a-series-row', start: '2026-01-12T19:00:00.000Z', hidden: true }],
        remove: ['b-one-off-row'],
      });
    });
  });

  describe('leaves rows untouched', () => {
    it('ignores recurring cancellation rows', () => {
      const recurringRow = cancellation('recurring-row', '2026-01-12T18:00:00Z');
      recurringRow.frequency = EventFrequency.WEEKLY;
      recurringRow.interval = 1;
      recurringRow.count = 2;
      const result = remapCancellations([mondays()], [recurring('series', '2026-01-06T09:00:00', LA)], [recurringRow], 'event-1');
      expect(plain(result)).toEqual({ move: [], remove: [] });
    });

    it('ignores a row already off every occurrence, even under a pattern change', () => {
      const orphan = cancellation('orphan', '2026-01-13T18:00:00Z'); // a Tuesday
      const result = remapCancellations([mondays()], [recurring('series', '2026-01-05T10:00:00', LA, { byDay: ['WE'] })], [orphan], 'event-1');
      expect(plain(result)).toEqual({ move: [], remove: [] });
    });

    it('leaves a row the capped walk cannot reach, while moving one it can', () => {
      // Daily from 2000-01-03: the 5000-occurrence cap ends in 2013.
      const daily = (time: string) => recurring('daily', `2000-01-03T${time}`, 'UTC', { frequency: EventFrequency.DAILY });
      const rows = [
        cancellation('reachable', '2000-01-10T10:00:00Z'),
        cancellation('beyond-cap', '2020-01-06T10:00:00Z'),
      ];
      const result = remapCancellations([daily('10:00:00')], [daily('11:00:00')], rows, 'event-1');
      expect(plain(result)).toEqual({
        move: [{ id: 'reachable', start: '2000-01-10T11:00:00.000Z', hidden: true }],
        remove: [],
      });
    });

    it('leaves a row only the old side\'s capped walk would reach, while removing one it can', () => {
      // The old daily series is capped in 2013; the new weekly one reaches 2020.
      const rows = [
        cancellation('reachable', '2000-01-10T10:00:00Z'),
        cancellation('beyond-cap', '2020-01-06T10:00:00Z'),
      ];
      const result = remapCancellations(
        [recurring('daily', '2000-01-03T10:00:00', 'UTC', { frequency: EventFrequency.DAILY })],
        [recurring('daily', '2000-01-04T11:00:00', 'UTC')],
        rows,
        'event-1',
      );
      expect(plain(result)).toEqual({ move: [], remove: ['reachable'] });
    });

    it('leaves every row, and logs the event id only, when there are more than REMAP_MAX_ROWS', () => {
      const rows = Array.from({ length: REMAP_MAX_ROWS + 1 }, (_, i) =>
        cancellation(`row-${i}`, DateTime.fromISO('2026-01-05T18:00:00Z', { zone: 'utc' }).plus({ weeks: i }).toISO()!));
      const result = remapCancellations([mondays()], [recurring('series', '2026-01-06T09:00:00', LA)], rows, 'event-1');
      expect(plain(result)).toEqual({ move: [], remove: [] });
      expect(warnMock).toHaveBeenCalledTimes(1);
      expect(warnMock.mock.calls[0][0]).toStrictEqual({ eventId: 'event-1' });
    });
  });
});

describe('expandScheduleOccurrences', () => {
  it('returns nothing for a schedule with no start', () => {
    const schedule = recurring('series', '2026-01-05T10:00:00', LA);
    schedule.startDate = null;
    expect(expandScheduleOccurrences(schedule, null, null, 10)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
    ['fractional', 1.5],
  ])('expands a recurring schedule with a %s interval as interval 1', (_label, interval) => {
    const schedule = recurring('series', '2026-03-02T10:00:00', LA);
    schedule.interval = interval as unknown as number;
    const starts = expandScheduleOccurrences(schedule, schedule, null, 2).map(d => d.toISOString());
    expect(starts).toEqual(['2026-03-02T18:00:00.000Z', '2026-03-09T17:00:00.000Z']);
  });

  it('returns raw occurrences as instants in the frame schedule\'s zone, up to the limit', () => {
    const schedule = recurring('series', '2026-03-02T10:00:00', LA);
    const starts = expandScheduleOccurrences(schedule, schedule, null, 2).map(d => d.toISOString());
    expect(starts).toEqual(['2026-03-02T18:00:00.000Z', '2026-03-09T17:00:00.000Z']);
  });

  it('stops at until, inclusive, across a DST change', () => {
    const schedule = recurring('series', '2026-03-02T10:00:00', LA);
    const until = new Date('2026-03-16T17:00:00.000Z');
    const starts = expandScheduleOccurrences(schedule, schedule, until, 10).map(d => d.toISOString());
    expect(starts).toEqual(['2026-03-02T18:00:00.000Z', '2026-03-09T17:00:00.000Z', '2026-03-16T17:00:00.000Z']);
  });

  it('returns a one-off\'s start only when it is not after until', () => {
    const schedule = oneOff('once', '2026-03-02T10:00:00', LA);
    expect(expandScheduleOccurrences(schedule, schedule, new Date('2026-03-02T18:00:00.000Z'), 10)
      .map(d => d.toISOString())).toEqual(['2026-03-02T18:00:00.000Z']);
    expect(expandScheduleOccurrences(schedule, schedule, new Date('2026-03-02T17:59:59.000Z'), 10)).toEqual([]);
  });
});
