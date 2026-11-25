// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { IANAZone } from 'luxon';
import rrule from 'rrule';

import {
  buildVTimezone,
  MAX_VTIMEZONE_SPAN_YEARS,
  VTIMEZONE_CACHE_SIZE,
} from '@/server/calendar/service/export/vtimezone';

const { rrulestr } = rrule;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

interface Observance {
  kind: string;
  dtstart: string;
  offsetFrom: number;
  offsetTo: number;
  rrule: string | null;
}

interface Onset {
  at: number;
  offsetFrom: number;
  offsetTo: number;
}

/** `+HHMM` / `-HHMM` as minutes east of UTC. */
function offsetMinutes(value: string): number {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`not a UTC offset: ${value}`);
  }
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/** A local `YYYYMMDDTHHMMSS` read as though it were UTC. */
function wallMillis(local: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(local);
  if (!m) {
    throw new Error(`not a local date-time: ${local}`);
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function parseObservances(lines: string[]): Observance[] {
  const observances: Observance[] = [];
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:STANDARD' || line === 'BEGIN:DAYLIGHT') {
      current = { kind: line.slice('BEGIN:'.length) };
    }
    else if (line === 'END:STANDARD' || line === 'END:DAYLIGHT') {
      observances.push({
        kind: current!.kind,
        dtstart: current!.DTSTART,
        offsetFrom: offsetMinutes(current!.TZOFFSETFROM),
        offsetTo: offsetMinutes(current!.TZOFFSETTO),
        rrule: current!.RRULE ?? null,
      });
      current = null;
    }
    else if (current) {
      const colon = line.indexOf(':');
      current[line.slice(0, colon)] = line.slice(colon + 1);
    }
  }
  return observances;
}

/**
 * Every onset the VTIMEZONE declares up to the end of `toYear`, in instant
 * order. Recurrence rules are expanded by the rrule package, which the
 * generator does not use, so this is an independent reading of the text.
 */
function onsetTable(lines: string[], toYear: number): Onset[] {
  const horizon = new Date(Date.UTC(toYear + 1, 0, 1));
  const onsets: Onset[] = [];
  for (const observance of parseObservances(lines)) {
    const walls = observance.rrule
      ? rrulestr(`DTSTART:${observance.dtstart}Z\nRRULE:${observance.rrule}`)
        .between(new Date(wallMillis(observance.dtstart)), horizon, true)
        .map(d => d.getTime())
      : [wallMillis(observance.dtstart)];
    for (const wall of walls) {
      onsets.push({
        at: wall - observance.offsetFrom * 60_000,
        offsetFrom: observance.offsetFrom,
        offsetTo: observance.offsetTo,
      });
    }
  }
  return onsets.sort((a, b) => a.at - b.at);
}

/** The offset the table implies at `ts`: the latest onset at or before it. */
function impliedOffset(onsets: Onset[], ts: number): number {
  let offset = onsets[0].offsetFrom;
  for (const onset of onsets) {
    if (onset.at > ts) break;
    offset = onset.offsetTo;
  }
  return offset;
}

/**
 * Compares the generated rules with the platform's own offsets every six
 * hours across the span, and one second either side of every declared onset.
 * Returns the mismatches so a failure names the instants.
 */
function offsetMismatches(zoneName: string, fromYear: number, toYear: number): string[] {
  const zone = IANAZone.create(zoneName);
  const onsets = onsetTable(buildVTimezone(zoneName, fromYear, toYear), toYear);
  const from = Date.UTC(fromYear, 0, 1);
  const to = Date.UTC(toYear + 1, 0, 1);

  const samples: number[] = [];
  for (let ts = from; ts < to; ts += SIX_HOURS_MS) {
    samples.push(ts);
  }
  for (const onset of onsets) {
    if (onset.at > from && onset.at < to) {
      samples.push(onset.at - 1000, onset.at);
    }
  }
  samples.sort((a, b) => a - b);

  const mismatches: string[] = [];
  let next = 0;
  let offset = onsets[0].offsetFrom;
  for (const ts of samples) {
    while (next < onsets.length && onsets[next].at <= ts) {
      offset = onsets[next].offsetTo;
      next++;
    }
    const expected = zone.offset(ts);
    if (offset !== expected) {
      mismatches.push(`${new Date(ts).toISOString()}: rules give ${offset}, zone is ${expected}`);
    }
  }
  return mismatches;
}

describe('buildVTimezone', () => {
  it('writes a zone with one regular rule as two recurring observances', () => {
    expect(buildVTimezone('America/New_York', 2025, 2036)).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'X-LIC-LOCATION:America/New_York',
      'BEGIN:DAYLIGHT',
      'DTSTART:20250309T020000',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:20251102T020000',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]);
  });

  it('writes a last-weekday rule as BYDAY=-1', () => {
    const lines = buildVTimezone('Europe/Berlin', 2025, 2036);

    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU');
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU');
    expect(lines).toContain('DTSTART:20250330T020000');
    expect(lines).toContain('DTSTART:20251026T030000');
  });

  it('orders a southern-hemisphere zone by onset, standard time first', () => {
    const observances = parseObservances(buildVTimezone('Australia/Sydney', 2025, 2036));

    expect(observances).toEqual([
      { kind: 'STANDARD', dtstart: '20250406T030000', offsetFrom: 660, offsetTo: 600, rrule: 'FREQ=YEARLY;BYMONTH=4;BYDAY=1SU' },
      { kind: 'DAYLIGHT', dtstart: '20251005T020000', offsetFrom: 600, offsetTo: 660, rrule: 'FREQ=YEARLY;BYMONTH=10;BYDAY=1SU' },
    ]);
  });

  it('writes a zone with no change in the span as one STANDARD observance', () => {
    expect(buildVTimezone('Asia/Kolkata', 2025, 2036)).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Kolkata',
      'X-LIC-LOCATION:Asia/Kolkata',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0530',
      'TZOFFSETTO:+0530',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]);
  });

  it('writes offsets that are not whole hours', () => {
    expect(buildVTimezone('Asia/Kathmandu', 2025, 2036)).toContain('TZOFFSETTO:+0545');
    expect(buildVTimezone('America/St_Johns', 2025, 2036)).toContain('TZOFFSETFROM:-0330');
    expect(buildVTimezone('America/St_Johns', 2025, 2036)).toContain('TZOFFSETTO:-0230');
    // Lord Howe moves its clocks by half an hour
    expect(buildVTimezone('Australia/Lord_Howe', 2025, 2036)).toContain('TZOFFSETFROM:+1030');
    expect(buildVTimezone('Australia/Lord_Howe', 2025, 2036)).toContain('TZOFFSETTO:+1100');
  });

  it('writes a zone that dropped daylight saving as dated observances after an anchor', () => {
    // Mexico City last changed its clocks on 30 October 2022
    const observances = parseObservances(buildVTimezone('America/Mexico_City', 2021, 2036));

    expect(observances).toEqual([
      { kind: 'STANDARD', dtstart: '20210101T000000', offsetFrom: -360, offsetTo: -360, rrule: null },
      { kind: 'DAYLIGHT', dtstart: '20210404T020000', offsetFrom: -360, offsetTo: -300, rrule: null },
      { kind: 'STANDARD', dtstart: '20211031T020000', offsetFrom: -300, offsetTo: -360, rrule: null },
      { kind: 'DAYLIGHT', dtstart: '20220403T020000', offsetFrom: -360, offsetTo: -300, rrule: null },
      { kind: 'STANDARD', dtstart: '20221030T020000', offsetFrom: -300, offsetTo: -360, rrule: null },
    ]);
  });

  it('writes the years before a rule change as dated observances and the rest as rules', () => {
    // The United States moved to the second Sunday of March in 2007
    const observances = parseObservances(buildVTimezone('America/New_York', 2005, 2020));

    expect(observances.map(o => `${o.kind} ${o.dtstart} ${o.rrule ?? '-'}`)).toEqual([
      'STANDARD 20050101T000000 -',
      'DAYLIGHT 20050403T020000 -',
      'STANDARD 20051030T020000 -',
      'DAYLIGHT 20060402T020000 -',
      'STANDARD 20061029T020000 -',
      'DAYLIGHT 20070311T020000 FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'STANDARD 20071104T020000 FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    ]);
  });

  it.each([
    ['America/New_York', 2015, 2040],
    ['Europe/Berlin', 2015, 2040],
    ['Australia/Sydney', 2015, 2040],
    ['Asia/Kolkata', 2015, 2040],
    ['Asia/Kathmandu', 2015, 2040],
    ['America/St_Johns', 2015, 2040],
    ['Australia/Lord_Howe', 2015, 2040],
    ['America/Mexico_City', 2021, 2040],
    // a rule change inside the span: dated observances, then rules
    ['America/New_York', 2000, 2020],
  ])('declares the offsets %s really has from %i to %i', (zoneName, fromYear, toYear) => {
    expect(offsetMismatches(zoneName, fromYear, toYear)).toEqual([]);
  });

  it('is read by the comparison as offsets that change, so a wrong rule would be caught', () => {
    const onsets = onsetTable(buildVTimezone('Europe/Berlin', 2025, 2036), 2036);

    // two onsets a year for twelve years
    expect(onsets).toHaveLength(24);
    expect(impliedOffset(onsets, Date.UTC(2030, 0, 15))).toBe(60);
    expect(impliedOffset(onsets, Date.UTC(2030, 6, 15))).toBe(120);
    // before the first declared onset the first TZOFFSETFROM applies
    expect(impliedOffset(onsets, Date.UTC(2025, 0, 15))).toBe(60);
  });

  it('gives the same lines on a second call', () => {
    expect(buildVTimezone('Europe/Berlin', 2020, 2030)).toEqual(buildVTimezone('Europe/Berlin', 2020, 2030));
  });

  it('refuses a name that is not an IANA zone', () => {
    expect(() => buildVTimezone('Mars/Olympus_Mons', 2025, 2030)).toThrow(/Mars\/Olympus_Mons/);
  });

  it('refuses a span that ends before it starts', () => {
    expect(() => buildVTimezone('Europe/Berlin', 2030, 2025)).toThrow(RangeError);
  });

  it('refuses a span too wide to scan, before scanning any of it', () => {
    expect(() => buildVTimezone('Europe/Berlin', 1970, 9999)).toThrow(RangeError);
    expect(() => buildVTimezone('Europe/Berlin', 1970, 1970 + MAX_VTIMEZONE_SPAN_YEARS)).toThrow(RangeError);
  });

  it('accepts the widest span it allows', () => {
    const lines = buildVTimezone('Asia/Kolkata', 1970, 1970 + MAX_VTIMEZONE_SPAN_YEARS - 1);

    expect(lines[0]).toBe('BEGIN:VTIMEZONE');
  });
});

describe('buildVTimezone cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a repeat call for the same zone and span without rescanning', () => {
    const first = buildVTimezone('America/Chicago', 1991, 2003);
    const offset = vi.spyOn(IANAZone.prototype, 'offset');

    const second = buildVTimezone('America/Chicago', 1991, 2003);

    expect(second).toEqual(first);
    expect(offset).not.toHaveBeenCalled();
  });

  it('scans again for the same zone over another span', () => {
    buildVTimezone('America/Denver', 1991, 2003);
    const offset = vi.spyOn(IANAZone.prototype, 'offset');

    buildVTimezone('America/Denver', 1991, 2004);

    expect(offset).toHaveBeenCalled();
  });

  it('hands out copies, so a caller changing its lines cannot change the next answer', () => {
    const first = buildVTimezone('Europe/Lisbon', 2000, 2010);
    const expected = [...first];

    first.push('X-MUTATED:1');

    expect(buildVTimezone('Europe/Lisbon', 2000, 2010)).toEqual(expected);
  });

  it('holds a bounded number of spans, forgetting the least recently used first', () => {
    buildVTimezone('Pacific/Auckland', 2001, 2001);
    for (let i = 0; i < VTIMEZONE_CACHE_SIZE; i++) {
      buildVTimezone('Etc/UTC', 1800 + i, 1800 + i);
    }
    const offset = vi.spyOn(IANAZone.prototype, 'offset');

    buildVTimezone('Pacific/Auckland', 2001, 2001);

    expect(offset).toHaveBeenCalled();
  });
});
