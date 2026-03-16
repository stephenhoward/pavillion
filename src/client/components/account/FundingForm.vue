<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import FundingService from '@/client/service/funding';
import type { FundingOptions, FundingProvider } from '@/client/service/funding';
import { useStripeCheckout } from '@/client/composables/useStripeCheckout';

const ALLOWED_CHECKOUT_ORIGINS = [
  'https://www.paypal.com',
  'https://www.sandbox.paypal.com',
];

type FormState = 'configure' | 'checkout' | 'result';

const props = defineProps<{
  calendarId?: string;
}>();

const emit = defineEmits<{
  subscribed: [];
}>();

const { t } = useTranslation('funding');

const fundingService = new FundingService();

const loading = ref(true);
const processing = ref(false);
const errorMessage = ref('');
const options = ref<FundingOptions | null>(null);
const formState = ref<FormState>('configure');
const resultStatus = ref<'success' | 'error'>('success');

const selectedProvider = ref('');
const selectedCycle = ref<'monthly' | 'yearly'>('monthly');
const customAmount = ref(10.00);

// Template ref for the Stripe checkout container
const checkoutContainerRef = ref<HTMLElement | null>(null);

// Stripe embedded checkout state
let checkoutInstance: any = null;

const singleProvider = computed(() =>
  options.value?.providers.length === 1,
);

const selectedProviderInfo = computed<FundingProvider | undefined>(() =>
  options.value?.providers.find(p => p.providerType === selectedProvider.value),
);

const isStripeProvider = computed(() =>
  selectedProvider.value === 'stripe',
);

const monthlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return FundingService.formatCurrency(options.value.monthlyPrice, options.value.currency);
});

const yearlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return FundingService.formatCurrency(options.value.yearlyPrice, options.value.currency);
});

async function loadOptions() {
  try {
    loading.value = true;
    options.value = await fundingService.getOptions();

    if (options.value.providers.length > 0) {
      selectedProvider.value = options.value.providers[0].providerType;
    }
  }
  catch (error) {
    console.error('Failed to load funding options:', error);
    errorMessage.value = t('load_error');
  }
  finally {
    loading.value = false;
  }
}

/**
 * Validates whether a redirect URL is from an allowed checkout origin.
 * Used for PayPal redirect flow.
 */
function isAllowedCheckoutOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_CHECKOUT_ORIGINS.includes(parsed.origin);
  }
  catch {
    return false;
  }
}

/**
 * Clean up any mounted Stripe checkout instance
 */
function destroyCheckout() {
  if (checkoutInstance) {
    try {
      checkoutInstance.destroy();
    }
    catch {
      // Ignore errors during cleanup
    }
    checkoutInstance = null;
  }
}

/**
 * Handle the Stripe embedded checkout flow
 */
async function startStripeCheckout() {
  const provider = selectedProviderInfo.value;

  if (!provider?.publishableKey) {
    errorMessage.value = t('subscribe_error');
    return;
  }

  processing.value = true;
  errorMessage.value = '';

  try {
    // Build checkout session params
    const params: Record<string, any> = {
      billing_cycle: selectedCycle.value,
      return_url: window.location.href,
    };

    if (options.value?.payWhatYouCan) {
      params.amount = FundingService.displayToMillicents(customAmount.value);
    }

    if (props.calendarId) {
      params.calendar_ids = [props.calendarId];
    }

    // Create checkout session via API
    const session = await fundingService.createCheckoutSession(params);

    // Initialize Stripe and mount embedded checkout
    const { stripe, loading: stripeLoading, error: stripeError } = useStripeCheckout(provider.publishableKey);

    // Wait for Stripe to load
    await new Promise<void>((resolve, reject) => {
      if (!stripeLoading.value) {
        if (stripeError.value) {
          reject(new Error(stripeError.value));
        }
        else {
          resolve();
        }
        return;
      }

      const stopWatch = watch([stripeLoading, stripeError], () => {
        if (!stripeLoading.value) {
          stopWatch();
          if (stripeError.value) {
            reject(new Error(stripeError.value));
          }
          else {
            resolve();
          }
        }
      });
    });

    if (!stripe.value) {
      throw new Error('Stripe failed to initialize');
    }

    // Initialize embedded checkout
    checkoutInstance = await stripe.value.initEmbeddedCheckout({
      clientSecret: session.client_secret,
    });

    // Switch to checkout state so the container is rendered
    formState.value = 'checkout';
    processing.value = false;

    // Wait for DOM update so the container ref is available
    await nextTick();

    const container = checkoutContainerRef.value;

    if (container) {
      checkoutInstance.mount(container);
    }

    // Poll for session completion
    pollCheckoutStatus(session.session_id);
  }
  catch (error) {
    console.error('Failed to start Stripe checkout:', error);
    errorMessage.value = t('subscribe_error');
    formState.value = 'configure';
    processing.value = false;
  }
}

/**
 * Poll the checkout session status until it completes or fails
 */
async function pollCheckoutStatus(sessionId: string) {
  const maxAttempts = 120;
  const intervalMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));

    // If user navigated away from checkout state, stop polling
    if (formState.value !== 'checkout') {
      return;
    }

    try {
      const status = await fundingService.getCheckoutSessionStatus(sessionId);

      if (status.status === 'complete') {
        destroyCheckout();
        resultStatus.value = 'success';
        formState.value = 'result';
        return;
      }

      if (status.status === 'expired') {
        destroyCheckout();
        resultStatus.value = 'error';
        formState.value = 'result';
        return;
      }
    }
    catch {
      // Continue polling on transient errors
    }
  }
}

/**
 * Handle the PayPal redirect flow (unchanged from original)
 */
async function startPayPalCheckout() {
  processing.value = true;
  errorMessage.value = '';

  try {
    const params: Record<string, any> = {
      provider_type: selectedProvider.value,
      billing_cycle: selectedCycle.value,
    };

    if (options.value?.payWhatYouCan) {
      params.amount = FundingService.displayToMillicents(customAmount.value);
    }

    const calendarIds = props.calendarId ? [props.calendarId] : undefined;
    const result = await fundingService.subscribe(params, calendarIds);

    if (result.redirectUrl) {
      if (!isAllowedCheckoutOrigin(result.redirectUrl)) {
        errorMessage.value = t('subscribe_error');
        return;
      }
      window.location.href = result.redirectUrl;
      return;
    }

    emit('subscribed');
  }
  catch (error) {
    console.error('Failed to create funding plan:', error);
    errorMessage.value = t('subscribe_error');
  }
  finally {
    processing.value = false;
  }
}

/**
 * Submit handler dispatches to the appropriate provider flow
 */
async function submitSubscribe() {
  if (!selectedProvider.value) {
    errorMessage.value = t('select_provider_error');
    return;
  }

  if (isStripeProvider.value) {
    await startStripeCheckout();
  }
  else {
    await startPayPalCheckout();
  }
}

/**
 * Return to configure state from checkout or result
 */
function backToConfigure() {
  destroyCheckout();
  errorMessage.value = '';
  formState.value = 'configure';
}

/**
 * Handle successful result acknowledgment
 */
function acknowledgeResult() {
  emit('subscribed');
}

onMounted(loadOptions);

onBeforeUnmount(() => {
  destroyCheckout();
});
</script>

<template>
  <div class="funding-form">
    <div v-if="loading" class="loading">{{ t("loading") }}</div>

    <div v-else-if="errorMessage && formState === 'configure'" class="error-message" role="alert">
      {{ errorMessage }}
    </div>

    <!-- Configure state: select billing cycle, amount, provider -->
    <template v-if="!loading && formState === 'configure' && options">
      <!-- Provider selection (skip when only one) -->
      <div v-if="!singleProvider" class="form-group">
        <label class="form-label">{{ t("select_provider") }}</label>
        <div class="provider-options">
          <label
            v-for="provider in options.providers"
            :key="provider.providerType"
            class="provider-option"
          >
            <input
              type="radio"
              :value="provider.providerType"
              v-model="selectedProvider"
              :disabled="processing"
            />
            <span>{{ provider.displayName }}</span>
          </label>
        </div>
      </div>

      <!-- Billing cycle -->
      <div class="form-group">
        <label class="form-label">{{ t("select_cycle") }}</label>
        <div class="cycle-options">
          <label class="cycle-option">
            <input
              type="radio"
              value="monthly"
              v-model="selectedCycle"
              :disabled="processing"
            />
            <span>{{ t("billing_cycle_monthly") }} - {{ monthlyPriceDisplay }}</span>
          </label>
          <label class="cycle-option">
            <input
              type="radio"
              value="yearly"
              v-model="selectedCycle"
              :disabled="processing"
            />
            <span>{{ t("billing_cycle_yearly") }} - {{ yearlyPriceDisplay }}</span>
          </label>
        </div>
      </div>

      <!-- PWYC amount -->
      <div v-if="options.payWhatYouCan" class="form-group">
        <label class="form-label">{{ t("custom_amount_label") }}</label>
        <div class="form-field">
          <input
            type="number"
            v-model.number="customAmount"
            step="0.01"
            min="1"
            :disabled="processing"
          />
          <div class="description">{{ t("custom_amount_description") }}</div>
        </div>
      </div>

      <!-- Submit -->
      <div class="form-actions">
        <button
          type="button"
          class="primary"
          :disabled="processing"
          @click="submitSubscribe"
        >
          {{ t("confirm_subscribe_button") }}
        </button>
      </div>
    </template>

    <!-- Checkout state: embedded Stripe checkout iframe -->
    <template v-if="formState === 'checkout'">
      <div class="checkout-state">
        <div v-if="errorMessage" class="error-message" role="alert">
          {{ errorMessage }}
        </div>
        <div ref="checkoutContainerRef" class="stripe-checkout-container" />
        <div class="form-actions">
          <button
            type="button"
            class="secondary"
            @click="backToConfigure"
          >
            {{ t("cancel_button") }}
          </button>
        </div>
      </div>
    </template>

    <!-- Result state: success or error after checkout -->
    <template v-if="formState === 'result'">
      <div class="result-state">
        <div v-if="resultStatus === 'success'" class="success-message" role="status">
          {{ t("subscribe_success") }}
        </div>
        <div v-else class="error-message" role="alert">
          {{ t("subscribe_error") }}
        </div>
        <div class="form-actions">
          <button
            v-if="resultStatus === 'success'"
            type="button"
            class="primary"
            @click="acknowledgeResult"
          >
            {{ t("checkout_done_button") }}
          </button>
          <button
            v-else
            type="button"
            class="secondary"
            @click="backToConfigure"
          >
            {{ t("checkout_try_again_button") }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.funding-form {
  .form-group {
    margin-bottom: 1.5rem;

    .form-label {
      display: block;
      font-weight: var(--pav-font-weight-medium);
      margin-bottom: 0.5rem;
      color: var(--pav-color-text-primary);
    }

    .provider-options, .cycle-options {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;

      label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        border: 1px solid var(--pav-color-border-primary);
        border-radius: 8px;
        cursor: pointer;

        &:hover {
          background: var(--pav-color-surface-hover);
        }

        input[type="radio"] {
          margin: 0;
        }
      }
    }

    .form-field {
      input {
        width: 100%;
        max-width: 200px;
        padding: 0.5rem;
        border: 1px solid var(--pav-color-border-primary);
        border-radius: 8px;
        background: var(--pav-color-surface-secondary);
        color: var(--pav-color-text-primary);

        @media (prefers-color-scheme: dark) {
          background: var(--pav-color-surface-tertiary);
        }
      }

      .description {
        margin-top: 0.5rem;
        font-size: 0.875rem;
        color: var(--pav-color-text-secondary);
      }
    }
  }

  .form-actions {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
  }
}

.loading {
  padding: 1rem;
  text-align: center;
  color: var(--pav-color-text-secondary);
}

.error-message {
  padding: 0.75rem;
  background-color: #fff0f0;
  border: 1px solid #d87373;
  color: #7d2a2a;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.success-message {
  padding: 0.75rem;
  background-color: #f0fff0;
  border: 1px solid #73d873;
  color: #2a7d2a;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.stripe-checkout-container {
  min-height: 300px;
  margin-bottom: 1rem;
}

.checkout-state,
.result-state {
  .form-actions {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
  }
}
</style>
