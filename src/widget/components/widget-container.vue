<script setup lang="ts">
import { reactive, onBeforeMount, onMounted, onUnmounted, inject, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useWidgetStore } from '../stores/widgetStore';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import CalendarService from '@/site/service/calendar';
import SearchFilterPublic from '@/site/components/search-filter-public.vue';
import ListView from './list-view.vue';
import NotFound from '@/site/components/not-found.vue';
import { type CalendarViewMode, isCalendarViewMode } from '@/common/model/calendar_view';
import type CalendarEventInstance from '@/common/model/event_instance';
import {
  isValidWidgetColorMode,
  isValidWidgetAccentColor,
} from '@/common/model/widget_config';
import { CalendarViewToolbar, MonthView, WeekView } from '@/common/ui/calendar-views';
import { useCalendarViewContainer } from '@/common/ui/calendar-views/useCalendarViewContainer';
import { useLocale } from '@/common/ui/composables/useLocale';
import { formatInstanceSlug } from '@/common/utils/instance-slug';
import type Config from '@/client/service/config';

const { t } = useTranslation('system');
const route = useRoute();
const widgetStore = useWidgetStore();
const publicCalendarStore = usePublicCalendarStore();
const siteConfig = inject<Config>('site_config');
const { currentLocale } = useLocale();

const calendarUrlName = route.params.urlName as string;

const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  isLoading: false,
});

// ----------------------------------------------------------------
// Calendar view (list / week / month)
// ----------------------------------------------------------------

/*
 * The owner's configured view is the widget's starting view, not a lock.
 *
 * `?view=` is read twice on this URL, with different meanings (see the
 * two-meanings note in @/common/routing/calendar-view-query):
 *
 * 1. The router guard's `widgetStore.parseConfig` reads it once, at load, from
 *    window.location.search, as the admin preview's override of the owner's
 *    configured view. The admin preview changes `view` by changing the
 *    iframe's src, which reloads the frame, so `parseConfig` re-reads it.
 *    The same-origin `pavillion:updateConfig` message below also writes
 *    `configuredView`, but its view only shows while the route carries no
 *    visitor view. Neither ever writes the visitor's view.
 * 2. useCalendarViewState reads it from the route query as the visitor's own
 *    choice, parsed against `configuredView` as the default.
 *
 * So once a visitor has chosen a view of their own, the preview no longer
 * changes what renders — correct, because the preview simulates the owner's
 * setting. The accepted consequence: reloading a URL that carries a
 * visitor's `?view=` makes `parseConfig` treat it as the starting view. On
 * the plain visitor path there is no conflict: the SDK passes
 * only `lang` (view/accentColor/colorMode are DEPRECATED_CONFIG_KEYS in
 * src/widget-sdk/pavillion-widget.ts).
 *
 * There is no loading gate here for the configured view: the router guard
 * resolves the server config before this route renders, so a month-configured
 * widget never paints the list first.
 */
const configuredView = computed<CalendarViewMode>(() => widgetStore.configuredView);

const {
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
  eventRoute,
  dayRoute,
} = useCalendarViewContainer({
  defaultView: configuredView,
  target: publicCalendarStore,
  isReady: () => publicCalendarStore.isCalendarSettingsLoaded
    && publicCalendarStore.currentCalendarUrlName === calendarUrlName,
  isLoading: () => state.isLoading
    || publicCalendarStore.isLoadingEvents
    || !publicCalendarStore.hasLoadedEvents,
  locale: currentLocale,
  // An event chip opens the widget's event detail for that occurrence.
  eventRoute: (instance: CalendarEventInstance) => ({
    name: 'widget-event-detail',
    params: {
      urlName: calendarUrlName,
      eventId: instance.event.id,
      startTime: formatInstanceSlug(instance.start),
    },
  }),
  calendarRoute: query => ({
    name: 'widget-calendar',
    params: { urlName: calendarUrlName },
    query,
  }),
});

const calendarService = new CalendarService();

// Handle postMessage updates from parent window (for preview)
const handleMessage = (event: MessageEvent) => {
  // Only accept messages from same origin
  if (event.origin !== window.location.origin) {
    return;
  }

  if (!event.data || typeof event.data !== 'object') {
    return;
  }

  if (event.data.type === 'pavillion:updateConfig') {
    const { config } = event.data;

    // Update widget store with new configuration. Values are re-validated
    // before being assigned; invalid values are silently ignored so a
    // malformed postMessage cannot corrupt store state or (for accentColor)
    // the CSS custom property the value ultimately reaches.
    // The app.vue component watches these values and will apply them automatically.
    if (config && typeof config === 'object') {
      // Sets the owner's configured (starting) view, never the visitor's.
      if (isCalendarViewMode(config.view)) {
        widgetStore.configuredView = config.view;
      }
      if (isValidWidgetAccentColor(config.accentColor)) {
        widgetStore.accentColor = config.accentColor;
      }
      if (isValidWidgetColorMode(config.colorMode)) {
        widgetStore.colorMode = config.colorMode;
      }
    }
  }
};

onBeforeMount(async () => {
  // Point the store at this calendar before anything can yield. The first
  // call for a calendar clears every filter, and SearchFilterPublic reads
  // the date range from the URL as soon as it mounts (once state.calendar is
  // set); the clear must land before that read, never after it, or a deep
  // link / history back to a filtered list loses its range. Calling it ahead
  // of every await keeps that true however many awaits come to precede it.
  publicCalendarStore.setCurrentCalendar(calendarUrlName);

  try {
    state.isLoading = true;

    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    // Widget display config (view/accentColor/colorMode) is already in the
    // store: the router guard loads it before any widget route renders.

    // Set server-level default date range from site config before loading calendar
    if (siteConfig) {
      const serverDefault = siteConfig.settings().defaultDateRange;
      if (serverDefault) {
        publicCalendarStore.setServerDefaultDateRange(serverDefault);
      }
    }

    // Load calendar settings (including defaultDateRange) before loading events
    await publicCalendarStore.loadCalendar(calendarUrlName);

    // Load categories - SearchFilterPublic will handle URL params and event loading
    await publicCalendarStore.loadCategories(calendarUrlName);
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = t('error_load_calendar');
  }
  finally {
    state.isLoading = false;
  }
});

onMounted(() => {
  // Listen for configuration updates from parent window
  window.addEventListener('message', handleMessage);
});

onUnmounted(() => {
  // Clean up event listener
  window.removeEventListener('message', handleMessage);
});
</script>

<template>
  <div v-if="state.notFound" class="widget-container">
    <NotFound />
  </div>
  <!-- The root is measured for the view tier, so it carries no horizontal
       padding or border (useContainerWidth's first reading is border-box,
       later ones content-box). -->
  <div v-else ref="root" class="widget-container">
    <header v-if="state.calendar">
      <!-- Search and Filter Component -->
      <SearchFilterPublic :view-mode="effectiveViewMode" />
    </header>

    <!-- No aria-busy here: <main> holds the toolbar's live period label and
         the grids' status text, which a busy ancestor would silence. -->
    <main
      class="widget-main"
      :data-loading="state.isLoading || publicCalendarStore.isLoadingEvents || undefined"
    >
      <div v-if="state.err" role="alert" class="error">{{ state.err }}</div>
      <div v-if="publicCalendarStore.eventError" role="alert" class="error">{{ publicCalendarStore.eventError }}</div>
      <div v-if="publicCalendarStore.categoryError" role="alert" class="error">{{ publicCalendarStore.categoryError }}</div>

      <CalendarViewToolbar
        :view-mode="effectiveViewMode"
        :available-views="availableViews"
        :anchor-date="anchorDate"
        :period-label="currentPeriodLabel"
        @update:view-mode="setView"
        @prev="goPrev"
        @next="goNext"
        @today="goToday"
      />

      <WeekView
        v-if="effectiveViewMode === 'week'"
        :anchor-date="anchorDate"
        :events-by-day="publicCalendarStore.getFilteredEventsByDay"
        :is-loading="gridIsLoading"
        :event-route="eventRoute"
        :day-route="dayRoute"
      />
      <MonthView
        v-else-if="effectiveViewMode === 'month'"
        :anchor-date="anchorDate"
        :events-by-day="publicCalendarStore.getFilteredEventsByDay"
        :is-loading="gridIsLoading"
        :event-route="eventRoute"
        :day-route="dayRoute"
      />
      <!-- ListView renders its own role="status" loading region. -->
      <ListView v-else />
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

.widget-container {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  background: var(--pav-surface-primary);
  color: var(--pav-text-primary);
}

header {
  padding: $public-space-md;
  border-bottom: 1px solid var(--pav-border-subtle);

  .calendar-title {
    font-size: $public-font-size-lg;
    font-weight: $public-font-weight-light;
    margin: 0 0 $public-space-md 0;
    color: var(--pav-text-primary);

    @include public-mobile-only {
      font-size: $public-font-size-md;
    }
  }
}

.widget-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

// The shared toolbar and grids are token-only; the widget sets their spacing.
.ui-view-toolbar {
  margin: $public-space-md $public-space-md 0;
}

.week-view,
.month-view {
  padding: $public-space-md;
}

.error {
  @include public-error-state;

  margin: $public-space-md;
}
</style>
