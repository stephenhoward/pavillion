<script setup lang="ts">
import { reactive, onBeforeMount, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CalendarService from '../service/calendar';
import { usePublicCalendarStore } from '../stores/publicCalendarStore';
import NotFound from './notFound.vue';
import SearchFilterPublic from './SearchFilterPublic.vue';
import { DateTime } from 'luxon';
import EventImage from './EventImage.vue';

const { t } = useTranslation('system');
const route = useRoute();
const calendarUrlName = route.params.calendar as string;

const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  isLoading: false,
});

const calendarService = new CalendarService();
const publicCalendarStore = usePublicCalendarStore();

// Computed properties for store data
const availableCategories = computed(() => publicCalendarStore.availableCategories);
const filteredEventsByDay = computed(() => publicCalendarStore.getFilteredEventsByDay);
const hasActiveFilters = computed(() => publicCalendarStore.hasActiveFilters);

onBeforeMount(async () => {
  try {
    state.isLoading = true;

    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    // Set current calendar in store
    publicCalendarStore.setCurrentCalendar(calendarUrlName);

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
      <!-- TODO: respect the user's language preferences instead of using 'en' -->
      <h1>{{ state.calendar.content("en").name || state.calendar.urlName }}</h1>

      <!-- Search and Filter Component -->
      <SearchFilterPublic />
    </header>

    <main>
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <div v-if="publicCalendarStore.eventError" class="error">{{ publicCalendarStore.eventError }}</div>
      <div v-if="publicCalendarStore.categoryError" class="error">{{ publicCalendarStore.categoryError }}</div>

      <!-- Events Display -->
      <div v-if="Object.keys(filteredEventsByDay).length > 0">
        <section class="day" v-for="day in Object.keys(filteredEventsByDay).sort()" :key="day">
          <h2>{{ DateTime.fromISO(day).toLocaleString({weekday: 'long', month: 'long', day: 'numeric'}) }}</h2>
          <ul class="events">
            <li class="event" v-for="instance in filteredEventsByDay[day]" :key="instance.id">
              <EventImage :media="instance.event.media" :size="'small'" />
              <h3>
                <router-link :to="{ name: 'instance', params: { event: instance.event.id, instance: instance.id } }">
                  {{ instance.event.content("en").name }}
                </router-link>
              </h3>
              <div class="event-time">{{ instance.start.toLocaleString(DateTime.TIME_SIMPLE) }}</div>
            </li>
          </ul>
        </section>
      </div>

      <!-- Empty State -->
      <div v-else-if="!state.isLoading && !publicCalendarStore.isLoadingEvents" class="empty-state">
        <p v-if="hasActiveFilters">
          {{ t('no_events_with_filters') }}
        </p>
        <p v-else>
          {{ t('no_events_available') }}
        </p>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="clear-filters-btn"
          @click="publicCalendarStore.clearAllFilters(); publicCalendarStore.reloadWithFilters();"
        >
          {{ t('public_search_filter.clear_all_filters') }}
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="state.isLoading || publicCalendarStore.isLoadingEvents" class="loading">
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

// Events display
section.day {
  margin: $public-space-md 0;

  h2 {
    font-size: $public-font-size-base;
    margin: 0;
    padding: 0;
    font-weight: $public-font-weight-medium;
    color: $public-text-primary-light;

    @media (prefers-color-scheme: dark) {
      color: $public-text-primary-dark;
    }
  }

  ul.events {
    @include public-horizontal-scroll;

    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: stretch;
    padding: $public-space-xl 0;
    gap: $public-space-md;

    li.event {
      @include public-event-card-compact;

      list-style-type: none;
      margin-right: 0;

      h3 {
        order: 1;
        font-size: $public-font-size-md;
        margin-top: $public-space-sm;
        font-weight: $public-font-weight-light;
        line-height: $public-line-height-tight;

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

  .clear-filters-btn {
    @include public-button-ghost;

    padding: $public-space-sm $public-space-lg;
    font-size: $public-font-size-base;
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
