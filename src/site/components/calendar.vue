<script setup lang="ts">
import { reactive, onBeforeMount, computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import CalendarService from '../service/calendar';
import { usePublicCalendarStore } from '../stores/publicCalendarStore';
import NotFound from './notFound.vue';
import CategoryPillSelector from './CategoryPillSelector.vue';
import { DateTime } from 'luxon';
import EventImage from './EventImage.vue';

const { t } = useTranslation('system');
const route = useRoute();
const router = useRouter();
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
const selectedCategoryNames = computed({
  get: () => publicCalendarStore.selectedCategoryNames,
  set: (value) => publicCalendarStore.setSelectedCategories(value),
});
const filteredEventsByDay = computed(() => publicCalendarStore.getFilteredEventsByDay);
const hasActiveFilters = computed(() => publicCalendarStore.hasActiveFilters);
const isLoadingCategories = computed(() => publicCalendarStore.isLoadingCategories);

// Parse category filters from URL parameters
const parseCategoryFiltersFromUrl = () => {
  const categoryParam = route.query.category;
  if (Array.isArray(categoryParam)) {
    return categoryParam as string[];
  }
  else if (typeof categoryParam === 'string') {
    return [categoryParam];
  }
  return [];
};

// Update URL with current category filters
const updateUrlWithFilters = (categoryNames: string[]): void => {
  const query = { ...route.query };

  if (categoryNames.length > 0) {
    query.category = categoryNames;
  }
  else {
    delete query.category;
  }

  router.replace({ query });
};

// Watch for changes in selected categories to update URL
watch(selectedCategoryNames, (newNames) => {
  updateUrlWithFilters(newNames);
}, { deep: true });

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

    // Parse initial filters from URL
    const initialFilters = parseCategoryFiltersFromUrl();
    publicCalendarStore.setSelectedCategories(initialFilters);

    // Load categories and events concurrently
    await Promise.all([
      publicCalendarStore.loadCategories(calendarUrlName),
      publicCalendarStore.loadEvents(calendarUrlName, initialFilters.length > 0 ? initialFilters : undefined),
    ]);
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = 'Failed to load calendar data';
  }
  finally {
    state.isLoading = false;
  }
});

// Handle category filter changes
const handleCategoryFilterChange = async (categoryNames: string[]) => {
  publicCalendarStore.setSelectedCategories(categoryNames);
  // Reload events with new filters
  await publicCalendarStore.reloadWithFilters();
};

</script>

<template>
  <div v-if="state.notFound">
    <NotFound />
  </div>
  <div v-else>
    <header v-if="state.calendar">
      <!-- TODO: respect the user's language preferences instead of using 'en' -->
      <h1>{{ state.calendar.content("en").name || state.calendar.urlName }}</h1>

      <!-- Category Filter Section -->
      <div v-if="availableCategories.length > 0" class="category-filter-section">
        <h2 class="filter-title">{{ t('filter_by_category') }}</h2>
        <CategoryPillSelector
          :categories="availableCategories"
          v-model:selectedCategories="selectedCategoryNames"
          :disabled="isLoadingCategories"
          @update:selectedCategories="handleCategoryFilterChange"
        />

        <!-- Filter Status -->
        <div v-if="hasActiveFilters" class="filter-status">
          <button
            type="button"
            class="clear-filters-btn"
            @click="handleCategoryFilterChange([])"
          >
            {{ t('clear_filters') }}
          </button>
        </div>
      </div>

      <!-- Loading State for Categories -->
      <div v-if="isLoadingCategories" class="loading-categories">
        {{ t('loading_categories') }}
      </div>
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

// Category filter section
.category-filter-section {
  margin: 20px 0;
  padding: 15px 0;
  border-bottom: 1px solid $light-mode-border;

  @media (prefers-color-scheme: dark) {
    border-bottom-color: $dark-mode-border;
  }

  .filter-title {
    font-size: 16px;
    font-weight: $font-medium;
    margin: 0 0 10px 0;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  .filter-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    flex-wrap: wrap;
    gap: 10px;

    .filter-count {
      font-size: 14px;
      color: $light-mode-secondary-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-secondary-text;
      }
    }

    .clear-filters-btn {
      background: none;
      border: 1px solid $light-mode-border;
      color: $light-mode-text;
      padding: 4px 12px;
      border-radius: 15px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background-color: $light-mode-selected-background;
      }

      @media (prefers-color-scheme: dark) {
        border-color: $dark-mode-border;
        color: $dark-mode-text;

        &:hover {
          background-color: $dark-mode-selected-background;
        }
      }
    }
  }
}

.loading-categories {
  color: $light-mode-secondary-text;
  font-style: italic;
  margin: 10px 0;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-secondary-text;
  }
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
.loading, .loading-categories {
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
    margin: 0;
    font-size: 16px;
  }
}

// Responsive design
@media (max-width: 768px) {
  .category-filter-section {
    .filter-status {
      flex-direction: column;
      align-items: stretch;

      .clear-filters-btn {
        align-self: flex-start;
      }
    }
  }

  section.day ul.events {
    li.event {
      width: 120px;
    }
  }
}
</style>
