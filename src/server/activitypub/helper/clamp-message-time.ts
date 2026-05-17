/**
 * Clamps an ActivityPub activity's `published` timestamp into a bounded
 * sanity window of `[now - 2y, now + 1h]`. If `published` is missing,
 * malformed, or otherwise unparseable, falls back to the supplied arrival
 * time (`now`).
 *
 * Pure helper — does not call `Date.now()` internally. The caller must
 * supply `now` so callers (and tests) control the reference clock.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Two years, defined as 2 * 365 days. Leap-day drift is irrelevant for a
// sanity-window clamp; precision beyond "roughly two years" is not required.
const MS_PER_TWO_YEARS = 2 * 365 * MS_PER_DAY;

export function clampMessageTime(
  published: string | Date | undefined,
  now: Date,
): Date {
  if (published === undefined || published === null || published === '') {
    return now;
  }

  const parsed = published instanceof Date ? published : new Date(published);
  if (Number.isNaN(parsed.getTime())) {
    return now;
  }

  const floor = now.getTime() - MS_PER_TWO_YEARS;
  const ceiling = now.getTime() + MS_PER_HOUR;
  const parsedMs = parsed.getTime();

  if (parsedMs < floor) {
    return new Date(floor);
  }
  if (parsedMs > ceiling) {
    return new Date(ceiling);
  }
  return parsed;
}
