<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';
import SubscriptionService from '@/client/service/subscription';
import type { ProviderConfig, PayPalCredentials } from '@/client/service/subscription';

const { t } = useTranslation('admin', {
  keyPrefix: 'funding.wizard',
});

// Service instance
const subscriptionService = new SubscriptionService();

// Props
const props = defineProps<{
  show: boolean;
  unconfiguredProviders: ProviderConfig[];
}>();

// Emits
const emit = defineEmits<{
  close: [];
  'provider-connected': [];
}>();

// State
const currentStep = ref(1);
const selectedProvider = ref<string | null>(null);
const error = ref<string | null>(null);
const connecting = ref(false);

// PayPal form state
const paypalClientId = ref('');
const paypalClientSecret = ref('');
const paypalEnvironment = ref<'sandbox' | 'production'>('sandbox');
const paypalErrors = ref({
  clientId: '',
  clientSecret: '',
  environment: '',
});

// Computed
const totalSteps = computed(() => 3);

const selectedProviderConfig = computed(() => {
  return props.unconfiguredProviders.find(p => p.provider_type === selectedProvider.value);
});

const selectedProviderName = computed(() => {
  if (selectedProvider.value === 'stripe') {
    return t('providers.stripe_name');
  }
  else if (selectedProvider.value === 'paypal') {
    return t('providers.paypal_name');
  }
  return selectedProvider.value || '';
});

const isPayPalFormValid = computed(() => {
  return paypalClientId.value.trim() &&
         paypalClientSecret.value.trim() &&
         paypalEnvironment.value &&
         !paypalErrors.value.clientId &&
         !paypalErrors.value.clientSecret &&
         !paypalErrors.value.environment;
});

/**
 * Select a provider on step 1
 */
function selectProvider(providerType: string) {
  selectedProvider.value = providerType;
  error.value = null;
}

/**
 * Navigate to next step
 */
function goToNextStep() {
  if (currentStep.value === 1 && selectedProvider.value) {
    currentStep.value = 2;
    error.value = null;
  }
}

/**
 * Navigate to previous step
 */
function goToPreviousStep() {
  if (currentStep.value > 1) {
    currentStep.value--;
    error.value = null;
  }
}

/**
 * Close wizard and reset state
 */
function closeWizard() {
  resetWizard();
  emit('close');
}

/**
 * Reset wizard to initial state
 */
function resetWizard() {
  currentStep.value = 1;
  selectedProvider.value = null;
  error.value = null;
  connecting.value = false;
  resetPayPalForm();
}

/**
 * Reset PayPal form fields
 */
function resetPayPalForm() {
  paypalClientId.value = '';
  paypalClientSecret.value = '';
  paypalEnvironment.value = 'sandbox';
  paypalErrors.value = {
    clientId: '',
    clientSecret: '',
    environment: '',
  };
}

/**
 * Validate PayPal form field on blur
 */
function validatePayPalField(field: 'clientId' | 'clientSecret' | 'environment') {
  if (field === 'clientId') {
    paypalErrors.value.clientId = paypalClientId.value.trim() ? '' : 'Client ID is required';
  }
  else if (field === 'clientSecret') {
    paypalErrors.value.clientSecret = paypalClientSecret.value.trim() ? '' : 'Client Secret is required';
  }
  else if (field === 'environment') {
    paypalErrors.value.environment = paypalEnvironment.value ? '' : 'Environment is required';
  }
}

/**
 * Handle Stripe OAuth connection
 */
async function connectStripe() {
  try {
    connecting.value = true;
    error.value = null;

    // Pass current URL as return URL for OAuth callback
    const returnUrl = window.location.origin + '/admin/funding';
    const result = await subscriptionService.connectStripe(returnUrl);
    // Redirect to Stripe OAuth - the user will come back via OAuth redirect
    window.location.href = result;
  }
  catch (err) {
    console.error('Failed to connect Stripe:', err);
    error.value = t('errors.connection_failed', { provider: selectedProviderName.value });
    connecting.value = false;
  }
}

/**
 * Handle PayPal configuration submission
 */
async function configurePayPal() {
  // Validate form
  if (!isPayPalFormValid.value) {
    validatePayPalField('clientId');
    validatePayPalField('clientSecret');
    validatePayPalField('environment');
    return;
  }

  try {
    connecting.value = true;
    error.value = null;

    const credentials: PayPalCredentials = {
      client_id: paypalClientId.value.trim(),
      client_secret: paypalClientSecret.value.trim(),
      environment: paypalEnvironment.value,
    };

    const success = await subscriptionService.configurePayPal(credentials);

    if (success) {
      // Move to success step
      currentStep.value = 3;
      connecting.value = false;
    }
    else {
      error.value = t('errors.connection_failed', { provider: selectedProviderName.value });
      connecting.value = false;
    }
  }
  catch (err) {
    console.error('Failed to configure PayPal:', err);
    error.value = t('errors.connection_failed', { provider: selectedProviderName.value });
    connecting.value = false;
  }
}

/**
 * Handle Done button on success step
 */
function handleSuccess() {
  emit('provider-connected');
  emit('close');
  resetWizard();
}
</script>

<template>
  <Modal
    v-if="show"
    :title="t('title')"
    :initiallyOpen="true"
    @close="closeWizard"
  >
    <!-- Progress Indicator -->
    <div class="progress-indicator">
      {{ t('step_indicator', { current: currentStep, total: totalSteps }) }}
    </div>

    <!-- Wizard Content -->
    <div class="wizard-content">
      <!-- Error Message -->
      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <!-- Step 1: Provider Selection -->
      <div v-if="currentStep === 1" class="step-content">
        <h3 class="step-title">{{ t('step1.title') }}</h3>
        <p class="step-description">{{ t('step1.description') }}</p>

        <div class="provider-grid">
          <div
            v-for="provider in unconfiguredProviders"
            :key="provider.provider_type"
            class="provider-card"
            :class="{ selected: selectedProvider === provider.provider_type }"
            @click="selectProvider(provider.provider_type)"
          >
            <div class="provider-icon">
              {{ provider.provider_type === 'stripe' ? '💳' : '🅿️' }}
            </div>
            <h4 class="provider-name">
              {{ t(`providers.${provider.provider_type}_name`) }}
            </h4>
            <p class="provider-description">
              {{ t(`providers.${provider.provider_type}_description`) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Step 2: Provider Configuration -->
      <div v-if="currentStep === 2" class="step-content">
        <!-- Stripe Configuration -->
        <div v-if="selectedProvider === 'stripe'" class="provider-config">
          <h3 class="step-title">{{ t('step2.stripe_title') }}</h3>
          <p class="step-description">{{ t('step2.stripe_description') }}</p>

          <button
            type="button"
            class="primary connect-button"
            @click="connectStripe"
            :disabled="connecting"
          >
            {{ connecting ? t('connecting_button', { defaultValue: 'Connecting...' }) : t('step2.stripe_connect_button') }}
          </button>
        </div>

        <!-- PayPal Configuration -->
        <div v-if="selectedProvider === 'paypal'" class="provider-config">
          <h3 class="step-title">{{ t('step2.paypal_title') }}</h3>
          <p class="step-description">{{ t('step2.paypal_description') }}</p>

          <form @submit.prevent="configurePayPal">
            <div class="form-group">
              <label for="paypal-client-id" class="form-label">
                {{ t('step2.paypal_client_id_label') }}
                <span class="required">*</span>
              </label>
              <input
                id="paypal-client-id"
                v-model="paypalClientId"
                type="text"
                class="form-input"
                :class="{ 'has-error': paypalErrors.clientId }"
                :placeholder="t('step2.paypal_client_id_placeholder')"
                :disabled="connecting"
                @blur="validatePayPalField('clientId')"
              />
              <div v-if="paypalErrors.clientId" class="error-message-inline">
                {{ paypalErrors.clientId }}
              </div>
            </div>

            <div class="form-group">
              <label for="paypal-client-secret" class="form-label">
                {{ t('step2.paypal_client_secret_label') }}
                <span class="required">*</span>
              </label>
              <input
                id="paypal-client-secret"
                v-model="paypalClientSecret"
                type="password"
                class="form-input"
                :class="{ 'has-error': paypalErrors.clientSecret }"
                :placeholder="t('step2.paypal_client_secret_placeholder')"
                :disabled="connecting"
                @blur="validatePayPalField('clientSecret')"
              />
              <div v-if="paypalErrors.clientSecret" class="error-message-inline">
                {{ paypalErrors.clientSecret }}
              </div>
            </div>

            <div class="form-group">
              <label for="paypal-environment" class="form-label">
                {{ t('step2.paypal_environment_label') }}
                <span class="required">*</span>
              </label>
              <select
                id="paypal-environment"
                v-model="paypalEnvironment"
                class="form-input"
                :class="{ 'has-error': paypalErrors.environment }"
                :disabled="connecting"
                @blur="validatePayPalField('environment')"
              >
                <option value="sandbox">{{ t('step2.paypal_environment_sandbox') }}</option>
                <option value="production">{{ t('step2.paypal_environment_production') }}</option>
              </select>
              <div v-if="paypalErrors.environment" class="error-message-inline">
                {{ paypalErrors.environment }}
              </div>
            </div>

            <button
              type="submit"
              class="primary connect-button"
              :disabled="!isPayPalFormValid || connecting"
            >
              {{ connecting ? t('connecting_button', { defaultValue: 'Connecting...' }) : t('step2.paypal_configure_button', { defaultValue: 'Configure PayPal' }) }}
            </button>
          </form>
        </div>
      </div>

      <!-- Step 3: Success -->
      <div v-if="currentStep === 3" class="step-content success-content">
        <div class="success-icon">✓</div>
        <h3 class="step-title">{{ t('step3.title') }}</h3>
        <p class="success-message">
          {{ t('step3.success_message', { provider: selectedProviderName }) }}
        </p>
        <p class="ready-message">{{ t('step3.ready_message') }}</p>
      </div>
    </div>

    <!-- Modal Actions -->
    <div class="modal-actions">
      <!-- Step 1 Actions -->
      <template v-if="currentStep === 1">
        <button
          type="button"
          class="secondary cancel-button"
          @click="closeWizard"
          :disabled="connecting"
        >
          {{ t('cancel_button') }}
        </button>
        <button
          type="button"
          class="primary continue-button"
          @click="goToNextStep"
          :disabled="!selectedProvider || connecting"
        >
          {{ t('continue_button') }}
        </button>
      </template>

      <!-- Step 2 Actions -->
      <template v-if="currentStep === 2">
        <button
          type="button"
          class="secondary back-button"
          @click="goToPreviousStep"
          :disabled="connecting"
        >
          {{ t('back_button') }}
        </button>
        <button
          type="button"
          class="secondary cancel-button"
          @click="closeWizard"
          :disabled="connecting"
        >
          {{ t('cancel_button') }}
        </button>
      </template>

      <!-- Step 3 Actions -->
      <template v-if="currentStep === 3">
        <button
          type="button"
          class="primary done-button"
          @click="handleSuccess"
        >
          {{ t('done_button') }}
        </button>
      </template>
    </div>
  </Modal>
</template>

<style scoped lang="scss">
.progress-indicator {
  text-align: center;
  padding: 0 0 1rem 0;
  font-size: 0.875rem;
  font-weight: var(--pav-font-weight-medium);
  color: var(--pav-color-text-secondary);
}

.wizard-content {

  .error-message {
    margin-bottom: 1.5rem;
    padding: 0.75rem;
    background-color: #fff0f0;
    border: 1px solid #d87373;
    color: #7d2a2a;
    border-radius: 4px;

    @media (prefers-color-scheme: dark) {
      background-color: #4a2020;
      border-color: #8a4040;
      color: #f8b4b4;
    }
  }

  .step-content {
    .step-title {
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    .step-description {
      margin: 0 0 1.5rem 0;
      color: var(--pav-color-text-secondary);
      line-height: 1.5;
    }
  }
}

// Provider Selection Grid
.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;

  .provider-card {
    padding: 1.5rem;
    border: 2px solid var(--pav-color-border-primary);
    border-radius: 8px;
    cursor: pointer;
    text-align: center;
    transition: all 0.2s ease;
    background: var(--pav-color-surface-secondary);

    &:hover {
      border-color: #4a90e2;
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }

    &.selected {
      border-color: #4a90e2;
      background: rgba(74, 144, 226, 0.05);
      box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
    }

    @media (prefers-color-scheme: dark) {
      background: rgba(255, 255, 255, 0.05);

      &:hover {
        border-color: #60a5fa;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      }

      &.selected {
        border-color: #60a5fa;
        background: rgba(96, 165, 250, 0.1);
        box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1);
      }
    }

    .provider-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }

    .provider-name {
      margin: 0 0 0.5rem 0;
      font-size: 1.125rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    .provider-description {
      margin: 0;
      font-size: 0.875rem;
      color: var(--pav-color-text-secondary);
    }
  }
}

// Provider Configuration Forms
.provider-config {
  .connect-button {
    width: 100%;
    margin-top: 1rem;
  }

  .form-group {
    margin-bottom: 1.5rem;

    .form-label {
      display: block;
      font-weight: var(--pav-font-weight-medium);
      margin-bottom: 0.5rem;
      color: var(--pav-color-text-primary);

      .required {
        color: #dc3545;
        margin-left: 0.25rem;
      }
    }

    .form-input {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--pav-color-border-primary);
      border-radius: 8px;
      background: var(--pav-color-surface-secondary);
      color: var(--pav-color-text-primary);
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
        background: var(--pav-color-surface-hover);
      }

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-surface-tertiary);
      }
    }

    .error-message-inline {
      margin-top: 0.5rem;
      font-size: 0.875rem;
      color: #dc3545;
    }
  }
}

// Success Step
.success-content {
  text-align: center;
  padding: 2rem 0;

  .success-icon {
    width: 4rem;
    height: 4rem;
    margin: 0 auto 1.5rem;
    background: #d4edda;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    color: #155724;

    @media (prefers-color-scheme: dark) {
      background: #1e4620;
      color: #7fd68a;
    }
  }

  .success-message {
    margin-bottom: 1rem;
    font-size: 1.125rem;
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-primary);
  }

  .ready-message {
    margin: 0;
    color: var(--pav-color-text-secondary);
  }
}

// Modal Actions
.modal-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 1.5rem;

  button {
    min-width: 100px;
  }
}
</style>
