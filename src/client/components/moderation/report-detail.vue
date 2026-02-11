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
import { useReportFormatting } from '@/client/composables/useReportFormatting';
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
const { statusBadgeClass, statusLabel, categoryLabel, reporterTypeLabel } = useReportFormatting();

/**
 * Formats a date with time for the detail view.
 *
 * @param date - Date or ISO string to format
 * @returns Formatted date/time string
 */
const formatDateTime = (date: Date | string): string => {
  const dt = date instanceof Date ? DateTime.fromJSDate(date) : DateTime.fromISO(date as string);
  return dt.toLocaleString(DateTime.DATETIME_MED);
};

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
 * Whether the report has any detected abuse patterns.
 */
const hasAbusePatterns = computed(() => {
  if (!report.value) return false;
  return report.value.hasSourceFloodingPattern
    || report.value.hasEventTargetingPattern
    || report.value.hasInstancePattern;
});


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

      <!-- Pattern Warning Badges -->
      <div v-if="hasAbusePatterns" class="report-detail__pattern-warnings" role="status">
        <div
          v-if="report.hasSourceFloodingPattern"
          class="report-detail__pattern-badge report-detail__pattern-badge--warning"
          data-testid="pattern-badge-source-flooding"
          role="status"
          :aria-label="t('patterns.source_flooding_aria')"
        >
          <span class="report-detail__pattern-badge-title">{{ t('patterns.source_flooding') }}</span>
          <span class="report-detail__pattern-badge-description">{{ t('patterns.source_flooding_description') }}</span>
        </div>

        <div
          v-if="report.hasEventTargetingPattern"
          class="report-detail__pattern-badge report-detail__pattern-badge--warning"
          data-testid="pattern-badge-event-targeting"
          role="status"
          :aria-label="t('patterns.event_targeting_aria')"
        >
          <span class="report-detail__pattern-badge-title">{{ t('patterns.event_targeting') }}</span>
          <span class="report-detail__pattern-badge-description">{{ t('patterns.event_targeting_description') }}</span>
        </div>

        <div
          v-if="report.hasInstancePattern"
          class="report-detail__pattern-badge report-detail__pattern-badge--warning"
          data-testid="pattern-badge-instance"
          role="status"
          :aria-label="t('patterns.instance_pattern_aria')"
        >
          <span class="report-detail__pattern-badge-title">{{ t('patterns.instance_pattern') }}</span>
          <span class="report-detail__pattern-badge-description">{{ t('patterns.instance_pattern_description') }}</span>
        </div>
      </div>

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
            <span class="report-detail__info-value">{{ formatDateTime(report.createdAt) }}</span>
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
      <section v-if="canAct" class="report-detail__section" :aria-label="t('actions.section_label')">
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
                <span class="report-detail__timeline-date">{{ formatDateTime(record.createdAt) }}</span>
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
    font-weight: var(--pav-font-weight-medium);
    font-size: var(--pav-font-size-small);
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

  &__alert {
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    font-size: var(--pav-font-size-small);

    &--success {
      background-color: var(--pav-color-emerald-50);
      border: 1px solid var(--pav-color-emerald-200);
      color: var(--pav-color-emerald-700);

      @media (prefers-color-scheme: dark) {
        background-color: oklch(0.765 0.177 163.223 / 0.1);
        border-color: oklch(0.765 0.177 163.223 / 0.2);
        color: var(--pav-color-emerald-400);
      }
    }

    &--error {
      background-color: var(--pav-color-red-50);
      border: 1px solid var(--pav-color-red-200);
      color: var(--pav-color-red-700);

      @media (prefers-color-scheme: dark) {
        background-color: oklch(0.637 0.237 25.331 / 0.1);
        border-color: oklch(0.637 0.237 25.331 / 0.2);
        color: var(--pav-color-red-400);
      }
    }
  }
  &__pattern-warnings {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
  }

  &__pattern-badge {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-1);
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    border-width: 2px;
    border-style: solid;

    &--warning {
      background-color: var(--pav-color-amber-50);
      border-color: var(--pav-color-amber-400);
      color: var(--pav-color-amber-800);

      @media (prefers-color-scheme: dark) {
        background-color: oklch(0.769 0.188 70.08 / 0.15);
        border-color: oklch(0.769 0.188 70.08 / 0.5);
        color: var(--pav-color-amber-200);
      }
    }
  }

  &__pattern-badge-title {
    font-weight: var(--pav-font-weight-semibold);
    font-size: var(--pav-font-size-body);
    line-height: var(--pav-line-height-tight);
  }

  &__pattern-badge-description {
    font-size: var(--pav-font-size-small);
    line-height: var(--pav-line-height-normal);
    opacity: 0.9;
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
    font-size: var(--pav-font-size-caption);
    font-weight: var(--pav-font-weight-medium);
    text-transform: uppercase;
    letter-spacing: var(--pav-letter-spacing-wider);
    color: var(--pav-color-stone-500);
  }

  &__info-value {
    font-size: var(--pav-font-size-body);
    color: var(--pav-text-primary);
    font-weight: var(--pav-font-weight-medium);
  }

  &__event-id {
    font-family: var(--pav-font-family-mono);
    font-size: var(--pav-font-size-caption);
    word-break: break-all;
  }

  &__description {
    padding-top: var(--pav-space-4);
    border-top: 1px solid var(--pav-border-primary);
  }

  &__description-text {
    margin: var(--pav-space-2) 0 0;
    font-size: var(--pav-font-size-body);
    line-height: var(--pav-line-height-relaxed);
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
    font-size: var(--pav-font-size-body);
    line-height: var(--pav-line-height-normal);
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
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-text-primary);
  }

  &__dismiss-warning {
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    font-size: var(--pav-font-size-small);
    background-color: var(--pav-color-amber-50);
    border: 1px solid var(--pav-color-amber-200);
    color: var(--pav-color-amber-700);

    @media (prefers-color-scheme: dark) {
      background-color: oklch(0.769 0.188 70.08 / 0.1);
      border-color: oklch(0.769 0.188 70.08 / 0.2);
      color: var(--pav-color-amber-300);
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
    font-size: var(--pav-font-size-small);
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
    font-size: var(--pav-font-size-small);
  }

  &__timeline-date {
    font-size: var(--pav-font-size-caption);
    color: var(--pav-color-stone-500);
    white-space: nowrap;
  }

  &__timeline-decision {
    font-size: var(--pav-font-size-small);
    color: var(--pav-text-primary);
  }

  &__timeline-decision-label {
    font-weight: var(--pav-font-weight-medium);
  }

  &__timeline-notes {
    font-size: var(--pav-font-size-small);
    color: var(--pav-color-stone-600);
    font-style: italic;
    white-space: pre-wrap;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__timeline-reviewer {
    font-size: var(--pav-font-size-caption);
    color: var(--pav-color-stone-500);
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
</style>
