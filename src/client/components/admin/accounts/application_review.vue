<template>
  <Modal :title="t('application_details')" modal-class="review-modal" @close="$emit('close')">
    <div class="review-content">
      <!-- Email -->
      <div class="review-field">
        <label class="field-label">{{ t('email_label') }}</label>
        <p class="field-value">{{ application.email }}</p>
      </div>

      <!-- Status -->
      <div class="review-field">
        <label class="field-label">{{ t('status_label') }}</label>
        <div class="status-row">
          <span class="status-badge status-badge--pending">{{ t('status_pending') }}</span>
          <span class="status-since">{{ t('since_date', { date: formatDate(application.statusTimestamp) }) }}</span>
        </div>
      </div>

      <!-- Message -->
      <div class="review-field">
        <label class="field-label">{{ t('message_label') }}</label>
        <div class="message-card">
          <p class="message-text">{{ application.message || t('no_message') }}</p>
        </div>
      </div>

      <!-- Actions -->
      <div class="review-actions">
        <button type="button" class="btn-silent-reject" @click="$emit('reject', application, true)">
          {{ t('silent_reject') }}
        </button>
        <div class="action-buttons">
          <button type="button" class="btn-reject" @click="$emit('reject', application, false)">
            {{ t('reject') }}
          </button>
          <button type="button" class="btn-accept" @click="$emit('accept', application)">
            {{ t('accept') }}
          </button>
        </div>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import Modal from '@/client/components/common/modal.vue';

defineProps({
  application: {
    type: Object,
    required: true,
  },
});

defineEmits(['close', 'accept', 'reject']);

const { t } = useTranslation('admin', {
  keyPrefix: 'applications',
});

const formatDate = (date) => {
  if (!date) return '';
  return DateTime.fromJSDate(date).toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' });
};
</script>

<style scoped lang="scss">
.review-content {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  .review-field {
    .field-label {
      display: block;
      font-size: var(--pav-font-size-2xs);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-muted);
      text-transform: uppercase;
      letter-spacing: var(--pav-letter-spacing-wide);
      margin-bottom: var(--pav-space-1);
    }

    .field-value {
      margin: 0;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: var(--pav-space-2);

      .status-since {
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }

    .message-card {
      padding: var(--pav-space-4);
      background: var(--pav-color-stone-50);
      border-radius: var(--pav-border-radius-md);

      .message-text {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-secondary);
        white-space: pre-wrap;
      }
    }
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--pav-space-1) var(--pav-space-2_5);
    border-radius: var(--pav-border-radius-full);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-medium);

    &--pending {
      background: var(--pav-color-amber-100);
      color: var(--pav-color-amber-700);
    }
  }

  .review-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: var(--pav-space-4);
    border-top: 1px solid var(--pav-border-color-light);

    .btn-silent-reject {
      background: none;
      border: none;
      color: var(--pav-color-text-muted);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      font-family: inherit;
      cursor: pointer;
      padding: 0;
      transition: color 0.2s ease;

      &:hover {
        color: var(--pav-color-text-secondary);
      }
    }

    .action-buttons {
      display: flex;
      gap: var(--pav-space-3);

      .btn-reject {
        padding: var(--pav-space-2) var(--pav-space-5);
        background: none;
        border: 1px solid var(--pav-color-red-300);
        border-radius: var(--pav-border-radius-full);
        color: var(--pav-color-red-600);
        font-weight: var(--pav-font-weight-medium);
        font-size: var(--pav-font-size-xs);
        font-family: inherit;
        cursor: pointer;
        transition: background-color 0.2s ease;

        &:hover {
          background: var(--pav-color-red-50);
        }
      }

      .btn-accept {
        padding: var(--pav-space-2) var(--pav-space-5);
        background: var(--pav-color-emerald-500);
        border: none;
        border-radius: var(--pav-border-radius-full);
        color: var(--pav-color-text-inverse);
        font-weight: var(--pav-font-weight-medium);
        font-size: var(--pav-font-size-xs);
        font-family: inherit;
        cursor: pointer;
        transition: background-color 0.2s ease;

        &:hover {
          background: var(--pav-color-emerald-600);
        }
      }
    }
  }
}

@media (prefers-color-scheme: dark) {
  .review-content {
    .review-field {
      .message-card {
        background: var(--pav-color-stone-800);

        .message-text {
          color: var(--pav-color-stone-300);
        }
      }
    }

    .status-badge {
      &--pending {
        background: rgba(245, 158, 11, 0.15);
        color: var(--pav-color-amber-300);
      }
    }

    .review-actions {
      .btn-silent-reject {
        color: var(--pav-color-stone-400);

        &:hover {
          color: var(--pav-color-stone-300);
        }
      }

      .action-buttons {
        .btn-reject {
          border-color: var(--pav-color-red-700);
          color: var(--pav-color-red-400);

          &:hover {
            background: rgba(239, 68, 68, 0.1);
          }
        }
      }
    }
  }
}
</style>
