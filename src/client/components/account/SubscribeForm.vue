<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { ref, computed, onMounted } from 'vue';
import SubscriptionService from '@/client/service/subscription';
import type { SubscriptionOptions } from '@/client/service/subscription';

const ALLOWED_CHECKOUT_ORIGINS = [
  'https://checkout.stripe.com',
  'https://www.paypal.com',
  'https://www.sandbox.paypal.com',
];

const props = defineProps<{
  calendarId?: string;
}>();

const emit = defineEmits<{
  subscribed: [];
}>();

const { t } = useTranslation('subscription');

const subscriptionService = new SubscriptionService();

const loading = ref(true);
const processing = ref(false);
const errorMessage = ref('');
const options = ref<SubscriptionOptions | null>(null);

const selectedProvider = ref('');
const selectedCycle = ref<'monthly' | 'yearly'>('monthly');
const customAmount = ref(10.00);

const singleProvider = computed(() =>
  options.value?.providers.length === 1,
);

const monthlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return SubscriptionService.formatCurrency(options.value.monthly_price, options.value.currency);
});

const yearlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return SubscriptionService.formatCurrency(options.value.yearly_price, options.value.currency);
});

async function loadOptions() {
  try {
    loading.value = true;
    options.value = await subscriptionService.getOptions();

    if (options.value.providers.length > 0) {
      selectedProvider.value = options.value.providers[0].provider_type;
    }
  }
  catch (error) {
    console.error('Failed to load subscription options:', error);
    errorMessage.value = t('load_error');
  }
  finally {
    loading.value = false;
  }
}

function isAllowedCheckoutOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_CHECKOUT_ORIGINS.includes(parsed.origin);
  }
  catch {
    return false;
  }
}

async function submitSubscribe() {
  if (!selectedProvider.value) {
    errorMessage.value = t('select_provider_error');
    return;
  }

  processing.value = true;
  errorMessage.value = '';

  try {
    const params: Record<string, any> = {
      provider_type: selectedProvider.value,
      billing_cycle: selectedCycle.value,
    };

    if (options.value?.pay_what_you_can) {
      params.amount = SubscriptionService.displayToMillicents(customAmount.value);
    }

    const calendarIds = props.calendarId ? [props.calendarId] : undefined;
    const result = await subscriptionService.subscribe(params, calendarIds);

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
    console.error('Failed to subscribe:', error);
    errorMessage.value = t('subscribe_error');
  }
  finally {
    processing.value = false;
  }
}

onMounted(loadOptions);
</script>

<template>
  <div class="subscribe-form">
    <div v-if="loading" class="loading">{{ t("loading") }}</div>

    <div v-else-if="errorMessage" class="error-message" role="alert">
      {{ errorMessage }}
    </div>

    <template v-else-if="options">
      <!-- Provider selection (skip when only one) -->
      <div v-if="!singleProvider" class="form-group">
        <label class="form-label">{{ t("select_provider") }}</label>
        <div class="provider-options">
          <label
            v-for="provider in options.providers"
            :key="provider.provider_type"
            class="provider-option"
          >
            <input
              type="radio"
              :value="provider.provider_type"
              v-model="selectedProvider"
              :disabled="processing"
            />
            <span>{{ provider.display_name }}</span>
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
      <div v-if="options.pay_what_you_can" class="form-group">
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
  </div>
</template>

<style scoped lang="scss">
.subscribe-form {
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
}
</style>
