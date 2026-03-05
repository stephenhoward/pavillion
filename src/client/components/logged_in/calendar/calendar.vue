<script setup>
import { onBeforeMount, reactive, ref, watch, computed, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { Calendar, MapPin, Languages, Repeat, Pencil, Copy, Flag } from 'lucide-vue-next';
import { useEventStore } from '@/client/stores/eventStore';
import { useToast } from '@/client/composables/useToast';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import EventImage from '@/client/components/common/media/event-image.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import BulkOperationsMenu from './bulk-operations-menu.vue';
import CategorySelectionDialog from './category-selection-dialog.vue';
import SearchFilter from './search-filter.vue';
import ReportEvent from '@/client/components/report-event.vue';
import { useBulkSelection } from '@/client/composables/useBulkSelection';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useCategoryStore } from '@/client/stores/categoryStore';
import RepostCategoriesModal from '@/client/components/logged_in/repost-categories-modal.vue';

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

// For repost edit dialog translations
const { t: tFeed } = useTranslation('feed');

const eventService = new EventService();
const calendarStore = useCalendarStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const route = useRoute();
const router = useRouter();
const state = reactive({
  err: '',
  calendar: null,
  isLoading: false,
});
const calendarUrlName = computed(() => route.params.calendar);
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
const reportEventTitle = ref('');

// Repost category edit modal state
const repostEventForModal = ref(null);

// Ref to the element that triggered the repost modal (for focus return on close)
const repostModalTriggerEl = ref(null);

// Delete confirmation modal state
const showDeleteConfirmModal = ref(false);

// Ref to the element that triggered the delete modal (for focus return on close)
const deleteModalTriggerEl = ref(null);

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
 *
 * Selected events are preserved across filter changes. Events that no longer appear
 * in the filtered list are simply hidden but remain selected for bulk operations.
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
    await eventService.loadCalendarEvents(calendarUrlName.value, filters, state.calendar?.id);
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
  if (!calendarUrlName.value) return;

  try {
    state.isLoading = true;
    state.err = '';

    // Load calendar by URL name — only returns calendars the current user can edit
    state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName.value);

    // If the calendar wasn't found in the user's accessible calendars, redirect away
    if (!state.calendar) {
      router.replace({ name: 'calendars' });
      return;
    }

    // Load events for this calendar with current filters (from URL if present)
    const filters = {};
    if (currentFilters.search) {
      filters.search = currentFilters.search;
    }
    if (currentFilters.categories && currentFilters.categories.length > 0) {
      filters.categories = currentFilters.categories;
    }

    await eventService.loadCalendarEvents(calendarUrlName.value, Object.keys(filters).length > 0 ? filters : undefined, state.calendar?.id);
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
watch(calendarUrlName, (newUrlName, oldUrlName) => {
  if (newUrlName && newUrlName !== oldUrlName) {
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
 * Navigate to or open the editor for an event.
 * Used internally when navigation should always occur regardless of bulk mode.
 *
 * @param event - The CalendarEvent model to edit
 * @param domEvent - The originating mouse event, used to capture the trigger element
 */
const navigateToEditEvent = (event, domEvent) => {
  if (event.isRepost) {
    repostModalTriggerEl.value = domEvent?.currentTarget ?? null;
    repostEventForModal.value = event;
    return;
  }
  router.push({
    name: 'event_edit',
    params: { eventId: event.id },
  });
};

/**
 * Handle a click on the event article body.
 * When bulk mode is active (one or more events selected), toggles the event's
 * selection instead of navigating to the editor. This prevents users from
 * accidentally losing their selection by misclicking the card body.
 *
 * @param event - The CalendarEvent model
 * @param domEvent - The originating mouse event
 */
const handleEditEvent = (event, domEvent) => {
  if (hasSelection.value) {
    toggleEventSelection(event);
    return;
  }
  navigateToEditEvent(event, domEvent);
};

/**
 * Handle click on the dedicated edit (pencil) button.
 * Always navigates to the editor regardless of bulk mode, since the user
 * explicitly intends to edit by clicking the edit button.
 *
 * @param event - The CalendarEvent model to edit
 * @param domEvent - The originating mouse event
 */
const handleEditButtonClick = (event, domEvent) => {
  navigateToEditEvent(event, domEvent);
};

/**
 * Handle category save from the repost edit modal.
 * Calls bulkAssignCategories to add any newly selected categories,
 * then updates the event in the store with the API response.
 * Returns focus to the element that triggered the modal.
 */
const handleRepostCategoryUpdate = async (categoryIds) => {
  if (!repostEventForModal.value) return;

  if (categoryIds.length > 0) {
    try {
      const updatedEvents = await calendarService.bulkAssignCategories(
        [repostEventForModal.value.id],
        categoryIds,
      );
      updatedEvents.forEach(event => {
        store.updateEvent(state.calendar?.id, event);
      });
    }
    catch (error) {
      console.error('Error updating repost event categories:', error);
      toast.error(tFeed('errors.UnknownError'));
    }
  }

  repostEventForModal.value = null;
  await nextTick();
  repostModalTriggerEl.value?.focus();
};

/**
 * Handle cancel from the repost edit modal.
 * Closes the modal and returns focus to the element that triggered it.
 */
const handleRepostModalCancel = async () => {
  repostEventForModal.value = null;
  await nextTick();
  repostModalTriggerEl.value?.focus();
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

/**
 * Opens the delete confirmation modal when the user clicks "Delete Events".
 * Captures the trigger element so focus can be returned when the modal closes.
 * The actual deletion is performed in handleDeleteConfirm() after the user confirms.
 *
 * @param event - The originating mouse event, used to capture the trigger element
 */
const handleDeleteEvents = (event) => {
  if (!selectedEvents.value.length) return;
  deleteModalTriggerEl.value = (event?.currentTarget ?? null);
  showDeleteConfirmModal.value = true;
};

/**
 * Cancels the delete operation and closes the confirmation modal.
 * Returns focus to the element that triggered the modal.
 */
const handleDeleteCancel = async () => {
  showDeleteConfirmModal.value = false;
  await nextTick();
  deleteModalTriggerEl.value?.focus();
};

/**
 * Executes the bulk delete after the user confirms in the modal.
 * Deletes all selected events, reloads the event list, and shows a toast notification.
 * Returns focus to the element that triggered the modal after the modal closes.
 */
const handleDeleteConfirm = async () => {
  showDeleteConfirmModal.value = false;
  await nextTick();
  deleteModalTriggerEl.value?.focus();

  const deleteCount = selectedEvents.value.length;
  try {
    // Get the actual event objects from the selected IDs
    const eventsToDelete = getSelectedEventObjects(calendarEvents.value || []);

    for (const event of eventsToDelete) {
      await eventService.deleteEvent(event);
    }

    // Reload events after deletion with current filters
    await eventService.loadCalendarEvents(calendarUrlName.value, currentFilters, state.calendar?.id);
    deselectAll();
    toast.success(tBulk('delete_success', { count: deleteCount }));
  }
  catch (error) {
    console.error('Error deleting events:', error);
    toast.error(tBulk('delete_error'));
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
 * Captures the event title so the user can confirm they are reporting the correct event.
 */
const handleReportEvent = (event) => {
  reportEventId.value = event.id;
  reportEventTitle.value = event.content('en').name || '';
  showReportDialog.value = true;
};

/**
 * Closes the report dialog and resets state.
 */
const handleReportDialogClose = () => {
  showReportDialog.value = false;
  reportEventId.value = '';
  reportEventTitle.value = '';
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

/**
 * Returns the visible label text for the Select All checkbox.
 * Changes from "Select All" to "Deselect All" when all events are selected,
 * ensuring state is communicated beyond color alone.
 */
const selectAllVisibleLabel = computed(() => {
  if (!calendarEvents.value || calendarEvents.value.length === 0) {
    return tBulk('select_all');
  }
  const checkboxState = selectAllState(calendarEvents.value);
  return checkboxState.checked ? tBulk('deselect_all') : tBulk('select_all');
});

/**
 * Returns the accessible aria-label for the Select All checkbox.
 * Updates to reflect all three states: none selected, some selected (indeterminate),
 * and all selected, so screen reader users always know the current state.
 */
const selectAllAriaLabel = computed(() => {
  if (!calendarEvents.value || calendarEvents.value.length === 0) {
    return tBulk('select_all_events');
  }
  const checkboxState = selectAllState(calendarEvents.value);
  if (checkboxState.checked) {
    return tBulk('deselect_all_label');
  }
  if (checkboxState.indeterminate) {
    return tBulk('select_all_indeterminate_label');
  }
  return tBulk('select_all_events');
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
              <span v-if="state.calendar">{{ state.calendar.content('en').name || state.calendar.urlName }}</span>
              <span v-else>{{ calendarUrlName }}</span>
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
            :calendar-id="state.calendar?.id"
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
      <section v-if="!state.isLoading && calendarEvents && calendarEvents.length > 0"
               aria-label="Calendar Events"
               :class="{ 'has-bulk-toolbar': hasSelection }">
        <h2 class="sr-only">Events in this Calendar</h2>

        <!-- Select All Controls -->
        <div class="event-controls">
          <label class="select-all-control">
            <input
              type="checkbox"
              :checked="selectAllState(calendarEvents).checked"
              :indeterminate="selectAllState(calendarEvents).indeterminate"
              @change="toggleSelectAll(calendarEvents)"
              :aria-label="selectAllAriaLabel"
            />
            <span>{{ selectAllVisibleLabel }}</span>
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
              @click="handleEditEvent(event, $event)"
              class="event-article"
            >
              <EventImage :media="event.media" size="small" />
              <div class="event-content">
                <div class="event-title-row">
                  <h3 :id="`event-title-${event.id}`">{{ event.content("en").name }}</h3>
                  <span v-if="event.isRepost" class="repost-badge">
                    <span class="sr-only">{{ tFeed('events.repost_badge_prefix') }}</span>{{ tFeed('events.repost_button') }}
                  </span>
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
                <ul v-if="event.categories && event.categories.length > 0" class="event-categories" role="list">
                  <li v-for="category in event.categories"
                      :key="category.id"
                      class="category-badge">
                    {{ category.content('en').name }}
                  </li>
                </ul>
                <div v-if="event.series" class="series-badge-wrapper">
                  <span class="series-badge">
                    <span class="sr-only">{{ t('series_badge_label') }}</span>
                    {{ event.series.content('en')?.name || event.series.urlName }}
                  </span>
                </div>
              </div>
            </article>
            <div class="event-actions">
              <button
                type="button"
                class="edit-btn icon-btn"
                @click.stop="handleEditButtonClick(event, $event)"
                :aria-label="t('event.edit_label', { name: event.content('en').name })"
                title="Edit this event"
              >
                <Pencil :size="18" />
              </button>
              <button
                type="button"
                class="duplicate-btn icon-btn"
                @click.stop="handleDuplicateEvent(event)"
                :aria-label="t('event.duplicate_label', { name: event.content('en').name })"
                :title="t('event.duplicate_label', { name: event.content('en').name })"
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
      :calendar-id="state.calendar?.id"
      @close="handleCategoryDialogClose"
      @assign-complete="handleAssignmentComplete"
    />

    <!-- Delete Confirmation Modal -->
    <ModalLayout
      v-if="showDeleteConfirmModal"
      :title="tBulk('delete_confirm_title')"
      modal-class="delete-events-modal"
      @close="handleDeleteCancel"
    >
      <div class="delete-events-dialog">
        <p class="delete-events-message">
          {{ selectedCount === 1 ? tBulk('delete_confirm_message_one', { count: selectedCount }) : tBulk('delete_confirm_message_other', { count: selectedCount }) }}
        </p>
        <div class="delete-events-actions">
          <PillButton
            variant="ghost"
            @click="handleDeleteCancel"
          >
            {{ tBulk('cancel') }}
          </PillButton>
          <PillButton
            variant="danger"
            @click="handleDeleteConfirm"
          >
            {{ tBulk('delete_confirm_button') }}
          </PillButton>
        </div>
      </div>
    </ModalLayout>

    <!-- Report Event Dialog -->
    <ReportEvent
      v-if="showReportDialog"
      :event-id="reportEventId"
      :event-title="reportEventTitle"
      @close="handleReportDialogClose"
    />

    <!-- Repost Category Edit Modal -->
    <RepostCategoriesModal
      v-if="repostEventForModal"
      :event="repostEventForModal"
      :pre-selected-categories="repostEventForModal.categories.map(c => ({ id: c.id, name: c.content('en').name }))"
      :all-local-categories="(categoryStore.categories[state.calendar?.id] || []).map(c => ({ id: c.id, name: c.content('en').name }))"
      :dialog-title="tFeed('categoryMapping.editDialogTitle')"
      :confirm-label="tFeed('categoryMapping.save')"
      @confirm="handleRepostCategoryUpdate"
      @cancel="handleRepostModalCancel"
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

  &.has-bulk-toolbar {
    // Add clearance so the last event card is not obscured by the fixed bulk toolbar.
    // The toolbar is approximately 4.5rem tall positioned 1rem from the bottom.
    // Using 6rem provides comfortable clearance.
    padding-bottom: 6rem;
  }

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

      &:hover,
      &:focus-within {
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

        .repost-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-purple-100, #f3e8ff);
          border-radius: 9999px; // pill
          color: var(--pav-color-purple-700, #7e22ce);
          font-size: 0.75rem; // text-xs
          font-weight: 500;
          white-space: nowrap;

          @media (prefers-color-scheme: dark) {
            background: rgba(168, 85, 247, 0.2);
            color: var(--pav-color-purple-300, #d8b4fe);
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

      .event-categories {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        margin-top: 0.5rem;
        padding: 0;
        list-style: none;

        .category-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-stone-100);
          border-radius: 9999px; // pill
          color: var(--pav-color-stone-700);
          font-size: 0.75rem; // text-xs
          font-weight: 500;
          white-space: nowrap;

          @media (prefers-color-scheme: dark) {
            background: var(--pav-color-stone-700);
            color: var(--pav-color-stone-200);
          }
        }
      }

      .series-badge-wrapper {
        margin-top: 0.5rem;
      }

      .series-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.5rem;
        background: var(--pav-color-primary-100, #e0f2fe);
        border-radius: 9999px; // pill
        color: var(--pav-color-primary-700, #0369a1);
        font-size: 0.75rem; // text-xs
        font-weight: 500;
        white-space: nowrap;

        @media (prefers-color-scheme: dark) {
          background: var(--pav-color-primary-900, #0c4a6e);
          color: var(--pav-color-primary-200, #bae6fd);
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

// Constrain delete events modal width
:global(.delete-events-modal > div) {
  max-width: 480px !important;
}

.delete-events-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4, 1rem);

  .delete-events-message {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;
    line-height: 1.5;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .delete-events-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding-top: var(--pav-space-4, 1rem);
    border-top: 1px solid var(--pav-color-stone-200);

    @media (prefers-color-scheme: dark) {
      border-top-color: var(--pav-color-stone-700);
    }
  }
}
</style>
