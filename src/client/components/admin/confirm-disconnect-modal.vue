<script setup>
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'funding.disconnect_modal',
});

// Props
const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  providerName: {
    type: String,
    required: true,
  },
  activeFundingPlanCount: {
    type: Number,
    required: true,
  },
});

// Emits
const emit = defineEmits(['close', 'confirm']);

// State
const understood = ref(false);
const disconnecting = ref(false);

// Computed
const canDisconnect = computed(() => {
  return understood.value && !disconnecting.value;
});

/**
 * Handle disconnect confirmation
 */
async function handleConfirm() {
  if (!canDisconnect.value) {
    return;
  }

  disconnecting.value = true;

  try {
    await emit('confirm');
    // Reset state after successful disconnect
    resetState();
  }
  catch (error) {
    console.error('Error during disconnect:', error);
  }
  finally {
    disconnecting.value = false;
  }
}

/**
 * Handle modal close
 */
function handleClose() {
  if (!disconnecting.value) {
    resetState();
    emit('close');
  }
}

/**
 * Reset modal state
 */
function resetState() {
  understood.value = false;
  disconnecting.value = false;
}
</script>

<template>
  <Modal
    v-if="show"
    :title="t('title', { provider: providerName })"
    size="md"
    @close="handleClose"
  >
    <div class="disconnect-body">
      <div class="warning-icon">
        <svg width="48"
             height="48"
             viewBox="0 0 24 24"
             fill="none"
             xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 20h20L12 2z" fill="#dc3545" opacity="0.2"/>
          <path d="M12 2L2 20h20L12 2z"
                stroke="#dc3545"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"/>
          <path d="M12 9v4M12 17h.01"
                stroke="#dc3545"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="warning-message">
        <p class="message-primary">
          {{ t('message', { provider: providerName, count: activeFundingPlanCount }) }}
        </p>
        <p class="message-secondary">
          {{ t('consequence') }}
        </p>
      </div>

      <div class="confirmation-section">
        <label class="checkbox-label">
          <input
            type="checkbox"
            v-model="understood"
            :disabled="disconnecting"
          />
          <span class="checkbox-text">{{ t('checkbox_label') }}</span>
        </label>
      </div>

      <div class="modal-actions">
        <button
          type="button"
          class="btn btn--secondary"
          @click="handleClose"
          :disabled="disconnecting"
        >
          {{ t('cancel_button') }}
        </button>
        <button
          type="button"
          class="danger"
          @click="handleConfirm"
          :disabled="!canDisconnect"
        >
          {{ disconnecting ? t('disconnecting_button') : t('disconnect_button') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped lang="scss">
.disconnect-body {
  .warning-icon {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .warning-message {
    margin-bottom: 1.5rem;

    .message-primary {
      margin: 0 0 1rem 0;
      font-size: 1rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
      line-height: 1.5;
    }

    .message-secondary {
      margin: 0;
      font-size: 0.875rem;
      color: var(--pav-color-text-secondary);
      line-height: 1.5;
    }
  }

  .confirmation-section {
    padding: 1rem;
    background: rgba(220, 53, 69, 0.05);
    border: 1px solid rgba(220, 53, 69, 0.2);
    border-radius: 8px;
    margin-bottom: 1.5rem;

    @media (prefers-color-scheme: dark) {
      background: rgba(255, 107, 122, 0.1);
      border-color: rgba(255, 107, 122, 0.2);
    }

    .checkbox-label {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      cursor: pointer;
      user-select: none;

      input[type="checkbox"] {
        margin-top: 0.25rem;
        cursor: pointer;
        width: 18px;
        height: 18px;
        flex-shrink: 0;

        &:disabled {
          cursor: not-allowed;
        }
      }

      .checkbox-text {
        font-size: 0.875rem;
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
        line-height: 1.4;
      }
    }
  }
}

.modal-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  padding-top: 1.5rem;
  border-top: 1px solid var(--pav-color-border-primary);

  button {
    min-width: 120px;

    &.danger {
      background: #dc3545;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-weight: var(--pav-font-weight-medium);

      &:hover:not(:disabled) {
        background: #c82333;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @media (prefers-color-scheme: dark) {
        background: #e74c5c;

        &:hover:not(:disabled) {
          background: #d43f50;
        }
      }
    }
  }
}
</style>
