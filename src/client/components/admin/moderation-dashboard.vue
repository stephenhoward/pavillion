<script setup lang="ts">
import { onMounted, computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import { ReportStatus, ReportCategory, type EscalationType } from '@/common/model/report';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import CreateReportModal from '@/client/components/admin/create-report.vue';
import { DateTime } from 'luxon';

const { t } = useTranslation('admin', {
  keyPrefix: 'moderation',
});

const router = useRouter();
const moderationStore = useModerationStore();

interface FilterState {
  status: string;
  category: string;
  escalationType: string;
}

const state = reactive<FilterState>({
  status: '',
  category: '',
  escalationType: '',
});

const showCreateModal = ref(false);

const filterRefs = ref({
  status: null as HTMLSelectElement | null,
  category: null as HTMLSelectElement | null,
  escalationType: null as HTMLSelectElement | null,
});

onMounted(async () => {
  await moderationStore.fetchAdminReports();
});

const statusOptions = [
  { value: '', label: t('filters.all_statuses') },
  { value: ReportStatus.SUBMITTED, label: t('status.submitted') },
  { value: ReportStatus.UNDER_REVIEW, label: t('status.under_review') },
  { value: ReportStatus.ESCALATED, label: t('status.escalated') },
  { value: ReportStatus.RESOLVED, label: t('status.resolved') },
  { value: ReportStatus.DISMISSED, label: t('status.dismissed') },
];

const categoryOptions = [
  { value: '', label: t('filters.all_categories') },
  { value: ReportCategory.SPAM, label: t('category.spam') },
  { value: ReportCategory.INAPPROPRIATE, label: t('category.inappropriate') },
  { value: ReportCategory.MISLEADING, label: t('category.misleading') },
  { value: ReportCategory.HARASSMENT, label: t('category.harassment') },
  { value: ReportCategory.OTHER, label: t('category.other') },
];

const escalationTypeOptions = [
  { value: '', label: t('filters.all_types') },
  { value: 'manual', label: t('filters.manual') },
  { value: 'automatic', label: t('filters.automatic') },
];

function applyFilters() {
  moderationStore.setAdminFilters({
    status: state.status || undefined,
    category: state.category || undefined,
    escalationType: state.escalationType || undefined,
  });
  moderationStore.fetchAdminReports();
}

function resetFilters() {
  state.status = '';
  state.category = '';
  state.escalationType = '';
  moderationStore.setAdminFilters({});
  moderationStore.fetchAdminReports();
}

function changePage(page: number) {
  moderationStore.setAdminPage(page);
  moderationStore.fetchAdminReports();
}

const hasActiveFilters = computed(() => {
  return state.status || state.category || state.escalationType;
});

const adminInitiatedReports = computed(() => {
  return moderationStore.adminReports.filter(r => r.reporterType === 'administrator');
});

const escalatedReports = computed(() => {
  return moderationStore.adminReports.filter(r => r.reporterType !== 'administrator');
});

const formatDate = (date: Date | string | null): string => {
  if (!date) return '—';
  const dt = typeof date === 'string' ? DateTime.fromISO(date) : DateTime.fromJSDate(date);
  return dt.toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDeadline = (deadline: Date | string | null): string => {
  if (!deadline) return '—';
  const dt = typeof deadline === 'string' ? DateTime.fromISO(deadline) : DateTime.fromJSDate(deadline);
  const now = DateTime.now();
  const diffHours = dt.diff(now, 'hours').hours;

  if (diffHours < 0) {
    return t('deadline_overdue');
  }
  else if (diffHours < 24) {
    return t('deadline_today');
  }
  else if (diffHours < 48) {
    return t('deadline_tomorrow');
  }
  else {
    return dt.toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' });
  }
};

const isDeadlineApproaching = (deadline: Date | string | null): boolean => {
  if (!deadline) return false;
  const dt = typeof deadline === 'string' ? DateTime.fromISO(deadline) : DateTime.fromJSDate(deadline);
  const now = DateTime.now();
  const diffHours = dt.diff(now, 'hours').hours;
  return diffHours >= 0 && diffHours < 24;
};

const getPriorityBadgeClass = (priority: string | null): string => {
  switch (priority) {
    case 'high':
      return 'priority-high';
    case 'medium':
      return 'priority-medium';
    case 'low':
      return 'priority-low';
    default:
      return '';
  }
};

const getEscalationBadge = (report: any) => {
  if (report.reporterType === 'administrator') {
    return { label: t('badge.admin_initiated'), class: 'escalation-admin' };
  }
  else if (report.escalationType === 'manual') {
    return { label: t('badge.manually_escalated'), class: 'escalation-manual' };
  }
  else if (report.escalationType === 'automatic') {
    return { label: t('badge.auto_escalated'), class: 'escalation-auto' };
  }
  return null;
};

function viewReportDetail(reportId: string) {
  router.push({ name: 'moderation_report_detail', params: { reportId } });
}

function openCreateModal() {
  showCreateModal.value = true;
}

function closeCreateModal() {
  showCreateModal.value = false;
}

async function handleReportCreated() {
  // Refresh the list after creating a new report
  await moderationStore.fetchAdminReports();
}

function goToSettings() {
  router.push({ name: 'moderation_settings' });
}
</script>

<template>
  <div class="moderation-dashboard">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-text">
        <h1>{{ t('title') }}</h1>
        <p class="page-subtitle">{{ t('subtitle') }}</p>
      </div>
      <div class="page-header-actions">
        <button type="button" class="action-button action-create" @click="openCreateModal">
          <svg width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2">
            <line x1="12"
                  y1="5"
                  x2="12"
                  y2="19"/>
            <line x1="5"
                  y1="12"
                  x2="19"
                  y2="12"/>
          </svg>
          {{ t('create_report') }}
        </button>
        <button type="button"
                class="action-button action-settings"
                @click="goToSettings"
                :aria-label="t('settings')">
          <svg width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Filters Section -->
    <section class="filters-section" aria-label="Report filters">
      <div class="filters-grid">
        <div class="filter-group">
          <label :for="'status-filter'" class="filter-label">
            {{ t('filters.status') }}
          </label>
          <select
            id="status-filter"
            ref="filterRefs.status"
            v-model="state.status"
            class="filter-select"
            @change="applyFilters"
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

        <div class="filter-group">
          <label :for="'category-filter'" class="filter-label">
            {{ t('filters.category') }}
          </label>
          <select
            id="category-filter"
            ref="filterRefs.category"
            v-model="state.category"
            class="filter-select"
            @change="applyFilters"
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

        <div class="filter-group">
          <label :for="'escalation-filter'" class="filter-label">
            {{ t('filters.escalation_type') }}
          </label>
          <select
            id="escalation-filter"
            ref="filterRefs.escalationType"
            v-model="state.escalationType"
            class="filter-select"
            @change="applyFilters"
          >
            <option
              v-for="option in escalationTypeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>

      <button
        v-if="hasActiveFilters"
        type="button"
        class="reset-filters-button"
        @click="resetFilters"
      >
        {{ t('filters.reset') }}
      </button>
    </section>

    <!-- Loading State -->
    <LoadingMessage
      v-if="moderationStore.adminLoading"
      :description="t('loading')"
    />

    <!-- Error State -->
    <div v-else-if="moderationStore.adminError" class="error-message">
      <p>{{ t('error') }}: {{ moderationStore.adminError }}</p>
    </div>

    <!-- Reports Display -->
    <div v-else class="reports-content">
      <!-- Admin-Initiated Reports Section -->
      <section
        v-if="adminInitiatedReports.length > 0"
        class="reports-section"
        aria-labelledby="admin-reports-heading"
      >
        <h2 id="admin-reports-heading" class="section-heading">
          {{ t('admin_reports') }}
        </h2>

        <div class="reports-card">
          <!-- Desktop Table -->
          <div class="reports-table-desktop">
            <table class="reports-table" role="table" aria-label="Admin-initiated reports">
              <thead>
                <tr>
                  <th scope="col">{{ t('table.event') }}</th>
                  <th scope="col">{{ t('table.category') }}</th>
                  <th scope="col">{{ t('table.priority') }}</th>
                  <th scope="col">{{ t('table.deadline') }}</th>
                  <th scope="col">{{ t('table.status') }}</th>
                  <th scope="col" class="col-actions">{{ t('table.actions') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="report in adminInitiatedReports"
                  :key="report.id"
                  class="report-row"
                  @click="viewReportDetail(report.id)"
                  tabindex="0"
                  role="button"
                  @keydown.enter="viewReportDetail(report.id)"
                  @keydown.space.prevent="viewReportDetail(report.id)"
                >
                  <td class="cell-event">
                    <span class="event-id">{{ report.eventId.substring(0, 8) }}...</span>
                  </td>
                  <td class="cell-category">
                    <span class="category-badge">{{ t(`category.${report.category}`) }}</span>
                  </td>
                  <td class="cell-priority">
                    <span
                      v-if="report.adminPriority"
                      :class="['priority-badge', getPriorityBadgeClass(report.adminPriority)]"
                    >
                      {{ t(`priority.${report.adminPriority}`) }}
                    </span>
                    <span v-else class="no-priority">—</span>
                  </td>
                  <td class="cell-deadline">
                    <span
                      :class="{ 'deadline-approaching': isDeadlineApproaching(report.adminDeadline) }"
                    >
                      {{ formatDeadline(report.adminDeadline) }}
                    </span>
                  </td>
                  <td class="cell-status">
                    <span class="status-badge">{{ t(`status.${report.status}`) }}</span>
                  </td>
                  <td class="cell-actions">
                    <button type="button" class="action-link" @click.stop="viewReportDetail(report.id)">
                      {{ t('view_details') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Mobile Cards -->
          <div class="reports-mobile">
            <div
              v-for="report in adminInitiatedReports"
              :key="report.id"
              class="report-card"
              @click="viewReportDetail(report.id)"
              tabindex="0"
              role="button"
              @keydown.enter="viewReportDetail(report.id)"
              @keydown.space.prevent="viewReportDetail(report.id)"
            >
              <div class="report-card-header">
                <span class="event-id">{{ report.eventId.substring(0, 8) }}...</span>
                <button type="button" class="action-link-mobile" @click.stop="viewReportDetail(report.id)">
                  {{ t('view_details') }}
                </button>
              </div>
              <div class="report-card-content">
                <div class="report-card-badges">
                  <span class="category-badge">{{ t(`category.${report.category}`) }}</span>
                  <span
                    v-if="report.adminPriority"
                    :class="['priority-badge', getPriorityBadgeClass(report.adminPriority)]"
                  >
                    {{ t(`priority.${report.adminPriority}`) }}
                  </span>
                </div>
                <div class="report-card-meta">
                  <span class="meta-label">{{ t('deadline') }}:</span>
                  <span
                    :class="{ 'deadline-approaching': isDeadlineApproaching(report.adminDeadline) }"
                  >
                    {{ formatDeadline(report.adminDeadline) }}
                  </span>
                </div>
                <div class="report-card-meta">
                  <span class="status-badge">{{ t(`status.${report.status}`) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Escalated Reports Section -->
      <section
        v-if="escalatedReports.length > 0"
        class="reports-section"
        aria-labelledby="escalated-reports-heading"
      >
        <h2 id="escalated-reports-heading" class="section-heading">
          {{ t('escalated_reports') }}
        </h2>

        <div class="reports-card">
          <!-- Desktop Table -->
          <div class="reports-table-desktop">
            <table class="reports-table" role="table" aria-label="Escalated reports">
              <thead>
                <tr>
                  <th scope="col">{{ t('table.event') }}</th>
                  <th scope="col">{{ t('table.calendar') }}</th>
                  <th scope="col">{{ t('table.category') }}</th>
                  <th scope="col">{{ t('table.escalation') }}</th>
                  <th scope="col">{{ t('table.status') }}</th>
                  <th scope="col" class="col-actions">{{ t('table.actions') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="report in escalatedReports"
                  :key="report.id"
                  class="report-row"
                  @click="viewReportDetail(report.id)"
                  tabindex="0"
                  role="button"
                  @keydown.enter="viewReportDetail(report.id)"
                  @keydown.space.prevent="viewReportDetail(report.id)"
                >
                  <td class="cell-event">
                    <span class="event-id">{{ report.eventId.substring(0, 8) }}...</span>
                  </td>
                  <td class="cell-calendar">
                    <span class="calendar-id">{{ report.calendarId.substring(0, 8) }}...</span>
                  </td>
                  <td class="cell-category">
                    <span class="category-badge">{{ t(`category.${report.category}`) }}</span>
                  </td>
                  <td class="cell-escalation">
                    <span
                      v-if="getEscalationBadge(report)"
                      :class="['escalation-badge', getEscalationBadge(report)?.class]"
                    >
                      {{ getEscalationBadge(report)?.label }}
                    </span>
                  </td>
                  <td class="cell-status">
                    <span class="status-badge">{{ t(`status.${report.status}`) }}</span>
                  </td>
                  <td class="cell-actions">
                    <button type="button" class="action-link" @click.stop="viewReportDetail(report.id)">
                      {{ t('view_details') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Mobile Cards -->
          <div class="reports-mobile">
            <div
              v-for="report in escalatedReports"
              :key="report.id"
              class="report-card"
              @click="viewReportDetail(report.id)"
              tabindex="0"
              role="button"
              @keydown.enter="viewReportDetail(report.id)"
              @keydown.space.prevent="viewReportDetail(report.id)"
            >
              <div class="report-card-header">
                <span class="event-id">{{ report.eventId.substring(0, 8) }}...</span>
                <button type="button" class="action-link-mobile" @click.stop="viewReportDetail(report.id)">
                  {{ t('view_details') }}
                </button>
              </div>
              <div class="report-card-content">
                <div class="report-card-badges">
                  <span class="category-badge">{{ t(`category.${report.category}`) }}</span>
                  <span
                    v-if="getEscalationBadge(report)"
                    :class="['escalation-badge', getEscalationBadge(report)?.class]"
                  >
                    {{ getEscalationBadge(report)?.label }}
                  </span>
                </div>
                <div class="report-card-meta">
                  <span class="status-badge">{{ t(`status.${report.status}`) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Empty State -->
      <div v-if="moderationStore.adminReports.length === 0" class="empty-state">
        <p>{{ t('no_reports') }}</p>
        <p class="empty-state-description">{{ t('no_reports_description') }}</p>
      </div>

      <!-- Pagination -->
      <nav
        v-if="moderationStore.adminPagination.totalPages > 1"
        class="pagination"
        aria-label="Report pagination"
      >
        <button
          type="button"
          class="pagination-button"
          :disabled="moderationStore.adminPagination.currentPage === 1"
          @click="changePage(moderationStore.adminPagination.currentPage - 1)"
        >
          {{ t('pagination.previous') }}
        </button>
        <span class="pagination-info">
          {{ t('pagination.page_info', {
            current: moderationStore.adminPagination.currentPage,
            total: moderationStore.adminPagination.totalPages
          }) }}
        </span>
        <button
          type="button"
          class="pagination-button"
          :disabled="moderationStore.adminPagination.currentPage >= moderationStore.adminPagination.totalPages"
          @click="changePage(moderationStore.adminPagination.currentPage + 1)"
        >
          {{ t('pagination.next') }}
        </button>
      </nav>
    </div>

    <!-- Create Report Modal -->
    <CreateReportModal
      v-if="showCreateModal"
      @close="closeCreateModal"
      @created="handleReportCreated"
    />
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.moderation-dashboard {
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
        color: var(--pav-color-text-primary);
      }

      .page-subtitle {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }

    .page-header-actions {
      display: flex;
      gap: var(--pav-space-2);

      .action-button {
        display: inline-flex;
        align-items: center;
        gap: var(--pav-space-2);
        padding: var(--pav-space-2) var(--pav-space-4);
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        font-family: inherit;
        border: none;
        border-radius: var(--pav-border-radius-full);
        cursor: pointer;
        transition: all 0.2s ease;

        &:focus-visible {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
        }

        &.action-create {
          background: var(--pav-color-brand-primary);
          color: #fff;

          &:hover {
            background: var(--pav-color-brand-primary-dark);
          }
        }

        &.action-settings {
          background: var(--pav-color-surface-secondary);
          color: var(--pav-color-text-secondary);
          border: 1px solid var(--pav-border-color-light);

          &:hover {
            background: var(--pav-color-stone-100);
            color: var(--pav-color-text-primary);
          }
        }
      }
    }
  }

  .filters-section {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
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
        grid-template-columns: repeat(3, 1fr);
      }
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-2);

      .filter-label {
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-secondary);
      }

      .filter-select {
        padding: var(--pav-space-2) var(--pav-space-3);
        border: 1px solid var(--pav-border-color-light);
        border-radius: var(--pav-border-radius-md);
        font-size: var(--pav-font-size-xs);
        font-family: inherit;
        background: var(--pav-color-surface-primary);
        color: var(--pav-color-text-primary);
        cursor: pointer;

        &:focus {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
        }
      }
    }

    .reset-filters-button {
      margin-top: var(--pav-space-4);
      padding: var(--pav-space-2) var(--pav-space-4);
      background: none;
      border: 1px solid var(--pav-border-color-light);
      border-radius: var(--pav-border-radius-full);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      color: var(--pav-color-text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: var(--pav-color-stone-50);
        border-color: var(--pav-color-stone-300);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-brand-primary);
        outline-offset: 2px;
      }
    }
  }

  .error-message {
    padding: var(--pav-space-4);
    background: var(--pav-color-error-bg);
    color: var(--pav-color-error-text);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-error);
  }

  .reports-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-6);
  }

  .reports-section {
    .section-heading {
      margin: 0 0 var(--pav-space-4) 0;
      font-size: var(--pav-font-size-lg);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }

  .reports-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;

    .reports-table-desktop {
      display: none;

      @include pav-media(md) {
        display: block;
      }

      .reports-table {
        width: 100%;
        border-collapse: collapse;

        thead {
          tr {
            border-bottom: 1px solid var(--pav-border-color-light);
            background: var(--pav-color-stone-50);
          }

          th {
            padding: var(--pav-space-3) var(--pav-space-4);
            text-align: left;
            font-size: var(--pav-font-size-2xs);
            font-weight: var(--pav-font-weight-semibold);
            color: var(--pav-color-text-muted);
            text-transform: uppercase;
            letter-spacing: var(--pav-letter-spacing-wider);

            &.col-actions {
              text-align: right;
            }
          }
        }

        tbody {
          .report-row {
            border-bottom: 1px solid var(--pav-border-color-light);
            transition: background-color 0.15s ease;
            cursor: pointer;

            &:last-child {
              border-bottom: none;
            }

            &:hover {
              background: var(--pav-color-stone-50);
            }

            &:focus-within {
              background: var(--pav-color-stone-50);
            }

            &:focus {
              outline: 2px solid var(--pav-color-brand-primary);
              outline-offset: -2px;
            }
          }

          td {
            padding: var(--pav-space-4);
          }

          .cell-event,
          .cell-calendar {
            font-family: monospace;
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-secondary);
          }

          .cell-actions {
            text-align: right;
          }
        }
      }
    }

    .reports-mobile {
      display: block;

      @include pav-media(md) {
        display: none;
      }

      .report-card {
        padding: var(--pav-space-4);
        border-bottom: 1px solid var(--pav-border-color-light);
        cursor: pointer;
        transition: background-color 0.15s ease;

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background: var(--pav-color-stone-50);
        }

        &:focus {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: -2px;
          background: var(--pav-color-stone-50);
        }

        .report-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--pav-space-3);
          margin-bottom: var(--pav-space-3);

          .event-id {
            font-family: monospace;
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-secondary);
          }
        }

        .report-card-content {
          display: flex;
          flex-direction: column;
          gap: var(--pav-space-2);
        }

        .report-card-badges {
          display: flex;
          flex-wrap: wrap;
          gap: var(--pav-space-2);
        }

        .report-card-meta {
          display: flex;
          align-items: center;
          gap: var(--pav-space-2);
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-secondary);

          .meta-label {
            font-weight: var(--pav-font-weight-medium);
          }
        }
      }
    }
  }

  .category-badge,
  .status-badge,
  .priority-badge,
  .escalation-badge {
    display: inline-block;
    padding: var(--pav-space-0_5) var(--pav-space-2);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-medium);
    border-radius: var(--pav-border-radius-xs);
  }

  .category-badge {
    background: var(--pav-color-blue-100);
    color: var(--pav-color-blue-700);
  }

  .status-badge {
    background: var(--pav-color-stone-100);
    color: var(--pav-color-stone-700);
  }

  .priority-badge {
    &.priority-high {
      background: var(--pav-color-red-100);
      color: var(--pav-color-red-700);
    }

    &.priority-medium {
      background: var(--pav-color-orange-100);
      color: var(--pav-color-orange-700);
    }

    &.priority-low {
      background: var(--pav-color-stone-100);
      color: var(--pav-color-stone-700);
    }
  }

  .escalation-badge {
    &.escalation-admin {
      background: var(--pav-color-purple-100);
      color: var(--pav-color-purple-700);
    }

    &.escalation-manual {
      background: var(--pav-color-orange-100);
      color: var(--pav-color-orange-700);
    }

    &.escalation-auto {
      background: var(--pav-color-sky-100);
      color: var(--pav-color-sky-700);
    }
  }

  .deadline-approaching {
    color: var(--pav-color-warning);
    font-weight: var(--pav-font-weight-medium);
  }

  .action-link,
  .action-link-mobile {
    background: none;
    border: none;
    color: var(--pav-color-orange-600);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s ease;

    &:hover {
      color: var(--pav-color-orange-700);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-brand-primary);
      outline-offset: 2px;
      border-radius: var(--pav-border-radius-xs);
    }
  }

  .action-link-mobile {
    padding: var(--pav-space-1_5) var(--pav-space-3);
    border-radius: var(--pav-border-radius-full);
    transition: color 0.2s ease, background-color 0.2s ease;

    &:hover {
      background: var(--pav-color-orange-50);
    }
  }

  .empty-state {
    text-align: center;
    padding: var(--pav-space-12) var(--pav-space-4);
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);

    p {
      margin: 0;
      font-size: var(--pav-font-size-base);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    .empty-state-description {
      margin-top: var(--pav-space-2);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-normal);
      color: var(--pav-color-text-muted);
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
      background: var(--pav-color-surface-primary);
      border: 1px solid var(--pav-border-color-light);
      border-radius: var(--pav-border-radius-full);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      color: var(--pav-color-text-primary);
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover:not(:disabled) {
        background: var(--pav-color-stone-50);
        border-color: var(--pav-color-stone-300);
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
      color: var(--pav-color-text-secondary);
    }
  }
}

// Dark mode adjustments
@media (prefers-color-scheme: dark) {
  .moderation-dashboard {
    .page-header {
      .page-header-actions {
        .action-button {
          &.action-settings {
            background: var(--pav-color-stone-800);
            border-color: var(--pav-color-stone-600);

            &:hover {
              background: var(--pav-color-stone-700);
            }
          }
        }
      }
    }

    .filters-section {
      .reset-filters-button {
        &:hover {
          background: var(--pav-color-stone-800);
        }
      }
    }

    .reports-card {
      .reports-table-desktop {
        .reports-table {
          thead tr {
            background: rgba(41, 37, 36, 0.5);
          }

          tbody .report-row:hover {
            background: rgba(41, 37, 36, 0.3);
          }
        }
      }

      .reports-mobile {
        .report-card:hover {
          background: rgba(41, 37, 36, 0.3);
        }
      }
    }

    .category-badge {
      background: rgba(59, 130, 246, 0.15);
      color: var(--pav-color-blue-300);
    }

    .status-badge {
      background: var(--pav-color-stone-800);
      color: var(--pav-color-stone-300);
    }

    .priority-badge {
      &.priority-high {
        background: rgba(239, 68, 68, 0.15);
        color: var(--pav-color-red-300);
      }

      &.priority-medium {
        background: rgba(249, 115, 22, 0.15);
        color: var(--pav-color-orange-300);
      }

      &.priority-low {
        background: var(--pav-color-stone-800);
        color: var(--pav-color-stone-400);
      }
    }

    .escalation-badge {
      &.escalation-admin {
        background: rgba(168, 85, 247, 0.15);
        color: var(--pav-color-purple-300);
      }

      &.escalation-manual {
        background: rgba(249, 115, 22, 0.15);
        color: var(--pav-color-orange-300);
      }

      &.escalation-auto {
        background: rgba(14, 165, 233, 0.15);
        color: var(--pav-color-sky-300);
      }
    }

    .action-link,
    .action-link-mobile {
      color: var(--pav-color-orange-400);

      &:hover {
        color: var(--pav-color-orange-300);
      }
    }

    .action-link-mobile {
      &:hover {
        background: rgba(249, 115, 22, 0.1);
      }
    }

    .pagination {
      .pagination-button {
        &:hover:not(:disabled) {
          background: var(--pav-color-stone-800);
        }
      }
    }
  }
}
</style>
