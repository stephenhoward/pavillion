<script setup lang="ts">
import { reactive, onBeforeMount, computed, inject } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import type Config from '@/client/service/config';

import CalendarService from '../service/calendar';
import { usePublicCalendarStore } from '../stores/publicCalendarStore';
import NotFound from './notFound.vue';
import SearchFilterPublic from './SearchFilterPublic.vue';
import EventCard from './EventCard.vue';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import { useLocale } from '@/site/composables/useLocale';

const { t } = useTranslation('system');
const route = useRoute();
const router = useRouter();
const calendarUrlName = route.params.calendar as string;
const siteConfig = inject<Config>('site_config');
const { currentLocale } = useLocale();
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

/**
 * Clears all active filters and resets the URL query params.
 */
function clearAllFilters() {
  publicCalendarStore.clearAllFilters();
  publicCalendarStore.reloadWithFilters();
  router.replace({ query: {} });
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

</script>

<template>
  <div v-if="state.notFound">
    <NotFound />
  </div>
  <div
    v-else
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
      <SearchFilterPublic />
    </header>

    <main
      class="calendar-main"
      :aria-busy="state.isLoading || publicCalendarStore.isLoadingEvents"
    >
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

      <!-- Events Display -->
      <div
        v-if="Object.keys(filteredEventsByDay).length > 0"
        class="events-container"
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
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.calendar-page {
  // Full-page layout, no extra wrapper needed
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
    font-size: 2.25rem;
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
