<script setup lang="ts">
import { ref, reactive, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';

const { t } = useTranslation('admin', {
  keyPrefix: 'federation',
});

/**
 * Represents a blocked instance in the federation system.
 */
interface BlockedInstance {
  id: string;
  domain: string;
  reason: string;
  blockedAt: string;
}

// Reactive state
const blockedInstances = reactive<BlockedInstance[]>([]);
const showBlockModal = ref(false);
const blockDomain = ref('');
const blockReason = ref('');
const confirmUnblock = ref<BlockedInstance | null>(null);
const loading = ref(false);
const error = ref('');

// Modal refs for focus management
const blockModalRef = ref<HTMLElement | null>(null);
const unblockModalRef = ref<HTMLElement | null>(null);
const blockDomainInputRef = ref<HTMLInputElement | null>(null);

/**
 * Formats an ISO date string into a readable short date.
 */
function formatDate(dateString: string): string {
  const dt = DateTime.fromISO(dateString);
  return dt.isValid ? dt.toLocaleString(DateTime.DATE_MED) : dateString;
}

/**
 * Opens the block instance modal and focuses the domain input.
 */
async function openBlockModal() {
  showBlockModal.value = true;
  await nextTick();
  blockDomainInputRef.value?.focus();
}

/**
 * Closes the block instance modal and resets form fields.
 */
function closeBlockModal() {
  showBlockModal.value = false;
  blockDomain.value = '';
  blockReason.value = '';
}

/**
 * Handles blocking a new instance.
 * Since no backend API exists yet, this updates local state only.
 */
function handleBlockInstance() {
  if (!blockDomain.value.trim() || !blockReason.value.trim()) {
    return;
  }

  const newInstance: BlockedInstance = {
    id: crypto.randomUUID(),
    domain: blockDomain.value.trim(),
    reason: blockReason.value.trim(),
    blockedAt: new Date().toISOString(),
  };

  blockedInstances.push(newInstance);
  console.log('[Federation] Blocked instance:', newInstance.domain);
  closeBlockModal();
}

/**
 * Opens the unblock confirmation modal for a specific instance.
 */
function openUnblockModal(instance: BlockedInstance) {
  confirmUnblock.value = instance;
}

/**
 * Closes the unblock confirmation modal.
 */
function closeUnblockModal() {
  confirmUnblock.value = null;
}

/**
 * Handles unblocking an instance.
 * Since no backend API exists yet, this updates local state only.
 */
function handleUnblockInstance() {
  if (!confirmUnblock.value) {
    return;
  }

  const index = blockedInstances.findIndex(
    (inst) => inst.id === confirmUnblock.value?.id,
  );
  if (index !== -1) {
    console.log('[Federation] Unblocked instance:', blockedInstances[index].domain);
    blockedInstances.splice(index, 1);
  }
  closeUnblockModal();
}

/**
 * Handles Escape key to close modals.
 */
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (confirmUnblock.value) {
      closeUnblockModal();
    }
    else if (showBlockModal.value) {
      closeBlockModal();
    }
  }
}
</script>

<template>
  <div class="federation-page" @keydown="handleKeydown">
    <!-- Page Header -->
    <div class="federation-header">
      <div>
        <h1>{{ t("title") }}</h1>
        <p class="federation-subtitle">{{ t("subtitle") }}</p>
      </div>
      <button
        class="block-instance-button"
        @click="openBlockModal"
      >
        <svg
          width="20"
          height="20"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
        {{ t("block_instance_button") }}
      </button>
    </div>

    <!-- Info Panel -->
    <div class="federation-info-panel" role="note">
      <svg
        class="federation-info-icon"
        width="20"
        height="20"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <p>{{ t("info_text") }}</p>
    </div>

    <!-- Blocked Instances Card -->
    <section class="federation-card" aria-labelledby="blocked-instances-heading">
      <div class="federation-card-header">
        <h2 id="blocked-instances-heading">{{ t("blocked_instances_title") }}</h2>
      </div>

      <!-- Empty State -->
      <div v-if="blockedInstances.length === 0" class="federation-empty-state">
        <svg
          class="federation-empty-icon"
          width="48"
          height="48"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <p class="federation-empty-title">{{ t("no_blocked_instances") }}</p>
        <p class="federation-empty-description">{{ t("no_blocked_instances_description") }}</p>
      </div>

      <!-- Instances List -->
      <div v-else class="federation-instances-list">
        <div
          v-for="instance in blockedInstances"
          :key="instance.id"
          class="federation-instance-item"
        >
          <div class="federation-instance-info">
            <div class="federation-instance-meta">
              <span class="federation-domain-badge">{{ instance.domain }}</span>
              <span class="federation-blocked-date">
                {{ t("blocked_on", { date: formatDate(instance.blockedAt) }) }}
              </span>
            </div>
            <p class="federation-instance-reason">{{ instance.reason }}</p>
          </div>
          <button
            class="federation-unblock-button"
            @click="openUnblockModal(instance)"
          >
            {{ t("unblock_button") }}
          </button>
        </div>
      </div>
    </section>

    <!-- Block Instance Modal -->
    <div
      v-if="showBlockModal"
      class="federation-modal-overlay"
      @click.self="closeBlockModal"
    >
      <div
        ref="blockModalRef"
        class="federation-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="'block-modal-title'"
      >
        <div class="federation-modal-header">
          <h3 id="block-modal-title">{{ t("block_modal_title") }}</h3>
          <button
            class="federation-modal-close"
            @click="closeBlockModal"
            :aria-label="t('block_modal_cancel')"
          >
            <svg
              width="20"
              height="20"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div class="federation-modal-body">
          <div class="federation-form-group">
            <label for="blockDomain" class="federation-form-label">
              {{ t("block_modal_domain_label") }}
            </label>
            <input
              id="blockDomain"
              ref="blockDomainInputRef"
              type="text"
              class="federation-domain-input"
              v-model="blockDomain"
              :placeholder="t('block_modal_domain_placeholder')"
            />
          </div>
          <div class="federation-form-group">
            <label for="blockReason" class="federation-form-label">
              {{ t("block_modal_reason_label") }}
            </label>
            <textarea
              id="blockReason"
              class="federation-reason-textarea"
              v-model="blockReason"
              :placeholder="t('block_modal_reason_placeholder')"
              rows="3"
            />
          </div>
          <div class="federation-warning-panel">
            <p>{{ t("block_modal_warning") }}</p>
          </div>
        </div>
        <div class="federation-modal-footer">
          <button
            class="federation-cancel-button"
            @click="closeBlockModal"
          >
            {{ t("block_modal_cancel") }}
          </button>
          <button
            class="federation-block-submit-button"
            :disabled="!blockDomain.trim() || !blockReason.trim()"
            @click="handleBlockInstance"
          >
            {{ t("block_modal_submit") }}
          </button>
        </div>
      </div>
    </div>

    <!-- Unblock Confirmation Modal -->
    <div
      v-if="confirmUnblock"
      class="federation-modal-overlay"
      @click.self="closeUnblockModal"
    >
      <div
        ref="unblockModalRef"
        class="federation-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="'unblock-modal-title'"
      >
        <div class="federation-modal-header">
          <h3 id="unblock-modal-title">{{ t("unblock_modal_title") }}</h3>
        </div>
        <div class="federation-modal-body">
          <p class="federation-unblock-text">
            {{ t("unblock_modal_text", { domain: confirmUnblock.domain }).replace('<strong>', '').replace('</strong>', '') }}
          </p>
          <p class="federation-unblock-domain-highlight">
            {{ confirmUnblock.domain }}
          </p>
        </div>
        <div class="federation-modal-footer">
          <button
            class="federation-cancel-button"
            @click="closeUnblockModal"
          >
            {{ t("unblock_modal_cancel") }}
          </button>
          <button
            class="federation-unblock-submit-button"
            @click="handleUnblockInstance"
          >
            {{ t("unblock_modal_submit") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.federation-page {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
  max-width: 800px;

  .federation-header {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);

    @include pav-media(sm) {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    h1 {
      margin: 0 0 var(--pav-space-1) 0;
      font-size: var(--pav-font-size-2xl);
      font-weight: var(--pav-font-weight-light);
      color: var(--pav-color-text-primary);
    }

    .federation-subtitle {
      margin: 0;
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-text-muted);
    }

    .block-instance-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--pav-space-2);
      padding: var(--pav-space-2_5) var(--pav-space-6);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      font-family: inherit;
      color: var(--pav-color-text-inverse);
      background: var(--pav-color-red-500);
      border: none;
      border-radius: var(--pav-border-radius-full);
      cursor: pointer;
      transition: background-color 0.2s ease;
      white-space: nowrap;
      width: 100%;

      @include pav-media(sm) {
        width: auto;
      }

      &:hover {
        background: var(--pav-color-red-600);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-orange-500);
        outline-offset: 2px;
      }
    }
  }

  .federation-info-panel {
    display: flex;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4);
    background: var(--pav-color-sky-50);
    border: 1px solid var(--pav-color-sky-200);
    border-radius: var(--pav-border-radius-md);

    .federation-info-icon {
      flex-shrink: 0;
      margin-top: var(--pav-space-0_5);
      color: var(--pav-color-sky-500);
    }

    p {
      margin: 0;
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-sky-800);
      line-height: var(--pav-line-height-relaxed, 1.625);
    }
  }

  .federation-card {
    background: var(--pav-color-surface-primary);
    border: 1px solid var(--pav-border-color-light);
    border-radius: var(--pav-border-radius-card);
    overflow: hidden;

    .federation-card-header {
      padding: var(--pav-space-4) var(--pav-space-6);
      border-bottom: 1px solid var(--pav-border-color-light);

      h2 {
        margin: 0;
        font-size: var(--pav-font-size-base);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }
    }

    .federation-empty-state {
      padding: var(--pav-space-12);
      text-align: center;

      .federation-empty-icon {
        margin: 0 auto;
        color: var(--pav-color-stone-300);
      }

      .federation-empty-title {
        margin: var(--pav-space-4) 0 0 0;
        font-size: var(--pav-font-size-sm);
        color: var(--pav-color-text-muted);
      }

      .federation-empty-description {
        margin: var(--pav-space-1) 0 0 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-stone-400);
      }
    }

    .federation-instances-list {
      .federation-instance-item {
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-3);
        padding: var(--pav-space-4) var(--pav-space-6);
        border-bottom: 1px solid var(--pav-border-color-light);

        @include pav-media(sm) {
          flex-direction: row;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--pav-space-4);
        }

        &:last-child {
          border-bottom: none;
        }

        .federation-instance-info {
          flex: 1;
          min-width: 0;

          .federation-instance-meta {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: var(--pav-space-2);

            @include pav-media(sm) {
              gap: var(--pav-space-3);
            }

            .federation-domain-badge {
              display: inline-block;
              padding: var(--pav-space-1) var(--pav-space-2);
              font-family: var(--pav-font-family-mono);
              font-size: var(--pav-font-size-xs);
              font-weight: var(--pav-font-weight-medium);
              color: var(--pav-color-text-primary);
              background: var(--pav-color-stone-100);
              border-radius: var(--pav-border-radius-xs);
              word-break: break-all;
            }

            .federation-blocked-date {
              font-size: var(--pav-font-size-2xs);
              color: var(--pav-color-stone-400);
            }
          }

          .federation-instance-reason {
            margin: var(--pav-space-2) 0 0 0;
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-secondary);
          }
        }

        .federation-unblock-button {
          flex-shrink: 0;
          align-self: flex-start;
          padding: var(--pav-space-1_5) var(--pav-space-3);
          font-size: var(--pav-font-size-xs);
          font-weight: var(--pav-font-weight-medium);
          font-family: inherit;
          color: var(--pav-color-text-secondary);
          background: transparent;
          border: none;
          border-radius: var(--pav-border-radius-md);
          cursor: pointer;
          transition: color 0.2s ease, background-color 0.2s ease;

          &:hover {
            color: var(--pav-color-text-primary);
            background: var(--pav-color-stone-100);
          }

          &:focus-visible {
            outline: 2px solid var(--pav-color-orange-500);
            outline-offset: 2px;
          }
        }
      }
    }
  }
}

/* Modal Overlay */
.federation-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--pav-space-4);
  background: rgba(0, 0, 0, 0.5);
}

.federation-modal {
  background: var(--pav-color-surface-primary);
  border-radius: var(--pav-border-radius-modal);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  max-width: 28rem;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;

  .federation-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--pav-space-4) var(--pav-space-6);
    border-bottom: 1px solid var(--pav-border-color-light);

    h3 {
      margin: 0;
      font-size: var(--pav-font-size-base);
      font-weight: var(--pav-font-weight-semibold);
      color: var(--pav-color-text-primary);
    }

    .federation-modal-close {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--pav-space-1);
      color: var(--pav-color-stone-400);
      background: transparent;
      border: none;
      border-radius: var(--pav-border-radius-sm);
      cursor: pointer;
      transition: color 0.2s ease;

      &:hover {
        color: var(--pav-color-text-secondary);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-orange-500);
        outline-offset: 2px;
      }
    }
  }

  .federation-modal-body {
    padding: var(--pav-space-6);
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);

    .federation-form-group {
      .federation-form-label {
        display: block;
        margin-bottom: var(--pav-space-2);
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-secondary);
      }

      .federation-domain-input {
        display: block;
        width: 100%;
        padding: var(--pav-space-2_5) var(--pav-space-5);
        font-size: var(--pav-font-size-xs);
        font-family: var(--pav-font-family-mono);
        color: var(--pav-color-text-primary);
        background: var(--pav-color-surface-primary);
        border: 1px solid var(--pav-color-stone-300);
        border-radius: var(--pav-border-radius-full);
        outline: none;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        box-sizing: border-box;

        &::placeholder {
          color: var(--pav-color-stone-400);
        }

        &:focus {
          border-color: var(--pav-color-orange-500);
          box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
        }
      }

      .federation-reason-textarea {
        display: block;
        width: 100%;
        padding: var(--pav-space-2_5) var(--pav-space-4);
        font-size: var(--pav-font-size-xs);
        font-family: inherit;
        color: var(--pav-color-text-primary);
        background: var(--pav-color-surface-primary);
        border: 1px solid var(--pav-color-stone-300);
        border-radius: var(--pav-border-radius-md);
        outline: none;
        resize: none;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        box-sizing: border-box;

        &::placeholder {
          color: var(--pav-color-stone-400);
        }

        &:focus {
          border-color: var(--pav-color-orange-500);
          box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.15);
        }
      }
    }

    .federation-warning-panel {
      padding: var(--pav-space-3);
      background: var(--pav-color-amber-50);
      border: 1px solid var(--pav-color-amber-200);
      border-radius: var(--pav-border-radius-md);

      p {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-amber-800);
        line-height: var(--pav-line-height-relaxed, 1.625);
      }
    }

    .federation-unblock-text {
      margin: 0;
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-text-secondary);
      line-height: var(--pav-line-height-relaxed, 1.625);
    }

    .federation-unblock-domain-highlight {
      margin: var(--pav-space-2) 0 0 0;
      font-family: var(--pav-font-family-mono);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }

  .federation-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4) var(--pav-space-6);
    border-top: 1px solid var(--pav-border-color-light);

    .federation-cancel-button {
      padding: var(--pav-space-2) var(--pav-space-5);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      font-family: inherit;
      color: var(--pav-color-text-secondary);
      background: transparent;
      border: 1px solid var(--pav-color-stone-300);
      border-radius: var(--pav-border-radius-full);
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover {
        background: var(--pav-color-stone-50);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-orange-500);
        outline-offset: 2px;
      }
    }

    .federation-block-submit-button {
      padding: var(--pav-space-2) var(--pav-space-6);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      font-family: inherit;
      color: var(--pav-color-text-inverse);
      background: var(--pav-color-red-500);
      border: none;
      border-radius: var(--pav-border-radius-full);
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover:not(:disabled) {
        background: var(--pav-color-red-600);
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

    .federation-unblock-submit-button {
      padding: var(--pav-space-2) var(--pav-space-6);
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      font-family: inherit;
      color: var(--pav-color-text-inverse);
      background: var(--pav-color-emerald-500);
      border: none;
      border-radius: var(--pav-border-radius-full);
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover {
        background: var(--pav-color-emerald-600);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-orange-500);
        outline-offset: 2px;
      }
    }
  }
}

/* Dark mode overrides */
@media (prefers-color-scheme: dark) {
  .federation-page {
    .federation-info-panel {
      background: rgba(14, 165, 233, 0.08);
      border-color: var(--pav-color-sky-800);

      p {
        color: var(--pav-color-sky-200);
      }
    }

    .federation-card {
      .federation-empty-state {
        .federation-empty-icon {
          color: var(--pav-color-stone-600);
        }

        .federation-empty-description {
          color: var(--pav-color-stone-500);
        }
      }

      .federation-instances-list {
        .federation-instance-item {
          .federation-instance-info {
            .federation-instance-meta {
              .federation-domain-badge {
                background: var(--pav-color-stone-800);
              }

              .federation-blocked-date {
                color: var(--pav-color-stone-500);
              }
            }
          }

          .federation-unblock-button {
            color: var(--pav-color-stone-400);

            &:hover {
              color: var(--pav-color-text-primary);
              background: var(--pav-color-stone-800);
            }
          }
        }
      }
    }
  }

  .federation-modal {
    .federation-modal-header {
      .federation-modal-close {
        &:hover {
          color: var(--pav-color-stone-300);
        }
      }
    }

    .federation-modal-body {
      .federation-form-group {
        .federation-domain-input,
        .federation-reason-textarea {
          background: var(--pav-color-surface-secondary);
          border-color: var(--pav-color-stone-600);

          &:focus {
            border-color: var(--pav-color-orange-500);
            box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2);
          }
        }
      }

      .federation-warning-panel {
        background: rgba(245, 158, 11, 0.08);
        border-color: var(--pav-color-amber-800);

        p {
          color: var(--pav-color-amber-200);
        }
      }
    }

    .federation-modal-footer {
      .federation-cancel-button {
        border-color: var(--pav-color-stone-600);
        color: var(--pav-color-stone-300);

        &:hover {
          background: var(--pav-color-stone-800);
        }
      }

      .federation-block-submit-button {
        &:disabled {
          background: var(--pav-color-red-800);
        }
      }
    }
  }
}
</style>
