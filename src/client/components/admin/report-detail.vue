<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useModerationStore } from '@/client/stores/moderation-store';
import { useTranslation } from 'i18next-vue';
import { ReportCategory, ReportStatus } from '@/common/model/report';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import { DateTime } from 'luxon';
import { reactive, ref } from 'vue';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation('admin', {
  keyPrefix: 'moderation.detail',
});
const moderationStore = useModerationStore();

const reportId = route.params.reportId as string;

const state = reactive({
  adminNotes: '',
  showValidationError: false,
  successMessage: '',
  isSubmitting: false,
});

onMounted(async () => {
  await moderationStore.fetchAdminReport(reportId);
});

const report = computed(() => moderationStore.currentAdminReport?.report);
const escalationHistory = computed(() => moderationStore.currentAdminReport?.escalationHistory ?? []);

const formatDate = (date: Date | string | null): string => {
  if (!date) return '—';
  const dt = typeof date === 'string' ? DateTime.fromISO(date) : DateTime.fromJSDate(date);
  return dt.toLocaleString(DateTime.DATETIME_MED);
};

const formatDeadline = (deadline: Date | string | null): string => {
  if (!deadline) return '—';
  const dt = typeof deadline === 'string' ? DateTime.fromISO(deadline) : DateTime.fromJSDate(deadline);
  const now = DateTime.now();
  const diffHours = dt.diff(now, 'hours').hours;

  if (diffHours < 0) {
    return `${t('deadline_overdue')} (${dt.toLocaleString(DateTime.DATE_MED)})`;
  }
  else if (diffHours < 24) {
    return t('deadline_today');
  }
  else if (diffHours < 48) {
    return t('deadline_tomorrow');
  }
  else {
    return dt.toLocaleString(DateTime.DATE_MED);
  }
};

const getEscalationBadge = () => {
  if (!report.value) return null;

  if (report.value.reporterType === 'administrator') {
    return { label: t('badge.admin_initiated'), class: 'escalation-admin' };
  }
  else if (report.value.escalationType === 'manual') {
    return { label: t('badge.manually_escalated'), class: 'escalation-manual' };
  }
  else if (report.value.escalationType === 'automatic') {
    return { label: t('badge.auto_escalated'), class: 'escalation-auto' };
  }
  return null;
};

async function handleAction(action: 'override' | 'resolve' | 'dismiss') {
  if (!state.adminNotes.trim()) {
    state.showValidationError = true;
    return;
  }

  state.showValidationError = false;
  state.isSubmitting = true;

  try {
    if (action === 'override') {
      await moderationStore.adminOverrideReport(reportId, state.adminNotes);
      state.successMessage = t('override_success');
    }
    else if (action === 'dismiss') {
      await moderationStore.adminDismissReport(reportId, state.adminNotes);
      state.successMessage = t('dismiss_success');
    }
    else {
      await moderationStore.adminResolveReport(reportId, state.adminNotes);
      state.successMessage = t('resolve_success');
    }

    // Redirect back to dashboard after brief delay
    setTimeout(() => {
      router.push({ name: 'moderation' });
    }, 1500);
  }
  catch (error) {
    console.error('Error performing action:', error);
  }
  finally {
    state.isSubmitting = false;
  }
}

function goBack() {
  router.push({ name: 'moderation' });
}
</script>

<template>
  <div class="admin-report-detail">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-top">
        <button type="button"
                class="back-button"
                @click="goBack"
                :aria-label="t('back')">
          <svg width="20"
               height="20"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {{ t('back') }}
        </button>
      </div>
      <div class="page-header-text">
        <h1>{{ t('title') }}</h1>
        <p class="page-subtitle">{{ t('subtitle') }}</p>
      </div>
    </div>

    <!-- Loading State -->
    <LoadingMessage
      v-if="moderationStore.loadingAdminReport"
      :description="t('loading')"
    />

    <!-- Error State -->
    <div v-else-if="moderationStore.adminError" class="error-message">
      <p>{{ t('error') }}: {{ moderationStore.adminError }}</p>
    </div>

    <!-- Success Message -->
    <div v-if="state.successMessage" class="success-message" role="status">
      <svg class="message-icon"
           width="20"
           height="20"
           viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      {{ state.successMessage }}
    </div>

    <!-- Report Content -->
    <div v-else-if="report" class="report-content">
      <!-- Report Information Card -->
      <section class="info-card" aria-labelledby="report-info-heading">
        <h2 id="report-info-heading" class="section-heading">{{ t('report_information') }}</h2>

        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">{{ t('event_id') }}</span>
            <span class="info-value event-id">{{ report.eventId }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('calendar_id') }}</span>
            <span class="info-value calendar-id">{{ report.calendarId }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('category') }}</span>
            <span class="category-badge">{{ t(`category.${report.category}`) }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('reporter_type') }}</span>
            <span class="info-value">{{ t(`reporter.${report.reporterType}`) }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('status') }}</span>
            <span class="status-badge">{{ t(`status.${report.status}`) }}</span>
          </div>

          <div v-if="getEscalationBadge()" class="info-item">
            <span class="info-label">{{ t('escalation_type') }}</span>
            <span :class="['escalation-badge', getEscalationBadge()?.class]">
              {{ getEscalationBadge()?.label }}
            </span>
          </div>

          <div v-if="report.adminPriority" class="info-item">
            <span class="info-label">{{ t('priority') }}</span>
            <span :class="['priority-badge', `priority-${report.adminPriority}`]">
              {{ t(`priority.${report.adminPriority}`) }}
            </span>
          </div>

          <div v-if="report.adminDeadline" class="info-item">
            <span class="info-label">{{ t('deadline') }}</span>
            <span class="info-value">{{ formatDeadline(report.adminDeadline) }}</span>
          </div>

          <div class="info-item info-item-full">
            <span class="info-label">{{ t('description') }}</span>
            <p class="info-value description">{{ report.description }}</p>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('created_at') }}</span>
            <span class="info-value">{{ formatDate(report.createdAt) }}</span>
          </div>

          <div class="info-item">
            <span class="info-label">{{ t('updated_at') }}</span>
            <span class="info-value">{{ formatDate(report.updatedAt) }}</span>
          </div>
        </div>
      </section>

      <!-- Owner Review Section -->
      <section v-if="report.ownerNotes || report.reviewerNotes" class="info-card" aria-labelledby="owner-review-heading">
        <h2 id="owner-review-heading" class="section-heading">{{ t('owner_review') }}</h2>

        <div class="review-content">
          <div v-if="report.ownerNotes" class="review-item">
            <span class="review-label">{{ t('owner_notes') }}</span>
            <p class="review-text">{{ report.ownerNotes }}</p>
          </div>

          <div v-if="report.reviewerNotes" class="review-item">
            <span class="review-label">{{ t('reviewer_decision') }}</span>
            <p class="review-text">{{ report.reviewerNotes }}</p>
            <span v-if="report.reviewerTimestamp" class="review-timestamp">
              {{ formatDate(report.reviewerTimestamp) }}
            </span>
          </div>
        </div>
      </section>

      <!-- Escalation Timeline -->
      <section v-if="escalationHistory.length > 0" class="info-card" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" class="section-heading">{{ t('escalation_timeline') }}</h2>

        <ol class="timeline" aria-label="Report escalation timeline">
          <li v-for="record in escalationHistory" :key="record.id" class="timeline-item">
            <div class="timeline-marker" :aria-label="t('timeline_event')"/>
            <div class="timeline-content">
              <div class="timeline-header">
                <span class="timeline-transition">
                  {{ t(`status.${record.fromStatus}`) }} → {{ t(`status.${record.toStatus}`) }}
                </span>
                <span class="timeline-date">{{ formatDate(record.createdAt) }}</span>
              </div>
              <div class="timeline-meta">
                <span class="timeline-role">{{ t(`role.${record.reviewerRole}`) }}</span>
                <span class="timeline-decision">{{ record.decision }}</span>
              </div>
              <p v-if="record.notes" class="timeline-notes">{{ record.notes }}</p>
            </div>
          </li>
        </ol>
      </section>

      <!-- Admin Action Section -->
      <section
        v-if="report.status !== ReportStatus.RESOLVED && report.status !== ReportStatus.DISMISSED"
        class="admin-actions-card"
        aria-labelledby="admin-actions-heading"
      >
        <h2 id="admin-actions-heading" class="section-heading">{{ t('admin_actions') }}</h2>

        <div class="actions-form">
          <div class="form-group">
            <label for="admin-notes" class="form-label">
              {{ t('admin_notes_label') }}
              <span class="required-indicator" aria-label="required">*</span>
            </label>
            <textarea
              id="admin-notes"
              v-model="state.adminNotes"
              class="form-textarea"
              :class="{ 'has-error': state.showValidationError }"
              :placeholder="t('admin_notes_placeholder')"
              rows="4"
              :disabled="state.isSubmitting"
              :aria-invalid="state.showValidationError"
              :aria-describedby="state.showValidationError ? 'notes-error' : undefined"
            />
            <p v-if="state.showValidationError"
               id="notes-error"
               class="error-text"
               role="alert">
              {{ t('notes_required') }}
            </p>
          </div>

          <div class="action-buttons">
            <button
              type="button"
              class="action-button action-resolve"
              @click="handleAction('resolve')"
              :disabled="state.isSubmitting"
            >
              {{ t('resolve') }}
            </button>
            <button
              type="button"
              class="action-button action-override"
              @click="handleAction('override')"
              :disabled="state.isSubmitting"
            >
              {{ t('override') }}
            </button>
            <button
              type="button"
              class="action-button action-dismiss"
              @click="handleAction('dismiss')"
              :disabled="state.isSubmitting"
            >
              {{ t('dismiss') }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.admin-report-detail {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
  max-width: 900px;

  .page-header {
    .page-header-top {
      margin-bottom: var(--pav-space-4);

      .back-button {
        display: inline-flex;
        align-items: center;
        gap: var(--pav-space-1);
        padding: var(--pav-space-1) var(--pav-space-2);
        background: none;
        border: none;
        color: var(--pav-color-text-secondary);
        font-size: var(--pav-font-size-xs);
        font-family: inherit;
        cursor: pointer;
        transition: color 0.2s ease;

        &:hover {
          color: var(--pav-color-text-primary);
        }

        &:focus-visible {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
          border-radius: var(--pav-border-radius-xs);
        }
      }
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
  }

  .error-message {
    padding: var(--pav-space-4);
    background: var(--pav-color-error-bg);
    color: var(--pav-color-error-text);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-error);
  }

  .success-message {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
    padding: var(--pav-space-4);
    background: var(--pav-color-emerald-50);
    color: var(--pav-color-emerald-800);
    border-radius: var(--pav-border-radius-lg);
    border: 1px solid var(--pav-color-emerald-200);

    .message-icon {
      flex-shrink: 0;
    }
  }

  .report-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-6);
  }

  .info-card,
  .admin-actions-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    padding: var(--pav-space-6);

    .section-heading {
      margin: 0 0 var(--pav-space-4) 0;
      font-size: var(--pav-font-size-lg);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--pav-space-4);

    @include pav-media(sm) {
      grid-template-columns: repeat(2, 1fr);
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-1);

      &.info-item-full {
        grid-column: 1 / -1;
      }

      .info-label {
        font-size: var(--pav-font-size-2xs);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-muted);
        text-transform: uppercase;
        letter-spacing: var(--pav-letter-spacing-wider);
      }

      .info-value {
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-primary);

        &.event-id,
        &.calendar-id {
          font-family: monospace;
          font-size: var(--pav-font-size-2xs);
          word-break: break-all;
        }

        &.description {
          margin: var(--pav-space-1) 0 0 0;
          line-height: 1.5;
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
    width: fit-content;
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

  .review-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);

    .review-item {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-2);

      .review-label {
        font-size: var(--pav-font-size-2xs);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-muted);
        text-transform: uppercase;
        letter-spacing: var(--pav-letter-spacing-wider);
      }

      .review-text {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-primary);
        line-height: 1.5;
      }

      .review-timestamp {
        font-size: var(--pav-font-size-2xs);
        color: var(--pav-color-text-muted);
      }
    }
  }

  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;

    &::before {
      content: '';
      position: absolute;
      left: 8px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--pav-border-color-light);
    }

    .timeline-item {
      position: relative;
      padding-left: var(--pav-space-8);
      padding-bottom: var(--pav-space-5);

      &:last-child {
        padding-bottom: 0;
      }

      .timeline-marker {
        position: absolute;
        left: 0;
        top: 4px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--pav-color-brand-primary);
        border: 2px solid var(--pav-color-surface-primary);
        z-index: 1;
      }

      .timeline-content {
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-1_5);

        .timeline-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--pav-space-2);

          .timeline-transition {
            font-size: var(--pav-font-size-xs);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .timeline-date {
            font-size: var(--pav-font-size-2xs);
            color: var(--pav-color-text-muted);
          }
        }

        .timeline-meta {
          display: flex;
          flex-wrap: wrap;
          gap: var(--pav-space-2);
          font-size: var(--pav-font-size-2xs);

          .timeline-role {
            color: var(--pav-color-text-secondary);
          }

          .timeline-decision {
            color: var(--pav-color-text-muted);
          }
        }

        .timeline-notes {
          margin: 0;
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-secondary);
          line-height: 1.5;
        }
      }
    }
  }

  .actions-form {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-5);

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-2);

      .form-label {
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-secondary);

        .required-indicator {
          color: var(--pav-color-error);
          margin-left: var(--pav-space-0_5);
        }
      }

      .form-textarea {
        padding: var(--pav-space-3);
        border: 1px solid var(--pav-border-color-light);
        border-radius: var(--pav-border-radius-md);
        font-size: var(--pav-font-size-xs);
        font-family: inherit;
        color: var(--pav-color-text-primary);
        background: var(--pav-color-surface-primary);
        resize: vertical;

        &:focus {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
        }

        &.has-error {
          border-color: var(--pav-color-error);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .error-text {
        margin: 0;
        font-size: var(--pav-font-size-2xs);
        color: var(--pav-color-error);
      }
    }

    .action-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pav-space-3);

      .action-button {
        padding: var(--pav-space-2_5) var(--pav-space-5);
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        font-family: inherit;
        border: none;
        border-radius: var(--pav-border-radius-full);
        cursor: pointer;
        transition: all 0.2s ease;

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        &:focus-visible {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
        }

        &.action-resolve {
          background: var(--pav-color-emerald-600);
          color: #fff;

          &:hover:not(:disabled) {
            background: var(--pav-color-emerald-700);
          }
        }

        &.action-override {
          background: var(--pav-color-orange-600);
          color: #fff;

          &:hover:not(:disabled) {
            background: var(--pav-color-orange-700);
          }
        }

        &.action-dismiss {
          background: var(--pav-color-red-600);
          color: #fff;

          &:hover:not(:disabled) {
            background: var(--pav-color-red-700);
          }
        }
      }
    }
  }
}

// Dark mode adjustments
@media (prefers-color-scheme: dark) {
  .admin-report-detail {
    .success-message {
      background: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.3);
      color: var(--pav-color-emerald-300);
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

    .timeline {
      &::before {
        background: var(--pav-color-stone-700);
      }
    }
  }
}
</style>
