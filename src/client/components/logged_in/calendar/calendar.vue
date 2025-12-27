<script setup>
import { onBeforeMount, reactive, inject, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useEventStore } from '@/client/stores/eventStore';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import EventImage from '@/client/components/common/media/EventImage.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import BulkOperationsMenu from './BulkOperationsMenu.vue';
import CategorySelectionDialog from './CategorySelectionDialog.vue';
import SearchFilter from './SearchFilter.vue';
import { useBulkSelection } from '@/client/composables/useBulkSelection';
import { useCalendarStore } from '@/client/stores/calendarStore';

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
const calendarStore = useCalendarStore();

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

// Initial filters from URL parameters
const initialFilters = reactive({
  search: '',
  categories: [],
});

/**
 * Initializes filter state from URL query parameters.
 *
 * Reads search and category filters from the URL to support bookmarkable searches.
 * This enables users to share or bookmark specific filtered views of their calendar.
 *
 * URL Parameter Format:
 * - search: String query term (e.g., ?search=workshop)
 * - categories: Comma-separated category IDs (e.g., ?categories=cat1,cat2)
 * - Combined: ?search=workshop&categories=cat1,cat2
 *
 * The parsed filters are stored in both initialFilters (passed to SearchFilter component)
 * and currentFilters (used for tracking state changes).
 *
 * @example
 * // URL: /calendar/my-calendar?search=conference&categories=tech,business
 * // Results in:
 * // initialFilters = { search: 'conference', categories: ['tech', 'business'] }
 * // currentFilters = { search: 'conference', categories: ['tech', 'business'] }
 */
const initializeFiltersFromURL = () => {
  const searchParam = route.query.search;
  const categoriesParam = route.query.categories;

  initialFilters.search = typeof searchParam === 'string' ? searchParam : '';
  initialFilters.categories = categoriesParam
    ? (typeof categoriesParam === 'string' ? categoriesParam.split(',') : [])
    : [];

  // Also initialize currentFilters from URL
  Object.assign(currentFilters, {
    search: initialFilters.search,
    categories: [...initialFilters.categories],
  });
};

/**
 * Synchronizes current filter state to URL query parameters.
 *
 * Updates the browser URL to reflect active filters without triggering a page reload.
 * Uses router.replace() instead of router.push() to avoid polluting browser history.
 *
 * This enables:
 * - Bookmarking specific search/filter combinations
 * - Sharing filtered views via URL
 * - Browser back/forward navigation with filter state
 *
 * URL Parameter Behavior:
 * - Non-empty search: Adds/updates ?search=query parameter
 * - Empty search: Removes search parameter from URL
 * - Selected categories: Adds/updates ?categories=id1,id2 parameter
 * - No categories: Removes categories parameter from URL
 * - Preserves: All other existing query parameters
 *
 * @example
 * // Current URL: /calendar/my-calendar
 * // After search for "workshop": /calendar/my-calendar?search=workshop
 * // After clearing search: /calendar/my-calendar
 */
const syncFiltersToURL = () => {
  const query = { ...route.query };

  // Update or remove search parameter
  if (currentFilters.search && currentFilters.search.trim() !== '') {
    query.search = currentFilters.search.trim();
  }
  else {
    delete query.search;
  }

  // Update or remove categories parameter
  if (currentFilters.categories && currentFilters.categories.length > 0) {
    query.categories = currentFilters.categories.join(',');
  }
  else {
    delete query.categories;
  }

  // Update URL without page reload, preserving current route
  router.replace({
    name: route.name,
    params: route.params,
    query,
  });
};

/**
 * Handles filter changes from SearchFilter component.
 *
 * This is the main integration point between SearchFilter component and calendar view.
 * When users change search terms or category selections, this handler:
 * 1. Updates local filter state
 * 2. Syncs filters to URL parameters (for bookmarking)
 * 3. Reloads events from API with new filters
 * 4. Clears any bulk selections (filtered view may exclude selected items)
 *
 * @param filters - Filter object from SearchFilter component
 * @param filters.search - Search query string (optional)
 * @param filters.categories - Array of category IDs (optional)
 *
 * @example
 * // SearchFilter emits: { search: 'workshop', categories: ['cat1', 'cat2'] }
 * // This function will:
 * // 1. Update currentFilters
 * // 2. Update URL to: ?search=workshop&categories=cat1,cat2
 * // 3. Call API: /api/v1/calendars/:id/events?search=workshop&categories=cat1,cat2
 */
const handleFiltersChanged = async (filters) => {
  // Update current filters
  Object.assign(currentFilters, {
    search: filters.search || '',
    categories: filters.categories || [],
  });

  // Sync filters to URL
  syncFiltersToURL();

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
  // Initialize filters from URL parameters first
  initializeFiltersFromURL();

  // Then load calendar data with filters if any
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

    // Load events for this calendar with current filters (from URL if present)
    const filters = {};
    if (currentFilters.search) {
      filters.search = currentFilters.search;
    }
    if (currentFilters.categories && currentFilters.categories.length > 0) {
      filters.categories = currentFilters.categories;
    }

    await eventService.loadCalendarEvents(calendarId.value, Object.keys(filters).length > 0 ? filters : undefined);
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

/**
 * Navigate to new event creation for this calendar.
 * Sets the current calendar as selectedCalendar for pre-selection.
 */
const newEvent = async () => {
  if (state.calendar) {
    calendarStore.setSelectedCalendar(state.calendar.id);
    router.push({ name: 'event_new' });
  }
};

/**
 * Navigate to edit an existing event.
 */
const handleEditEvent = (event) => {
  router.push({
    name: 'event_edit',
    params: { eventId: event.id },
  });
};

const navigateToManagement = () => {
  router.push({
    name: 'calendar_management',
    params: { calendar: state.calendar.urlName },
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

/**
 * Navigate to duplicate an event.
 * Uses the ?from= query parameter to indicate duplication mode.
 */
const handleDuplicateEvent = (event) => {
  router.push({
    name: 'event_new',
    query: { from: event.id },
  });
};

// Format event date for display
const formatEventDate = (event) => {
  if (!event.schedules || event.schedules.length === 0) {
    return null;
  }

  const schedule = event.schedules[0];
  if (!schedule.startDate) {
    return null;
  }

  // Use Luxon's built-in locale-aware formatting
  return schedule.startDate.toLocaleString(DateTime.DATETIME_MED);
};

// Check if event is recurring
const isRecurring = (event) => {
  if (!event.schedules || event.schedules.length === 0) {
    return false;
  }

  const schedule = event.schedules[0];
  return schedule.frequency !== null && schedule.frequency !== undefined;
};

// Get recurrence description
const getRecurrenceText = (event) => {
  if (!isRecurring(event)) {
    return null;
  }

  const schedule = event.schedules[0];
  const frequency = schedule.frequency;

  // Simple recurrence labels
  const labels = {
    daily: 'Repeats daily',
    weekly: 'Repeats weekly',
    monthly: 'Repeats monthly',
    yearly: 'Repeats yearly',
  };

  return labels[frequency] || 'Recurring event';
};

// Check if any filters are currently active
const hasActiveFilters = computed(() => {
  return !!(currentFilters.search?.trim() || currentFilters.categories?.length > 0);
});
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
            :to="{ name: 'calendar_management', params: { calendar: state.calendar.urlName } }"
          >
            {{ t('manage_calendar') }}
          </RouterLink>
        </nav>
      </header>

      <!-- Search and Filter Controls -->
      <SearchFilter
        v-if="state.calendar && (store.events?.length > 0 || hasActiveFilters)"
        :calendar-id="calendarId"
        :initial-filters="initialFilters"
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
              @click="handleEditEvent(event)"
              class="event-article"
            >
              <EventImage :media="event.media" size="small" />
              <div class="event-content">
                <h3 :id="`event-title-${event.id}`">{{ event.content("en").name }}</h3>
                <div v-if="formatEventDate(event)" class="event-date">
                  <span class="date-text">📅 {{ formatEventDate(event) }}</span>
                  <span v-if="isRecurring(event)" class="recurrence-badge">🔄 {{ getRecurrenceText(event) }}</span>
                </div>
                <p v-if="event.content('en').description">{{ event.content("en").description }}</p>
              </div>
            </article>
            <div class="event-actions">
              <button
                type="button"
                class="edit-btn"
                @click.stop="handleEditEvent(event)"
                :aria-label="`Edit event: ${event.content('en').name}`"
                title="Edit this event"
              >
                ✏️
              </button>
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

      <!-- Empty State: No results from filters -->
      <EmptyLayout v-else-if="!state.isLoading && hasActiveFilters && (!store.events || store.events.length === 0)"
                   title="No events found"
                   description="No events match your current search criteria. Try adjusting your filters or clearing them to see all events." />

      <!-- Empty State: No events at all -->
      <EmptyLayout v-else-if="!state.isLoading && !hasActiveFilters && (!store.events || store.events.length === 0)"
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
      border: 1px var(--pav-color-surface-primary);
      border-radius: 8px;
      transition: all 0.2s ease;

      &.selected {
        border-color: var(--pav-color-interactive-primary);
        background: rgba(0, 123, 255, 0.05);
      }

      &:hover {
        border-color: #e0e0e0;
        box-shadow: 0 2px 8px rgba(0, 123, 255, 0.2);
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

        .edit-btn,
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

      .event-date {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin: 8px 0;
        font-size: 14px;

        .date-text {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #555;
          font-weight: 500;

          @include dark-mode {
            color: #bbb;
          }
        }

        .recurrence-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          background: #e3f2fd;
          border: 1px solid #2196f3;
          border-radius: 12px;
          color: #1976d2;
          font-size: 12px;
          font-weight: 500;

          @include dark-mode {
            background: rgba(33, 150, 243, 0.2);
            border-color: #2196f3;
            color: #64b5f6;
          }
        }
      }

      p {
        margin: 8px 0 0 0;
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
