<script setup lang="ts">
/**
 * Reports Dashboard Component
 *
 * Displays a filterable, sortable, and paginated list of reports
 * filed against events in a calendar. Calendar owners and authorized
 * editors use this to review and manage moderation reports.
 */
import { reactive, onMounted, computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import { ReportStatus, ReportCategory } from '@/common/model/report';
import type { ReportFilters } from '@/client/service/moderation';
import { useReportFormatting } from '@/client/composables/useReportFormatting';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const props = defineProps<{
  calendarId: string;
}>();

const emit = defineEmits<{
  (e: 'view-report', reportId: string): void;
}>();

const { t } = useTranslation('system', {
  keyPrefix: 'moderation',
});

const store = useModerationStore();
const { statusBadgeClass, statusLabel, categoryLabel, reporterTypeLabel, formatDate } = useReportFormatting();

const filters = reactive({
  status: '' as string,
  category: '' as string,
  sortBy: 'created_at' as ReportFilters['sortBy'],
  sortOrder: 'DESC' as ReportFilters['sortOrder'],
});

/**
 * Status options for the filter dropdown.
 */
const statusOptions = computed(() => [
  { value: '', label: t('dashboard.all_statuses') },
  { value: ReportStatus.SUBMITTED, label: t('status.submitted') },
  { value: ReportStatus.UNDER_REVIEW, label: t('status.under_review') },
  { value: ReportStatus.RESOLVED, label: t('status.resolved') },
  { value: ReportStatus.DISMISSED, label: t('status.dismissed') },
  { value: ReportStatus.ESCALATED, label: t('status.escalated') },
]);

/**
 * Category options for the filter dropdown.
 */
const categoryOptions = computed(() => [
  { value: '', label: t('dashboard.all_categories') },
  { value: ReportCategory.SPAM, label: t('category.spam') },
  { value: ReportCategory.INAPPROPRIATE, label: t('category.inappropriate') },
  { value: ReportCategory.MISLEADING, label: t('category.misleading') },
  { value: ReportCategory.HARASSMENT, label: t('category.harassment') },
  { value: ReportCategory.OTHER, label: t('category.other') },
]);

/**
 * Applies filters and fetches reports from the store.
 */
const applyFilters = async () => {
  const reportFilters: ReportFilters = {
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  };

  if (filters.status) {
    reportFilters.status = filters.status as ReportStatus;
  }
  if (filters.category) {
    reportFilters.category = filters.category as ReportCategory;
  }

  await store.setFilters(reportFilters, props.calendarId);
};

/**
 * Navigates to a specific page of results.
 *
 * @param page - The page number to navigate to
 */
const goToPage = async (page: number) => {
  await store.setPage(page, props.calendarId);
};

/**
 * Handles clicking on a report row to view its details.
 *
 * @param reportId - The ID of the report to view
 */
const viewReport = (reportId: string) => {
  emit('view-report', reportId);
};

/**
 * Whether the previous page button should be enabled.
 */
const hasPreviousPage = computed(() => store.pagination.currentPage > 1);

/**
 * Whether the next page button should be enabled.
 */
const hasNextPage = computed(() => store.pagination.currentPage < store.pagination.totalPages);

// Watch for filter changes and apply them
watch(
  () => [filters.status, filters.category, filters.sortBy, filters.sortOrder],
  () => {
    applyFilters();
  },
);

onMounted(async () => {
  store.reset();
  await applyFilters();
});
</script>

<template>
  <div class="reports-dashboard">
    <!-- Header -->
    <header class="reports-dashboard__header">
      <h2 class="reports-dashboard__title">{{ t('dashboard.title') }}</h2>
    </header>

    <!-- Filters -->
    <div class="reports-dashboard__filters" role="search" :aria-label="t('dashboard.title')">
      <div class="reports-dashboard__filter-group">
        <label
          for="filter-status"
          class="reports-dashboard__filter-label"
        >
          {{ t('dashboard.filter_status') }}
        </label>
        <select
          id="filter-status"
          v-model="filters.status"
          class="reports-dashboard__select"
        >
          <option
            v-for="option in statusOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>

      <div class="reports-dashboard__filter-group">
        <label
          for="filter-category"
          class="reports-dashboard__filter-label"
        >
          {{ t('dashboard.filter_category') }}
        </label>
        <select
          id="filter-category"
          v-model="filters.category"
          class="reports-dashboard__select"
        >
          <option
            v-for="option in categoryOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>

      <div class="reports-dashboard__filter-group">
        <label
          for="sort-by"
          class="reports-dashboard__filter-label"
        >
          {{ t('dashboard.sort_by') }}
        </label>
        <select
          id="sort-by"
          v-model="filters.sortBy"
          class="reports-dashboard__select"
        >
          <option value="created_at">{{ t('dashboard.sort_date') }}</option>
          <option value="status">{{ t('dashboard.sort_status') }}</option>
          <option value="category">{{ t('dashboard.filter_category') }}</option>
        </select>
      </div>
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="store.loading" :description="t('dashboard.loading')" />

    <!-- Error State -->
    <div v-else-if="store.error" class="reports-dashboard__error" role="alert">
      {{ t('dashboard.error_loading') }}
    </div>

    <!-- Empty State -->
    <EmptyLayout
      v-else-if="!store.hasReports"
      :title="t('dashboard.empty')"
      :description="t('dashboard.empty_description')"
    />

    <!-- Reports Table -->
    <div v-else class="reports-dashboard__table-container">
      <table class="reports-dashboard__table" role="grid" :aria-label="t('dashboard.table_label')">
        <thead>
          <tr>
            <th scope="col">{{ t('dashboard.column_event') }}</th>
            <th scope="col">{{ t('dashboard.column_category') }}</th>
            <th scope="col">{{ t('dashboard.column_reporter') }}</th>
            <th scope="col">{{ t('dashboard.column_status') }}</th>
            <th scope="col">{{ t('dashboard.column_date') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="report in store.reports"
            :key="report.id"
            class="reports-dashboard__row"
            tabindex="0"
            role="row"
            @click="viewReport(report.id)"
            @keydown.enter="viewReport(report.id)"
            @keydown.space.prevent="viewReport(report.id)"
          >
            <td>
              <span class="reports-dashboard__event-id">{{ report.eventId.substring(0, 8) }}...</span>
            </td>
            <td>{{ categoryLabel(report.category) }}</td>
            <td>{{ reporterTypeLabel(report.reporterType) }}</td>
            <td>
              <span
                class="status-badge"
                :class="statusBadgeClass(report.status)"
              >
                {{ statusLabel(report.status) }}
              </span>
            </td>
            <td>{{ formatDate(report.createdAt) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <nav
        v-if="store.pagination.totalPages > 1"
        class="reports-dashboard__pagination"
        :aria-label="t('dashboard.pagination_label')"
      >
        <button
          type="button"
          class="reports-dashboard__page-btn"
          :disabled="!hasPreviousPage"
          :aria-label="t('dashboard.previous_page')"
          @click="goToPage(store.pagination.currentPage - 1)"
        >
          &laquo;
        </button>
        <span class="reports-dashboard__page-info">
          {{ t('dashboard.page_info', { current: store.pagination.currentPage, total: store.pagination.totalPages }) }}
        </span>
        <button
          type="button"
          class="reports-dashboard__page-btn"
          :disabled="!hasNextPage"
          :aria-label="t('dashboard.next_page')"
          @click="goToPage(store.pagination.currentPage + 1)"
        >
          &raquo;
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/components/calendar-admin' as *;

.reports-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  &__header {
    @include admin-section-header;
  }

  &__title {
    @include admin-section-title;
  }

  &__filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pav-space-4);
    align-items: flex-end;
  }

  &__filter-group {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-1);
    min-width: 10rem;
    flex: 1;
    max-width: 14rem;
  }

  &__filter-label {
    font-size: var(--pav-font-size-caption);
    font-weight: var(--pav-font-weight-medium);
    text-transform: uppercase;
    letter-spacing: var(--pav-letter-spacing-wider);
    color: var(--pav-color-stone-500);
  }

  &__select {
    @include admin-form-input;
    appearance: auto;
    cursor: pointer;
    padding: var(--pav-space-2) var(--pav-space-3);
    font-size: var(--pav-font-size-small);
  }

  &__error {
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    font-size: var(--pav-font-size-small);
    background-color: var(--pav-color-red-50);
    border: 1px solid var(--pav-color-red-200);
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      background-color: oklch(0.637 0.237 25.331 / 0.1);
      border-color: oklch(0.637 0.237 25.331 / 0.2);
      color: var(--pav-color-red-400);
    }
  }

  &__table-container {
    overflow-x: auto;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;

    thead {
      th {
        padding: var(--pav-space-3) var(--pav-space-4);
        text-align: start;
        font-size: var(--pav-font-size-caption);
        font-weight: var(--pav-font-weight-medium);
        text-transform: uppercase;
        letter-spacing: var(--pav-letter-spacing-wider);
        color: var(--pav-color-stone-500);
        border-bottom: 1px solid var(--pav-border-primary);
        white-space: nowrap;
      }
    }

    tbody {
      td {
        padding: var(--pav-space-3) var(--pav-space-4);
        font-size: var(--pav-font-size-small);
        color: var(--pav-text-primary);
        border-bottom: 1px solid var(--pav-border-primary);
        vertical-align: middle;
      }
    }
  }

  &__row {
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--pav-color-stone-50);

      @media (prefers-color-scheme: dark) {
        background-color: var(--pav-color-stone-800);
      }
    }

    &:focus {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: -2px;
      border-radius: 0.25rem;
    }
  }

  &__event-id {
    font-family: var(--pav-font-family-mono);
    font-size: var(--pav-font-size-caption);
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pav-space-4);
    padding: var(--pav-space-4) 0;
  }

  &__page-btn {
    background: none;
    border: 1px solid var(--pav-border-primary);
    border-radius: 0.375rem;
    padding: var(--pav-space-2) var(--pav-space-3);
    color: var(--pav-text-primary);
    cursor: pointer;
    font-size: var(--pav-font-size-small);
    transition: background-color 0.15s ease;

    &:hover:not(:disabled) {
      background-color: var(--pav-color-stone-50);

      @media (prefers-color-scheme: dark) {
        background-color: var(--pav-color-stone-800);
      }
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
    }
  }

  &__page-info {
    font-size: var(--pav-font-size-small);
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

// Status badge styles (shared mixin from calendar-admin)
.status-badge {
  @include report-status-badge;

  &--submitted {
    @include report-status-badge--submitted;
  }

  &--under-review {
    @include report-status-badge--under-review;
  }

  &--resolved {
    @include report-status-badge--resolved;
  }

  &--dismissed {
    @include report-status-badge--dismissed;
  }

  &--escalated {
    @include report-status-badge--escalated;
  }
}

// Responsive adjustments
@media (max-width: 640px) {
  .reports-dashboard {
    &__filters {
      flex-direction: column;
    }

    &__filter-group {
      max-width: none;
    }

    &__table {
      thead th,
      tbody td {
        padding: var(--pav-space-2) var(--pav-space-3);
        font-size: var(--pav-font-size-caption);
      }
    }
  }
}
</style>
