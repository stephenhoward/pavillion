<script setup>
import { useTranslation } from 'i18next-vue';
import { ref, computed, onMounted } from 'vue';
import SubscriptionService from '@/client/service/subscription';

const { t } = useTranslation('subscription');

// Service instance
const subscriptionService = new SubscriptionService();

// State management
const loading = ref(true);
const processing = ref(false);
const successMessage = ref('');
const errorMessage = ref('');

// Data state
const options = ref(null);
const status = ref(null);

// Subscribe form state
const showSubscribeForm = ref(false);
const selectedProvider = ref('');
const selectedCycle = ref('monthly');
const customAmount = ref(10.00);

// Computed properties
const hasSubscription = computed(() => status.value !== null);

const isActive = computed(() => status.value?.status === 'active');

const isPastDue = computed(() => status.value?.status === 'past_due');

const isSuspended = computed(() => status.value?.status === 'suspended');

const isCancelled = computed(() => status.value?.status === 'cancelled');

const canSubscribe = computed(() => options.value?.enabled && !hasSubscription.value);

const canCancel = computed(() => hasSubscription.value && (isActive.value || isPastDue.value));

const monthlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return SubscriptionService.formatCurrency(options.value.monthly_price, options.value.currency);
});

const yearlyPriceDisplay = computed(() => {
  if (!options.value) return '';
  return SubscriptionService.formatCurrency(options.value.yearly_price, options.value.currency);
});

const currentAmountDisplay = computed(() => {
  if (!status.value) return '';
  return SubscriptionService.formatCurrency(status.value.amount, status.value.currency);
});

/**
 * Load subscription options and current status
 */
async function loadData() {
  try {
    loading.value = true;
    [options.value, status.value] = await Promise.all([
      subscriptionService.getOptions(),
      subscriptionService.getStatus(),
    ]);
  }
  catch (error) {
    console.error('Failed to load subscription data:', error);
    errorMessage.value = t('load_error');
  }
  finally {
    loading.value = false;
  }
}

/**
 * Start subscription flow
 */
function startSubscribe() {
  showSubscribeForm.value = true;
  if (options.value.providers.length > 0) {
    selectedProvider.value = options.value.providers[0].provider_type;
  }
}

/**
 * Cancel subscription form
 */
function cancelSubscribeForm() {
  showSubscribeForm.value = false;
  selectedProvider.value = '';
  selectedCycle.value = 'monthly';
  customAmount.value = 10.00;
}

/**
 * Submit subscription
 */
async function submitSubscribe() {
  if (!selectedProvider.value) {
    errorMessage.value = t('select_provider_error');
    return;
  }

  processing.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const params = {
      provider_type: selectedProvider.value,
      billing_cycle: selectedCycle.value,
    };

    // Add custom amount if PWYC is enabled
    if (options.value.pay_what_you_can) {
      params.amount = SubscriptionService.displayToMillicents(customAmount.value);
    }

    const result = await subscriptionService.subscribe(params);

    // If provider requires redirect (e.g., Stripe Checkout)
    if (result.redirectUrl) {
      window.location.href = result.redirectUrl;
      return;
    }

    // Subscription created successfully
    successMessage.value = t('subscribe_success');
    showSubscribeForm.value = false;
    await loadData();
  }
  catch (error) {
    console.error('Failed to subscribe:', error);
    errorMessage.value = t('subscribe_error');
  }
  finally {
    processing.value = false;
  }
}

/**
 * Cancel subscription
 */
async function cancelSubscription() {
  if (!confirm(t('cancel_confirm'))) {
    return;
  }

  processing.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const success = await subscriptionService.cancel();

    if (success) {
      successMessage.value = t('cancel_success');
      await loadData();
    }
    else {
      errorMessage.value = t('cancel_error');
    }
  }
  catch (error) {
    console.error('Failed to cancel subscription:', error);
    errorMessage.value = t('cancel_error');
  }
  finally {
    processing.value = false;
  }
}

/**
 * Open billing portal
 */
async function openBillingPortal() {
  try {
    const portalUrl = await subscriptionService.getPortalUrl();
    window.location.href = portalUrl;
  }
  catch (error) {
    console.error('Failed to get portal URL:', error);
    errorMessage.value = t('portal_error');
  }
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString();
}

// Load data on mount
onMounted(async () => {
  await loadData();
});
</script>

<template>
  <section class="settings subscription-management" aria-labelledby="subscription-heading">
    <div class="settings-header">
      <router-link to="/profile" class="back-button">{{ t("back_to_settings") }}</router-link>
      <h1 id="subscription-heading">{{ t("title") }}</h1>
    </div>

    <div role="status" aria-live="polite">
      <div v-if="successMessage" class="success-message">{{ successMessage }}</div>
      <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    </div>

    <div v-if="loading" class="loading">{{ t("loading") }}</div>

    <div v-else class="subscription-content">
      <!-- No subscription - Show subscribe options -->
      <div v-if="canSubscribe && !showSubscribeForm" class="no-subscription">
        <h2>{{ t("no_subscription") }}</h2>
        <p>{{ t("no_subscription_description") }}</p>

        <div class="pricing-info">
          <div class="price-option">
            <strong>{{ t("monthly_option") }}</strong>
            <span class="price">{{ monthlyPriceDisplay }}</span>
          </div>
          <div class="price-option">
            <strong>{{ t("yearly_option") }}</strong>
            <span class="price">{{ yearlyPriceDisplay }}</span>
          </div>
        </div>

        <button type="button" class="primary" @click="startSubscribe">
          {{ t("subscribe_button") }}
        </button>
      </div>

      <!-- Subscribe form -->
      <div v-if="showSubscribeForm" class="subscribe-form">
        <h2>{{ t("subscribe_title") }}</h2>

        <div class="form-group">
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

        <div class="form-actions">
          <button type="button"
                  class="primary"
                  :disabled="processing"
                  @click="submitSubscribe">
            {{ t("confirm_subscribe_button") }}
          </button>
          <button type="button"
                  class="secondary"
                  :disabled="processing"
                  @click="cancelSubscribeForm">
            {{ t("cancel_button") }}
          </button>
        </div>
      </div>

      <!-- Active subscription - Show status and management -->
      <div v-if="hasSubscription" class="subscription-status">
        <h2>{{ t("current_subscription") }}</h2>

        <div class="status-card">
          <div class="status-row">
            <span class="label">{{ t("status_label") }}</span>
            <span :class="`status-badge status-${status.status}`">
              {{ t(`status_${status.status}`) }}
            </span>
          </div>

          <div class="status-row">
            <span class="label">{{ t("billing_cycle_label") }}</span>
            <span>{{ t(`billing_cycle_${status.billing_cycle}`) }}</span>
          </div>

          <div class="status-row">
            <span class="label">{{ t("amount_label") }}</span>
            <span>{{ currentAmountDisplay }}</span>
          </div>

          <div class="status-row">
            <span class="label">{{ t("current_period_label") }}</span>
            <span>{{ formatDate(status.current_period_start) }} - {{ formatDate(status.current_period_end) }}</span>
          </div>

          <div v-if="status.cancelled_at" class="status-row">
            <span class="label">{{ t("cancelled_at_label") }}</span>
            <span>{{ formatDate(status.cancelled_at) }}</span>
          </div>

          <div v-if="isCancelled" class="status-message info">
            {{ t("cancellation_info", { date: formatDate(status.current_period_end) }) }}
          </div>

          <div v-if="isPastDue" class="status-message warning">
            {{ t("past_due_warning") }}
          </div>

          <div v-if="isSuspended" class="status-message error">
            {{ t("suspended_message") }}
          </div>
        </div>

        <div class="subscription-actions">
          <button
            v-if="isActive || isPastDue"
            type="button"
            class="secondary"
            @click="openBillingPortal"
          >
            {{ t("manage_payment_button") }}
          </button>

          <button
            v-if="canCancel"
            type="button"
            class="danger"
            :disabled="processing"
            @click="cancelSubscription"
          >
            {{ t("cancel_subscription_button") }}
          </button>
        </div>
      </div>

      <!-- Subscriptions disabled message -->
      <div v-if="!options?.enabled" class="subscriptions-disabled">
        <p>{{ t("subscriptions_disabled") }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.subscription-management {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.settings-header {
  margin-bottom: 2rem;

  .back-button {
    display: inline-block;
    margin-bottom: 1rem;
    color: $light-mode-button-background;
    text-decoration: none;
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-button-background;
    }

    &:hover {
      text-decoration: underline;
    }
  }

  h1 {
    font-weight: 200;
    font-size: 2rem;
    margin: 0;
  }
}

h2 {
  font-weight: 200;
  font-size: 1.5rem;
  margin-bottom: 1rem;
}

.loading {
  padding: 2rem;
  text-align: center;
  color: $light-mode-secondary-text;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-secondary-text;
  }
}

.success-message {
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  background-color: #f0fff0;
  border: 1px solid #73d873;
  color: #2a7d2a;
  border-radius: 4px;
}

.error-message {
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  background-color: #fff0f0;
  border: 1px solid #d87373;
  color: #7d2a2a;
  border-radius: 4px;
}

.subscription-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.no-subscription {
  text-align: center;
  padding: 2rem;

  .pricing-info {
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin: 2rem 0;

    .price-option {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
      border: 1px solid $light-mode-border;
      border-radius: $component-border-radius;
      min-width: 150px;

      @media (prefers-color-scheme: dark) {
        border-color: $dark-mode-border;
      }

      .price {
        font-size: 1.5rem;
        font-weight: 600;
        color: $light-mode-button-background;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-button-background;
        }
      }
    }
  }
}

.subscribe-form {
  padding: 2rem;
  border: 1px solid $light-mode-border;
  border-radius: $component-border-radius;
  background: $light-mode-panel-background;

  @media (prefers-color-scheme: dark) {
    border-color: $dark-mode-border;
    background: $dark-mode-panel-background;
  }

  .form-group {
    margin-bottom: 1.5rem;

    .form-label {
      display: block;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: $light-mode-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
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
        border: 1px solid $light-mode-border;
        border-radius: $component-border-radius;
        cursor: pointer;

        @media (prefers-color-scheme: dark) {
          border-color: $dark-mode-border;
        }

        &:hover {
          background: $light-mode-selected-background;

          @media (prefers-color-scheme: dark) {
            background: $dark-mode-selected-background;
          }
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
        border: 1px solid $light-mode-border;
        border-radius: $component-border-radius;
        background: $light-mode-panel-background;
        color: $light-mode-text;

        @media (prefers-color-scheme: dark) {
          border-color: $dark-mode-border;
          background: $dark-mode-input-background;
          color: $dark-mode-input-text;
        }
      }

      .description {
        margin-top: 0.5rem;
        font-size: 0.875rem;
        color: $light-mode-secondary-text;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-secondary-text;
        }
      }
    }
  }

  .form-actions {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
  }
}

.subscription-status {
  .status-card {
    padding: 1.5rem;
    border: 1px solid $light-mode-border;
    border-radius: $component-border-radius;
    background: $light-mode-panel-background;

    @media (prefers-color-scheme: dark) {
      border-color: $dark-mode-border;
      background: $dark-mode-panel-background;
    }

    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 0;
      border-bottom: 1px solid $light-mode-border;

      @media (prefers-color-scheme: dark) {
        border-color: $dark-mode-border;
      }

      &:last-child {
        border-bottom: none;
      }

      .label {
        font-weight: 500;
        color: $light-mode-secondary-text;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-secondary-text;
        }
      }

      .status-badge {
        padding: 0.25rem 0.75rem;
        border-radius: 4px;
        font-size: 0.875rem;
        font-weight: 500;

        &.status-active {
          background: #d4edda;
          color: #155724;
        }

        &.status-past_due {
          background: #fff3cd;
          color: #856404;
        }

        &.status-suspended, &.status-cancelled {
          background: #f8d7da;
          color: #721c24;
        }
      }
    }

    .status-message {
      margin-top: 1rem;
      padding: 0.75rem;
      border-radius: 4px;

      &.info {
        background: #d1ecf1;
        color: #0c5460;
      }

      &.warning {
        background: #fff3cd;
        color: #856404;
      }

      &.error {
        background: #f8d7da;
        color: #721c24;
      }
    }
  }

  .subscription-actions {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;

    button.danger {
      background: #dc3545;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background: #c82333;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

.subscriptions-disabled {
  padding: 2rem;
  text-align: center;
  color: $light-mode-secondary-text;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-secondary-text;
  }
}
</style>
