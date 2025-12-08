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
@use '../../client/assets/mixins' as *;

h1 {
  font-size: 200%;
  font-weight: $font-light;
}

// Events display
section.day {
  margin: 10px 0;

  h2 {
    font-size: 100%;
    margin: 0;
    padding: 0;
    font-weight: $font-medium;
  }

  ul.events {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: stretch;
    overflow-x: auto;
    padding: 20px 0px;

    li.event {
      list-style-type: none;
      padding: 10px;
      width: 150px;
      margin-right: 10px;
      box-shadow: rgba(0,0,0,0.2) 8px 8px 12px;
      background-color: rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;

      h3 {
        order: 1;
        font-size: 120%;
        margin-top: 10px;
        font-weight: $font-light;

        a {
          color: $light-mode-text;
          text-decoration: none;

          @media (prefers-color-scheme: dark) {
            color: $dark-mode-text;
          }
        }
      }

      .event-time {
        order: 2;
        font-size: 14px;
        color: $light-mode-secondary-text;
        margin-top: 5px;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-secondary-text;
        }
      }

      .event-categories {
        order: 3;
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;

        .event-category-badge {
          background-color: $light-mode-button-background;
          color: white;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 10px;
          font-weight: $font-medium;

          @media (prefers-color-scheme: dark) {
            background-color: $dark-mode-button-background;
          }
        }
      }
    }
  }
}

// Loading and error states
.loading {
  text-align: center;
  padding: 20px;
  color: $light-mode-secondary-text;
  font-style: italic;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-secondary-text;
  }
}

.error {
  background-color: #fee;
  border: 1px solid #fcc;
  color: #c33;
  padding: 10px;
  border-radius: 5px;
  margin: 10px 0;

  @media (prefers-color-scheme: dark) {
    background-color: #400;
    border-color: #600;
    color: #fcc;
  }
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: $light-mode-secondary-text;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-secondary-text;
  }

  p {
    margin: 0 0 20px 0;
    font-size: 16px;
  }

  .clear-filters-btn {
    @include btn-base;
    @include btn-ghost;

    padding: $spacing-sm $spacing-lg;
    font-size: 14px;
  }
}

// Responsive design
@media (max-width: 768px) {
  section.day ul.events {
    li.event {
      width: 120px;
    }
  }
}
</style>
