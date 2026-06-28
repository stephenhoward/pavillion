/**
 * Single source of truth for parsing a stored BYDAY entry (RFC 5545 BYDAY,
 * e.g. `MO`, `1MO`, `-1FR`).
 *
 * The stored format is an OPTIONAL signed ordinal followed by a two-letter ISO
 * weekday code. An ordinal, when present, encodes "the Nth occurrence of that
 * weekday in the period" (used with MONTHLY/YEARLY rules to express e.g.
 * "first Monday of the month").
 *
 * This parser is intentionally permissive about the ordinal: it returns a
 * structured `{ ordinal, dayCode }` and leaves the present-vs-absent policy to
 * each call site. The presentation helper (recurrence-text) only renders the
 * nth-weekday case and so rejects entries with no ordinal; the rrule builder
 * (event_instance) accepts both plain and ordinal forms. Encoding the domain
 * format once here keeps those two consumers from drifting apart.
 */

/**
 * The seven valid ISO weekday codes (RFC 5545 BYDAY values). Matches rrule's
 * `ALL_WEEKDAYS` exactly.
 */
export type ByDayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

const VALID_DAY_CODES = new Set<string>(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);

/**
 * Pattern for a stored BYDAY entry: an optional signed integer ordinal
 * followed by a two-letter weekday code. The ordinal group is optional so a
 * plain `MO` and an ordinal `1MO` / `-1FR` both match.
 */
const BY_DAY_PATTERN = /^(-?\d+)?([A-Z]{2})$/;

/**
 * Structured result of parsing a BYDAY entry.
 */
export interface ParsedByDay {
  /** The signed ordinal when present (e.g. 1, -1), or `null` for a plain code. */
  ordinal: number | null;
  /** The validated two-letter ISO weekday code. */
  dayCode: ByDayCode;
}

/**
 * Parses a single stored BYDAY entry into structured form.
 *
 * @param entry - A BYDAY token such as `MO`, `1MO`, or `-1FR`
 * @returns `{ ordinal, dayCode }` on success, or `null` when the token does
 *   not match the BYDAY format or carries an unknown weekday code. Callers
 *   apply their own handling of the ordinal-present vs. ordinal-absent case.
 */
export function parseByDayEntry(entry: string): ParsedByDay | null {
  const match = entry.match(BY_DAY_PATTERN);
  if (!match) {
    return null;
  }
  const [, ordinalStr, dayCode] = match;
  if (!VALID_DAY_CODES.has(dayCode)) {
    return null;
  }
  let ordinal: number | null = null;
  if (ordinalStr !== undefined) {
    ordinal = parseInt(ordinalStr, 10);
    if (Number.isNaN(ordinal)) {
      return null;
    }
  }
  return { ordinal, dayCode: dayCode as ByDayCode };
}
