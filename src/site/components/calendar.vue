<script setup lang="ts">
import { reactive, onBeforeMount, onMounted, computed, inject, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import type Config from '@/client/service/config';
import type { CalendarViewMode } from '@/common/model/calendar_view';
import type CalendarEventInstance from '@/common/model/event_instance';
import {
  DATE_QUERY_KEY,
  LIST_END_DATE_QUERY_KEY,
  LIST_START_DATE_QUERY_KEY,
  VIEW_QUERY_KEY,
  calendarViewQuery,
} from '@/common/routing/calendar-view-query';
import { calendarPath, eventPath } from '@/common/routing/public-paths';
import { CalendarViewToolbar, MonthView, WeekView } from '@/common/ui/calendar-views';
import { periodLabel } from '@/common/ui/calendar-views/calendar-grid';
import { useCalendarViewState } from '@/common/ui/calendar-views/useCalendarViewState';
import { useCalendarWindowSync } from '@/common/ui/calendar-views/useCalendarWindowSync';
import { useContainerWidth } from '@/common/ui/composables/useContainerWidth';
import { formatInstanceSlug } from '@/common/utils/instance-slug';

import CalendarService from '../service/calendar';
import { usePublicCalendarStore } from '../stores/publicCalendarStore';
import NotFound from './not-found.vue';
import SearchFilterPublic from './search-filter-public.vue';
import EventCard from './event-card.vue';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import { useLocale } from '@/site/composables/useLocale';

const { t } = useTranslation('system');
const route = useRoute();
const router = useRouter();
const calendarUrlName = route.params.calendar as string;
const siteConfig = inject<Config>('site_config');
const { currentLocale, localizedPath } = useLocale();
const { localizedContent } = useLocalizedContent();

const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  isLoading: false,
});

const calendarService = new CalendarService();
const publicCalendarStore = usePublicCalendarStore();

// Computed properties for store data
const filteredEventsByDay = computed(() => publicCalendarStore.getFilteredEventsByDay);
const hasActiveFilters = computed(() => publicCalendarStore.hasActiveFilters);
const hasNonDateFilters = computed(() => publicCalendarStore.hasNonDateFilters);
const hasOnlyDateFilters = computed(() => publicCalendarStore.hasOnlyDateFilters);
const defaultEventImage = computed(() => publicCalendarStore.defaultEventImage);

// ----------------------------------------------------------------
// Calendar view (list / week / month)
// ----------------------------------------------------------------

// The site has no owner-configured starting view: it always opens on the list.
const defaultView = computed<CalendarViewMode>(() => 'list');

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
// week or month to the list during setup, so the first fetch would be the
// list's range and the measured tier would immediately fetch again. Until
// measured, the view state keeps its `wide` starting tier and the URL's view.
watch([tier, width], ([nextTier, nextWidth]) => {
  if (nextWidth > 0) {
    setTier(nextTier);
  }
}, { immediate: true });

// The view window outlives this component in the store (back-navigation keeps
// it); start from none so a list URL never fetches a previous visit's month.
publicCalendarStore.setViewWindow(null, null);

// The first fetch belongs to the existing mount sequence: SearchFilterPublic
// reloads on mount (or once calendar settings load), by which point the window
// sync below has already set the view window during setup. Reloading from the
// sync before then would fetch twice — or fetch a previously viewed calendar,
// since this calendar is only selected in onBeforeMount.
let isMounted = false;
onMounted(() => {
  isMounted = true;
});

useCalendarWindowSync(fetchWindow, {
  setViewWindow: (start, end) => publicCalendarStore.setViewWindow(start, end),
  reloadWithFilters: () => {
    const isReady = isMounted
      && publicCalendarStore.isCalendarSettingsLoaded
      && publicCalendarStore.currentCalendarUrlName === calendarUrlName;
    return isReady ? publicCalendarStore.reloadWithFilters() : Promise.resolve();
  },
});

const currentPeriodLabel = computed(() => effectiveViewMode.value === 'list'
  ? ''
  : periodLabel(effectiveViewMode.value, anchorDate.value, currentLocale.value));

const gridIsLoading = computed(() => state.isLoading
  || publicCalendarStore.isLoadingEvents
  || !publicCalendarStore.hasLoadedEvents);

/** An event chip links to the occurrence page, built as event-card.vue builds it. */
function eventRoute(instance: CalendarEventInstance): RouteLocationRaw {
  return localizedPath(eventPath(calendarUrlName, instance.event.id, formatInstanceSlug(instance.start)));
}

/**
 * A day number (or a cell's overflow link) opens the list filtered to that
 * day. The view is emitted through calendarViewQuery so the link lands on the
 * list whatever the surface's default; the other filters are kept.
 */
function dayRoute(isoDate: string): RouteLocationRaw {
  const merged: Record<string, unknown> = {
    ...route.query,
    ...calendarViewQuery('list', anchorDate.value, defaultView.value),
    [LIST_START_DATE_QUERY_KEY]: isoDate,
    [LIST_END_DATE_QUERY_KEY]: isoDate,
  };
  const query = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));

  return { path: localizedPath(calendarPath(calendarUrlName)), query: query as Record<string, string> };
}

/**
 * Clears all active filters and resets the filter query params, keeping the
 * calendar view the visitor is on.
 */
function clearAllFilters() {
  publicCalendarStore.clearAllFilters();
  publicCalendarStore.reloadWithFilters();
  const viewQuery = Object.fromEntries(
    [VIEW_QUERY_KEY, DATE_QUERY_KEY]
      .filter(key => route.query[key] !== undefined)
      .map(key => [key, route.query[key]]),
  );
  router.replace({ query: viewQuery });
}

onBeforeMount(async () => {
  // Skip full reload if the store already has data for this calendar (e.g. back-navigation).
  // Only fetch the calendar metadata needed to render the header, then return early.
  if (publicCalendarStore.currentCalendarUrlName === calendarUrlName
      && publicCalendarStore.allEvents.length > 0) {
    try {
      state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName);
    }
    catch (error) {
      console.error('Error loading calendar metadata:', error);
    }
    return;
  }

  try {
    state.isLoading = true;

    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    // Set page title to calendar name
    const calendarName = localizedContent(state.calendar).name || state.calendar.urlName;
    document.title = `${calendarName} | Pavillion`;

    // Set server-level default date range from site config before loading calendar
    if (siteConfig) {
      const serverDefault = siteConfig.settings().defaultDateRange;
      if (serverDefault) {
        publicCalendarStore.setServerDefaultDateRange(serverDefault);
      }
    }

    // Set current calendar in store
    publicCalendarStore.setCurrentCalendar(calendarUrlName);

    // Load calendar settings (including defaultDateRange) before loading events.
    // SearchFilterPublic's mount/watcher then triggers reloadWithFilters(), which
    // loads events AND categories together against the resolved default date window.
    await publicCalendarStore.loadCalendar(calendarUrlName);
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = t('error_load_calendar');
  }
  finally {
    state.isLoading = false;
  }
});

</script>

<template>
  <div v-if="state.notFound">
    <NotFound />
  </div>
  <div
    v-else
    ref="root"
    class="calendar-page"
  >
    <header
      v-if="state.calendar"
      class="calendar-header"
    >
      <div class="calendar-header-inner">
        <h1 class="calendar-title">
          {{ localizedContent(state.calendar).name || state.calendar.urlName }}
        </h1>
        <p
          v-if="localizedContent(state.calendar).description"
          class="calendar-description"
        >
          {{ localizedContent(state.calendar).description }}
        </p>
      </div>

      <!-- Search and Filter Component (includes persistent Clear All Filters button) -->
      <SearchFilterPublic :view-mode="effectiveViewMode" />
    </header>

    <!-- aria-busy sits on the list container, not here: <main> also holds the
         toolbar's live period label and the grids' status text, which a busy
         ancestor would silence on every period step. -->
    <main class="calendar-main">
      <div
        v-if="state.err"
        role="alert"
        class="error"
      >{{ state.err }}</div>
      <div
        v-if="publicCalendarStore.eventError"
        role="alert"
        class="error"
      >{{ publicCalendarStore.eventError }}</div>
      <div
        v-if="publicCalendarStore.categoryError"
        role="alert"
        class="error"
      >{{ publicCalendarStore.categoryError }}</div>

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
        :events-by-day="filteredEventsByDay"
        :is-loading="gridIsLoading"
        :event-route="eventRoute"
        :day-route="dayRoute"
      />
      <MonthView
        v-else-if="effectiveViewMode === 'month'"
        :anchor-date="anchorDate"
        :events-by-day="filteredEventsByDay"
        :is-loading="gridIsLoading"
        :event-route="eventRoute"
        :day-route="dayRoute"
      />

      <!-- Events Display (list view) -->
      <template v-else>
        <div
          v-if="Object.keys(filteredEventsByDay).length > 0"
          class="events-container"
          :aria-busy="state.isLoading || publicCalendarStore.isLoadingEvents"
        >
          <section
            v-for="day in Object.keys(filteredEventsByDay).sort()"
            :key="day"
            class="day-section"
          >
            <h2 class="day-heading">
              {{ DateTime.fromISO(day).setLocale(currentLocale).toLocaleString({weekday: 'long', month: 'long', day: 'numeric'}) }}
            </h2>
            <ul class="day-events">
              <li
                v-for="instance in filteredEventsByDay[day]"
                :key="instance.id"
                class="day-event-item"
              >
                <EventCard
                  :instance="instance"
                  :calendar-url-name="calendarUrlName"
                  :calendar="publicCalendarStore.currentCalendar"
                  :default-image="defaultEventImage"
                />
              </li>
            </ul>
          </section>
        </div>

        <!-- Empty State: suppress when search is pending (1-2 chars typed) to avoid conflicting messages -->
        <div
          v-else-if="!state.isLoading && !publicCalendarStore.isLoadingEvents && publicCalendarStore.hasLoadedEvents && !publicCalendarStore.isSearchPending"
          class="empty-state"
        >
          <div
            class="empty-state-icon"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect
                x="3"
                y="4"
                width="18"
                height="18"
                rx="2"
                ry="2"
              />
              <line
                x1="16"
                y1="2"
                x2="16"
                y2="6"
              />
              <line
                x1="8"
                y1="2"
                x2="8"
                y2="6"
              />
              <line
                x1="3"
                y1="10"
                x2="21"
                y2="10"
              />
            </svg>
          </div>
          <div
            role="status"
            class="empty-state-text"
          >
            <p>{{ t('no_events_available') }}</p>
            <p
              v-if="publicCalendarStore.searchQuery"
              class="empty-state-hint"
            >
              {{ t('no_events_for_search', { term: publicCalendarStore.searchQuery }) }}
            </p>
            <p
              v-else-if="hasNonDateFilters"
              class="empty-state-hint"
            >{{ t('no_events_with_filters_hint') }}</p>
            <p
              v-else-if="hasOnlyDateFilters"
              class="empty-state-hint"
            >{{ t('no_events_in_date_range_hint') }}</p>
            <p
              v-else
              class="empty-state-hint"
            >{{ t('no_events_available_hint') }}</p>
          </div>
          <button
            v-if="hasActiveFilters"
            type="button"
            class="clear-filters-btn"
            @click="clearAllFilters"
          >
            {{ t('clear_all_filters') }}
          </button>
        </div>

        <!-- Loading State -->
        <div
          v-if="state.isLoading || publicCalendarStore.isLoadingEvents"
          role="status"
          class="loading"
        >
          {{ t('loading_events') }}
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.calendar-page {
  // Full-page layout, no extra wrapper needed. It is also the element whose
  // width picks the view tier, so it must carry no horizontal padding or
  // border (useContainerWidth's first reading is border-box, later ones
  // content-box).
}

// ================================================================
// CALENDAR HEADER
// ================================================================

.calendar-header {
  margin-bottom: $public-space-xl;
}

.calendar-header-inner {
  @include public-container-constrained;

  padding-top: $public-space-2xl;
  padding-bottom: $public-space-xl;

  @include public-tablet-up {
    padding-top: $public-space-3xl;
    padding-bottom: $public-space-2xl;
  }
}

.calendar-title {
  font-size: $public-font-size-2xl;
  font-weight: $public-font-weight-bold;
  letter-spacing: $public-letter-spacing-tight;
  line-height: $public-line-height-tight;
  margin: 0 0 $public-space-sm 0;

  @include public-tablet-up {
    font-size: $public-font-size-3xl;
  }
}

.calendar-description {
  font-size: $public-font-size-md;
  color: $public-text-secondary-light;
  margin: 0;
  line-height: $public-line-height-relaxed;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

// ================================================================
// EVENTS DISPLAY
// ================================================================
// Vertical stacked layout with sticky date headings.
// ================================================================

.calendar-main {
  @include public-container-constrained;

  padding-top: $public-space-2xl;
  padding-bottom: $public-space-2xl;

  @include public-tablet-up {
    padding-top: $public-space-3xl;
    padding-bottom: $public-space-3xl;
  }
}

.events-container {
  display: flex;
  flex-direction: column;
  gap: $public-space-2xl;
}

.day-section {
  // No extra margin needed; events-container gap handles spacing
}

.day-heading {
  @include public-sticky-date-heading;

  padding: $public-space-sm 0;
  margin: 0 0 $public-space-lg 0;
  color: $public-text-secondary-light;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.day-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: $public-space-lg;
}

.day-event-item {
  // No extra styles needed; EventCard handles its own layout
}

// The shared toolbar is token-only; the page sets only its spacing.
.ui-view-toolbar {
  margin-bottom: $public-space-xl;
}

// Loading and error states
.loading {
  @include public-loading-state;
}

.error {
  @include public-error-state;

  margin: $public-space-md 0;
}

.empty-state {
  @include public-empty-state;

  .empty-state-icon {
    width: 3rem;
    height: 3rem;
    color: $public-text-tertiary-light;
    margin-bottom: $public-space-md;

    svg {
      width: 100%;
      height: 100%;
    }

    @include public-dark-mode {
      color: $public-text-tertiary-dark;
    }
  }

  .empty-state-text {
    p {
      margin: 0 0 $public-space-sm 0;
    }
  }

  .empty-state-hint {
    font-size: $public-font-size-sm;
    color: $public-text-secondary-light;
    margin-top: $public-space-xs;

    @include public-dark-mode {
      color: $public-text-secondary-dark;
    }
  }

  .clear-filters-btn {
    display: inline-block;
    margin-top: $public-space-md;
    padding: $public-space-xs $public-space-md;
    background: none;
    border: 1px solid $public-accent-light;
    border-radius: 9999px;
    color: $public-accent-light;
    font-size: $public-font-size-sm;
    font-weight: $public-font-weight-medium;
    cursor: pointer;
    transition: $public-transition-fast;

    &:hover {
      background: $public-accent-light;
      color: white;
    }

    &:focus-visible {
      @include public-focus-visible;
    }

    @include public-dark-mode {
      border-color: $public-accent-dark;
      color: $public-accent-dark;

      &:hover {
        background: $public-accent-dark;
        color: white;
      }
    }
  }
}
</style>
