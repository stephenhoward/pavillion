<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import type { BlockedInstance } from '@/common/model/blocked_instance';

const { t } = useTranslation('admin', {
  keyPrefix: 'blocked_instances',
});

const moderationStore = useModerationStore();

const state = reactive({
  domain: '',
  reason: '',
  isBlocking: false,
  validationErrors: {
    domain: '',
    reason: '',
  },
  successMessage: '',
  errorMessage: '',
  confirmUnblockDomain: null as string | null,
});

onMounted(async () => {
  await moderationStore.fetchBlockedInstances();
});

function validateForm(): boolean {
  let isValid = true;

  // Reset errors
  state.validationErrors = {
    domain: '',
    reason: '',
  };

  // Validate domain
  if (!state.domain || state.domain.trim().length === 0) {
    state.validationErrors.domain = t('error.domain_required');
    isValid = false;
  }
  else {
    // Basic domain format validation
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(state.domain.trim())) {
      state.validationErrors.domain = t('error.domain_invalid');
      isValid = false;
    }
  }

  // Validate reason
  if (!state.reason || state.reason.trim().length === 0) {
    state.validationErrors.reason = t('error.reason_required');
    isValid = false;
  }

  return isValid;
}

async function blockInstance() {
  if (!validateForm()) {
    return;
  }

  state.isBlocking = true;
  state.errorMessage = '';
  state.successMessage = '';

  try {
    await moderationStore.blockInstance(state.domain.trim(), state.reason.trim());

    state.successMessage = t('block_success', { domain: state.domain.trim() });

    // Reset form
    state.domain = '';
    state.reason = '';
    state.validationErrors = {
      domain: '',
      reason: '',
    };
  }
  catch (error) {
    console.error('Error blocking instance:', error);

    if (error instanceof Error && error.name === 'InstanceAlreadyBlockedError') {
      state.errorMessage = t('error.already_blocked');
    }
    else {
      state.errorMessage = moderationStore.blockingError || t('error.block_failed');
    }
  }
  finally {
    state.isBlocking = false;
  }
}

function showUnblockConfirm(domain: string) {
  state.confirmUnblockDomain = domain;
  state.successMessage = '';
  state.errorMessage = '';
}

function cancelUnblock() {
  state.confirmUnblockDomain = null;
}

async function confirmUnblock() {
  const domain = state.confirmUnblockDomain;
  if (!domain) return;

  try {
    await moderationStore.unblockInstance(domain);
    state.successMessage = t('unblock_success', { domain });
    state.confirmUnblockDomain = null;
  }
  catch (error) {
    console.error('Error unblocking instance:', error);
    state.errorMessage = moderationStore.blockingError || t('error.unblock_failed');
    state.confirmUnblockDomain = null;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
</script>

<template>
  <div class="blocked-instances">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-text">
        <h1>{{ t('title') }}</h1>
        <p class="page-subtitle">{{ t('subtitle') }}</p>
      </div>
    </div>

    <!-- Loading State -->
    <LoadingMessage
      v-if="moderationStore.loadingBlockedInstances"
      :description="t('loading')"
    />

    <!-- Error State -->
    <div v-else-if="moderationStore.blockingError && !state.errorMessage" class="error-message">
      <p>{{ t('load_error') }}: {{ moderationStore.blockingError }}</p>
    </div>

    <!-- Main Content -->
    <div v-else class="blocked-instances-content">
      <!-- Status Messages -->
      <div role="status" aria-live="polite">
        <div v-if="state.successMessage" class="message message-success">
          <svg class="message-icon"
               width="20"
               height="20"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2"
               stroke-linecap="round"
               stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ state.successMessage }}
        </div>
        <div v-if="state.errorMessage" class="message message-error">
          <svg class="message-icon"
               width="20"
               height="20"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="2"
               stroke-linecap="round"
               stroke-linejoin="round">
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
      </div>

      <!-- Block Instance Form -->
      <section class="block-form-card" aria-labelledby="block-form-heading">
        <div class="card-header">
          <h2 id="block-form-heading">{{ t('form.title') }}</h2>
        </div>

        <div class="card-body">
          <form class="block-form" @submit.prevent="blockInstance">
            <!-- Domain Input -->
            <div class="form-group">
              <label for="domain-input" class="form-label">
                {{ t('form.domain_label') }}
              </label>
              <input
                id="domain-input"
                v-model="state.domain"
                type="text"
                class="form-input"
                :class="{ 'has-error': state.validationErrors.domain }"
                :placeholder="t('form.domain_placeholder')"
                :disabled="state.isBlocking"
                :aria-invalid="!!state.validationErrors.domain"
                :aria-describedby="state.validationErrors.domain ? 'domain-error' : 'domain-help'"
              />
              <p v-if="state.validationErrors.domain"
                 id="domain-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.domain }}
              </p>
              <p v-else id="domain-help" class="help-text">
                {{ t('form.domain_help') }}
              </p>
            </div>

            <!-- Reason Input -->
            <div class="form-group">
              <label for="reason-input" class="form-label">
                {{ t('form.reason_label') }}
              </label>
              <textarea
                id="reason-input"
                v-model="state.reason"
                class="form-textarea"
                :class="{ 'has-error': state.validationErrors.reason }"
                :placeholder="t('form.reason_placeholder')"
                :disabled="state.isBlocking"
                rows="3"
                :aria-invalid="!!state.validationErrors.reason"
                :aria-describedby="state.validationErrors.reason ? 'reason-error' : 'reason-help'"
              />
              <p v-if="state.validationErrors.reason"
                 id="reason-error"
                 class="error-text"
                 role="alert">
                {{ state.validationErrors.reason }}
              </p>
              <p v-else id="reason-help" class="help-text">
                {{ t('form.reason_help') }}
              </p>
            </div>

            <!-- Submit Button -->
            <div class="form-actions">
              <button
                type="submit"
                class="block-button"
                :disabled="state.isBlocking"
              >
                {{ state.isBlocking ? t('form.blocking') : t('form.block_button') }}
              </button>
            </div>
          </form>
        </div>
      </section>

      <!-- Blocked Instances List -->
      <section class="blocked-list-card" aria-labelledby="blocked-list-heading">
        <div class="card-header">
          <h2 id="blocked-list-heading">{{ t('list.title') }}</h2>
          <span class="blocked-count">
            {{ t('list.count', { count: moderationStore.blockedInstances.length }) }}
          </span>
        </div>

        <div v-if="!moderationStore.hasBlockedInstances" class="empty-state">
          <svg class="empty-icon"
               width="48"
               height="48"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M4.93 4.93l14.14 14.14"/>
          </svg>
          <p>{{ t('list.empty') }}</p>
        </div>

        <div v-else class="blocked-list">
          <!-- Mobile List View -->
          <div class="mobile-list">
            <div
              v-for="instance in moderationStore.blockedInstances"
              :key="instance.domain"
              class="mobile-list-item"
            >
              <div class="instance-header">
                <div class="instance-domain">{{ instance.domain }}</div>
                <button
                  class="unblock-button-mobile"
                  :disabled="!!state.confirmUnblockDomain"
                  @click="showUnblockConfirm(instance.domain)"
                  :aria-label="t('list.unblock_aria', { domain: instance.domain })"
                >
                  {{ t('list.unblock_button') }}
                </button>
              </div>
              <div class="instance-reason">{{ instance.reason }}</div>
              <div class="instance-meta">
                <span>{{ formatDate(instance.blockedAt.toISOString()) }}</span>
              </div>
            </div>
          </div>

          <!-- Desktop Table View -->
          <table class="blocked-table">
            <thead>
              <tr>
                <th scope="col">{{ t('list.domain_column') }}</th>
                <th scope="col">{{ t('list.reason_column') }}</th>
                <th scope="col">{{ t('list.blocked_at_column') }}</th>
                <th scope="col">{{ t('list.actions_column') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="instance in moderationStore.blockedInstances" :key="instance.domain">
                <td class="domain-cell">{{ instance.domain }}</td>
                <td class="reason-cell">{{ instance.reason }}</td>
                <td class="date-cell">{{ formatDate(instance.blockedAt.toISOString()) }}</td>
                <td class="actions-cell">
                  <button
                    class="unblock-button"
                    :disabled="!!state.confirmUnblockDomain"
                    @click="showUnblockConfirm(instance.domain)"
                    :aria-label="t('list.unblock_aria', { domain: instance.domain })"
                  >
                    {{ t('list.unblock_button') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Unblock Confirmation Modal -->
      <div v-if="state.confirmUnblockDomain" class="modal-overlay" @click.self="cancelUnblock">
        <div class="modal"
             role="dialog"
             aria-labelledby="confirm-title"
             aria-modal="true">
          <div class="modal-header">
            <h3 id="confirm-title">{{ t('confirm.title') }}</h3>
          </div>
          <div class="modal-body">
            <p>{{ t('confirm.message', { domain: state.confirmUnblockDomain }) }}</p>
          </div>
          <div class="modal-actions">
            <button class="modal-button cancel-button" @click="cancelUnblock">
              {{ t('confirm.cancel') }}
            </button>
            <button class="modal-button confirm-button" @click="confirmUnblock">
              {{ t('confirm.unblock') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.blocked-instances {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  .page-header {
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

  .blocked-instances-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-5);

    .message {
      display: flex;
      align-items: center;
      gap: var(--pav-space-2);
      padding: var(--pav-space-3) var(--pav-space-4);
      border-radius: var(--pav-border-radius-md);
      font-size: var(--pav-font-size-xs);

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
  }

  .block-form-card,
  .blocked-list-card {
    background: var(--pav-color-surface-primary);
    border: 1px solid var(--pav-border-color-light);
    border-radius: var(--pav-border-radius-card);
    overflow: hidden;

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--pav-space-4) var(--pav-space-6);
      border-bottom: 1px solid var(--pav-border-color-light);

      h2 {
        margin: 0;
        font-size: var(--pav-font-size-base);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }

      .blocked-count {
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }

    .card-body {
      padding: var(--pav-space-6);
    }
  }

  .block-form {
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
      }

      .form-input,
      .form-textarea {
        display: block;
        width: 100%;
        max-width: 40rem;
        padding: var(--pav-space-2_5) var(--pav-space-5);
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

      .help-text {
        margin: 0;
        font-size: var(--pav-font-size-2xs);
        color: var(--pav-color-text-muted);
      }
    }

    .form-actions {
      padding-top: var(--pav-space-2);

      .block-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--pav-space-2_5) var(--pav-space-6);
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        font-family: inherit;
        color: #fff;
        background: var(--pav-color-brand-primary);
        border: none;
        border-radius: var(--pav-border-radius-full);
        cursor: pointer;
        transition: background-color 0.2s ease;

        &:hover:not(:disabled) {
          background: var(--pav-color-brand-primary-dark);
        }

        &:focus-visible {
          outline: 2px solid var(--pav-color-brand-primary);
          outline-offset: 2px;
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }
    }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--pav-space-12) var(--pav-space-6);
    color: var(--pav-color-text-muted);

    .empty-icon {
      margin-bottom: var(--pav-space-3);
      opacity: 0.5;
    }

    p {
      margin: 0;
      font-size: var(--pav-font-size-xs);
    }
  }

  .blocked-list {
    .mobile-list {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-3);
      padding: var(--pav-space-4);

      @include pav-media(md) {
        display: none;
      }

      .mobile-list-item {
        padding: var(--pav-space-4);
        background: var(--pav-color-surface-secondary);
        border: 1px solid var(--pav-border-color-light);
        border-radius: var(--pav-border-radius-md);

        .instance-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--pav-space-2);

          .instance-domain {
            font-size: var(--pav-font-size-xs);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }
        }

        .instance-reason {
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-text-secondary);
          margin-bottom: var(--pav-space-2);
        }

        .instance-meta {
          font-size: var(--pav-font-size-2xs);
          color: var(--pav-color-text-muted);
        }
      }
    }

    .blocked-table {
      display: none;
      width: 100%;
      border-collapse: collapse;

      @include pav-media(md) {
        display: table;
      }

      thead {
        background: var(--pav-color-surface-secondary);
        border-bottom: 1px solid var(--pav-border-color-light);

        th {
          padding: var(--pav-space-3) var(--pav-space-4);
          text-align: left;
          font-size: var(--pav-font-size-2xs);
          font-weight: var(--pav-font-weight-semibold);
          color: var(--pav-color-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
      }

      tbody {
        tr {
          border-bottom: 1px solid var(--pav-border-color-light);
          transition: background-color 0.15s ease;

          &:hover {
            background: var(--pav-color-surface-secondary);
          }

          &:last-child {
            border-bottom: none;
          }
        }

        td {
          padding: var(--pav-space-4);
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-secondary);
        }

        .domain-cell {
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-primary);
        }

        .reason-cell {
          max-width: 25rem;
        }

        .date-cell {
          white-space: nowrap;
        }

        .actions-cell {
          text-align: right;
        }
      }
    }

    .unblock-button,
    .unblock-button-mobile {
      padding: var(--pav-space-1_5) var(--pav-space-3);
      font-size: var(--pav-font-size-2xs);
      font-weight: var(--pav-font-weight-medium);
      font-family: inherit;
      color: var(--pav-color-error);
      background: transparent;
      border: 1px solid var(--pav-color-error);
      border-radius: var(--pav-border-radius-md);
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover:not(:disabled) {
        background: var(--pav-color-error);
        color: #fff;
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-error);
        outline-offset: 2px;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }

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
      max-width: 30rem;
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

        p {
          margin: 0;
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-secondary);
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

          &.cancel-button {
            color: var(--pav-color-text-secondary);
            background: var(--pav-color-surface-secondary);

            &:hover {
              background: var(--pav-color-stone-300);
            }
          }

          &.confirm-button {
            color: #fff;
            background: var(--pav-color-error);

            &:hover {
              background: var(--pav-color-red-700);
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
}

@media (prefers-color-scheme: dark) {
  .blocked-instances {
    .blocked-instances-content {
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
    }

    .block-form {
      .form-group {
        .form-input,
        .form-textarea {
          background: var(--pav-color-surface-secondary);
          border-color: var(--pav-color-stone-600);

          &:focus {
            border-color: var(--pav-color-brand-primary);
            box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
          }
        }
      }
    }
  }
}
</style>
