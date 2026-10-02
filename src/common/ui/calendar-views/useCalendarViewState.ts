/**
 * Which calendar view a visitor is looking at, anchored where, and which
 * period of events that view needs.
 *
 * The URL is the only state. `viewMode` and `anchorDate` are derived from the
 * route query through `parseCalendarViewQuery` — the single reader of `view`
 * and `date` — and every action writes through `router.replace` and lets the
 * route change flow back. There is no local copy to fall out of step with a
 * back button, a pasted link, or another component replacing the query.
 *
 * The width tier is the one input that is not in the URL. It narrows which
 * views can be shown (`availableViews`); a view the tier cannot show is
 * displayed as the list (`effectiveViewMode`) while the URL keeps the
 * visitor's choice, so widening the window restores it. Tier changes never
 * write the URL. The tier starts at `wide` so that the window is correct for
 * the URL's own view during setup; a container that knows it is narrower
 * calls `setTier` before wiring `useCalendarWindowSync`, so the first fetch is
 * already for the right period.
 *
 * The anchor is bounded. `parseCalendarViewQuery` accepts any date luxon can
 * read as yyyy-MM-dd — years 0000 to 9999 — and the anchor decides the period
 * fetched, so a date more than ANCHOR_BOUND_YEARS from today is treated like
 * an unparseable one (today, with no URL write), and `goPrev` / `goNext` will
 * not step past the bound.
 *
 * How `date` relates to the list filters `startDate` / `endDate` on the same
 * URL is declared in `@/common/routing/calendar-view-query`.
 */
import { computed, ref, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DateTime } from 'luxon';

import type { CalendarViewMode } from '@/common/model/calendar_view';
import {
  DATE_QUERY_KEY,
  calendarViewQuery,
  parseCalendarViewQuery,
} from '@/common/routing/calendar-view-query';
import type { WidthTier } from '@/common/ui/assets/breakpoints';
import { getWeekStart } from '@/common/utils/datePresets';

/** The period of events a week or month view needs, as local calendar days. */
export interface CalendarWindow {
  /** Local start of the first day in the period. */
  startDate: DateTime;
  /** Local start of the last day in the period (inclusive). */
  endDate: DateTime;
}

/** How far from today, in years, an anchor date may lie. */
const ANCHOR_BOUND_YEARS = 100;

/** The list filter key whose date seeds the anchor when leaving the list. */
const LIST_START_DATE_KEY = 'startDate';

/** The views each width tier can show, in switcher order. */
const VIEWS_BY_TIER: Record<WidthTier, readonly CalendarViewMode[]> = {
  narrow: ['list'],
  medium: ['list', 'month'],
  wide: ['list', 'week', 'month'],
};

function isWithinAnchorBound(date: DateTime): boolean {
  const today = DateTime.now().startOf('day');
  return date >= today.minus({ years: ANCHOR_BOUND_YEARS })
    && date <= today.plus({ years: ANCHOR_BOUND_YEARS });
}

/** A date from the URL, or today when it is out of bounds. */
function boundedAnchor(date: DateTime): DateTime {
  return isWithinAnchorBound(date) ? date : DateTime.now().startOf('day');
}

/**
 * View state for a calendar surface, read from and written to the route query.
 *
 * @param options.defaultView - The surface's default view, omitted from the URL
 *   when shown (the site's list, or the widget's configured starting view)
 */
export function useCalendarViewState(options: { defaultView: Readonly<Ref<CalendarViewMode>> }) {
  const { defaultView } = options;
  const route = useRoute();
  const router = useRouter();

  const tier = ref<WidthTier>('wide');

  const parsed = computed(() => parseCalendarViewQuery(route.query, defaultView.value));

  const viewMode = computed<CalendarViewMode>(() => parsed.value.viewMode);
  const anchorDate = computed<DateTime>(() => boundedAnchor(parsed.value.anchorDate));

  const availableViews = computed<readonly CalendarViewMode[]>(() => VIEWS_BY_TIER[tier.value]);

  const effectiveViewMode = computed<CalendarViewMode>(() =>
    availableViews.value.includes(viewMode.value) ? viewMode.value : 'list');

  const window = computed<CalendarWindow | null>(() => {
    const anchor = anchorDate.value;

    if (effectiveViewMode.value === 'week') {
      const startDate = getWeekStart(anchor);
      return { startDate, endDate: startDate.plus({ days: 6 }) };
    }
    if (effectiveViewMode.value === 'month') {
      const startDate = anchor.startOf('month');
      return { startDate, endDate: anchor.endOf('month').startOf('day') };
    }
    return null;
  });

  /** Merge the view keys over the current query, dropping the ones to omit. */
  function write(nextView: CalendarViewMode, nextAnchor: DateTime): void {
    const merged: Record<string, unknown> = {
      ...route.query,
      ...calendarViewQuery(nextView, nextAnchor, defaultView.value),
    };
    const query = Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined),
    );
    router.replace({ query: query as typeof route.query });
  }

  /**
   * Switch to a view. Moving out of the list anchors on the list filter's
   * startDate when there is one, else today; moving between week and month
   * keeps the current anchor.
   *
   * "Out of the list" is the URL's view, not the displayed one: a week view
   * shown as a list at the medium tier still has its `date`, and startDate
   * never overrides a `date` already in the URL.
   */
  function setView(nextView: CalendarViewMode): void {
    let anchor = anchorDate.value;

    if (viewMode.value === 'list' && nextView !== 'list') {
      // Read through the contract so startDate gets the same strict
      // yyyy-MM-dd parse, and the same today fallback, as `date`.
      const fromList = parseCalendarViewQuery(
        { [DATE_QUERY_KEY]: route.query[LIST_START_DATE_KEY] },
        nextView,
      ).anchorDate;
      anchor = boundedAnchor(fromList);
    }

    write(nextView, anchor);
  }

  /** Move the anchor one period, if an anchored view is shown and the bound allows. */
  function step(direction: 1 | -1): void {
    const mode = effectiveViewMode.value;
    if (mode === 'list') {
      return;
    }

    const next = mode === 'week'
      ? anchorDate.value.plus({ weeks: direction })
      : anchorDate.value.plus({ months: direction });

    if (isWithinAnchorBound(next)) {
      write(viewMode.value, next);
    }
  }

  function goPrev(): void {
    step(-1);
  }

  function goNext(): void {
    step(1);
  }

  function goToday(): void {
    write(viewMode.value, DateTime.now().startOf('day'));
  }

  function setTier(nextTier: WidthTier): void {
    tier.value = nextTier;
  }

  return {
    viewMode,
    effectiveViewMode,
    anchorDate,
    window,
    availableViews,
    setView,
    goPrev,
    goNext,
    goToday,
    setTier,
  };
}
