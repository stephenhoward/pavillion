<script setup lang="ts">
import { reactive, onBeforeMount, computed, inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import CalendarService from '../service/calendar';
import { usePublicCalendarStore } from '../stores/publicCalendarStore';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import NotFound from './notFound.vue';
import SearchFilterPublic from './SearchFilterPublic.vue';
import { DateTime } from 'luxon';
import EventImage from './EventImage.vue';
import type Config from '@/client/service/config';
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
    state.err = 'Failed to load calendar data';
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
  <div v-else>
    <header v-if="state.calendar">
      <h1>{{ localizedContent(state.calendar).name || state.calendar.urlName }}</h1>

      <!-- Search and Filter Component (includes persistent Clear All Filters button) -->
      <SearchFilterPublic />
    </header>

    <main>
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <div v-if="publicCalendarStore.eventError" class="error">{{ publicCalendarStore.eventError }}</div>
      <div v-if="publicCalendarStore.categoryError" class="error">{{ publicCalendarStore.categoryError }}</div>

      <!-- Events Display -->
      <div v-if="Object.keys(filteredEventsByDay).length > 0">
        <section class="day" v-for="day in Object.keys(filteredEventsByDay).sort()" :key="day">
          <h2>{{ DateTime.fromISO(day).setLocale(currentLocale).toLocaleString({weekday: 'long', month: 'long', day: 'numeric'}) }}</h2>
          <ul class="events">
            <li class="event" v-for="instance in filteredEventsByDay[day]" :key="instance.id">
              <EventImage :media="instance.event.media" context="card" :lazy="true" />
              <h3>
                <router-link :to="localizedPath(`/view/${calendarUrlName}/events/${instance.event.id}/${instance.id}`)">
                  {{ localizedContent(instance.event).name }}
                </router-link>
              </h3>
              <div class="event-time">{{ instance.start.toLocal().toLocaleString(DateTime.TIME_SIMPLE) }}</div>
            </li>
          </ul>
        </section>
      </div>

      <!-- Empty State: suppress when search is pending (1-2 chars typed) to avoid conflicting messages -->
      <div v-else-if="!state.isLoading && !publicCalendarStore.isLoadingEvents && publicCalendarStore.hasLoadedEvents && !publicCalendarStore.isSearchPending" class="empty-state">
        <div role="status">
          <p>{{ t('no_events_available') }}</p>
          <p v-if="publicCalendarStore.searchQuery" class="empty-state-hint">
            {{ t('no_events_for_search', { term: publicCalendarStore.searchQuery }) }}
          </p>
          <p v-else-if="hasNonDateFilters" class="empty-state-hint">{{ t('no_events_with_filters_hint') }}</p>
          <p v-else-if="hasOnlyDateFilters" class="empty-state-hint">{{ t('no_events_in_date_range_hint') }}</p>
          <p v-else class="empty-state-hint">{{ t('no_events_available_hint') }}</p>
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
      <div v-if="state.isLoading || publicCalendarStore.isLoadingEvents" role="status" class="loading">
        {{ t('loading_events') }}
      </div>
    </main>
  </div>
</template>

<style lang="scss">
@use '../assets/mixins' as *;

h1 {
  font-size: 200%;
  font-weight: $public-font-weight-light;
}

// ================================================================
// EVENTS DISPLAY
// ================================================================
// A horizontally scrollable list of event cards.
// Cards adapt gracefully whether they have images or not.
// ================================================================

section.day {
  margin: $public-space-lg 0;

  h2 {
    font-size: $public-font-size-sm;
    margin: 0;
    padding: 0;
    font-weight: $public-font-weight-semibold;
    text-transform: uppercase;
    letter-spacing: $public-letter-spacing-wide;
    color: $public-text-secondary-light;

    @media (prefers-color-scheme: dark) {
      color: $public-text-secondary-dark;
    }
  }

  ul.events {
    @include public-horizontal-scroll;

    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: stretch;
    padding: $public-space-md 0 $public-space-xl 0;
    gap: $public-space-md;

    li.event {
      @include public-event-card-compact;

      list-style-type: none;
      margin-right: 0;
      position: relative;

      // ============================================================
      // CONTENT-FIRST CARD DESIGN
      // ============================================================
      // When no image is present, the card becomes a refined
      // text-focused card with a subtle accent treatment.
      // ============================================================

      // Check if card has no image (EventImage renders nothing)
      &:not(:has(.event-image)) {
        // Add a warm accent bar at top for visual weight
        &::before {
          content: '';
          position: absolute;
          top: 0;
          left: $public-space-md;
          right: $public-space-md;
          height: 3px;
          background: linear-gradient(
            90deg,
            $public-accent-light 0%,
            rgba($public-accent-light, 0.4) 100%
          );
          border-radius: 0 0 2px 2px;
          opacity: 0.7;

          @media (prefers-color-scheme: dark) {
            background: linear-gradient(
              90deg,
              $public-accent-dark 0%,
              rgba($public-accent-dark, 0.4) 100%
            );
          }
        }

        // Adjust padding to account for accent bar
        padding-top: $public-space-lg;

        // Title gets more visual prominence
        h3 {
          font-size: $public-font-size-lg;
          font-weight: $public-font-weight-medium;
          margin-top: 0;
        }
      }

      // ============================================================
      // CARD WITH IMAGE
      // ============================================================
      // Standard card with image thumbnail above text.
      // ============================================================

      &:has(.event-image) {
        h3 {
          margin-top: $public-space-sm;
        }
      }

      h3 {
        order: 1;
        font-size: $public-font-size-md;
        font-weight: $public-font-weight-regular;
        line-height: $public-line-height-tight;
        margin: 0;

        a {
          color: $public-text-primary-light;
          text-decoration: none;
          transition: $public-transition-fast;

          &:hover {
            color: $public-accent-light;
          }

          @media (prefers-color-scheme: dark) {
            color: $public-text-primary-dark;

            &:hover {
              color: $public-accent-dark;
            }
          }
        }
      }

      .event-time {
        order: 2;
        font-size: $public-font-size-sm;
        font-weight: $public-font-weight-medium;
        color: $public-text-secondary-light;
        margin-top: $public-space-xs;

        @media (prefers-color-scheme: dark) {
          color: $public-text-secondary-dark;
        }
      }

      .event-categories {
        order: 3;
        margin-top: $public-space-sm;
        display: flex;
        flex-wrap: wrap;
        gap: $public-space-xs;

        .event-category-badge {
          @include public-category-badge;
        }
      }
    }
  }
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

  .empty-state-hint {
    font-size: $public-font-size-sm;
    color: $public-text-secondary-light;
    margin-top: $public-space-xs;

    @media (prefers-color-scheme: dark) {
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
      outline: 2px solid $public-accent-light;
      outline-offset: 2px;
    }

    @media (prefers-color-scheme: dark) {
      border-color: $public-accent-dark;
      color: $public-accent-dark;

      &:hover {
        background: $public-accent-dark;
        color: white;
      }
    }
  }
}

// Responsive design
@include public-mobile-only {
  section.day ul.events {
    li.event {
      width: 120px;
    }
  }
}
</style>
