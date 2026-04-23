import { DateTime } from 'luxon';

const SLUG_REGEX = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/;

// Defense-in-depth year bounds to prevent distant timestamps from reaching
// rrule.between, which walks the occurrence series between dtstart and the
// probe point. These bounds widely accommodate legitimate bookmarks.
const YEAR_LOOKBACK = 5;
const YEAR_LOOKAHEAD = 10;

/**
 * Format a DateTime as a minute-precision UTC instance slug: `yyyymmdd-hhmm`.
 * The input is converted to UTC before formatting so callers may pass a
 * zoned DateTime without pre-conversion.
 */
export function formatInstanceSlug(start: DateTime): string {
  return start.toUTC().toFormat('yyyyMMdd-HHmm');
}

/**
 * Parse an instance slug (`yyyymmdd-hhmm`, UTC) into a Luxon DateTime.
 * Returns null for structurally-malformed, semantically-invalid, or
 * out-of-bounds input.
 */
const SLUG_LENGTH = 13;

export function parseInstanceSlug(slug: string): DateTime | null {
  if (!slug || slug.length !== SLUG_LENGTH) return null;
  const match = SLUG_REGEX.exec(slug);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const yearNum = Number(year);
  const currentYear = new Date().getUTCFullYear();
  if (yearNum < currentYear - YEAR_LOOKBACK || yearNum > currentYear + YEAR_LOOKAHEAD) {
    return null;
  }
  const parsed = DateTime.fromObject(
    {
      year: yearNum,
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
    },
    { zone: 'utc' },
  );
  return parsed.isValid ? parsed : null;
}
