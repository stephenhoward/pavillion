/**
 * Unit tests for the shared week and month grid date math.
 *
 * The module is pure, so every test states both inputs explicitly — the anchor
 * and "today" — rather than relying on the clock or on the machine's zone. The
 * label tests assert against Luxon's own locale data instead of literal
 * strings, because ICU wording varies between Node builds and a literal would
 * be asserting the ICU version rather than our formatting.
 */
import { describe, it, expect } from 'vitest';
import { DateTime, Info } from 'luxon';

import { weekDays, monthCells, periodLabel, weekdayLabels } from '@/common/ui/calendar-views/calendar-grid';

/** A zone with a DST transition, for the weeks that are not 168 hours long. */
const DST_ZONE = 'America/New_York';

/** A date far from every anchor under test, for "today is not in this grid". */
const ELSEWHERE = DateTime.fromISO('1999-06-15');

const day = (iso: string, zone?: string): DateTime =>
  DateTime.fromISO(iso, zone ? { zone } : undefined);

const keys = (cells: { dateKey: string }[]): string[] => cells.map(cell => cell.dateKey);

describe('weekDays', () => {
  it('returns seven cells running Sunday to Saturday', () => {
    const cells = weekDays(day('2026-09-22'), ELSEWHERE);

    expect(cells).toHaveLength(7);
    expect(cells[0].date.weekday).toBe(7); // Luxon: Sunday is 7
    expect(cells[6].date.weekday).toBe(6); // Luxon: Saturday is 6
    expect(keys(cells)).toEqual([
      '2026-09-20', '2026-09-21', '2026-09-22',
      '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
    ]);
    expect(cells.map(cell => cell.dayNumber)).toEqual([20, 21, 22, 23, 24, 25, 26]);
  });

  it('starts the week on Sunday for an anchor on any weekday', () => {
    // The same Sunday convention getWeekStart uses in
    // src/common/utils/datePresets.ts, which drives the fetch window.
    for (let offset = 0; offset < 7; offset++) {
      const anchor = day('2026-09-20').plus({ days: offset });
      const first = weekDays(anchor, ELSEWHERE)[0];

      expect(first.date.weekday).toBe(7);
      expect(first.dateKey).toBe('2026-09-20');
    }
  });

  it('keeps an anchor that is already Sunday as the first cell', () => {
    expect(weekDays(day('2025-01-05'), ELSEWHERE)[0].dateKey).toBe('2025-01-05');
  });

  it('starts every cell at the beginning of its day, whatever time the anchor carries', () => {
    const cells = weekDays(day('2026-09-22T17:45:00'), ELSEWHERE);

    expect(cells.every(cell => cell.date.hour === 0 && cell.date.minute === 0)).toBe(true);
  });

  it('spans the year boundary', () => {
    expect(keys(weekDays(day('2024-12-31'), ELSEWHERE))).toEqual([
      '2024-12-29', '2024-12-30', '2024-12-31',
      '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04',
    ]);
  });

  it('marks only the days in the anchor month as current month', () => {
    const cells = weekDays(day('2024-12-31'), ELSEWHERE);

    expect(cells.map(cell => cell.isCurrentMonth)).toEqual([
      true, true, true, false, false, false, false,
    ]);
  });

  it('produces seven whole days across a spring-forward week', () => {
    const cells = weekDays(day('2024-03-13', DST_ZONE), ELSEWHERE);

    expect(keys(cells)).toEqual([
      '2024-03-10', '2024-03-11', '2024-03-12',
      '2024-03-13', '2024-03-14', '2024-03-15', '2024-03-16',
    ]);
    // Sunday to Saturday is an hour short of six 24-hour days, so arithmetic
    // in fixed durations would drift off midnight after the transition.
    expect(cells[6].date.diff(cells[0].date, 'hours').hours).toBe(143);
    expect(cells.every(cell => cell.date.hour === 0)).toBe(true);
  });

  it('produces seven whole days across a fall-back week', () => {
    const cells = weekDays(day('2024-11-06', DST_ZONE), ELSEWHERE);

    expect(keys(cells)).toEqual([
      '2024-11-03', '2024-11-04', '2024-11-05',
      '2024-11-06', '2024-11-07', '2024-11-08', '2024-11-09',
    ]);
    // An hour longer than six 24-hour days, for the same reason in reverse.
    expect(cells[6].date.diff(cells[0].date, 'hours').hours).toBe(145);
    expect(cells.every(cell => cell.date.hour === 0)).toBe(true);
  });

  it('marks exactly one cell as today when today falls in the week', () => {
    const cells = weekDays(day('2026-09-22'), day('2026-09-24T13:30:00'));

    expect(cells.filter(cell => cell.isToday).map(cell => cell.dateKey)).toEqual(['2026-09-24']);
  });

  it('marks no cell as today when today falls outside the week', () => {
    const cells = weekDays(day('2026-09-22'), day('2026-09-27'));

    expect(cells.some(cell => cell.isToday)).toBe(false);
  });
});

describe('monthCells', () => {
  it('returns 42 cells with the right current-month run, whatever weekday the month starts on', () => {
    const startWeekdays = new Set<number>();

    for (let offset = 0; offset < 24; offset++) {
      const month = day('2024-01-01').plus({ months: offset });
      const cells = monthCells(month, ELSEWHERE);
      const currentMonth = cells.filter(cell => cell.isCurrentMonth);

      startWeekdays.add(month.weekday);

      expect(cells).toHaveLength(42);
      expect(cells[0].date.weekday).toBe(7);
      expect(cells[41].date.weekday).toBe(6);
      expect(currentMonth).toHaveLength(month.daysInMonth!);
      // The month's days are one contiguous run, never scattered.
      expect(currentMonth.map(cell => cell.dayNumber))
        .toEqual(Array.from({ length: month.daysInMonth! }, (_, index) => index + 1));
      expect(new Set(keys(cells)).size).toBe(42);
    }

    // Two consecutive years cover every possible first-of-month weekday.
    expect(startWeekdays.size).toBe(7);
  });

  it('is insensitive to where in the month the anchor sits', () => {
    expect(keys(monthCells(day('2025-01-23'), ELSEWHERE)))
      .toEqual(keys(monthCells(day('2025-01-01'), ELSEWHERE)));
  });

  it('pads December forward into the following January', () => {
    const cells = monthCells(day('2024-12-01'), ELSEWHERE);

    expect(cells[0].dateKey).toBe('2024-12-01'); // 1 December 2024 is itself a Sunday
    expect(cells[41].dateKey).toBe('2025-01-11');
    expect(cells[41].isCurrentMonth).toBe(false);
  });

  it('pads January back into the previous December', () => {
    const cells = monthCells(day('2025-01-01'), ELSEWHERE);

    expect(keys(cells).slice(0, 4)).toEqual(['2024-12-29', '2024-12-30', '2024-12-31', '2025-01-01']);
    expect(cells.slice(0, 4).map(cell => cell.isCurrentMonth)).toEqual([false, false, false, true]);
  });

  it('includes 29 February in a leap year', () => {
    for (const year of ['2024', '2028']) {
      const currentMonth = monthCells(day(`${year}-02-01`), ELSEWHERE).filter(cell => cell.isCurrentMonth);

      expect(currentMonth).toHaveLength(29);
      expect(currentMonth[28].dateKey).toBe(`${year}-02-29`);
    }
  });

  it('ends February on the 28th in a common year', () => {
    const currentMonth = monthCells(day('2023-02-01'), ELSEWHERE).filter(cell => cell.isCurrentMonth);

    expect(currentMonth).toHaveLength(28);
    expect(currentMonth[27].dateKey).toBe('2023-02-28');
  });

  it('covers every calendar day exactly once across a DST transition', () => {
    const cells = monthCells(day('2024-03-01', DST_ZONE), ELSEWHERE);

    expect(new Set(keys(cells)).size).toBe(42);
    expect(keys(cells)).toContain('2024-03-10'); // the short day
    expect(cells.every(cell => cell.date.hour === 0)).toBe(true);
  });

  it('marks exactly one cell as today when today falls in the grid', () => {
    const cells = monthCells(day('2026-09-01'), day('2026-09-22T09:00:00'));

    expect(cells.filter(cell => cell.isToday).map(cell => cell.dateKey)).toEqual(['2026-09-22']);
  });

  it('marks today in the padding when today belongs to a neighbouring month', () => {
    const today = monthCells(day('2025-01-01'), day('2024-12-30')).filter(cell => cell.isToday);

    expect(today.map(cell => cell.dateKey)).toEqual(['2024-12-30']);
    expect(today[0].isCurrentMonth).toBe(false);
  });

  it('marks no cell as today when today falls outside the grid', () => {
    expect(monthCells(day('2026-09-01'), ELSEWHERE).some(cell => cell.isToday)).toBe(false);
  });
});

describe('periodLabel', () => {
  it.each(['en', 'es', 'fr'])('names the month and year in %s', locale => {
    const label = periodLabel('month', day('2024-12-15'), locale);

    expect(label).toContain(Info.months('long', { locale })[11]);
    expect(label).toContain('2024');
  });

  it('does not fall back to English for a non-English locale', () => {
    expect(periodLabel('month', day('2024-12-15'), 'fr')).not.toContain('December');
    expect(periodLabel('week', day('2024-12-31'), 'es')).not.toContain('December');
  });

  it.each(['en', 'es', 'fr'])('names both ends of a week spanning the year boundary in %s', locale => {
    const label = periodLabel('week', day('2024-12-31'), locale);
    const months = Info.months('long', { locale });

    expect(label).toContain(months[11]);
    expect(label).toContain(months[0]);
    expect(label).toContain('2024');
    expect(label).toContain('2025');
  });

  it('labels the week containing the anchor, not the anchor itself', () => {
    expect(periodLabel('week', day('2026-09-24'), 'en'))
      .toBe(periodLabel('week', day('2026-09-20'), 'en'));
  });

  it('labels a week that sits inside one month with that month and year', () => {
    const label = periodLabel('week', day('2026-09-22'), 'en');

    expect(label).toContain(Info.months('long', { locale: 'en' })[8]);
    expect(label).toContain('2026');
  });
});

describe('weekdayLabels', () => {
  it.each(['en', 'es', 'fr'])('returns seven Sunday-first short names in %s', locale => {
    const labels = weekdayLabels(locale);
    const mondayFirst = Info.weekdays('short', { locale });

    expect(labels).toHaveLength(7);
    expect(labels).toEqual([mondayFirst[6], ...mondayFirst.slice(0, 6)]);
  });

  it('is localised rather than fixed English', () => {
    expect(weekdayLabels('en')[0]).toBe('Sun');
    expect(weekdayLabels('fr')).not.toEqual(weekdayLabels('en'));
  });
});
