<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import { ReportCategory } from '@/common/model/report';
import type { AdminPriority } from '@/common/model/report';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created'): void;
}>();

const { t } = useTranslation('admin', {
  keyPrefix: 'moderation.create',
});

const moderationStore = useModerationStore();

const state = reactive({
  eventId: '',
  category: '' as string,
  description: '',
  priority: '' as string,
  deadline: '',
  adminNotes: '',
  isSubmitting: false,
  validationErrors: {
    eventId: '',
    category: '',
    description: '',
    priority: '',
  },
  successMessage: '',
  errorMessage: '',
});

const categoryOptions = [
  { value: '', label: t('category_placeholder') },
  { value: ReportCategory.SPAM, label: t('category.spam') },
  { value: ReportCategory.INAPPROPRIATE, label: t('category.inappropriate') },
  { value: ReportCategory.MISLEADING, label: t('category.misleading') },
  { value: ReportCategory.HARASSMENT, label: t('category.harassment') },
  { value: ReportCategory.OTHER, label: t('category.other') },
];

const priorityOptions = [
  { value: '', label: t('priority_placeholder') },
  { value: 'low', label: t('priority.low') },
  { value: 'medium', label: t('priority.medium') },
  { value: 'high', label: t('priority.high') },
];

function validateForm(): boolean {
  let isValid = true;

  // Reset errors
  state.validationErrors = {
    eventId: '',
    category: '',
    description: '',
    priority: '',
  };

  // Validate event ID
  if (!state.eventId.trim()) {
    state.validationErrors.eventId = t('error.event_id_required');
    isValid = false;
  }

  // Validate category
  if (!state.category) {
    state.validationErrors.category = t('error.category_required');
    isValid = false;
  }

  // Validate description
  if (!state.description.trim()) {
    state.validationErrors.description = t('error.description_required');
    isValid = false;
  }

  // Validate priority
  if (!state.priority) {
    state.validationErrors.priority = t('error.priority_required');
    isValid = false;
  }

  return isValid;
}

async function handleSubmit() {
  if (!validateForm()) {
    return;
  }

  state.isSubmitting = true;
  state.errorMessage = '';
  state.successMessage = '';

  try {
    await moderationStore.createAdminReport({
      eventId: state.eventId.trim(),
      category: state.category,
      description: state.description.trim(),
      priority: state.priority as AdminPriority,
      deadline: state.deadline || undefined,
      adminNotes: state.adminNotes.trim() || undefined,
    });

    state.successMessage = t('success');

    // Emit created event and close modal after brief delay
    setTimeout(() => {
      emit('created');
      emit('close');
    }, 1500);
  }
  catch (error) {
    console.error('Error creating report:', error);
    state.errorMessage = moderationStore.adminError || t('error.create_failed');
  }
  finally {
    state.isSubmitting = false;
  }
}

function handleCancel() {
  emit('close');
}
</script>

<template>
  <div class="modal-overlay" @click.self="handleCancel">
    <div class="modal-content"
         role="dialog"
         aria-labelledby="create-report-title"
         aria-modal="true">
      <div class="modal-header">
        <h2 id="create-report-title">{{ t('title') }}</h2>
        <button
          type="button"
          class="close-button"
          @click="handleCancel"
          :aria-label="t('close')"
        >
          <svg width="20"
               height="20"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2">
            <line x1="18"
                  y1="6"
                  x2="6"
                  y2="18"/>
            <line x1="6"
                  y1="6"
                  x2="18"
                  y2="18"/>
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Success Message -->
        <div v-if="state.successMessage" class="message message-success" role="status">
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

        <!-- Error Message -->
        <div v-if="state.errorMessage" class="message message-error" role="alert">
          <svg class="message-icon"
               width="20"
               height="20"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15"
                  y1="9"
                  x2="9"
                  y2="15"/>
            <line x1="9"
                  y1="9"
                  x2="15"
                  y2="15"/>
          </svg>
          {{ state.errorMessage }}
        </div>

        <form @submit.prevent="handleSubmit" class="report-form">
          <!-- Event ID -->
          <div class="form-group">
            <label for="event-id" class="form-label">
              {{ t('event_id') }}
              <span class="required-indicator" aria-label="required">*</span>
            </label>
            <input
              id="event-id"
              type="text"
              v-model="state.eventId"
              class="form-input"
              :class="{ 'has-error': state.validationErrors.eventId }"
              :placeholder="t('event_id_placeholder')"
              :disabled="state.isSubmitting"
              :aria-invalid="!!state.validationErrors.eventId"
              :aria-describedby="state.validationErrors.eventId ? 'event-id-error' : 'event-id-help'"
            />
            <p v-if="state.validationErrors.eventId"
               id="event-id-error"
               class="error-text"
               role="alert">
              {{ state.validationErrors.eventId }}
            </p>
            <p v-else id="event-id-help" class="help-text">
              {{ t('event_id_help') }}
            </p>
          </div>

          <!-- Category -->
          <div class="form-group">
            <label for="category" class="form-label">
              {{ t('category') }}
              <span class="required-indicator" aria-label="required">*</span>
            </label>
            <select
              id="category"
              v-model="state.category"
              class="form-select"
              :class="{ 'has-error': state.validationErrors.category }"
              :disabled="state.isSubmitting"
              :aria-invalid="!!state.validationErrors.category"
              :aria-describedby="state.validationErrors.category ? 'category-error' : undefined"
            >
              <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <p v-if="state.validationErrors.category"
               id="category-error"
               class="error-text"
               role="alert">
              {{ state.validationErrors.category }}
            </p>
          </div>

          <!-- Description -->
          <div class="form-group">
            <label for="description" class="form-label">
              {{ t('description') }}
              <span class="required-indicator" aria-label="required">*</span>
            </label>
            <textarea
              id="description"
              v-model="state.description"
              class="form-textarea"
              :class="{ 'has-error': state.validationErrors.description }"
              :placeholder="t('description_placeholder')"
              rows="4"
              :disabled="state.isSubmitting"
              :aria-invalid="!!state.validationErrors.description"
              :aria-describedby="state.validationErrors.description ? 'description-error' : undefined"
            />
            <p v-if="state.validationErrors.description"
               id="description-error"
               class="error-text"
               role="alert">
              {{ state.validationErrors.description }}
            </p>
          </div>

          <!-- Priority -->
          <div class="form-group">
            <label for="priority" class="form-label">
              {{ t('priority') }}
              <span class="required-indicator" aria-label="required">*</span>
            </label>
            <select
              id="priority"
              v-model="state.priority"
              class="form-select"
              :class="{ 'has-error': state.validationErrors.priority }"
              :disabled="state.isSubmitting"
              :aria-invalid="!!state.validationErrors.priority"
              :aria-describedby="state.validationErrors.priority ? 'priority-error' : undefined"
            >
              <option v-for="option in priorityOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <p v-if="state.validationErrors.priority"
               id="priority-error"
               class="error-text"
               role="alert">
              {{ state.validationErrors.priority }}
            </p>
          </div>

          <!-- Deadline -->
          <div class="form-group">
            <label for="deadline" class="form-label">
              {{ t('deadline') }}
            </label>
            <input
              id="deadline"
              type="date"
              v-model="state.deadline"
              class="form-input"
              :disabled="state.isSubmitting"
              :aria-describedby="'deadline-help'"
            />
            <p id="deadline-help" class="help-text">
              {{ t('deadline_help') }}
            </p>
          </div>

          <!-- Admin Notes -->
          <div class="form-group">
            <label for="admin-notes" class="form-label">
              {{ t('admin_notes') }}
            </label>
            <textarea
              id="admin-notes"
              v-model="state.adminNotes"
              class="form-textarea"
              :placeholder="t('admin_notes_placeholder')"
              rows="3"
              :disabled="state.isSubmitting"
              :aria-describedby="'admin-notes-help'"
            />
            <p id="admin-notes-help" class="help-text">
              {{ t('admin_notes_help') }}
            </p>
          </div>

          <!-- Form Actions -->
          <div class="form-actions">
            <button
              type="button"
              class="button button-secondary"
              @click="handleCancel"
              :disabled="state.isSubmitting"
            >
              {{ t('cancel') }}
            </button>
            <button
              type="submit"
              class="button button-primary"
              :disabled="state.isSubmitting"
            >
              {{ state.isSubmitting ? t('creating') : t('create') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--pav-space-4);

  @media (prefers-color-scheme: dark) {
    background: rgba(0, 0, 0, 0.7);
  }
}

.modal-content {
  background: var(--pav-color-surface-primary);
  border-radius: var(--pav-border-radius-xl);
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);

  @media (prefers-color-scheme: dark) {
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--pav-space-5) var(--pav-space-6);
    border-bottom: 1px solid var(--pav-border-color-light);

    h2 {
      margin: 0;
      font-size: var(--pav-font-size-lg);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    .close-button {
      padding: var(--pav-space-1);
      background: none;
      border: none;
      color: var(--pav-color-text-muted);
      cursor: pointer;
      transition: color 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;

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

  .modal-body {
    padding: var(--pav-space-6);
    overflow-y: auto;

    .message {
      display: flex;
      align-items: center;
      gap: var(--pav-space-2);
      padding: var(--pav-space-3) var(--pav-space-4);
      border-radius: var(--pav-border-radius-md);
      font-size: var(--pav-font-size-xs);
      margin-bottom: var(--pav-space-5);

      .message-icon {
        flex-shrink: 0;
      }

      &.message-success {
        background: var(--pav-color-emerald-50);
        border: 1px solid var(--pav-color-emerald-200);
        color: var(--pav-color-emerald-800);
      }

      &.message-error {
        background: var(--pav-color-red-50);
        border: 1px solid var(--pav-color-red-200);
        color: var(--pav-color-red-700);
      }
    }

    .report-form {
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

        .form-input,
        .form-select,
        .form-textarea {
          padding: var(--pav-space-2_5) var(--pav-space-3);
          border: 1px solid var(--pav-border-color-light);
          border-radius: var(--pav-border-radius-md);
          font-size: var(--pav-font-size-xs);
          font-family: inherit;
          color: var(--pav-color-text-primary);
          background: var(--pav-color-surface-primary);

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

        .form-select {
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2378716C' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: var(--pav-space-8);
        }

        .form-textarea {
          resize: vertical;
        }

        .error-text {
          margin: 0;
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-error);
        }

        .help-text {
          margin: 0;
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-text-muted);
        }
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--pav-space-3);
        padding-top: var(--pav-space-2);

        .button {
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

          &.button-secondary {
            background: var(--pav-color-surface-secondary);
            color: var(--pav-color-text-primary);
            border: 1px solid var(--pav-border-color-light);

            &:hover:not(:disabled) {
              background: var(--pav-color-stone-100);
            }
          }

          &.button-primary {
            background: var(--pav-color-brand-primary);
            color: #fff;

            &:hover:not(:disabled) {
              background: var(--pav-color-brand-primary-dark);
            }
          }
        }
      }
    }
  }
}

// Dark mode adjustments
@media (prefers-color-scheme: dark) {
  .modal-content {
    .modal-body {
      .message {
        &.message-success {
          background: rgba(16, 185, 129, 0.1);
          border-color: rgba(16, 185, 129, 0.3);
          color: var(--pav-color-emerald-300);
        }

        &.message-error {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
          color: var(--pav-color-red-300);
        }
      }

      .report-form {
        .form-group {
          .form-input,
          .form-select,
          .form-textarea {
            background: var(--pav-color-surface-secondary);
            border-color: var(--pav-color-stone-600);

            &:focus {
              border-color: var(--pav-color-brand-primary);
            }
          }

          .form-select {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23A8A29E' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          }
        }

        .form-actions {
          .button {
            &.button-secondary {
              background: var(--pav-color-stone-800);
              border-color: var(--pav-color-stone-600);

              &:hover:not(:disabled) {
                background: var(--pav-color-stone-700);
              }
            }
          }
        }
      }
    }
  }
}
</style>
