<script setup>
import { onBeforeMount, reactive, inject, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useEventStore } from '@/client/stores/eventStore';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import EventImage from '@/client/components/common/media/EventImage.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import BulkOperationsMenu from './BulkOperationsMenu.vue';
import CategorySelectionDialog from './CategorySelectionDialog.vue';
import SearchFilter from './SearchFilter.vue';
import { useBulkSelection } from '@/client/composables/useBulkSelection';

const { t } = useTranslation('calendars',{
  keyPrefix: 'calendar',
});

// For bulk operations translations
const { t: tBulk } = useTranslation('calendars', {
  keyPrefix: 'bulk_operations',
});
const site_config = inject('site_config');
const site_domain = site_config.settings().domain;
const eventService = new EventService();
const emit = defineEmits(['openEvent']);

const route = useRoute();
const router = useRouter();
const state = reactive({
  err: '',
  calendar: null,
  isLoading: false,
});
const calendarId = computed(() => route.params.calendar);
const store = useEventStore();
const calendarService = new CalendarService();

// Bulk selection functionality
const {
  selectedEvents,
  selectedCount,
  hasSelection,
  toggleEventSelection,
  isEventSelected,
  selectAllState,
  toggleSelectAll,
  deselectAll,
} = useBulkSelection();

// Search and filter functionality
const currentFilters = reactive({
  search: '',
  categories: [],
});

const handleFiltersChanged = async (filters) => {
  // Update current filters
  Object.assign(currentFilters, {
    search: filters.search || '',
    categories: filters.categories || [],
  });

  // Reload events with new filters
  state.isLoading = true;
  try {
    await eventService.loadCalendarEvents(calendarId.value, filters);
    // Clear selections when filtering changes
    deselectAll();
  }
  catch (error) {
    console.error('Error loading filtered events:', error);
    state.err = 'Failed to load events with current filters';
  }
  finally {
    state.isLoading = false;
  }
};

onBeforeMount(async () => {
  await loadCalendarData();
});

// Function to load calendar data
const loadCalendarData = async () => {
  if (!calendarId.value) return;

  try {
    state.isLoading = true;
    state.err = '';

    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId.value);

    // Load events for this calendar
    await eventService.loadCalendarEvents(calendarId.value);
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = 'Failed to load calendar data';
  }
  finally {
    state.isLoading = false;
  }
};

// Watch for calendar ID changes and reload data
watch(calendarId, (newCalendarId, oldCalendarId) => {
  if (newCalendarId && newCalendarId !== oldCalendarId) {
    loadCalendarData();
  }
});

const newEvent = async () => {
  try {
    const event = eventService.initEvent(state.calendar);
    emit('openEvent', event);
  }
  catch (error) {
    console.error('Error checking calendars:', error);
  }
};

const navigateToManagement = () => {
  router.push({
    name: 'calendar_management',
    params: { calendar: state.calendar.id },
  });
};

// Category selection dialog state
const showCategoryDialog = ref(false);

// Handle bulk operations
const handleAssignCategories = () => {
  showCategoryDialog.value = true;
};

const handleDeselectAll = () => {
  deselectAll();
};

const handleCategoryDialogClose = () => {
  showCategoryDialog.value = false;
};

const handleAssignmentComplete = (result) => {
  // Show success message or handle completion
  console.log(`Successfully assigned ${result.categoryCount} categories to ${result.eventCount} events`);
  deselectAll(); // Clear selection after successful assignment
};

const handleDeleteEvents = async () => {
  if (!selectedEvents.value.length) return;

  const confirmDelete = confirm(`Are you sure you want to delete ${selectedCount.value} event${selectedCount.value > 1 ? 's' : ''}?`);

  if (confirmDelete) {
    try {
      // Get the actual event objects from the selected IDs
      const eventsToDelete = getSelectedEventObjects(store.events || []);

      for (const event of eventsToDelete) {
        await eventService.deleteEvent(event);
      }

      // Reload events after deletion with current filters
      await eventService.loadCalendarEvents(calendarId.value, currentFilters);
      deselectAll();
    }
    catch (error) {
      console.error('Error deleting events:', error);
      // TODO: Show user-friendly error message
    }
  }
};

const handleDuplicateEvent = (event) => {
  // Open the event editor in duplication mode
  emit('openEvent', event.clone(), true); // Pass isDuplicationMode as true
};
</script>

<template>
  <div>
    <div v-if="state.err"
         class="error alert"
         role="alert"
         aria-live="polite">
      {{ state.err }}
    </div>
    <div v-else>
      <header class="calendar-header">
        <h1>
          <span v-if="state.calendar">{{ state.calendar.urlName }}@{{ site_domain }}</span>
          <span v-else>{{ calendarId }}@{{ site_domain }}</span>
        </h1>
        <nav aria-label="Calendar Management">
          <RouterLink
            type="button"
            @click="navigateToManagement"
            v-if="state.calendar"
            :aria-label="`Manage calendar: ${state.calendar.urlName}`"
            :to="{ name: 'calendar_management', params: { calendar: state.calendar.id } }"
          >
            {{ t('manage_calendar') }}
          </RouterLink>
        </nav>
      </header>

      <!-- Search and Filter Controls -->
      <SearchFilter
        v-if="state.calendar && store.events && store.events.length > 0"
        :calendar-id="calendarId"
        :initial-filters="currentFilters"
        @filters-changed="handleFiltersChanged"
      />

      <!-- Loading State -->
      <div v-if="state.isLoading" class="loading-state">
        Loading events...
      </div>

      <!-- Events Display Section -->
      <section v-if="!state.isLoading && store.events && store.events.length > 0" aria-label="Calendar Events">
        <h2 class="sr-only">Events in this Calendar</h2>

        <!-- Select All Controls -->
        <div class="event-controls">
          <label class="select-all-control">
            <input
              type="checkbox"
              :checked="selectAllState(store.events).checked"
              :indeterminate="selectAllState(store.events).indeterminate"
              @change="toggleSelectAll(store.events)"
              :aria-label="tBulk('select_all_events')"
            />
            <span>{{ tBulk('select_all') }}</span>
          </label>
        </div>

        <ul class="event-list" role="list">
          <li v-for="event in store.events"
              :key="event.id"
              class="event-item"
              :class="{ selected: isEventSelected(event) }"
              role="listitem">
            <div class="event-checkbox">
              <input
                type="checkbox"
                :checked="isEventSelected(event)"
                @change.stop="toggleEventSelection(event)"
                :aria-label="`Select event: ${event.content('en').name}`"
              />
            </div>
            <article
              :aria-labelledby="`event-title-${event.id}`"
              @click="$emit('openEvent', event.clone())"
              class="event-article"
            >
              <EventImage :media="event.media" size="small" />
              <div class="event-content">
                <h3 :id="`event-title-${event.id}`">{{ event.content("en").name }}</h3>
                <p v-if="event.content('en').description">{{ event.content("en").description }}</p>
              </div>
            </article>
            <div class="event-actions">
              <button
                type="button"
                class="duplicate-btn"
                @click.stop="handleDuplicateEvent(event)"
                :aria-label="`Duplicate event: ${event.content('en').name}`"
                title="Duplicate this event"
              >
                📄
              </button>
            </div>
          </li>
        </ul>
      </section>

      <EmptyLayout v-else-if="!state.isLoading && (!store.events || store.events.length === 0)"
                   :title="t('noEvents')"
                   :description="t('noEventsDescription')">
        <button type="button" class="primary" @click="newEvent()">
          {{ t('createEvent') }}
        </button>
      </EmptyLayout>
    </div>

    <!-- Bulk Operations Menu -->
    <BulkOperationsMenu
      :selected-count="selectedCount"
      @assign-categories="handleAssignCategories"
      @delete-events="handleDeleteEvents"
      @deselect-all="handleDeselectAll"
    />

    <!-- Category Selection Dialog -->
    <CategorySelectionDialog
      :visible="showCategoryDialog"
      :selected-event-ids="selectedEvents"
      @close="handleCategoryDialogClose"
      @assign-complete="handleAssignmentComplete"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

/* Screen reader only class for accessibility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Main element styling */
main[role="main"] {
  min-height: 100vh;
  padding: var(--pav-space-lg);
}

/* Calendar header with navigation */
.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 20px;

  h1 {
    font-size: 16pt;
    font-weight: 200;
    margin: 0;
  }

  nav[aria-label="Calendar Management"] {
    .manage-btn {
      font-size: 0.9rem;
      padding: 0.5rem 1rem;
    }
  }
}

/* Events section styling */
section[aria-label="Calendar Events"] {
  margin: var(--pav-space-lg) 0;

  .event-controls {
    margin: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color, #e0e0e0);

    .select-all-control {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-weight: 500;
      color: var(--text-primary, #333);

      @include dark-mode {
        color: var(--text-primary-dark, #fff);
      }

      input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }

      span {
        user-select: none;
      }

      &:hover {
        color: var(--primary-color, #007bff);
      }
    }

    @include dark-mode {
      border-color: var(--border-color-dark, #4a5568);
    }
  }

  .event-list {
    list-style: none;
    padding: 0;
    margin: 20px;

    .event-item {
      display: flex;
      align-items: flex-start;
      gap: 15px;
      padding: 15px;
      margin-bottom: 15px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      transition: all 0.2s ease;

      &.selected {
        border-color: #007bff;
        background: rgba(0, 123, 255, 0.05);
      }

      &:hover {
        border-color: #007bff;
        box-shadow: 0 2px 8px rgba(0, 123, 255, 0.1);
      }

      @include dark-mode {
        border-color: #444;

        &.selected {
          border-color: #007bff;
          background: rgba(0, 123, 255, 0.1);
        }

        &:hover {
          border-color: #007bff;
          box-shadow: 0 2px 8px rgba(0, 123, 255, 0.2);
        }
      }

      .event-checkbox {
        display: flex;
        align-items: center;
        padding-top: 2px;

        input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }
      }

      .event-article {
        display: flex;
        align-items: flex-start;
        gap: 15px;
        flex: 1;
        cursor: pointer;
      }

      .event-actions {
        display: flex;
        align-items: center;
        gap: 8px;

        .duplicate-btn {
          background: transparent;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          padding: 8px;
          font-size: 16px;
          cursor: pointer;
          color: var(--text-secondary, #666);
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;

          &:hover {
            background-color: var(--background-secondary, #f5f5f5);
            border-color: var(--primary-color, #007bff);
            color: var(--primary-color, #007bff);
            transform: translateY(-1px);
          }

          &:active {
            transform: translateY(0);
          }

          @include dark-mode {
            border-color: #4a5568;
            color: #a0aec0;

            &:hover {
              background-color: #2d3748;
              border-color: #007bff;
              color: #007bff;
            }
          }
        }
      }
    }

    .event-content {
      flex: 1;

      h3 {
        margin: 0 0 8px 0;
        font-size: 18px;
        color: #333;

        @include dark-mode {
          color: #fff;
        }
      }

      p {
        margin: 0;
        color: #666;
        font-size: 14px;
        line-height: 1.4;

        @include dark-mode {
          color: #ccc;
        }
      }
    }
  }
}

.management-section {
  margin: 20px;
  padding: 20px;
  background: var(--background-secondary, #f8f9fa);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);

  @include dark-mode {
    background: var(--background-secondary-dark, #2d3748);
    border-color: var(--border-color-dark, #4a5568);
  }
}

.management-tabs {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.error {
  color: red;
  padding: 20px;
  text-align: center;
}

.loading-state {
  padding: 20px;
  text-align: center;
  color: $light-mode-text;
  font-style: italic;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-text;
  }
}
</style>
