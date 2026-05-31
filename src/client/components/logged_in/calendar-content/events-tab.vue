<script setup lang="ts">
import { reactive, ref, computed, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { Plus, Calendar, Languages, Repeat, Pencil, Copy, Flag, Link2Off, CalendarX } from 'lucide-vue-next';
import { useEventStore } from '@/client/stores/eventStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useCategoryStore } from '@/client/stores/categoryStore';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import { useToast } from '@/client/composables/useToast';
import { useBulkSelection } from '@/client/composables/useBulkSelection';
import EventImage from '@/client/components/common/media/event-image.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import BulkOperationsMenu from '@/client/components/logged_in/calendar/bulk-operations-menu.vue';
import CategorySelectionDialog from '@/client/components/logged_in/calendar/category-selection-dialog.vue';
import SearchFilter from '@/client/components/logged_in/calendar/search-filter.vue';
import ReportEvent from '@/client/components/report-event.vue';
import RepostCategoriesModal from '@/client/components/logged_in/repost-categories-modal.vue';

const props = defineProps({
  calendar: {
    type: Object,
    required: true,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['loadEvents']);

const { t } = useTranslation('calendars', {
  keyPrefix: 'calendar',
});

const { t: tBulk } = useTranslation('calendars', {
  keyPrefix: 'bulk_operations',
});

const { t: tReport } = useTranslation('system', {
  keyPrefix: 'report',
});

const { t: tFeed } = useTranslation('feed');

const { t: tCancellations } = useTranslation('event_editor', {
  keyPrefix: 'cancellations',
});

const eventService = new EventService();
const calendarStore = useCalendarStore();
const categoryStore = useCategoryStore();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const store = useEventStore();
const calendarService = new CalendarService();

// Computed property to get events for the current calendar
const calendarEvents = computed(() => store.eventsForCalendar(props.calendar?.id));

/**
 * Resolves the effective image for an event.
 * Falls back to the calendar's default event image for locally-owned events.
 * Reposted events do NOT get the local calendar's default image.
 */
const resolveEventImage = (event: any) => {
  if (event.media) {
    return event.media;
  }
  if (event.isRepost) {
    return null;
  }
  return props.calendar?.defaultEventImage ?? null;
};

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
const repostModalTriggerEl = ref(null);

// Delete confirmation modal state
const showDeleteConfirmModal = ref(false);
const deleteModalTriggerEl = ref(null);

// Unpost confirmation modal state
const showUnpostConfirmModal = ref(false);
const unpostTargetEvent = ref<any>(null);
const unpostModalTriggerEl = ref<HTMLElement | null>(null);

/**
 * Initializes filter state from URL query parameters.
 */
const initializeFiltersFromURL = () => {
  const searchParam = route.query.search;
  const categoriesParam = route.query.categories;

  initialFilters.search = typeof searchParam === 'string' ? searchParam : '';
  initialFilters.categories = categoriesParam
    ? (typeof categoriesParam === 'string' ? categoriesParam.split(',') : [])
    : [];

  Object.assign(currentFilters, {
    search: initialFilters.search,
    categories: [...initialFilters.categories],
  });
};

/**
 * Synchronizes current filter state to URL query parameters.
 */
const syncFiltersToURL = () => {
  const query = { ...route.query };

  if (currentFilters.search && currentFilters.search.trim() !== '') {
    query.search = currentFilters.search.trim();
  }
  else {
    delete query.search;
  }

  if (currentFilters.categories && currentFilters.categories.length > 0) {
    query.categories = currentFilters.categories.join(',');
  }
  else {
    delete query.categories;
  }

  router.replace({
    name: route.name,
    params: route.params,
    query,
  });
};

/**
 * Handles filter changes from SearchFilter component.
 */
const handleFiltersChanged = async (filters) => {
  Object.assign(currentFilters, {
    search: filters.search || '',
    categories: filters.categories || [],
  });

  syncFiltersToURL();

  emit('loadEvents', filters);
};

/**
 * Navigate to new event creation for this calendar.
 */
const newEvent = async () => {
  if (props.calendar) {
    calendarStore.setSelectedCalendar(props.calendar.id);
    router.push({ name: 'event_new' });
  }
};

/**
 * Navigate to or open the editor for an event.
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
 */
const handleEditButtonClick = (event, domEvent) => {
  navigateToEditEvent(event, domEvent);
};

/**
 * Handle category save from the repost edit modal.
 */
const handleRepostCategoryUpdate = async (categoryIds) => {
  if (!repostEventForModal.value) return;

  try {
    const updatedEvent = await calendarService.replaceEventCategories(
      repostEventForModal.value.id,
      categoryIds,
      props.calendar?.id,
    );
    store.updateEvent(props.calendar?.id, updatedEvent);
  }
  catch (error) {
    console.error('Error updating repost event categories:', error);
    toast.error(tFeed('errors.UnknownError'));
  }

  repostEventForModal.value = null;
  await nextTick();
  repostModalTriggerEl.value?.focus();
};

/**
 * Handle cancel from the repost edit modal.
 */
const handleRepostModalCancel = async () => {
  repostEventForModal.value = null;
  await nextTick();
  repostModalTriggerEl.value?.focus();
};

// Category selection dialog state
const showCategoryDialog = ref(false);

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
  toast.success(tBulk('delete_success', { count: result.eventCount }));
  deselectAll();
};

/**
 * Opens the delete confirmation modal.
 */
const handleDeleteEvents = (event) => {
  if (!selectedEvents.value.length) return;
  deleteModalTriggerEl.value = (event?.currentTarget ?? null);
  showDeleteConfirmModal.value = true;
};

/**
 * Cancels the delete operation and closes the confirmation modal.
 */
const handleDeleteCancel = async () => {
  showDeleteConfirmModal.value = false;
  await nextTick();
  deleteModalTriggerEl.value?.focus();
};

/**
 * Executes the bulk delete after the user confirms in the modal.
 */
const handleDeleteConfirm = async () => {
  showDeleteConfirmModal.value = false;
  await nextTick();
  deleteModalTriggerEl.value?.focus();

  const deleteCount = selectedEvents.value.length;
  try {
    const eventsToDelete = getSelectedEventObjects(calendarEvents.value || []);

    for (const event of eventsToDelete) {
      await eventService.deleteEvent(event);
    }

    emit('loadEvents', currentFilters);
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

/**
 * Opens the unpost confirmation modal for a reposted event.
 */
const handleUnpostButtonClick = (event: any, domEvent: MouseEvent) => {
  unpostModalTriggerEl.value = (domEvent?.currentTarget as HTMLElement) ?? null;
  unpostTargetEvent.value = event;
  showUnpostConfirmModal.value = true;
};

/**
 * Cancels the unpost operation and closes the confirmation modal.
 */
const handleUnpostCancel = async () => {
  showUnpostConfirmModal.value = false;
  unpostTargetEvent.value = null;
  await nextTick();
  unpostModalTriggerEl.value?.focus();
};

/**
 * Executes the unpost after the user confirms in the modal.
 *
 * Uses eventService.unshareReposted (not feedService.unshareEvent directly) so
 * this calendar-management surface depends only on EventService. The wrapper
 * hits the same DELETE /api/v1/social/shares endpoint and also handles store
 * removal, keeping the component free of feed-domain imports.
 *
 * This surface confirms-then-mutates (removes the event from the list on
 * success). The feed view uses an optimistic-with-rollback pattern instead,
 * which is intentional: the calendar list is a management surface where a
 * destructive-feeling remove makes sense, while the feed is a browsing surface
 * where the row should remain visible.
 */
const handleUnpostConfirm = async () => {
  const targetEvent = unpostTargetEvent.value;
  showUnpostConfirmModal.value = false;

  if (!targetEvent || !props.calendar?.id) {
    unpostTargetEvent.value = null;
    await nextTick();
    unpostModalTriggerEl.value?.focus();
    return;
  }

  try {
    await eventService.unshareReposted(props.calendar.id, targetEvent);
    toast.success(t('event.unpost_success_toast'));
  }
  catch (error) {
    console.error('Error unposting reposted event:', error);
    toast.error(t('event.unpost_error_toast'));
  }
  finally {
    unpostTargetEvent.value = null;
    await nextTick();
    unpostModalTriggerEl.value?.focus();
  }
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

  const labels = {
    daily: t('recurrence_daily'),
    weekly: t('recurrence_weekly'),
    monthly: t('recurrence_monthly'),
    yearly: t('recurrence_yearly'),
  };

  return labels[frequency] || t('recurrence_generic');
};

// Check if any filters are currently active
const hasActiveFilters = computed(() => {
  return !!(currentFilters.search?.trim() || currentFilters.categories?.length > 0);
});

const selectAllVisibleLabel = computed(() => {
  if (!calendarEvents.value || calendarEvents.value.length === 0) {
    return tBulk('select_all');
  }
  const checkboxState = selectAllState(calendarEvents.value);
  return checkboxState.checked ? tBulk('deselect_all') : tBulk('select_all');
});

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

// Initialize filters from URL on mount
initializeFiltersFromURL();
</script>

<template>
  <div>
    <!-- Loading State -->
    <div
      v-if="isLoading"
      class="loading-state"
      role="status"
      aria-live="polite"
    >
      {{ t('loading_events') }}
    </div>

    <!-- Search and Filter Controls — kept outside the loading-gated section so the
         component is not destroyed and re-mounted on each filter change, which would
         cause it to lose its internal search state. -->
    <SearchFilter
      v-if="calendar && (calendarEvents && calendarEvents.length > 0 || hasActiveFilters)"
      :calendar-id="calendar?.id"
      :initial-filters="initialFilters"
      @filters-changed="handleFiltersChanged"
    />

    <!-- Events Display Section -->
    <section v-if="!isLoading && calendarEvents && calendarEvents.length > 0"
             :aria-label="t('events_section_label')"
             :class="{ 'events-section': true, 'has-bulk-toolbar': hasSelection }">
      <div class="tab-header">
        <h2 class="events-title">{{ t('events_heading') }}</h2>
        <PillButton
          variant="primary"
          @click="newEvent"
          :aria-label="t('createEvent')" >
          <Plus :size="20" :stroke-width="2" />
          {{ t('createEvent') }}
        </PillButton>
      </div>

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
              :aria-label="t('event.select_label', { name: event.content('en').name })"
            />
          </div>
          <article
            :aria-labelledby="`event-title-${event.id}`"
            @click="handleEditEvent(event, $event)"
            class="event-article"
          >
            <EventImage :media="resolveEventImage(event)" size="small" />
            <div class="event-content">
              <div class="event-title-row">
                <h3 :id="`event-title-${event.id}`">{{ event.content("en").name }}</h3>
                <span
                  v-if="event.isCancelled"
                  data-testid="event-cancelled-pill"
                  class="cancelled-pill"
                >
                  <CalendarX :size="14" aria-hidden="true" />
                  {{ tCancellations('cancelled_badge') }}
                </span>
                <span v-if="event.isRepost" class="repost-badge">
                  <span class="sr-only">{{ tFeed('events.repost_badge_prefix') }}</span>{{ tFeed('events.repost_button') }}
                </span>
                <span v-if="event.languages && event.languages.length > 1" class="language-count">
                  <Languages :size="16" aria-hidden="true" />
                  {{ t('language_count', { count: event.languages.length }) }}
                </span>
              </div>
              <div v-if="formatEventDate(event)" class="event-date">
                <Calendar :size="16" class="date-icon" aria-hidden="true" />
                <span class="date-text">{{ formatEventDate(event) }}</span>
                <span v-if="isRecurring(event)" class="recurrence-badge">
                  <Repeat :size="14" aria-hidden="true" />
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
              class="edit-btn btn btn--icon btn--subtle"
              @click.stop="handleEditButtonClick(event, $event)"
              :aria-label="t('event.edit_label', { name: event.content('en').name })"
              :title="t('event.edit_title')"
            >
              <Pencil :size="18" />
            </button>
            <button
              type="button"
              class="duplicate-btn btn btn--icon btn--subtle"
              @click.stop="handleDuplicateEvent(event)"
              :aria-label="t('event.duplicate_label', { name: event.content('en').name })"
              :title="t('event.duplicate_label', { name: event.content('en').name })"
            >
              <Copy :size="18" />
            </button>
            <button
              v-if="event.isRepost"
              type="button"
              class="unpost-btn btn btn--icon btn--subtle"
              @click.stop="handleUnpostButtonClick(event, $event)"
              :aria-label="t('event.unpost_aria_label', { name: event.content('en').name })"
              :title="t('event.unpost_button_label')"
            >
              <Link2Off :size="18" />
            </button>
            <button
              type="button"
              class="report-btn btn btn--icon btn--subtle"
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
    <EmptyLayout v-else-if="!isLoading && hasActiveFilters && (!calendarEvents || calendarEvents.length === 0)"
                 :title="t('no_events_filtered_title')"
                 :description="t('no_events_filtered_description')" />

    <!-- Empty State: No events at all -->
    <EmptyLayout v-else-if="!isLoading && !hasActiveFilters && (!calendarEvents || calendarEvents.length === 0)"
                 :title="t('noEvents')"
                 :description="t('noEventsDescription')"
                 :guide="{ slug: 'guides/calendar-owners/quickstart', key: 'quickstart' }"
                 :guide-label="t('guide_link')">
      <button type="button" class="btn btn--cta btn--lg" @click="newEvent()">
        <Plus :size="20" :stroke-width="2" />
        {{ t('createEvent') }}
      </button>
    </EmptyLayout>

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
      :calendar-id="calendar?.id"
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

    <!-- Unpost Confirmation Modal -->
    <ModalLayout
      v-if="showUnpostConfirmModal"
      :title="t('event.unpost_confirm_title')"
      modal-class="unpost-event-modal"
      @close="handleUnpostCancel"
    >
      <div class="unpost-event-dialog">
        <p class="unpost-event-message">
          {{ t('event.unpost_confirm_body') }}
        </p>
        <div class="unpost-event-actions">
          <PillButton
            variant="ghost"
            @click="handleUnpostCancel"
          >
            {{ t('event.unpost_cancel') }}
          </PillButton>
          <PillButton
            variant="danger"
            @click="handleUnpostConfirm"
          >
            {{ t('event.unpost_confirm_action') }}
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
      :all-local-categories="(categoryStore.categories[calendar?.id] || []).map(c => ({ id: c.id, name: c.content('en').name }))"
      :dialog-title="tFeed('categoryMapping.editDialogTitle')"
      :confirm-label="tFeed('categoryMapping.save')"
      @confirm="handleRepostCategoryUpdate"
      @cancel="handleRepostModalCancel"
    />
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

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

.loading-state {
  max-width: 56rem;
  margin: 2rem auto;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--pav-text-secondary);
  font-style: italic;
  font-size: 1.125rem;
}

.events-title {
  @include admin-section-title;
  font-size: 1.5rem;
}

/* Events section with new design system */
.events-section {
  padding: 1.5rem 0;

  &.has-bulk-toolbar {
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
      color: var(--pav-text-secondary);

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
      border-radius: 0.75rem;
      border: 1px solid var(--pav-border-subtle);
      background: var(--pav-surface-primary);
      padding: 1rem;
      transition: all 0.15s ease;

      &:hover {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      display: flex;
      align-items: flex-start;
      gap: 1rem;

      &:hover,
      &:focus-within {
        .event-actions {
          opacity: 1;
          transition: opacity 0.2s ease;
        }
      }

      &.selected {
        border-color: var(--pav-color-orange-400);
        background: var(--pav-color-orange-50);
        box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);

        [data-theme="dark"] & {
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
        min-width: 0;
      }

      .event-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        opacity: 0;
        transition: opacity 0.2s ease;

        @media (max-width: 768px) {
          opacity: 1;
        }
      }

      @media (max-width: 599px) {
        display: grid;
        grid-template-columns: auto 1fr;
        grid-template-areas:
          'checkbox article'
          '. actions';
        gap: 0.5rem 0.75rem;

        .event-checkbox {
          grid-area: checkbox;
          padding-top: 0.125rem;
        }

        .event-article {
          grid-area: article;
        }

        .event-actions {
          grid-area: actions;
          justify-self: end;
        }
      }
    }

    .event-content {
      flex: 1;
      min-width: 0;

      .event-title-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;

        h3 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--pav-text-primary);
        }

        .repost-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-purple-100, #f3e8ff);
          border-radius: 9999px;
          color: var(--pav-color-purple-700, #7e22ce);
          font-size: 0.75rem;
          font-weight: 500;
          white-space: nowrap;

          [data-theme="dark"] & {
            background: rgba(168, 85, 247, 0.2);
            color: var(--pav-color-purple-300, #d8b4fe);
          }
        }

        .cancelled-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-red-100, #fee2e2);
          border-radius: 9999px;
          color: var(--pav-color-red-700, #b91c1c);
          font-size: 0.75rem;
          font-weight: 500;
          white-space: nowrap;

          [data-theme="dark"] & {
            background: rgba(239, 68, 68, 0.2);
            color: var(--pav-color-red-300, #fca5a5);
          }
        }

        .language-count {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-sky-100);
          border-radius: 9999px;
          color: var(--pav-color-sky-700);
          font-size: 0.75rem;
          font-weight: 500;
          white-space: nowrap;

          [data-theme="dark"] & {
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
        font-size: 0.875rem;

        .date-icon {
          color: var(--pav-color-orange-500);
          flex-shrink: 0;
        }

        .date-text {
          color: var(--pav-text-secondary);
          font-weight: 500;
        }

        .recurrence-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.5rem;
          background: var(--pav-color-sky-100);
          border-radius: 9999px;
          color: var(--pav-color-sky-700);
          font-size: 0.75rem;
          font-weight: 500;

          [data-theme="dark"] & {
            background: rgba(14, 165, 233, 0.2);
            color: var(--pav-color-sky-300);
          }
        }
      }

      .event-description {
        margin: 0;
        color: var(--pav-text-secondary);
        font-size: 0.875rem;
        line-height: 1.5;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
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
          background: var(--pav-interactive-hover);
          border-radius: 9999px;
          color: var(--pav-text-secondary);
          font-size: 0.75rem;
          font-weight: 500;
          white-space: nowrap;
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
        border-radius: 9999px;
        color: var(--pav-color-primary-700, #0369a1);
        font-size: 0.75rem;
        font-weight: 500;
        white-space: nowrap;

        [data-theme="dark"] & {
          background: var(--pav-color-primary-900, #0c4a6e);
          color: var(--pav-color-primary-200, #bae6fd);
        }
      }
    }
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
    color: var(--pav-text-secondary);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .delete-events-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding-top: var(--pav-space-4, 1rem);
    border-top: 1px solid var(--pav-border-subtle);
  }
}

// Constrain unpost event modal width
:global(.unpost-event-modal > div) {
  max-width: 480px !important;
}

.unpost-event-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4, 1rem);

  .unpost-event-message {
    margin: 0;
    color: var(--pav-text-secondary);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .unpost-event-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding-top: var(--pav-space-4, 1rem);
    border-top: 1px solid var(--pav-border-subtle);
  }
}
</style>
