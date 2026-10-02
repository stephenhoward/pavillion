/**
 * Keeps an events source's date range in step with a calendar view's window.
 *
 * The target is typed structurally, so the public calendar store satisfies it
 * without this module importing a store. Its `setDateRange` takes ISO dates
 * (yyyy-MM-dd), not DateTimes.
 *
 * The watch is immediate: a non-null window present during setup syncs at
 * once, so a deep link to a month fetches that month on first load rather
 * than the list's default range first. An initial null window makes no call —
 * the list's own filters already own that fetch. After that, a window that
 * becomes null clears the range so the list falls back to its own default.
 * Windows are compared by their ISO dates, so a recomputed window covering
 * the same days makes no call.
 */
import { computed, watch, type Ref } from 'vue';

import type { CalendarWindow } from '@/common/ui/calendar-views/useCalendarViewState';

/** What the window is pushed into. */
export interface CalendarWindowSyncTarget {
  setDateRange(start: string | null, end: string | null): void;
  reloadWithFilters(): Promise<void>;
}

/**
 * Push every change of `window` into `target`: set the range, then reload.
 *
 * @param window - The view's fetch window, or null when a list is shown
 * @param target - The events source to keep in step
 */
export function useCalendarWindowSync(
  window: Readonly<Ref<CalendarWindow | null>>,
  target: CalendarWindowSyncTarget,
): void {
  const range = computed<[string, string] | null>(() => window.value === null
    ? null
    : [window.value.startDate.toISODate() as string, window.value.endDate.toISODate() as string]);

  // Keyed on a string so the watcher fires only when the dates differ.
  const rangeKey = computed(() => range.value === null ? null : range.value.join('/'));

  watch(rangeKey, (next, previous) => {
    if (next === null && previous === undefined) {
      return;
    }

    const [start, end] = range.value ?? [null, null];
    target.setDateRange(start, end);
    void target.reloadWithFilters();
  }, { immediate: true });
}
