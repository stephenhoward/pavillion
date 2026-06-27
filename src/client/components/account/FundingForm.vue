<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import FundingService from '@/client/service/funding';
import type { FundingOptions, FundingProvider } from '@/client/service/funding';
import { loadStripe } from '@/client/service/stripe-loader';

type FormState = 'configure' | 'checkout' | 'result';

const props = defineProps<{
  calendarId?: string;
  initialCycle?: 'monthly' | 'yearly';
  initialAmount?: number;
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

// PWYC-specific state
const monthlyAmount = ref(0);
const yearlyOptIn = ref(false);

// Template ref for the Stripe checkout container
const checkoutContainerRef = ref<HTMLElement | null>(null);

// Stripe embedded checkout state
let checkoutInstance: any = null;

/**
 * Detect whether the user's current color mode is dark.
 * Checks data-theme attribute first, then falls back to system preference.
 */
function isDarkMode(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const availableProviders = computed(() =>
  options.value?.providers.filter(p => p.providerType !== 'paypal') ?? [],
);

const singleProvider = computed(() =>
  availableProviders.value.length === 1,
);

const selectedProviderInfo = computed<FundingProvider | undefined>(() =>
  options.value?.providers.find(p => p.providerType === selectedProvider.value),
);

const isStripeProvider = computed(() =>
  selectedProvider.value === 'stripe',
);

const isPwyc = computed(() =>
  options.value?.payWhatYouCan ?? false,
);

const monthlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return FundingService.formatCurrency(options.value.monthlyPrice, options.value.currency);
});

const yearlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return FundingService.formatCurrency(options.value.yearlyPrice, options.value.currency);
});

/**
 * Computed discounted yearly amount based on PWYC monthly input.
 * Formula: monthly * 12 * (1 - discount/100)
 */
const pwycYearlyAmount = computed(() => {
  const discount = options.value?.payWhatYouCanYearlyDiscount ?? 0;
  return monthlyAmount.value * 12 * (1 - discount / 100);
});

/**
 * Formatted PWYC yearly amount for display
 */
const pwycYearlyDisplay = computed(() => {
  if (!options.value) return '';
  const millicents = FundingService.displayToMillicents(pwycYearlyAmount.value);
  return FundingService.formatCurrency(millicents, options.value.currency);
});

/**
 * Currency symbol for PWYC inputs
 */
const currencySymbol = computed((): string => {
  const currency = options.value?.currency ?? 'USD';
  try {
    return new Intl.NumberFormat(i18next.language, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0).find(p => p.type === 'currency')?.value ?? '$';
  }
  catch {
    return '$';
  }
});

/**
 * Formatted suggested monthly amount for display
 */
const suggestedAmountDisplay = computed(() => {
  if (!options.value) return '';
  return FundingService.formatCurrency(options.value.monthlyPrice, options.value.currency);
});

async function loadOptions() {
  try {
    loading.value = true;
    options.value = await fundingService.getOptions();

    if (availableProviders.value.length > 0) {
      selectedProvider.value = availableProviders.value[0].providerType;
    }

    // Apply initial values from props if provided
    if (props.initialCycle) {
      selectedCycle.value = props.initialCycle;
    }

    // Prefill PWYC monthly amount from admin's suggested price
    if (options.value?.payWhatYouCan) {
      if (props.initialAmount !== undefined) {
        monthlyAmount.value = FundingService.millicentsToDisplay(props.initialAmount);
      }
      else {
        monthlyAmount.value = FundingService.millicentsToDisplay(options.value.monthlyPrice);
      }
      customAmount.value = monthlyAmount.value;
    }
    else if (props.initialAmount !== undefined) {
      customAmount.value = FundingService.millicentsToDisplay(props.initialAmount);
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
 * Handle checkout completion callback from Stripe embedded checkout.
 * Verifies the session status via our API before transitioning state.
 */
async function handleCheckoutComplete(sessionId: string) {
  // If user already navigated away from checkout, ignore the callback
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
    // If verification fails, show error — the onComplete callback fires when the form finishes, not when payment is verified
    destroyCheckout();
    resultStatus.value = 'error';
    formState.value = 'result';
  }
}

/**
 * Handle the Stripe embedded checkout flow.
 * Uses Stripe's onComplete callback instead of polling.
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
    // Build return URL with tab=settings so redirect lands on the correct tab
    const returnUrlObj = new URL(window.location.href);
    returnUrlObj.searchParams.set('tab', 'settings');

    // Build checkout session params
    const params: Record<string, any> = {
      returnUrl: returnUrlObj.toString(),
    };

    if (isPwyc.value) {
      // PWYC mode: use monthly input and yearly opt-in
      if (yearlyOptIn.value) {
        params.billingCycle = 'yearly';
        params.amount = FundingService.displayToMillicents(pwycYearlyAmount.value);
      }
      else {
        params.billingCycle = 'monthly';
        params.amount = FundingService.displayToMillicents(monthlyAmount.value);
      }
    }
    else {
      // Fixed pricing mode: use selected cycle
      params.billingCycle = selectedCycle.value;
    }

    if (props.calendarId) {
      params.calendarIds = [props.calendarId];
    }

    if (isDarkMode()) {
      params.colorMode = 'dark';
    }

    // Create checkout session via API
    const session = await fundingService.createCheckoutSession(params);

    // Load Stripe.js and initialize with publishable key
    const stripeInstance = await loadStripe(provider.publishableKey);

    // Initialize embedded checkout with onComplete callback
    checkoutInstance = await stripeInstance.initEmbeddedCheckout({
      clientSecret: session.clientSecret,
      onComplete: () => handleCheckoutComplete(session.sessionId),
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
  }
  catch (error) {
    console.error('Failed to start Stripe checkout:', error);
    errorMessage.value = t('subscribe_error');
    formState.value = 'configure';
    processing.value = false;
  }
}

/**
 * PayPal checkout — not yet implemented, placeholder for future implementation
 */
async function startPayPalCheckout() {
  // TODO: Implement PayPal checkout flow
  errorMessage.value = t('subscribe_error');
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

onMounted(async () => {
  const url = new URL(window.location.href);
  const sessionId = url.searchParams.get('session_id');

  if (sessionId) {
    // Clean URL so session_id doesn't persist on refresh
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', url.toString());

    // Set state so handleCheckoutComplete's guard passes
    formState.value = 'checkout';
    await handleCheckoutComplete(sessionId);

    if (formState.value === 'result') {
      loading.value = false;
      return;
    }
  }

  loadOptions();
});

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
            v-for="provider in availableProviders"
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

      <!-- PWYC mode: monthly amount input + yearly opt-in checkbox -->
      <template v-if="isPwyc">
        <div class="form-group">
          <label class="form-label" for="pwyc-monthly-amount">
            {{ t("monthly_amount_label") }}
          </label>
          <div class="form-field">
            <div class="currency-input">
              <span class="currency-symbol">{{ currencySymbol }}</span>
              <input
                id="pwyc-monthly-amount"
                type="number"
                v-model.number="monthlyAmount"
                step="0.01"
                min="1"
                :disabled="processing"
              />
            </div>
            <div class="description">
              {{ t("suggested_amount", { amount: suggestedAmountDisplay }) }}
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="yearly-opt-in">
            <input
              type="checkbox"
              v-model="yearlyOptIn"
              :disabled="processing"
            />
            <span>{{ t("yearly_opt_in_label", { amount: pwycYearlyDisplay }) }}</span>
          </label>
          <div
            v-if="options.payWhatYouCanYearlyDiscount > 0"
            class="description yearly-discount-note"
          >
            {{ t("yearly_discount_note", { percent: options.payWhatYouCanYearlyDiscount }) }}
          </div>
        </div>
      </template>

      <!-- Non-PWYC mode: billing cycle radios with fixed prices -->
      <template v-else>
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
      </template>

      <!-- Submit -->
      <div class="form-actions">
        <button
          type="button"
          class="btn btn--primary"
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
            class="btn btn--secondary"
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
            class="btn btn--primary"
            @click="acknowledgeResult"
          >
            {{ t("checkout_done_button") }}
          </button>
          <button
            v-else
            type="button"
            class="btn btn--secondary"
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
    margin-bottom: var(--pav-space-6);

    .form-label {
      display: block;
      font-weight: var(--pav-font-weight-medium);
      margin-bottom: var(--pav-space-2);
      color: var(--pav-color-text-primary);
    }

    .provider-options, .cycle-options {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-3);

      label {
        display: flex;
        align-items: center;
        gap: var(--pav-space-2);
        padding: var(--pav-space-3);
        border: 1px solid var(--pav-color-border-primary);
        border-radius: var(--pav-border-radius-md);
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
      .currency-input {
        display: flex;
        align-items: center;
        gap: var(--pav-space-1);
        max-width: 200px;

        .currency-symbol {
          font-weight: 500;
          color: var(--pav-color-text-secondary);
          font-size: var(--pav-font-size-sm);
        }

        input {
          flex: 1;
        }
      }

      input {
        width: 100%;
        max-width: 200px;
        padding: var(--pav-space-2);
        border: 1px solid var(--pav-color-border-primary);
        border-radius: var(--pav-border-radius-md);
        background: var(--pav-color-surface-secondary);
        color: var(--pav-color-text-primary);

        @media (prefers-color-scheme: dark) {
          background: var(--pav-color-surface-tertiary);
        }
      }

      .description {
        margin-top: var(--pav-space-2);
        font-size: var(--pav-font-size-small);
        color: var(--pav-color-text-secondary);
      }
    }

    .yearly-opt-in {
      display: flex;
      align-items: center;
      gap: var(--pav-space-2);
      padding: var(--pav-space-3);
      border: 1px solid var(--pav-color-border-primary);
      border-radius: var(--pav-border-radius-md);
      cursor: pointer;

      &:hover {
        background: var(--pav-color-surface-hover);
      }

      input[type="checkbox"] {
        margin: 0;
      }
    }

    .yearly-discount-note {
      margin-top: var(--pav-space-2);
      font-size: var(--pav-font-size-small);
      color: var(--pav-color-text-secondary);
    }
  }

  .form-actions {
    display: flex;
    gap: var(--pav-space-4);
    margin-top: var(--pav-space-8);
  }
}

.loading {
  padding: var(--pav-space-4);
  text-align: center;
  color: var(--pav-color-text-secondary);
}

.error-message,
.success-message {
  margin-bottom: var(--pav-space-4);
}

.stripe-checkout-container {
  min-height: 300px;
  margin-bottom: var(--pav-space-4);
}

.checkout-state,
.result-state {
  .form-actions {
    display: flex;
    gap: var(--pav-space-4);
    margin-top: var(--pav-space-8);
  }
}
</style>
