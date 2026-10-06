/**
 * The wiring a calendar view container needs around the list / week / month
 * views: the measured root, the URL-backed view state, the events source kept
 * in step with the view's window, and the bindings the toolbar and grids take.
 *
 * Each app supplies only what differs between them: its default view, its
 * events source, when that source is ready to reload, what counts as loading,
 * and the shape of its routes. The events source is typed structurally (see
 * `CalendarWindowSyncTarget`), so an app store satisfies it without this
 * module importing a store.
 *
 * Call it synchronously in `<script setup>`: it registers an `onMounted`
 * hook, and the returned `root` must be bound with `ref="root"` on an element
 * with no horizontal padding or border (see `useContainerWidth`).
 */
import { computed, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import type { DateTime } from 'luxon';

import type { CalendarViewMode } from '@/common/model/calendar_view';
import type CalendarEventInstance from '@/common/model/event_instance';
import {
  LIST_END_DATE_QUERY_KEY,
  LIST_START_DATE_QUERY_KEY,
  calendarViewQuery,
} from '@/common/routing/calendar-view-query';
import { periodLabel } from '@/common/ui/calendar-views/calendar-grid';
import { useCalendarViewState } from '@/common/ui/calendar-views/useCalendarViewState';
import {
  useCalendarWindowSync,
  type CalendarWindowSyncTarget,
} from '@/common/ui/calendar-views/useCalendarWindowSync';
import { useContainerWidth } from '@/common/ui/composables/useContainerWidth';

export interface CalendarViewContainerOptions {
  /** The surface's default view, omitted from the URL when shown. */
  defaultView: Readonly<Ref<CalendarViewMode>>;
  /** The events source whose view window follows the shown view. */
  target: CalendarWindowSyncTarget;
  /**
   * Whether the source holds this calendar, ready to reload. Consulted only
   * after mount; the container adds that condition itself.
   */
  isReady: () => boolean;
  /** Whether the grids should show their loading state. */
  isLoading: () => boolean;
  /** The locale the period label is formatted in. */
  locale: Readonly<Ref<string>>;
  /** Where an event chip links to. */
  eventRoute: (instance: CalendarEventInstance) => RouteLocationRaw;
  /** This calendar's own page, carrying the given query. */
  calendarRoute: (query: Record<string, string>) => RouteLocationRaw;
}

export interface CalendarViewContainer {
  root: Ref<HTMLElement | null>;
  effectiveViewMode: ComputedRef<CalendarViewMode>;
  anchorDate: ComputedRef<DateTime>;
  availableViews: ComputedRef<readonly CalendarViewMode[]>;
  setView: (view: CalendarViewMode) => void;
  goPrev: () => void;
  goNext: () => void;
  goToday: () => void;
  currentPeriodLabel: ComputedRef<string>;
  gridIsLoading: ComputedRef<boolean>;
  eventRoute: (instance: CalendarEventInstance) => RouteLocationRaw;
  dayRoute: (isoDate: string) => RouteLocationRaw;
}

/**
 * Wire a calendar view container.
 *
 * @param options - What the app supplies; see `CalendarViewContainerOptions`
 * @returns The root ref to bind and the toolbar and grid bindings
 */
export function useCalendarViewContainer(options: CalendarViewContainerOptions): CalendarViewContainer {
  const { defaultView, target } = options;
  const route = useRoute();

  const root = ref<HTMLElement | null>(null);
  const { tier, width } = useContainerWidth(root);

  const {
    effectiveViewMode,
    anchorDate,
    window: fetchWindow,
    availableViews,
    setView,
    goPrev,
    goNext,
    goToday,
    setTier,
  } = useCalendarViewState({ defaultView });

  // Forward the tier only once the root has been measured. Before mount the
  // width reads 0 (tier `narrow`); passing that on would collapse a deep-linked
  // or configured week or month to the list during setup, so the first fetch
  // would be the list's range and the measured tier would immediately fetch
  // again. Until measured, the view state keeps its `wide` starting tier and
  // the URL's view.
  watch([tier, width], ([nextTier, nextWidth]) => {
    if (nextWidth > 0) {
      setTier(nextTier);
    }
  }, { immediate: true });

  // The view window outlives the container in the store (back-navigation
  // keeps it); start from none so a list never fetches a previous visit's
  // month. This must precede the window sync, which sets the view's own
  // window during setup.
  target.setViewWindow(null, null);

  // The first fetch belongs to the app's mount sequence: its filter component
  // reloads on mount (or once calendar settings load), by which point the
  // window sync below has already set the view window during setup. Reloading
  // from the sync before then would fetch twice — or fetch a previously viewed
  // calendar, since the app selects this one only in onBeforeMount.
  let isMounted = false;
  onMounted(() => {
    isMounted = true;
  });

  useCalendarWindowSync(fetchWindow, {
    setViewWindow: (start, end) => target.setViewWindow(start, end),
    reloadWithFilters: () => isMounted && options.isReady()
      ? target.reloadWithFilters()
      : Promise.resolve(),
  });

  const currentPeriodLabel = computed(() => effectiveViewMode.value === 'list'
    ? ''
    : periodLabel(effectiveViewMode.value, anchorDate.value, options.locale.value));

  const gridIsLoading = computed(() => options.isLoading());

  /**
   * A day number (or a cell's overflow link) opens the list filtered to that
   * day. The view MUST be emitted through calendarViewQuery: where the default
   * is week or month, a link without it would land on the default view, where
   * startDate/endDate are ignored. Other filters are kept; keys
   * calendarViewQuery marks undefined are dropped.
   */
  function dayRoute(isoDate: string): RouteLocationRaw {
    const merged: Record<string, unknown> = {
      ...route.query,
      ...calendarViewQuery('list', anchorDate.value, defaultView.value),
      [LIST_START_DATE_QUERY_KEY]: isoDate,
      [LIST_END_DATE_QUERY_KEY]: isoDate,
    };
    const query = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));

    return options.calendarRoute(query as Record<string, string>);
  }

  return {
    root,
    effectiveViewMode,
    anchorDate,
    availableViews,
    setView,
    goPrev,
    goNext,
    goToday,
    currentPeriodLabel,
    gridIsLoading,
    eventRoute: options.eventRoute,
    dayRoute,
  };
}
