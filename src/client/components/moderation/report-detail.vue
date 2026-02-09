<script setup lang="ts">
/**
 * Report Detail Component
 *
 * Displays the full detail view of a single moderation report,
 * including the report info, event reference, owner notes,
 * action buttons (resolve/dismiss), and escalation history timeline.
 */
import { reactive, onMounted, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { ArrowLeft } from 'lucide-vue-next';
import { useModerationStore } from '@/client/stores/moderation-store';
import { ReportStatus } from '@/common/model/report';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import PillButton from '@/client/components/common/PillButton.vue';

const props = defineProps<{
  calendarId: string;
  reportId: string;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
}>();

const { t } = useTranslation('system', {
  keyPrefix: 'moderation',
});

const store = useModerationStore();

const state = reactive({
  ownerNotes: '',
  actionNotes: '',
  showResolveForm: false,
  showDismissForm: false,
  isSavingNotes: false,
  isActioning: false,
  actionSuccess: '',
  actionError: '',
  notesSuccess: '',
});

/**
 * The current report from the store.
 */
const report = computed(() => store.currentReport?.report ?? null);

/**
 * The escalation history from the store.
 */
const escalationHistory = computed(() => store.currentReport?.escalationHistory ?? []);

/**
 * Whether the report can be acted upon (not already resolved/dismissed).
 */
const canAct = computed(() => {
  if (!report.value) return false;
  return report.value.status !== ReportStatus.RESOLVED
    && report.value.status !== ReportStatus.DISMISSED;
});

/**
 * Resolves the CSS class for a status badge.
 *
 * @param status - The report status value
 * @returns CSS class for the badge
 */
const statusBadgeClass = (status: string): string => {
  const classMap: Record<string, string> = {
    [ReportStatus.SUBMITTED]: 'status-badge--submitted',
    [ReportStatus.UNDER_REVIEW]: 'status-badge--under-review',
    [ReportStatus.RESOLVED]: 'status-badge--resolved',
    [ReportStatus.DISMISSED]: 'status-badge--dismissed',
    [ReportStatus.ESCALATED]: 'status-badge--escalated',
  };
  return classMap[status] || '';
};

/**
 * Returns the translated label for a report status.
 *
 * @param status - The report status value
 * @returns Translated label string
 */
const statusLabel = (status: string): string => {
  const labelMap: Record<string, string> = {
    [ReportStatus.SUBMITTED]: t('status.submitted'),
    [ReportStatus.UNDER_REVIEW]: t('status.under_review'),
    [ReportStatus.RESOLVED]: t('status.resolved'),
    [ReportStatus.DISMISSED]: t('status.dismissed'),
    [ReportStatus.ESCALATED]: t('status.escalated'),
  };
  return labelMap[status] || status;
};

/**
 * Returns the translated label for a report category.
 *
 * @param category - The report category value
 * @returns Translated label string
 */
const categoryLabel = (category: string): string => {
  const labelMap: Record<string, string> = {
    spam: t('category.spam'),
    inappropriate: t('category.inappropriate'),
    misleading: t('category.misleading'),
    harassment: t('category.harassment'),
    other: t('category.other'),
  };
  return labelMap[category] || category;
};

/**
 * Returns the translated label for a reporter type.
 *
 * @param reporterType - The reporter type value
 * @returns Translated label string
 */
const reporterTypeLabel = (reporterType: string): string => {
  const labelMap: Record<string, string> = {
    anonymous: t('reporter_type.anonymous'),
    authenticated: t('reporter_type.authenticated'),
    administrator: t('reporter_type.administrator'),
  };
  return labelMap[reporterType] || reporterType;
};

/**
 * Formats a date for display.
 *
 * @param date - Date or ISO string to format
 * @returns Formatted date/time string
 */
const formatDate = (date: Date | string): string => {
  const dt = date instanceof Date ? DateTime.fromJSDate(date) : DateTime.fromISO(date as string);
  return dt.toLocaleString(DateTime.DATETIME_MED);
};

/**
 * Navigates back to the reports dashboard.
 */
const goBack = () => {
  emit('back');
};

/**
 * Saves the owner notes for this report.
 */
const saveNotes = async () => {
  if (!report.value) return;

  state.isSavingNotes = true;
  state.notesSuccess = '';
  state.actionError = '';

  try {
    await store.updateNotes(props.calendarId, props.reportId, state.ownerNotes);
    state.notesSuccess = t('detail.notes_saved');
    clearMessage('notesSuccess');
  }
  catch {
    state.actionError = store.error || '';
  }
  finally {
    state.isSavingNotes = false;
  }
};

/**
 * Opens the resolve action form.
 */
const showResolve = () => {
  state.showResolveForm = true;
  state.showDismissForm = false;
  state.actionNotes = '';
  state.actionError = '';
};

/**
 * Opens the dismiss action form.
 */
const showDismiss = () => {
  state.showDismissForm = true;
  state.showResolveForm = false;
  state.actionNotes = '';
  state.actionError = '';
};

/**
 * Cancels the current action form.
 */
const cancelAction = () => {
  state.showResolveForm = false;
  state.showDismissForm = false;
  state.actionNotes = '';
  state.actionError = '';
};

/**
 * Resolves the report with the provided notes.
 */
const resolveReport = async () => {
  if (!state.actionNotes.trim()) {
    state.actionError = t('actions.notes_required');
    return;
  }

  state.isActioning = true;
  state.actionError = '';
  state.actionSuccess = '';

  try {
    await store.resolveReport(props.calendarId, props.reportId, state.actionNotes.trim());
    state.actionSuccess = t('actions.resolved_success');
    state.showResolveForm = false;
    state.actionNotes = '';
    clearMessage('actionSuccess');
  }
  catch {
    state.actionError = store.error || '';
  }
  finally {
    state.isActioning = false;
  }
};

/**
 * Dismisses the report with the provided notes.
 */
const dismissReport = async () => {
  if (!state.actionNotes.trim()) {
    state.actionError = t('actions.notes_required');
    return;
  }

  state.isActioning = true;
  state.actionError = '';
  state.actionSuccess = '';

  try {
    await store.dismissReport(props.calendarId, props.reportId, state.actionNotes.trim());
    state.actionSuccess = t('actions.dismissed_success');
    state.showDismissForm = false;
    state.actionNotes = '';
    clearMessage('actionSuccess');
  }
  catch {
    state.actionError = store.error || '';
  }
  finally {
    state.isActioning = false;
  }
};

/**
 * Clears a success message after a timeout.
 *
 * @param field - The state field to clear
 * @param delay - Timeout in milliseconds
 */
const clearMessage = (field: 'actionSuccess' | 'notesSuccess', delay = 5000) => {
  setTimeout(() => {
    state[field] = '';
  }, delay);
};

onMounted(async () => {
  try {
    await store.fetchReport(props.calendarId, props.reportId);

    // Initialize owner notes from fetched report
    if (store.currentReport?.report.ownerNotes) {
      state.ownerNotes = store.currentReport.report.ownerNotes;
    }
  }
  catch {
    // Error is handled by the store
  }
});
</script>

<template>
  <div class="report-detail">
    <!-- Back button -->
    <button
      type="button"
      class="report-detail__back"
      @click="goBack"
      :aria-label="t('detail.back_to_reports')"
    >
      <ArrowLeft :size="18" />
      {{ t('detail.back_to_reports') }}
    </button>

    <!-- Loading -->
    <LoadingMessage v-if="store.loadingReport" :description="t('detail.loading')" />

    <!-- Error -->
    <div v-else-if="store.error && !report" class="report-detail__error" role="alert">
      {{ t('detail.error_loading') }}
    </div>

    <!-- Report Content -->
    <template v-else-if="report">
      <!-- Header -->
      <header class="report-detail__header">
        <h2 class="report-detail__title">{{ t('detail.title') }}</h2>
        <span
          class="status-badge"
          :class="statusBadgeClass(report.status)"
        >
          {{ statusLabel(report.status) }}
        </span>
      </header>

      <!-- Success Messages -->
      <div v-if="state.actionSuccess" class="report-detail__alert report-detail__alert--success" role="status">
        {{ state.actionSuccess }}
      </div>

      <!-- Error Messages -->
      <div v-if="state.actionError" class="report-detail__alert report-detail__alert--error" role="alert">
        {{ state.actionError }}
      </div>

      <!-- Report Information -->
      <section class="report-detail__section" :aria-label="t('detail.title')">
        <div class="report-detail__info-grid">
          <div class="report-detail__info-item">
            <span class="report-detail__info-label">{{ t('dashboard.column_category') }}</span>
            <span class="report-detail__info-value">{{ categoryLabel(report.category) }}</span>
          </div>

          <div class="report-detail__info-item">
            <span class="report-detail__info-label">{{ t('detail.reporter_type') }}</span>
            <span class="report-detail__info-value">{{ reporterTypeLabel(report.reporterType) }}</span>
          </div>

          <div class="report-detail__info-item">
            <span class="report-detail__info-label">{{ t('detail.reported_on') }}</span>
            <span class="report-detail__info-value">{{ formatDate(report.createdAt) }}</span>
          </div>

          <div class="report-detail__info-item">
            <span class="report-detail__info-label">{{ t('detail.event') }}</span>
            <span class="report-detail__info-value report-detail__event-id">{{ report.eventId }}</span>
          </div>
        </div>

        <!-- Description -->
        <div v-if="report.description" class="report-detail__description">
          <h3 class="report-detail__section-title">{{ t('detail.description') }}</h3>
          <p class="report-detail__description-text">{{ report.description }}</p>
        </div>
      </section>

      <!-- Owner Notes Section -->
      <section class="report-detail__section" :aria-label="t('detail.owner_notes')">
        <h3 class="report-detail__section-title">{{ t('detail.owner_notes') }}</h3>

        <div v-if="state.notesSuccess" class="report-detail__alert report-detail__alert--success" role="status">
          {{ state.notesSuccess }}
        </div>

        <div class="report-detail__notes-form">
          <textarea
            v-model="state.ownerNotes"
            class="report-detail__textarea"
            :placeholder="t('detail.owner_notes_placeholder')"
            rows="3"
            :aria-label="t('detail.owner_notes')"
          />
          <div class="report-detail__notes-actions">
            <PillButton
              variant="secondary"
              size="sm"
              :disabled="state.isSavingNotes"
              @click="saveNotes"
            >
              {{ state.isSavingNotes ? t('detail.saving_notes') : t('detail.save_notes') }}
            </PillButton>
          </div>
        </div>
      </section>

      <!-- Action Buttons -->
      <section v-if="canAct" class="report-detail__section" aria-label="Report actions">
        <h3 class="report-detail__section-title">{{ t('actions.resolve_confirm') }}</h3>

        <!-- Action buttons when no form is open -->
        <div v-if="!state.showResolveForm && !state.showDismissForm" class="report-detail__action-buttons">
          <PillButton
            variant="primary"
            @click="showResolve"
          >
            {{ t('actions.resolve') }}
          </PillButton>
          <PillButton
            variant="danger"
            @click="showDismiss"
          >
            {{ t('actions.dismiss') }}
          </PillButton>
        </div>

        <!-- Resolve Form -->
        <div v-if="state.showResolveForm" class="report-detail__action-form">
          <p class="report-detail__action-label">{{ t('actions.resolve_confirm') }}</p>
          <textarea
            v-model="state.actionNotes"
            class="report-detail__textarea"
            :placeholder="t('actions.notes_placeholder')"
            rows="3"
            :aria-label="t('actions.notes_placeholder')"
          />
          <div class="report-detail__action-form-buttons">
            <PillButton
              variant="ghost"
              size="sm"
              :disabled="state.isActioning"
              @click="cancelAction"
            >
              {{ t('actions.cancel') }}
            </PillButton>
            <PillButton
              variant="primary"
              size="sm"
              :disabled="state.isActioning || !state.actionNotes.trim()"
              @click="resolveReport"
            >
              {{ state.isActioning ? t('actions.resolving') : t('actions.resolve') }}
            </PillButton>
          </div>
        </div>

        <!-- Dismiss Form -->
        <div v-if="state.showDismissForm" class="report-detail__action-form">
          <p class="report-detail__action-label">{{ t('actions.dismiss_confirm') }}</p>
          <div class="report-detail__dismiss-warning" role="alert">
            {{ t('actions.dismiss_warning') }}
          </div>
          <textarea
            v-model="state.actionNotes"
            class="report-detail__textarea"
            :placeholder="t('actions.notes_placeholder')"
            rows="3"
            :aria-label="t('actions.notes_placeholder')"
          />
          <div class="report-detail__action-form-buttons">
            <PillButton
              variant="ghost"
              size="sm"
              :disabled="state.isActioning"
              @click="cancelAction"
            >
              {{ t('actions.cancel') }}
            </PillButton>
            <PillButton
              variant="danger"
              size="sm"
              :disabled="state.isActioning || !state.actionNotes.trim()"
              @click="dismissReport"
            >
              {{ state.isActioning ? t('actions.dismissing') : t('actions.dismiss') }}
            </PillButton>
          </div>
        </div>
      </section>

      <!-- Escalation History -->
      <section class="report-detail__section" :aria-label="t('detail.escalation_history')">
        <h3 class="report-detail__section-title">{{ t('detail.escalation_history') }}</h3>

        <div v-if="escalationHistory.length === 0" class="report-detail__empty-history">
          {{ t('detail.no_escalation_history') }}
        </div>

        <ol v-else class="report-detail__timeline">
          <li
            v-for="record in escalationHistory"
            :key="record.id"
            class="report-detail__timeline-item"
          >
            <div class="report-detail__timeline-marker"/>
            <div class="report-detail__timeline-content">
              <div class="report-detail__timeline-header">
                <span class="report-detail__timeline-transition">
                  <span class="status-badge" :class="statusBadgeClass(record.fromStatus)">
                    {{ statusLabel(record.fromStatus) }}
                  </span>
                  <span class="report-detail__timeline-arrow">&rarr;</span>
                  <span class="status-badge" :class="statusBadgeClass(record.toStatus)">
                    {{ statusLabel(record.toStatus) }}
                  </span>
                </span>
                <span class="report-detail__timeline-date">{{ formatDate(record.createdAt) }}</span>
              </div>
              <div v-if="record.decision" class="report-detail__timeline-decision">
                <span class="report-detail__timeline-decision-label">{{ t('detail.escalation_decision') }}:</span>
                {{ record.decision }}
              </div>
              <div v-if="record.notes" class="report-detail__timeline-notes">
                {{ record.notes }}
              </div>
              <div v-if="record.reviewerRole" class="report-detail__timeline-reviewer">
                {{ t('detail.escalation_by') }}: {{ record.reviewerRole }}
              </div>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/components/calendar-admin' as *;

.report-detail {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  &__back {
    display: inline-flex;
    align-items: center;
    gap: var(--pav-space-2);
    background: none;
    border: none;
    color: var(--pav-color-stone-600);
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    padding: var(--pav-space-2) 0;
    transition: color 0.2s;

    &:hover {
      color: var(--pav-color-orange-600);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
      border-radius: 0.25rem;
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);

      &:hover {
        color: var(--pav-color-orange-400);
      }
    }
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pav-space-4);
  }

  &__title {
    @include admin-section-title;
    margin: 0;
  }

  &__error {
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    font-size: 0.875rem;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }

  &__alert {
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    font-size: 0.875rem;

    &--success {
      background-color: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.2);
      color: var(--pav-color-green-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-green-400);
      }
    }

    &--error {
      background-color: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: var(--pav-color-red-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-red-400);
      }
    }
  }

  &__section {
    @include admin-section;
    background: var(--pav-bg-primary);
    border: 1px solid var(--pav-border-primary);
    border-radius: 0.75rem;
    padding: var(--pav-space-5);
  }

  &__section-title {
    @include admin-section-label;
    margin-top: 0;
  }

  &__info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--pav-space-4);
    margin-bottom: var(--pav-space-4);

    @media (max-width: 640px) {
      grid-template-columns: 1fr;
    }
  }

  &__info-item {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-1);
  }

  &__info-label {
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--pav-color-stone-500);
  }

  &__info-value {
    font-size: 0.9375rem;
    color: var(--pav-text-primary);
    font-weight: 500;
  }

  &__event-id {
    font-family: monospace;
    font-size: 0.8125rem;
    word-break: break-all;
  }

  &__description {
    padding-top: var(--pav-space-4);
    border-top: 1px solid var(--pav-border-primary);
  }

  &__description-text {
    margin: var(--pav-space-2) 0 0;
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--pav-text-primary);
    white-space: pre-wrap;
  }

  &__notes-form {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
  }

  &__textarea {
    @include admin-form-input;
    resize: vertical;
    min-height: 5rem;
    font-family: inherit;
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  &__notes-actions {
    display: flex;
    justify-content: flex-end;
  }

  &__action-buttons {
    display: flex;
    gap: var(--pav-space-3);
  }

  &__action-form {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
  }

  &__action-label {
    margin: 0;
    font-weight: 500;
    color: var(--pav-text-primary);
  }

  &__dismiss-warning {
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    font-size: 0.875rem;
    background-color: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
    color: var(--pav-color-amber-700, #b45309);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-amber-300, #fcd34d);
    }
  }

  &__action-form-buttons {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
    padding-top: var(--pav-space-3);
    border-top: 1px solid var(--pav-border-primary);
  }

  // Escalation timeline
  &__empty-history {
    font-size: 0.875rem;
    color: var(--pav-color-stone-500);
    font-style: italic;
  }

  &__timeline {
    list-style: none;
    padding: 0;
    margin: 0;
    position: relative;

    &::before {
      content: '';
      position: absolute;
      left: 7px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--pav-border-primary);
    }
  }

  &__timeline-item {
    display: flex;
    gap: var(--pav-space-4);
    padding-bottom: var(--pav-space-4);
    position: relative;

    &:last-child {
      padding-bottom: 0;
    }
  }

  &__timeline-marker {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--pav-color-stone-300);
    border: 2px solid var(--pav-bg-primary);
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    margin-top: var(--pav-space-1);

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-600);
    }
  }

  &__timeline-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-2);
    min-width: 0;
  }

  &__timeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pav-space-3);
    flex-wrap: wrap;
  }

  &__timeline-transition {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
  }

  &__timeline-arrow {
    color: var(--pav-color-stone-400);
    font-size: 0.875rem;
  }

  &__timeline-date {
    font-size: 0.75rem;
    color: var(--pav-color-stone-500);
    white-space: nowrap;
  }

  &__timeline-decision {
    font-size: 0.875rem;
    color: var(--pav-text-primary);
  }

  &__timeline-decision-label {
    font-weight: 500;
  }

  &__timeline-notes {
    font-size: 0.875rem;
    color: var(--pav-color-stone-600);
    font-style: italic;
    white-space: pre-wrap;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__timeline-reviewer {
    font-size: 0.75rem;
    color: var(--pav-color-stone-500);
  }
}

// Status badge styles (shared with dashboard)
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--pav-space-1) var(--pav-space-2);
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;

  &--submitted {
    background: var(--pav-color-sky-50);
    color: var(--pav-color-sky-700);

    @media (prefers-color-scheme: dark) {
      background: oklch(0.725 0.143 232.661 / 0.15);
      color: var(--pav-color-sky-300);
    }
  }

  &--under-review {
    background: var(--pav-color-amber-50, rgba(245, 158, 11, 0.1));
    color: var(--pav-color-amber-700, #b45309);

    @media (prefers-color-scheme: dark) {
      background: rgba(245, 158, 11, 0.15);
      color: var(--pav-color-amber-300, #fcd34d);
    }
  }

  &--resolved {
    background: var(--pav-color-green-50, rgba(34, 197, 94, 0.1));
    color: var(--pav-color-green-700, #15803d);

    @media (prefers-color-scheme: dark) {
      background: rgba(34, 197, 94, 0.15);
      color: var(--pav-color-green-300, #86efac);
    }
  }

  &--dismissed {
    background: var(--pav-color-stone-100);
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-800);
      color: var(--pav-color-stone-400);
    }
  }

  &--escalated {
    background: var(--pav-color-red-50, rgba(239, 68, 68, 0.1));
    color: var(--pav-color-red-700, #b91c1c);

    @media (prefers-color-scheme: dark) {
      background: rgba(239, 68, 68, 0.15);
      color: var(--pav-color-red-300, #fca5a5);
    }
  }
}
</style>
