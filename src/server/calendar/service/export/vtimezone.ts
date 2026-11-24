import { DateTime, IANAZone } from 'luxon';

/**
 * VTIMEZONE generation for the calendar export.
 *
 * The observances are derived from the platform's own time zone data, read
 * through Luxon's `IANAZone.offset` (Intl underneath): the span is walked for
 * offset changes, and the changes are then described as RFC 5545 observances.
 * No time zone data package is involved, so the output follows whatever tzdata
 * the running Node carries.
 *
 * Known limit: a zone whose changes follow no yearly weekday rule (or that
 * has stopped changing) is written as dated observances only, so past the end
 * of the span its last observance simply persists.
 */

const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** RFC 5545 weekday codes indexed by `Date.getUTCDay()`. */
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * The widest span, in calendar years, {@link buildVTimezone} will scan. The
 * scan is synchronous and walks the span a day at a time, so its cost grows
 * with the span: a century is a fraction of a second, eight thousand years
 * tens of seconds. Callers size the span from stored dates, which can be
 * arbitrarily far away; this bound keeps a caller that forgets to cap it
 * from blocking the event loop.
 */
export const MAX_VTIMEZONE_SPAN_YEARS = 250;

/** A yearly rule is only declared once it has held for this many years. */
const MIN_REGULAR_YEARS = 2;

/**
 * How many (zone, span) components {@link buildVTimezone} remembers. The
 * scan costs up to about 0.3-0.4 s a zone in the worst case (a span from
 * 1970 to decades ahead), about 22 s for a 64-zone export, and its answer
 * only changes with the running Node's tzdata, so repeat exports reuse it; the bound keeps an
 * owner with schedules in hundreds of zones from growing the cache without
 * limit. Least recently used is forgotten first.
 */
export const VTIMEZONE_CACHE_SIZE = 128;

const vtimezoneCache = new Map<string, string[]>();

/** One change of UTC offset. Offsets are in seconds east of UTC. */
interface Transition {
  /** The first instant the new offset applies, in epoch milliseconds. */
  at: number;
  offsetFrom: number;
  offsetTo: number;
  /** Whether daylight time is in force after the change. */
  isDaylight: boolean;
  /**
   * The onset as local wall time in the offset before the change, carried in
   * the UTC fields of a Date. This is the form DTSTART is written in.
   */
  wall: Date;
}

/** One STANDARD or DAYLIGHT sub-component. */
interface Observance {
  isDaylight: boolean;
  wall: Date;
  offsetFrom: number;
  offsetTo: number;
  rrule: string | null;
}

/** The yearly rule one direction of change follows across the regular tail. */
interface YearlyRule {
  signature: string;
  /** The earliest transition of the tail that follows this rule. */
  first: Transition;
  /** Every onset so far fell on the last such weekday of its month. */
  alwaysLast: boolean;
  /** The distinct week-of-month ordinals the onsets fell on. */
  ordinals: Set<number>;
}

function offsetSeconds(zone: IANAZone, ts: number): number {
  return Math.round(zone.offset(ts) * 60);
}

/** The first whole second in (lo, hi] at which the offset differs from the offset at `lo`. */
function bisectTransition(zone: IANAZone, lo: number, hi: number): number {
  const before = offsetSeconds(zone, lo);
  while (hi - lo > SECOND_MS) {
    const mid = lo + Math.floor((hi - lo) / (2 * SECOND_MS)) * SECOND_MS;
    if (offsetSeconds(zone, mid) === before) {
      lo = mid;
    }
    else {
      hi = mid;
    }
  }
  return hi;
}

/** Every offset change in [from, to), in order. */
function findTransitions(zone: IANAZone, from: number, to: number): Transition[] {
  const transitions: Transition[] = [];
  let cursor = from;
  while (cursor < to) {
    const next = Math.min(cursor + DAY_MS, to);
    const offsetFrom = offsetSeconds(zone, cursor);
    if (offsetSeconds(zone, next) === offsetFrom) {
      cursor = next;
      continue;
    }
    const at = bisectTransition(zone, cursor, next);
    transitions.push({
      at,
      offsetFrom,
      offsetTo: offsetSeconds(zone, at),
      isDaylight: DateTime.fromMillis(at, { zone }).isInDST,
      wall: new Date(at + offsetFrom * SECOND_MS),
    });
    // Resume from the change itself, so a second change inside the same day is found.
    cursor = at;
  }
  return transitions;
}

/** What must stay the same from year to year for a change to follow one rule. */
function ruleSignature(t: Transition): string {
  return [
    t.offsetFrom,
    t.offsetTo,
    t.isDaylight,
    t.wall.getUTCMonth(),
    t.wall.getUTCDay(),
    t.wall.getUTCHours(),
    t.wall.getUTCMinutes(),
    t.wall.getUTCSeconds(),
  ].join('|');
}

/** Which occurrence of its weekday in the month the onset falls on, from 1. */
function weekOfMonth(wall: Date): number {
  return Math.ceil(wall.getUTCDate() / 7);
}

function isLastWeekdayOfMonth(wall: Date): boolean {
  const daysInMonth = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 0)).getUTCDate();
  return wall.getUTCDate() + 7 > daysInMonth;
}

/**
 * The regular tail: the longest run of years reaching the end of the span in
 * which every year has exactly one change each way, each with the same
 * offsets, month, weekday and wall time as the year after it, and falling
 * either always on the last such weekday of the month or always on the same
 * nth. Null when the final years follow no such rule.
 */
function findRegularTail(
  transitions: Transition[],
  fromYear: number,
  toYear: number,
): { startYear: number; rules: YearlyRule[] } | null {
  const byYear = new Map<number, Transition[]>();
  for (const t of transitions) {
    const year = t.wall.getUTCFullYear();
    byYear.set(year, [...(byYear.get(year) ?? []), t]);
  }

  let rules: YearlyRule[] | null = null;
  let startYear = toYear + 1;
  for (let year = toYear; year >= fromYear; year--) {
    const pair = byYear.get(year) ?? [];
    if (pair.length !== 2) break;

    if (rules === null) {
      const [first, second] = pair;
      const eachWay = first.offsetTo === second.offsetFrom && second.offsetTo === first.offsetFrom;
      if (!eachWay || ruleSignature(first) === ruleSignature(second)) break;
      rules = pair.map(t => ({
        signature: ruleSignature(t),
        first: t,
        alwaysLast: isLastWeekdayOfMonth(t.wall),
        ordinals: new Set([weekOfMonth(t.wall)]),
      }));
      startYear = year;
      continue;
    }

    const extended: YearlyRule[] = [];
    for (const rule of rules) {
      const t = pair.find(candidate => ruleSignature(candidate) === rule.signature);
      if (!t) break;
      const alwaysLast = rule.alwaysLast && isLastWeekdayOfMonth(t.wall);
      const ordinals = new Set(rule.ordinals).add(weekOfMonth(t.wall));
      if (!alwaysLast && ordinals.size > 1) break;
      extended.push({ signature: rule.signature, first: t, alwaysLast, ordinals });
    }
    if (extended.length !== rules.length) break;
    rules = extended;
    startYear = year;
  }

  if (rules === null || toYear - startYear + 1 < MIN_REGULAR_YEARS) {
    return null;
  }
  return { startYear, rules };
}

/** `YYYYMMDDTHHMMSS` from the UTC fields of a wall-time Date. */
function formatWall(wall: Date): string {
  return DateTime.fromJSDate(wall, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss");
}

/** `+HHMM` / `-HHMM`, with seconds appended only when the offset has them. */
function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${sign}${pad(Math.floor(abs / 3600))}${pad(Math.floor((abs % 3600) / 60))}`;
  return abs % 60 === 0 ? hhmm : `${hhmm}${pad(abs % 60)}`;
}

function observanceLines(observance: Observance): string[] {
  const name = observance.isDaylight ? 'DAYLIGHT' : 'STANDARD';
  const lines = [
    `BEGIN:${name}`,
    `DTSTART:${formatWall(observance.wall)}`,
    `TZOFFSETFROM:${formatOffset(observance.offsetFrom)}`,
    `TZOFFSETTO:${formatOffset(observance.offsetTo)}`,
  ];
  if (observance.rrule) {
    lines.push(`RRULE:${observance.rrule}`);
  }
  lines.push(`END:${name}`);
  return lines;
}

function datedObservance(t: Transition): Observance {
  return { isDaylight: t.isDaylight, wall: t.wall, offsetFrom: t.offsetFrom, offsetTo: t.offsetTo, rrule: null };
}

function recurringObservance(rule: YearlyRule): Observance {
  const wall = rule.first.wall;
  // "Always last" is checked first: the last Sunday of a month is the fourth
  // in some years and the fifth in others, but it is always the last.
  const ordinal = rule.alwaysLast ? -1 : [...rule.ordinals][0];
  return {
    ...datedObservance(rule.first),
    rrule: `FREQ=YEARLY;BYMONTH=${wall.getUTCMonth() + 1};BYDAY=${ordinal}${WEEKDAY_CODES[wall.getUTCDay()]}`,
  };
}

/**
 * The VTIMEZONE component for an IANA zone, covering the calendar years
 * `fromYear` to `toYear` inclusive.
 *
 * - No offset change in the span: one STANDARD observance.
 * - A yearly rule that holds to the end of the span: one DAYLIGHT and one
 *   STANDARD observance, each with an RRULE, starting at the first onset the
 *   rule covers. For most zones that is the whole component.
 * - Changes before that rule took hold, or every change of a zone with no
 *   such rule: one dated observance each, after an anchor observance at the
 *   start of `fromYear` that carries the offset then in force.
 *
 * Answers a repeat call for the same zone and span from a bounded cache
 * ({@link VTIMEZONE_CACHE_SIZE}); every call returns its own copy.
 *
 * @param zoneName - An IANA zone name, e.g. `America/New_York`
 * @param fromYear - First calendar year the component must be right for
 * @param toYear - Last calendar year the component must be right for
 * @returns The unfolded content lines, `BEGIN:VTIMEZONE` to `END:VTIMEZONE` inclusive
 * @throws {Error} When `zoneName` is not a zone the platform knows
 * @throws {RangeError} When the span is not a pair of whole years in order,
 *   or covers more than {@link MAX_VTIMEZONE_SPAN_YEARS} years
 */
export function buildVTimezone(zoneName: string, fromYear: number, toYear: number): string[] {
  if (!IANAZone.isValidZone(zoneName)) {
    throw new Error(`Unknown time zone: ${zoneName}`);
  }
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear > toYear) {
    throw new RangeError(`Invalid time zone span: ${fromYear} to ${toYear}`);
  }
  if (toYear - fromYear + 1 > MAX_VTIMEZONE_SPAN_YEARS) {
    throw new RangeError(
      `Time zone span ${fromYear} to ${toYear} is wider than ${MAX_VTIMEZONE_SPAN_YEARS} years`,
    );
  }

  const key = `${zoneName}|${fromYear}|${toYear}`;
  const cached = vtimezoneCache.get(key);
  if (cached) {
    // Re-inserting marks the entry most recently used.
    vtimezoneCache.delete(key);
    vtimezoneCache.set(key, cached);
    return [...cached];
  }

  const lines = scanVTimezone(zoneName, fromYear, toYear);
  vtimezoneCache.set(key, lines);
  if (vtimezoneCache.size > VTIMEZONE_CACHE_SIZE) {
    vtimezoneCache.delete(vtimezoneCache.keys().next().value!);
  }
  return [...lines];
}

/** The uncached work of {@link buildVTimezone}, for arguments it has already checked. */
function scanVTimezone(zoneName: string, fromYear: number, toYear: number): string[] {
  const zone = IANAZone.create(zoneName);
  const spanStart = Date.UTC(fromYear, 0, 1);
  const transitions = findTransitions(zone, spanStart, Date.UTC(toYear + 1, 0, 1));
  const startOffset = offsetSeconds(zone, spanStart);

  const observances: Observance[] = [];
  if (transitions.length === 0) {
    observances.push({
      isDaylight: false,
      wall: new Date(0),
      offsetFrom: startOffset,
      offsetTo: startOffset,
      rrule: null,
    });
  }
  else {
    const tail = findRegularTail(transitions, fromYear, toYear);
    const dated = tail
      ? transitions.filter(t => t.wall.getUTCFullYear() < tail.startYear)
      : transitions;
    if (dated.length > 0) {
      observances.push({
        isDaylight: DateTime.fromMillis(spanStart, { zone }).isInDST,
        wall: new Date(spanStart),
        offsetFrom: startOffset,
        offsetTo: startOffset,
        rrule: null,
      });
      observances.push(...dated.map(datedObservance));
    }
    if (tail) {
      observances.push(...tail.rules
        .map(recurringObservance)
        .sort((a, b) => a.wall.getTime() - b.wall.getTime()));
    }
  }

  return [
    'BEGIN:VTIMEZONE',
    `TZID:${zoneName}`,
    `X-LIC-LOCATION:${zoneName}`,
    ...observances.flatMap(observanceLines),
    'END:VTIMEZONE',
  ];
}
