<script setup>
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';

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
  activeSubscriptionCount: {
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
  <div v-if="show" class="modal-overlay" @click.self="handleClose">
    <div class="modal-container"
         role="dialog"
         aria-modal="true"
         :aria-label="t('title', { provider: providerName })">
      <div class="modal-header">
        <h2>{{ t('title', { provider: providerName }) }}</h2>
        <button
          type="button"
          class="close-button"
          :aria-label="t('close_button')"
          @click="handleClose"
          :disabled="disconnecting"
        >
          &times;
        </button>
      </div>

      <div class="modal-body">
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
            {{ t('message', { provider: providerName, count: activeSubscriptionCount }) }}
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
            class="secondary"
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
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

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
  padding: 1rem;

  @media (prefers-color-scheme: dark) {
    background: rgba(0, 0, 0, 0.7);
  }
}

.modal-container {
  background: $light-mode-panel-background;
  border-radius: $component-border-radius;
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06);

  @media (prefers-color-scheme: dark) {
    background: $dark-mode-panel-background;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid $light-mode-border;

  @media (prefers-color-scheme: dark) {
    border-bottom-color: $dark-mode-border;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 500;
    color: #dc3545;

    @media (prefers-color-scheme: dark) {
      color: #ff6b7a;
    }
  }

  .close-button {
    background: none;
    border: none;
    font-size: 2rem;
    line-height: 1;
    color: $light-mode-secondary-text;
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover:not(:disabled) {
      color: $light-mode-text;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;

      &:hover:not(:disabled) {
        color: $dark-mode-text;
      }
    }
  }
}

.modal-body {
  padding: 1.5rem;

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
      font-weight: 500;
      color: $light-mode-text;
      line-height: 1.5;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
    }

    .message-secondary {
      margin: 0;
      font-size: 0.875rem;
      color: $light-mode-secondary-text;
      line-height: 1.5;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-secondary-text;
      }
    }
  }

  .confirmation-section {
    padding: 1rem;
    background: rgba(220, 53, 69, 0.05);
    border: 1px solid rgba(220, 53, 69, 0.2);
    border-radius: $component-border-radius;
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
        font-weight: 500;
        color: $light-mode-text;
        line-height: 1.4;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-text;
        }
      }
    }
  }
}

.modal-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  padding-top: 1.5rem;
  border-top: 1px solid $light-mode-border;

  @media (prefers-color-scheme: dark) {
    border-top-color: $dark-mode-border;
  }

  button {
    min-width: 120px;

    &.danger {
      background: #dc3545;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: $component-border-radius;
      cursor: pointer;
      font-weight: 500;

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
