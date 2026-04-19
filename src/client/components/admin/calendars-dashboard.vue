<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';

import { useCalendarAdminStore } from '@/client/stores/calendarAdminStore';
import type { AdminCalendarRow } from '@/client/service/admin-calendar';
import LoadingMessage from '@/client/components/common/loading_message.vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'calendars',
});

const router = useRouter();
const store = useCalendarAdminStore();

interface LocalFilterState {
  search: string;
}

const state = reactive<LocalFilterState>({
  search: store.filters.search,
});

const searchTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

onMounted(() => {
  store.loadCalendars();
});

/**
 * Handles search input with a 300ms debounce to avoid flooding the API.
 */
function onSearchInput() {
  if (searchTimeout.value) {
    clearTimeout(searchTimeout.value);
  }
  searchTimeout.value = setTimeout(() => {
    store.setFilter('search', state.search);
  }, 300);
}

/**
 * Toggles the "open reports only" filter via the store.
 */
function onHasOpenReportsChange(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  store.setFilter('hasOpenReports', checked);
}

/**
 * Updates the sort column via the store.
 */
function onSortByChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as
    | 'created'
    | 'lastActivity'
    | 'eventCount';
  store.setFilter('sortBy', value);
}

/**
 * Updates the sort direction via the store.
 */
function onSortDirChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as 'asc' | 'desc';
  store.setFilter('sortDir', value);
}

function onResetFilters() {
  state.search = '';
  store.$patch((s) => {
    s.filters.search = '';
    s.filters.hasOpenReports = false;
    s.filters.sortBy = 'lastActivity';
    s.filters.sortDir = 'desc';
    s.page = 1;
  });
  store.loadCalendars();
}

function changePage(page: number) {
  store.setPage(page);
}

/**
 * Formats an ISO date string for display, falling back to an em dash when null.
 */
function formatLastActivity(value: string | null): string {
  if (!value) return t('never');
  const dt = DateTime.fromISO(value);
  if (!dt.isValid) return t('never');
  return dt.toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Maps a funding status to its BEM badge variant class.
 */
function fundingBadgeClass(status: AdminCalendarRow['fundingStatus']): string {
  switch (status) {
    case 'subscribed':
      return 'badge badge--success';
    case 'grant':
      return 'badge badge--info';
    case 'none':
    default:
      return 'badge';
  }
}

function fundingStatusLabel(status: AdminCalendarRow['fundingStatus']): string {
  switch (status) {
    case 'subscribed':
      return t('funding_status_subscribed');
    case 'grant':
      return t('funding_status_grant');
    case 'none':
    default:
      return t('funding_status_none');
  }
}

/**
 * Navigates to the moderation dashboard filtered to this calendar.
 */
function viewOpenReports(calendarId: string) {
  router.push({
    path: '/admin/moderation',
    query: { calendar_id: calendarId },
  });
}

const hasActiveFilters = computed(() => {
  return (
    store.filters.search !== ''
    || store.filters.hasOpenReports
    || store.filters.sortBy !== 'lastActivity'
    || store.filters.sortDir !== 'desc'
  );
});
</script>

<template>
  <div class="calendars-dashboard">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-text">
        <h1>{{ t('page_title') }}</h1>
        <p class="page-subtitle">{{ t('page_subtitle') }}</p>
      </div>
    </div>

    <!-- Filters Section -->
    <section class="filters-section" :aria-label="t('filters_section_aria_label')">
      <div class="filters-grid">
        <div class="filter-group">
          <label for="scope-filter" class="filter-label">
            {{ t('scope_filter_label') }}
            <span class="filter-label-hint">{{ t('scope_remote_coming_soon') }}</span>
          </label>
          <select
            id="scope-filter"
            class="filter-select"
            disabled
            aria-disabled="true"
          >
            <option value="local">{{ t('scope_local') }}</option>
            <option value="remote" disabled>{{ t('scope_remote_coming_soon') }}</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="search-filter" class="filter-label">
            {{ t('search_label') }}
          </label>
          <input
            id="search-filter"
            v-model="state.search"
            class="filter-input"
            type="search"
            :placeholder="t('search_placeholder')"
            @input="onSearchInput"
          />
        </div>

        <div class="filter-group">
          <label for="sort-by-filter" class="filter-label">
            {{ t('sort_by_label') }}
          </label>
          <select
            id="sort-by-filter"
            :value="store.filters.sortBy"
            class="filter-select"
            @change="onSortByChange"
          >
            <option value="created">{{ t('sort_by_created') }}</option>
            <option value="lastActivity">{{ t('sort_by_last_activity') }}</option>
            <option value="eventCount">{{ t('sort_by_event_count') }}</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="sort-dir-filter" class="filter-label">
            {{ t('sort_dir_label') }}
          </label>
          <select
            id="sort-dir-filter"
            :value="store.filters.sortDir"
            class="filter-select"
            @change="onSortDirChange"
          >
            <option value="asc">{{ t('sort_dir_asc') }}</option>
            <option value="desc">{{ t('sort_dir_desc') }}</option>
          </select>
        </div>

        <div class="filter-group filter-group--checkbox">
          <label class="filter-checkbox-label">
            <input
              type="checkbox"
              :checked="store.filters.hasOpenReports"
              @change="onHasOpenReportsChange"
            />
            <span>{{ t('has_open_reports_label') }}</span>
          </label>
        </div>
      </div>

      <button
        v-if="hasActiveFilters"
        type="button"
        class="reset-filters-button"
        @click="onResetFilters"
      >
        {{ t('reset_filters') }}
      </button>
    </section>

    <!-- Loading -->
    <LoadingMessage
      v-if="store.loading"
      :description="t('loading')"
    />

    <!-- Error -->
    <div v-else-if="store.error" class="error-message" role="alert">
      <p>{{ t('error') }}: {{ store.error }}</p>
    </div>

    <!-- Content -->
    <div v-else class="calendars-content">
      <div v-if="store.items.length === 0" class="empty-state">
        <p>{{ t('no_calendars') }}</p>
        <p class="empty-state-description">{{ t('no_calendars_description') }}</p>
      </div>

      <div v-else class="calendars-card">
        <table class="calendars-table" role="table" :aria-label="t('table_aria_label')">
          <thead>
            <tr>
              <th scope="col">{{ t('column_calendar') }}</th>
              <th scope="col">{{ t('column_owner') }}</th>
              <th scope="col">{{ t('column_event_count') }}</th>
              <th scope="col">{{ t('column_last_activity') }}</th>
              <th scope="col">{{ t('column_funding_status') }}</th>
              <th scope="col">{{ t('column_open_reports') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="calendar in store.items"
              :key="calendar.id"
              class="calendar-row"
              data-testid="calendar-row"
            >
              <td class="cell-calendar">
                <div class="calendar-title">{{ calendar.title }}</div>
                <div class="calendar-url">{{ calendar.urlName }}</div>
              </td>
              <td class="cell-owner">
                {{ calendar.owner.displayName }}
              </td>
              <td class="cell-event-count">
                {{ calendar.upcomingEventCount }}
              </td>
              <td class="cell-last-activity">
                {{ formatLastActivity(calendar.lastActivityAt) }}
              </td>
              <td class="cell-funding">
                <span :class="fundingBadgeClass(calendar.fundingStatus)">
                  {{ fundingStatusLabel(calendar.fundingStatus) }}
                </span>
              </td>
              <td class="cell-open-reports">
                <button
                  v-if="calendar.openReportCount > 0"
                  type="button"
                  class="open-reports-button"
                  :aria-label="t('open_reports_aria', { count: calendar.openReportCount })"
                  data-testid="open-reports-badge"
                  @click="viewOpenReports(calendar.id)"
                >
                  <span class="badge badge--notification">
                    {{ calendar.openReportCount }}
                  </span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <nav
        v-if="store.pagination.totalPages > 1"
        class="pagination"
        :aria-label="t('pagination_aria_label')"
      >
        <button
          type="button"
          class="pagination-button"
          :disabled="store.pagination.currentPage === 1"
          :aria-disabled="store.pagination.currentPage === 1"
          @click="changePage(store.pagination.currentPage - 1)"
        >
          {{ t('pagination_previous') }}
        </button>
        <span class="pagination-info">
          {{ t('pagination_page_info', {
            current: store.pagination.currentPage,
            total: store.pagination.totalPages,
          }) }}
        </span>
        <button
          type="button"
          class="pagination-button"
          :disabled="store.pagination.currentPage >= store.pagination.totalPages"
          :aria-disabled="store.pagination.currentPage >= store.pagination.totalPages"
          @click="changePage(store.pagination.currentPage + 1)"
        >
          {{ t('pagination_next') }}
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.calendars-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);

    @include pav-media(md) {
      flex-direction: row;
      align-items: flex-start;
      justify-content: space-between;
    }

    .page-header-text {
      h1 {
        margin: 0 0 var(--pav-space-1) 0;
        font-size: var(--pav-font-size-2xl);
        font-weight: var(--pav-font-weight-light);
        color: var(--pav-text-primary);
      }

      .page-subtitle {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-text-muted);
      }
    }
  }

  .filters-section {
    background: var(--pav-surface-card);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-primary);
    padding: var(--pav-space-4);

    @include pav-media(md) {
      padding: var(--pav-space-6);
    }

    .filters-grid {
      display: grid;
      gap: var(--pav-space-4);
      grid-template-columns: 1fr;

      @include pav-media(sm) {
        grid-template-columns: repeat(2, 1fr);
      }

      @include pav-media(md) {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-2);

      &--checkbox {
        justify-content: flex-end;
      }

      .filter-label {
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-text-secondary);
      }

      .filter-label-hint {
        margin-inline-start: var(--pav-space-2);
        font-weight: var(--pav-font-weight-regular);
        color: var(--pav-text-muted);
        font-style: italic;
      }

      .filter-select,
      .filter-input {
        padding: var(--pav-space-2) var(--pav-space-3);
        border: 1px solid var(--pav-border-primary);
        border-radius: var(--pav-border-radius-md);
        font-size: var(--pav-font-size-xs);
        font-family: inherit;
        background: var(--pav-surface-card);
        color: var(--pav-text-primary);

        &:focus {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .filter-checkbox-label {
        display: inline-flex;
        align-items: center;
        gap: var(--pav-space-2);
        font-size: var(--pav-font-size-xs);
        color: var(--pav-text-primary);
        cursor: pointer;
      }
    }

    .reset-filters-button {
      margin-top: var(--pav-space-4);
      padding: var(--pav-space-2) var(--pav-space-4);
      background: none;
      border: 1px solid var(--pav-border-primary);
      border-radius: var(--pav-border-radius-full);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      color: var(--pav-text-secondary);
      cursor: pointer;
      transition: background-color 0.2s ease, border-color 0.2s ease;

      &:hover {
        background: var(--pav-interactive-hover);
        border-color: var(--pav-border-primary);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-brand-primary);
        outline-offset: 2px;
      }
    }
  }

  .error-message {
    padding: var(--pav-space-4);
    background: var(--pav-color-alert-error-bg);
    color: var(--pav-color-alert-error-text);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-error);
  }

  .calendars-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-6);
  }

  .calendars-card {
    background: var(--pav-surface-card);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-primary);
    overflow: hidden;
  }

  .calendars-table {
    width: 100%;
    border-collapse: collapse;

    thead {
      tr {
        border-bottom: 1px solid var(--pav-border-primary);
        background: var(--pav-surface-secondary);
      }

      th {
        padding: var(--pav-space-3) var(--pav-space-4);
        text-align: left;
        font-size: var(--pav-font-size-2xs);
        font-weight: var(--pav-font-weight-semibold);
        color: var(--pav-text-muted);
        text-transform: uppercase;
        letter-spacing: var(--pav-letter-spacing-wider);
      }
    }

    tbody {
      .calendar-row {
        border-bottom: 1px solid var(--pav-border-primary);

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background: var(--pav-interactive-hover);
        }
      }

      td {
        padding: var(--pav-space-4);
        font-size: var(--pav-font-size-xs);
        color: var(--pav-text-primary);
        vertical-align: middle;
      }

      .cell-calendar {
        .calendar-title {
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-text-primary);
        }

        .calendar-url {
          margin-top: var(--pav-space-1);
          font-family: monospace;
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-text-muted);
        }
      }
    }
  }

  .open-reports-button {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--pav-color-brand-primary);
      outline-offset: 2px;
      border-radius: var(--pav-border-radius-full);
    }
  }

  .empty-state {
    text-align: center;
    padding: var(--pav-space-12) var(--pav-space-4);
    background: var(--pav-surface-card);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-primary);

    p {
      margin: 0;
      font-size: var(--pav-font-size-base);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-text-primary);
    }

    .empty-state-description {
      margin-top: var(--pav-space-2);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-normal);
      color: var(--pav-text-muted);
    }
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pav-space-4);
    padding: var(--pav-space-4);

    .pagination-button {
      padding: var(--pav-space-2) var(--pav-space-4);
      background: var(--pav-surface-card);
      border: 1px solid var(--pav-border-primary);
      border-radius: var(--pav-border-radius-full);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      color: var(--pav-text-primary);
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover:not(:disabled) {
        background: var(--pav-interactive-hover);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-brand-primary);
        outline-offset: 2px;
      }
    }

    .pagination-info {
      font-size: var(--pav-font-size-xs);
      color: var(--pav-text-secondary);
    }
  }
}
</style>
