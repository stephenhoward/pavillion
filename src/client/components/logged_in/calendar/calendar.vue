<script setup>
import { onBeforeMount, reactive, inject, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { Calendar, MapPin, Languages, Repeat, Pencil, Copy, Flag } from 'lucide-vue-next';
import { useEventStore } from '@/client/stores/eventStore';
import { useToast } from '@/client/composables/useToast';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import EventImage from '@/client/components/common/media/EventImage.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import PillButton from '@/client/components/common/PillButton.vue';
import BulkOperationsMenu from './BulkOperationsMenu.vue';
import CategorySelectionDialog from './CategorySelectionDialog.vue';
import SearchFilter from './SearchFilter.vue';
import ReportEvent from '@/client/components/report-event.vue';
import { useBulkSelection } from '@/client/composables/useBulkSelection';
import { useCalendarStore } from '@/client/stores/calendarStore';

const { t } = useTranslation('calendars',{
  keyPrefix: 'calendar',
});

// For bulk operations translations
const { t: tBulk } = useTranslation('calendars', {
  keyPrefix: 'bulk_operations',
});

// For report translations
const { t: tReport } = useTranslation('system', {
  keyPrefix: 'report',
});

const site_config = inject('site_config');
const site_domain = site_config.settings().domain;
const eventService = new EventService();
const calendarStore = useCalendarStore();
const toast = useToast();

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

// Computed property to get events for the current calendar
const calendarEvents = computed(() => store.eventsForCalendar(state.calendar?.id));

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
  getSelectedEventObjects,
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

// Report dialog state
const showReportDialog = ref(false);
const reportEventId = ref('');

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
    const deleteCount = selectedEvents.value.length;
    try {
      // Get the actual event objects from the selected IDs
      const eventsToDelete = getSelectedEventObjects(calendarEvents.value || []);

      for (const event of eventsToDelete) {
        await eventService.deleteEvent(event);
      }

      // Reload events after deletion with current filters
      await eventService.loadCalendarEvents(calendarId.value, currentFilters);
      deselectAll();
      toast.success(tBulk('delete_success', { count: deleteCount }));
    }
    catch (error) {
      console.error('Error deleting events:', error);
      toast.error(tBulk('delete_error'));
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

/**
 * Opens the report dialog for the specified event.
 */
const handleReportEvent = (event) => {
  reportEventId.value = event.id;
  showReportDialog.value = true;
};

/**
 * Closes the report dialog and resets state.
 */
const handleReportDialogClose = () => {
  showReportDialog.value = false;
  reportEventId.value = '';
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
        <div class="header-content">
          <div class="header-title-section">
            <h1>
              <span v-if="state.calendar">{{ state.calendar.urlName }}@{{ site_domain }}</span>
              <span v-else>{{ calendarId }}@{{ site_domain }}</span>
            </h1>
            <div class="header-actions">
              <RouterLink
                v-if="state.calendar"
                :to="{ name: 'calendar_management', params: { calendar: state.calendar.urlName } }"
                custom
                v-slot="{ navigate }"
              >
                <PillButton
                  variant="ghost"
                  @click="navigate"
                  :aria-label="`Manage calendar: ${state.calendar.urlName}`"
                >
                  {{ t('manage_calendar') }}
                </PillButton>
              </RouterLink>
              <PillButton
                variant="primary"
                @click="newEvent"
                :aria-label="t('createEvent')"
              >
                {{ t('createEvent') }}
              </PillButton>
            </div>
          </div>

          <!-- Search and Filter Controls -->
          <SearchFilter
            v-if="state.calendar && (calendarEvents.length > 0 || hasActiveFilters)"
            :calendar-id="calendarId"
            :initial-filters="initialFilters"
            @filters-changed="handleFiltersChanged"
          />
        </div>
      </header>

      <!-- Loading State -->
      <div v-if="state.isLoading" class="loading-state">
        Loading events...
      </div>

      <!-- Events Display Section -->
      <section v-if="!state.isLoading && calendarEvents && calendarEvents.length > 0" aria-label="Calendar Events">
        <h2 class="sr-only">Events in this Calendar</h2>

        <!-- Select All Controls -->
        <div class="event-controls">
          <label class="select-all-control">
            <input
              type="checkbox"
              :checked="selectAllState(calendarEvents).checked"
              :indeterminate="selectAllState(calendarEvents).indeterminate"
              @change="toggleSelectAll(calendarEvents)"
              :aria-label="tBulk('select_all_events')"
            />
            <span>{{ tBulk('select_all') }}</span>
          </label>
        </div>

        <ul class="event-list" role="list">
          <li v-for="event in calendarEvents"
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
                <div class="event-title-row">
                  <h3 :id="`event-title-${event.id}`">{{ event.content("en").name }}</h3>
                  <span v-if="event.languages && event.languages.length > 1" class="language-count">
                    <Languages :size="16" />
                    {{ event.languages.length }} languages
                  </span>
                </div>
                <div v-if="formatEventDate(event)" class="event-date">
                  <Calendar :size="16" class="date-icon" />
                  <span class="date-text">{{ formatEventDate(event) }}</span>
                  <span v-if="isRecurring(event)" class="recurrence-badge">
                    <Repeat :size="14" />
                    {{ getRecurrenceText(event) }}
                  </span>
                </div>
                <p v-if="event.content('en').description" class="event-description">{{ event.content("en").description }}</p>
              </div>
            </article>
            <div class="event-actions">
              <button
                type="button"
                class="edit-btn icon-btn"
                @click.stop="handleEditEvent(event)"
                :aria-label="`Edit event: ${event.content('en').name}`"
                title="Edit this event"
              >
                <Pencil :size="18" />
              </button>
              <button
                type="button"
                class="duplicate-btn icon-btn"
                @click.stop="handleDuplicateEvent(event)"
                :aria-label="`Duplicate event: ${event.content('en').name}`"
                title="Duplicate this event"
              >
                <Copy :size="18" />
              </button>
              <button
                type="button"
                class="report-btn icon-btn"
                @click.stop="handleReportEvent(event)"
                :aria-label="tReport('report_event_label')"
                :title="tReport('report_button')"
              >
                <Flag :size="18" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Empty State: No results from filters -->
      <EmptyLayout v-else-if="!state.isLoading && hasActiveFilters && (!calendarEvents || calendarEvents.length === 0)"
                   title="No events found"
                   description="No events match your current search criteria. Try adjusting your filters or clearing them to see all events." />

      <!-- Empty State: No events at all -->
      <EmptyLayout v-else-if="!state.isLoading && !hasActiveFilters && (!calendarEvents || calendarEvents.length === 0)"
                   :title="t('noEvents')"
                   :description="t('noEventsDescription')">
        <PillButton variant="primary" @click="newEvent()">
          {{ t('createEvent') }}
        </PillButton>
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

    <!-- Report Event Dialog -->
    <ReportEvent
      v-if="showReportDialog"
      :event-id="reportEventId"
      @close="handleReportDialogClose"
    />
  </div>
</template>

<style scoped lang="scss">
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

/* Calendar header with sticky blur effect */
.calendar-header {
  /* Inlined: sticky-blur-header */
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(8px);
  background: rgba(255, 255, 255, 0.8);

  @media (prefers-color-scheme: dark) {
    background: rgba(28, 25, 23, 0.8); // Stone-900 with opacity
  }

  padding: 1.5rem 1rem;
  border-bottom: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-bottom-color: var(--pav-color-stone-700);
  }

  .header-content {
    max-width: 56rem; // max-w-4xl
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .header-title-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;

    h1 {
      font-size: 2.25rem; // text-4xl
      font-weight: 300; // font-light
      margin: 0;
      color: var(--pav-color-stone-800);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-100);
      }
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
      flex-shrink: 0;
    }
  }

  @media (max-width: 768px) {
    .header-title-section {
      flex-direction: column;
      align-items: stretch;

      h1 {
        font-size: 1.5rem;
      }

      .header-actions {
        width: 100%;
      }
    }
  }
}

/* Events section with new design system */
section[aria-label="Calendar Events"] {
  max-width: 56rem; // max-w-4xl
  margin: 0 auto;
  padding: 1.5rem 1rem;

  .event-controls {
    padding: 1rem 0;
    margin-bottom: 1rem;

    .select-all-control {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.875rem;
      color: var(--pav-color-stone-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-200);
      }

      input[type="checkbox"] {
        width: 1.125rem;
        height: 1.125rem;
        cursor: pointer;
        accent-color: var(--pav-color-orange-500);
      }

      span {
        user-select: none;
      }

      &:hover {
        color: var(--pav-color-orange-600);
      }
    }
  }

  .event-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;

    .event-item {
      /* Inlined: event-card */
      border-radius: 0.75rem; // rounded-xl
      border: 1px solid var(--pav-color-stone-200);
      background: white;
      padding: 1rem;
      transition: all 0.15s ease;

      &:hover {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-800);
        border-color: var(--pav-color-stone-700);
      }

      display: flex;
      align-items: flex-start;
      gap: 1rem;

      &:hover {
        .event-actions {
          /* Inlined: hover-reveal */
          opacity: 1;
          transition: opacity 0.2s ease;
        }
      }

      &.selected {
        border-color: var(--pav-color-orange-400);
        background: var(--pav-color-orange-50);
        box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);

        @media (prefers-color-scheme: dark) {
          background: rgba(249, 115, 22, 0.1);
        }
      }

      .event-checkbox {
        padding-top: 0.25rem;

        input[type="checkbox"] {
          width: 1.125rem;
          height: 1.125rem;
          cursor: pointer;
          accent-color: var(--pav-color-orange-500);
        }
      }

      .event-article {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        flex: 1;
        cursor: pointer;
        min-width: 0; // Fix flex overflow
      }

      .event-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        opacity: 0;
        transition: opacity 0.2s ease;

        .icon-btn {
          background: transparent;
          border: none;
          border-radius: 0.5rem; // rounded-lg
          padding: 0.5rem;
          cursor: pointer;
          color: var(--pav-color-stone-600);
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;

          &:hover {
            background: var(--pav-color-stone-100);
            color: var(--pav-color-orange-500);
          }

          @media (prefers-color-scheme: dark) {
            color: var(--pav-color-stone-400);

            &:hover {
              background: var(--pav-color-stone-700);
              border-color: var(--pav-color-orange-500);
              color: var(--pav-color-orange-500);
            }
          }
        }

        // Always show on mobile/touch devices
        @media (max-width: 768px) {
          opacity: 1;
        }
      }
    }

    .event-content {
      flex: 1;
      min-width: 0; // Fix text overflow

      .event-title-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;

        h3 {
          margin: 0;
          font-size: 1.125rem; // text-lg
          font-weight: 600; // font-semibold
          color: var(--pav-color-stone-900);

          @media (prefers-color-scheme: dark) {
            color: var(--pav-color-stone-100);
          }
        }

        .language-count {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-sky-100);
          border-radius: 9999px; // pill
          color: var(--pav-color-sky-700);
          font-size: 0.75rem; // text-xs
          font-weight: 500;
          white-space: nowrap;

          @media (prefers-color-scheme: dark) {
            background: rgba(14, 165, 233, 0.2);
            color: var(--pav-color-sky-300);
          }
        }
      }

      .event-date {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
        font-size: 0.875rem; // text-sm

        .date-icon {
          color: var(--pav-color-orange-500);
          flex-shrink: 0;
        }

        .date-text {
          color: var(--pav-color-stone-600);
          font-weight: 500;

          @media (prefers-color-scheme: dark) {
            color: var(--pav-color-stone-300);
          }
        }

        .recurrence-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-sky-100);
          border-radius: 9999px; // pill
          color: var(--pav-color-sky-700);
          font-size: 0.75rem; // text-xs
          font-weight: 500;

          @media (prefers-color-scheme: dark) {
            background: rgba(14, 165, 233, 0.2);
            color: var(--pav-color-sky-300);
          }
        }
      }

      .event-description {
        margin: 0;
        color: var(--pav-color-stone-600);
        font-size: 0.875rem; // text-sm
        line-height: 1.5;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;

        @media (prefers-color-scheme: dark) {
          color: var(--pav-color-stone-400);
        }
      }
    }
  }
}

.error {
  max-width: 56rem; // max-w-4xl
  margin: 2rem auto;
  padding: 1rem 1.5rem;
  background: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);
  border-radius: 0.75rem; // rounded-xl
  color: var(--pav-color-red-700);
  text-align: center;

  @media (prefers-color-scheme: dark) {
    background: rgba(220, 53, 69, 0.1);
    border-color: var(--pav-color-red-900);
    color: var(--pav-color-red-300);
  }
}

.loading-state {
  max-width: 56rem; // max-w-4xl
  margin: 2rem auto;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--pav-color-stone-600);
  font-style: italic;
  font-size: 1.125rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}
</style>
