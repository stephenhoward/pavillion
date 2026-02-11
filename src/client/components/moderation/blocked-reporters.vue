<script setup lang="ts">
/**
 * Blocked Reporters Component
 *
 * Displays a list of blocked reporter email addresses
 * with admin controls for managing the block list.
 */
import { reactive, onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import type { BlockedReporter } from '@/common/model/blocked_reporter';
import BlockedReportersService from '@/client/service/blocked-reporters';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const { t } = useTranslation('system', {
  keyPrefix: 'moderation.blocked_reporters',
});

const service = new BlockedReportersService();

const state = reactive({
  blockedReporters: [] as BlockedReporter[],
  loading: false,
  error: '',
  showBlockModal: false,
  blockForm: {
    email: '',
    reason: '',
  },
  validationErrors: {
    email: '',
    reason: '',
  },
  isBlocking: false,
  blockError: '',
  successMessage: '',
  showUnblockModal: false,
  unblockTarget: null as BlockedReporter | null,
  isUnblocking: false,
  unblockError: '',
});

/**
 * Formats a date for display in the table.
 *
 * @param date - Date or ISO string to format
 * @returns Formatted date string
 */
const formatDate = (date: Date | string): string => {
  const dt = date instanceof Date ? DateTime.fromJSDate(date) : DateTime.fromISO(date as string);
  return dt.toLocaleString(DateTime.DATE_MED);
};

/**
 * Truncates long email hashes for display.
 *
 * @param hash - The email hash to display
 * @returns Truncated hash string
 */
const truncateHash = (hash: string): string => {
  if (hash.length <= 16) {
    return hash;
  }
  return `${hash.substring(0, 12)}...${hash.substring(hash.length - 4)}`;
};

/**
 * Fetches the list of blocked reporters from the API.
 */
const fetchBlockedReporters = async () => {
  state.loading = true;
  state.error = '';

  try {
    state.blockedReporters = await service.listBlockedReporters();
  }
  catch (error: unknown) {
    console.error('Error fetching blocked reporters:', error);
    state.error = t('error_loading');
  }
  finally {
    state.loading = false;
  }
};

/**
 * Opens the block reporter modal.
 */
const openBlockModal = () => {
  state.showBlockModal = true;
  state.blockForm = {
    email: '',
    reason: '',
  };
  state.validationErrors = {
    email: '',
    reason: '',
  };
  state.blockError = '';
  state.successMessage = '';
};

/**
 * Closes the block reporter modal.
 */
const closeBlockModal = () => {
  state.showBlockModal = false;
};

/**
 * Validates email format.
 *
 * @param email - Email to validate
 * @returns True if valid
 */
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates the block form.
 *
 * @returns True if form is valid
 */
const validateBlockForm = (): boolean => {
  let isValid = true;

  // Reset errors
  state.validationErrors = {
    email: '',
    reason: '',
  };

  // Validate email
  if (!state.blockForm.email || state.blockForm.email.trim().length === 0) {
    state.validationErrors.email = t('validation_email_required');
    isValid = false;
  }
  else if (!isValidEmail(state.blockForm.email.trim())) {
    state.validationErrors.email = t('validation_email_invalid');
    isValid = false;
  }

  // Validate reason
  if (!state.blockForm.reason || state.blockForm.reason.trim().length === 0) {
    state.validationErrors.reason = t('validation_reason_required');
    isValid = false;
  }

  return isValid;
};

/**
 * Blocks a reporter email address.
 */
const blockReporter = async () => {
  if (!validateBlockForm()) {
    return;
  }

  state.isBlocking = true;
  state.blockError = '';
  state.successMessage = '';

  try {
    await service.blockReporter(
      state.blockForm.email.trim(),
      state.blockForm.reason.trim(),
    );

    state.successMessage = t('block_success');

    // Refresh list
    await fetchBlockedReporters();

    // Close modal
    closeBlockModal();
  }
  catch (error: unknown) {
    console.error('Error blocking reporter:', error);
    state.blockError = t('block_error');
  }
  finally {
    state.isBlocking = false;
  }
};

/**
 * Opens the unblock confirmation modal.
 *
 * @param reporter - The blocked reporter to unblock
 */
const openUnblockModal = (reporter: BlockedReporter) => {
  state.showUnblockModal = true;
  state.unblockTarget = reporter;
  state.unblockError = '';
  state.successMessage = '';
};

/**
 * Closes the unblock confirmation modal.
 */
const closeUnblockModal = () => {
  state.showUnblockModal = false;
  state.unblockTarget = null;
  state.unblockError = '';
};

/**
 * Unblocks a reporter email address.
 */
const unblockReporter = async () => {
  if (!state.unblockTarget) return;

  state.isUnblocking = true;
  state.unblockError = '';
  state.successMessage = '';

  try {
    await service.unblockReporter(state.unblockTarget.emailHash);

    state.successMessage = t('unblock_success');

    // Refresh list
    await fetchBlockedReporters();

    // Close modal
    closeUnblockModal();
  }
  catch (error: unknown) {
    console.error('Error unblocking reporter:', error);
    state.unblockError = t('unblock_error');
  }
  finally {
    state.isUnblocking = false;
  }
};

onMounted(async () => {
  await fetchBlockedReporters();
});
</script>

<template>
  <div class="blocked-reporters">
    <!-- Header -->
    <header class="blocked-reporters__header">
      <h2 class="blocked-reporters__title">{{ t('title') }}</h2>
      <button
        class="block-reporter-button"
        @click="openBlockModal"
      >
        {{ t('block_button') }}
      </button>
    </header>

    <!-- Success Message -->
    <div v-if="state.successMessage"
         class="blocked-reporters__success"
         role="status"
         aria-live="polite">
      {{ state.successMessage }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.loading" :description="t('loading')" />

    <!-- Error State -->
    <div v-else-if="state.error" class="blocked-reporters__error" role="alert">
      {{ state.error }}
    </div>

    <!-- Empty State -->
    <EmptyLayout
      v-else-if="state.blockedReporters.length === 0"
      :title="t('empty')"
      :description="t('empty_description')"
    />

    <!-- Blocked Reporters Table -->
    <div v-else class="blocked-reporters__table-container">
      <table class="blocked-reporters__table" role="grid" :aria-label="t('table_label')">
        <thead>
          <tr>
            <th scope="col">{{ t('column_email_hash') }}</th>
            <th scope="col">{{ t('column_reason') }}</th>
            <th scope="col">{{ t('column_blocked_by') }}</th>
            <th scope="col">{{ t('column_date_blocked') }}</th>
            <th scope="col">{{ t('column_actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="reporter in state.blockedReporters"
            :key="reporter.id"
            class="blocked-reporters__row"
          >
            <td>
              <span class="blocked-reporters__email-hash" :title="reporter.emailHash">
                {{ truncateHash(reporter.emailHash) }}
              </span>
            </td>
            <td>{{ reporter.reason }}</td>
            <td>{{ reporter.blockedBy }}</td>
            <td>{{ formatDate(reporter.createdAt) }}</td>
            <td>
              <button
                class="unblock-button"
                data-test="unblock-button"
                @click="openUnblockModal(reporter)"
                :aria-label="`${t('unblock_button')} ${truncateHash(reporter.emailHash)}`"
              >
                {{ t('unblock_button') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Block Reporter Modal -->
    <div v-if="state.showBlockModal" class="modal-overlay" @click.self="closeBlockModal">
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-modal-title"
      >
        <div class="modal-header">
          <h3 id="block-modal-title">{{ t('block_modal_title') }}</h3>
        </div>

        <div class="modal-body">
          <!-- Error Message -->
          <div v-if="state.blockError" class="modal-error" role="alert">
            {{ state.blockError }}
          </div>

          <!-- Email Field -->
          <div class="form-group">
            <label for="block-email-input" class="form-label">
              {{ t('block_email_label') }}
            </label>
            <input
              id="block-email-input"
              v-model="state.blockForm.email"
              type="email"
              class="form-input"
              :class="{ 'has-error': state.validationErrors.email }"
              :placeholder="t('block_email_placeholder')"
              :disabled="state.isBlocking"
              :aria-invalid="!!state.validationErrors.email"
              :aria-describedby="state.validationErrors.email ? 'email-error' : undefined"
            />
            <p
              v-if="state.validationErrors.email"
              id="email-error"
              class="error-text"
              role="alert"
            >
              {{ state.validationErrors.email }}
            </p>
          </div>

          <!-- Reason Field -->
          <div class="form-group">
            <label for="block-reason-input" class="form-label">
              {{ t('block_reason_label') }}
            </label>
            <textarea
              id="block-reason-input"
              v-model="state.blockForm.reason"
              class="form-textarea"
              :class="{ 'has-error': state.validationErrors.reason }"
              :placeholder="t('block_reason_placeholder')"
              :disabled="state.isBlocking"
              rows="3"
              :aria-invalid="!!state.validationErrors.reason"
              :aria-describedby="state.validationErrors.reason ? 'reason-error' : undefined"
            />
            <p
              v-if="state.validationErrors.reason"
              id="reason-error"
              class="error-text"
              role="alert"
            >
              {{ state.validationErrors.reason }}
            </p>
          </div>
        </div>

        <div class="modal-actions">
          <button
            class="modal-button cancel-button"
            @click="closeBlockModal"
            :disabled="state.isBlocking"
          >
            {{ t('block_cancel') }}
          </button>
          <button
            class="modal-button confirm-button"
            @click="blockReporter"
            :disabled="state.isBlocking"
          >
            {{ state.isBlocking ? t('blocking') : t('block_submit') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Unblock Reporter Modal -->
    <div v-if="state.showUnblockModal" class="modal-overlay" @click.self="closeUnblockModal">
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unblock-modal-title"
      >
        <div class="modal-header">
          <h3 id="unblock-modal-title">{{ t('unblock_modal_title') }}</h3>
        </div>

        <div class="modal-body">
          <!-- Description -->
          <p class="unblock-description">
            {{ t('unblock_modal_description') }}
          </p>

          <!-- Error Message -->
          <div v-if="state.unblockError" class="modal-error" role="alert">
            {{ state.unblockError }}
          </div>

          <!-- Reporter Details -->
          <div v-if="state.unblockTarget" class="unblock-details">
            <div class="detail-row">
              <span class="detail-label">{{ t('unblock_email_hash') }}:</span>
              <span class="detail-value blocked-reporters__email-hash">
                {{ state.unblockTarget.emailHash }}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">{{ t('unblock_reason') }}:</span>
              <span class="detail-value">{{ state.unblockTarget.reason }}</span>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button
            class="modal-button cancel-button"
            data-test="cancel-unblock"
            @click="closeUnblockModal"
            :disabled="state.isUnblocking"
          >
            {{ t('unblock_cancel') }}
          </button>
          <button
            class="modal-button confirm-button"
            data-test="confirm-unblock"
            @click="unblockReporter"
            :disabled="state.isUnblocking"
          >
            {{ state.isUnblocking ? t('unblocking') : t('unblock_submit') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/components/calendar-admin' as *;

.blocked-reporters {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  &__header {
    @include admin-section-header;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    @include admin-section-title;
  }

  .block-reporter-button {
    padding: var(--pav-space-2_5) var(--pav-space-5);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: #fff;
    background: var(--pav-color-brand-primary);
    border: none;
    border-radius: var(--pav-border-radius-full);
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background: var(--pav-color-brand-primary-dark);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-brand-primary);
      outline-offset: 2px;
    }
  }

  &__success {
    padding: var(--pav-space-3);
    border-radius: 0.75rem;
    font-size: var(--pav-font-size-small);
    background-color: var(--pav-color-emerald-50);
    border: 1px solid var(--pav-color-emerald-200);
    color: var(--pav-color-emerald-800);

    @media (prefers-color-scheme: dark) {
      background-color: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.3);
      color: var(--pav-color-emerald-300);
    }
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
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--pav-color-stone-50);

      @media (prefers-color-scheme: dark) {
        background-color: var(--pav-color-stone-800);
      }
    }
  }

  &__email-hash {
    font-family: var(--pav-font-family-mono);
    font-size: var(--pav-font-size-caption);
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .unblock-button {
    padding: var(--pav-space-1_5) var(--pav-space-3);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: var(--pav-color-text-primary);
    background: transparent;
    border: 1px solid var(--pav-color-stone-300);
    border-radius: var(--pav-border-radius-full);
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: var(--pav-color-stone-100);
      border-color: var(--pav-color-stone-400);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-brand-primary);
      outline-offset: 2px;
    }

    @media (prefers-color-scheme: dark) {
      border-color: var(--pav-color-stone-600);

      &:hover {
        background: var(--pav-color-stone-800);
        border-color: var(--pav-color-stone-500);
      }
    }
  }
}

// Modal styles
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

  .modal {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-card);
    max-width: 32rem;
    width: 100%;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
                0 10px 10px -5px rgba(0, 0, 0, 0.04);

    .modal-header {
      padding: var(--pav-space-6) var(--pav-space-6) var(--pav-space-4);

      h3 {
        margin: 0;
        font-size: var(--pav-font-size-lg);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }
    }

    .modal-body {
      padding: 0 var(--pav-space-6) var(--pav-space-6);
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-4);

      .unblock-description {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-secondary);
        line-height: 1.5;
      }

      .unblock-details {
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-3);
        padding: var(--pav-space-4);
        background: var(--pav-color-surface-secondary);
        border-radius: var(--pav-border-radius-input);

        .detail-row {
          display: flex;
          flex-direction: column;
          gap: var(--pav-space-1);

          .detail-label {
            font-size: var(--pav-font-size-2xs);
            font-weight: var(--pav-font-weight-medium);
            text-transform: uppercase;
            letter-spacing: var(--pav-letter-spacing-wider);
            color: var(--pav-color-text-secondary);
          }

          .detail-value {
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-primary);
          }
        }
      }

      .modal-error {
        padding: var(--pav-space-3);
        border-radius: 0.5rem;
        font-size: var(--pav-font-size-xs);
        background-color: var(--pav-color-red-50);
        border: 1px solid var(--pav-color-red-200);
        color: var(--pav-color-red-700);

        @media (prefers-color-scheme: dark) {
          background-color: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
          color: var(--pav-color-red-300);
        }
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-2);

        .form-label {
          font-size: var(--pav-font-size-xs);
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-secondary);
        }

        .form-input,
        .form-textarea {
          display: block;
          width: 100%;
          padding: var(--pav-space-2_5) var(--pav-space-3);
          font-size: var(--pav-font-size-xs);
          font-family: inherit;
          color: var(--pav-color-text-primary);
          background: var(--pav-color-surface-primary);
          border: 1px solid var(--pav-color-stone-300);
          border-radius: var(--pav-border-radius-input);
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          box-sizing: border-box;

          &:focus {
            border-color: var(--pav-color-brand-primary);
            box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
          }

          &.has-error {
            border-color: var(--pav-color-error);
          }

          &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            background: var(--pav-color-surface-secondary);
          }

          @media (prefers-color-scheme: dark) {
            background: var(--pav-color-surface-secondary);
            border-color: var(--pav-color-stone-600);

            &:focus {
              border-color: var(--pav-color-brand-primary);
              box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
            }
          }
        }

        .form-textarea {
          resize: vertical;
          min-height: 4rem;
        }

        .error-text {
          margin: 0;
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-error);
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: var(--pav-space-3);
      padding: var(--pav-space-4) var(--pav-space-6) var(--pav-space-6);
      justify-content: flex-end;

      .modal-button {
        padding: var(--pav-space-2_5) var(--pav-space-5);
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        font-family: inherit;
        border-radius: var(--pav-border-radius-full);
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        &.cancel-button {
          color: var(--pav-color-text-secondary);
          background: var(--pav-color-surface-secondary);

          &:hover:not(:disabled) {
            background: var(--pav-color-stone-300);
          }
        }

        &.confirm-button {
          color: #fff;
          background: var(--pav-color-brand-primary);

          &:hover:not(:disabled) {
            background: var(--pav-color-brand-primary-dark);
          }
        }

        &:focus-visible {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
        }
      }
    }
  }
}

// Responsive adjustments
@media (max-width: 640px) {
  .blocked-reporters {
    &__header {
      flex-direction: column;
      align-items: stretch;
      gap: var(--pav-space-3);
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
