<script setup>
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'funding.paypal_modal',
});

// Props
const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
});

// Emits
const emit = defineEmits(['close', 'submit']);

// Form state
const clientId = ref('');
const clientSecret = ref('');
const environment = ref('sandbox');
const submitting = ref(false);

// Validation state
const errors = ref({
  clientId: '',
  clientSecret: '',
  environment: '',
});

// Computed
const hasErrors = computed(() => {
  return errors.value.clientId || errors.value.clientSecret || errors.value.environment;
});

const isFormValid = computed(() => {
  return clientId.value.trim() && clientSecret.value.trim() && environment.value && !hasErrors.value;
});

/**
 * Validate form fields
 */
function validateForm() {
  errors.value = {
    clientId: '',
    clientSecret: '',
    environment: '',
  };

  if (!clientId.value.trim()) {
    errors.value.clientId = t('client_id_required');
  }

  if (!clientSecret.value.trim()) {
    errors.value.clientSecret = t('client_secret_required');
  }

  if (!environment.value) {
    errors.value.environment = t('environment_required');
  }

  return !hasErrors.value;
}

/**
 * Handle form submission
 */
async function handleSubmit() {
  if (!validateForm()) {
    return;
  }

  submitting.value = true;

  try {
    await emit('submit', {
      clientId: clientId.value.trim(),
      clientSecret: clientSecret.value.trim(),
      environment: environment.value,
    });

    // Reset form on success
    resetForm();
  } catch (error) {
    console.error('Error submitting PayPal configuration:', error);
  } finally {
    submitting.value = false;
  }
}

/**
 * Reset form fields
 */
function resetForm() {
  clientId.value = '';
  clientSecret.value = '';
  environment.value = 'sandbox';
  errors.value = {
    clientId: '',
    clientSecret: '',
    environment: '',
  };
}

/**
 * Handle modal close
 */
function handleClose() {
  if (!submitting.value) {
    resetForm();
    emit('close');
  }
}

/**
 * Validate field on blur
 */
function validateField(field) {
  if (field === 'clientId' && !clientId.value.trim()) {
    errors.value.clientId = t('client_id_required');
  } else if (field === 'clientId') {
    errors.value.clientId = '';
  }

  if (field === 'clientSecret' && !clientSecret.value.trim()) {
    errors.value.clientSecret = t('client_secret_required');
  } else if (field === 'clientSecret') {
    errors.value.clientSecret = '';
  }

  if (field === 'environment' && !environment.value) {
    errors.value.environment = t('environment_required');
  } else if (field === 'environment') {
    errors.value.environment = '';
  }
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="handleClose">
    <div class="modal-container" role="dialog" aria-modal="true" :aria-label="t('title')">
      <div class="modal-header">
        <h2>{{ t('title') }}</h2>
        <button
          type="button"
          class="close-button"
          :aria-label="t('close_button')"
          @click="handleClose"
          :disabled="submitting"
        >
          &times;
        </button>
      </div>

      <div class="modal-body">
        <p class="modal-description">{{ t('description') }}</p>

        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label for="paypal-client-id" class="form-label">
              {{ t('client_id_label') }}
              <span class="required">*</span>
            </label>
            <input
              id="paypal-client-id"
              v-model="clientId"
              type="text"
              class="form-input"
              :class="{ 'has-error': errors.clientId }"
              :placeholder="t('client_id_placeholder')"
              :disabled="submitting"
              @blur="validateField('clientId')"
            />
            <div v-if="errors.clientId" class="error-message">
              {{ errors.clientId }}
            </div>
            <div class="field-help">{{ t('client_id_help') }}</div>
          </div>

          <div class="form-group">
            <label for="paypal-client-secret" class="form-label">
              {{ t('client_secret_label') }}
              <span class="required">*</span>
            </label>
            <input
              id="paypal-client-secret"
              v-model="clientSecret"
              type="password"
              class="form-input"
              :class="{ 'has-error': errors.clientSecret }"
              :placeholder="t('client_secret_placeholder')"
              :disabled="submitting"
              @blur="validateField('clientSecret')"
            />
            <div v-if="errors.clientSecret" class="error-message">
              {{ errors.clientSecret }}
            </div>
            <div class="field-help">{{ t('client_secret_help') }}</div>
          </div>

          <div class="form-group">
            <label for="paypal-environment" class="form-label">
              {{ t('environment_label') }}
              <span class="required">*</span>
            </label>
            <select
              id="paypal-environment"
              v-model="environment"
              class="form-input"
              :class="{ 'has-error': errors.environment }"
              :disabled="submitting"
              @blur="validateField('environment')"
            >
              <option value="sandbox">{{ t('environment_sandbox') }}</option>
              <option value="production">{{ t('environment_production') }}</option>
            </select>
            <div v-if="errors.environment" class="error-message">
              {{ errors.environment }}
            </div>
            <div class="field-help">{{ t('environment_help') }}</div>
          </div>

          <div class="modal-actions">
            <button
              type="button"
              class="secondary"
              @click="handleClose"
              :disabled="submitting"
            >
              {{ t('cancel_button') }}
            </button>
            <button
              type="submit"
              class="primary"
              :disabled="!isFormValid || submitting"
            >
              {{ submitting ? t('submitting_button') : t('submit_button') }}
            </button>
          </div>
        </form>
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
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
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

  .modal-description {
    margin: 0 0 1.5rem 0;
    color: $light-mode-secondary-text;
    line-height: 1.5;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }

  .form-group {
    margin-bottom: 1.5rem;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .form-label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.5rem;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }

    .required {
      color: #dc3545;
      margin-left: 0.25rem;
    }
  }

  .form-input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid $light-mode-border;
    border-radius: $component-border-radius;
    background: $light-mode-panel-background;
    color: $light-mode-text;
    font-size: 1rem;

    &:focus {
      outline: none;
      border-color: #4a90e2;
      box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
    }

    &.has-error {
      border-color: #dc3545;

      &:focus {
        box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.1);
      }
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      background: $light-mode-selected-background;
    }

    @media (prefers-color-scheme: dark) {
      border-color: $dark-mode-border;
      background: $dark-mode-input-background;
      color: $dark-mode-input-text;

      &:disabled {
        background: $dark-mode-selected-background;
      }
    }
  }

  .error-message {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: #dc3545;
  }

  .field-help {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: $light-mode-secondary-text;
    line-height: 1.4;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }
}

.modal-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid $light-mode-border;

  @media (prefers-color-scheme: dark) {
    border-top-color: $dark-mode-border;
  }

  button {
    min-width: 100px;
  }
}
</style>
