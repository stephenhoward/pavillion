import { DateTime } from 'luxon';

/**
 * The instance slug shape as a regex source string, unanchored: `\d{8}-\d{4}`.
 *
 * This is the one place the shape is spelled. Route-level consumers embed it
 * rather than re-typing it: vue-router param constraints in src/site/routes.ts
 * and src/widget/router.ts interpolate it into a path template
 * (`:startTime(${INSTANCE_SLUG_PATTERN})`), and meta-tags.ts composes it into
 * a `new RegExp` with its own anchors. It carries no anchors of its own
 * because vue-router wraps a param pattern in its own delimiters, and a
 * stray `^` or `$` inside those would silently match nothing.
 *
 * Structural only. parseInstanceSlug applies this shape with anchors and
 * then checks the calendar semantics (month 13, Feb 30, year bounds); a
 * router that accepts a slug by this pattern still hands it to the parser.
 */
export const INSTANCE_SLUG_PATTERN = '\\d{8}-\\d{4}';

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
