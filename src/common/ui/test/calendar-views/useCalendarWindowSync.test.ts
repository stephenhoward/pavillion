/**
 * Unit tests for useCalendarWindowSync.
 *
 * The target is a stub that records every call into one shared log, so the
 * assertions pin the order of setViewWindow and reloadWithFilters rather than
 * only that each happened. The stub has no setDateRange: the view window must
 * never reach the list filter's dates.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick, ref } from 'vue';
import { DateTime } from 'luxon';

import {
  useCalendarWindowSync,
  type CalendarWindowSyncTarget,
} from '@/common/ui/calendar-views/useCalendarWindowSync';
import type { CalendarWindow } from '@/common/ui/calendar-views/useCalendarViewState';

let calls: unknown[][];

const target: CalendarWindowSyncTarget = {
  setViewWindow(start, end) {
    calls.push(['setViewWindow', start, end]);
  },
  async reloadWithFilters() {
    calls.push(['reloadWithFilters']);
  },
};

function calendarWindow(start: string, end: string): CalendarWindow {
  return { startDate: DateTime.fromISO(start), endDate: DateTime.fromISO(end) };
}

beforeEach(() => {
  calls = [];
});

describe('useCalendarWindowSync', () => {
  it('syncs an initial non-null window exactly once, during setup', async () => {
    const window = ref<CalendarWindow | null>(calendarWindow('2026-09-01', '2026-09-30'));

    useCalendarWindowSync(window, target);

    expect(calls).toEqual([
      ['setViewWindow', '2026-09-01', '2026-09-30'],
      ['reloadWithFilters'],
    ]);

    await nextTick();
    expect(calls).toHaveLength(2);
  });

  it('makes no call for an initial null window', async () => {
    const window = ref<CalendarWindow | null>(null);

    useCalendarWindowSync(window, target);
    await nextTick();

    expect(calls).toEqual([]);
  });

  it('sets the new range, then reloads, when one window replaces another', async () => {
    const window = ref<CalendarWindow | null>(calendarWindow('2026-09-01', '2026-09-30'));
    useCalendarWindowSync(window, target);
    calls = [];

    window.value = calendarWindow('2026-10-01', '2026-10-31');
    await nextTick();

    expect(calls).toEqual([
      ['setViewWindow', '2026-10-01', '2026-10-31'],
      ['reloadWithFilters'],
    ]);
  });

  it('sets the new range, then reloads, when a window appears', async () => {
    const window = ref<CalendarWindow | null>(null);
    useCalendarWindowSync(window, target);

    window.value = calendarWindow('2026-09-13', '2026-09-19');
    await nextTick();

    expect(calls).toEqual([
      ['setViewWindow', '2026-09-13', '2026-09-19'],
      ['reloadWithFilters'],
    ]);
  });

  it('clears the range, then reloads, when the window becomes null', async () => {
    const window = ref<CalendarWindow | null>(calendarWindow('2026-09-01', '2026-09-30'));
    useCalendarWindowSync(window, target);
    calls = [];

    window.value = null;
    await nextTick();

    expect(calls).toEqual([
      ['setViewWindow', null, null],
      ['reloadWithFilters'],
    ]);
  });

  it('makes no call when a new window object covers the same dates', async () => {
    const window = ref<CalendarWindow | null>(calendarWindow('2026-09-01', '2026-09-30'));
    useCalendarWindowSync(window, target);
    calls = [];

    window.value = calendarWindow('2026-09-01', '2026-09-30');
    await nextTick();

    expect(calls).toEqual([]);
  });
});
