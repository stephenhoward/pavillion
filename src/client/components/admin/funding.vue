<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SubscriptionService from '@/client/service/subscription';
import PayPalConfigModal from './PayPalConfigModal.vue';
import ConfirmDisconnectModal from './ConfirmDisconnectModal.vue';
import AddProviderWizard from './AddProviderWizard.vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'funding',
});

// Service instance
const subscriptionService = new SubscriptionService();

// Router
const route = useRoute();
const router = useRouter();

// State management
const loading = ref(true);
const saving = ref(false);
const successMessage = ref('');
const errorMessage = ref('');

// Settings form state
const enabled = ref(false);
const monthlyPrice = ref(10.00);
const yearlyPrice = ref(100.00);
const currency = ref('USD');
const payWhatYouCan = ref(false);
const gracePeriodDays = ref(7);

// Provider management state
const providers = ref([]);
const providersLoading = ref(false);
const connectingProvider = ref(null); // Track which provider is currently connecting
const showPayPalModal = ref(false); // Control PayPal configuration modal visibility
const showDisconnectModal = ref(false); // Control disconnect confirmation modal visibility
const disconnectModalData = ref({
  providerType: '',
  providerName: '',
  activeSubscriptionCount: 0,
}); // Data for disconnect confirmation modal

// Wizard state
const showWizard = ref(false);

// Subscription list state
const subscriptions = ref([]);
const subscriptionsPage = ref(1);
const subscriptionsLimit = ref(20);
const subscriptionsTotal = ref(0);

// Currency options
const currencyOptions = [
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'CAD', label: 'CAD - Canadian Dollar' },
  { value: 'AUD', label: 'AUD - Australian Dollar' },
];

// Computed property to check if any payment provider is configured
const hasConfiguredProvider = computed(() => {
  return providers.value.some(provider => provider.configured);
});

// Computed property to get list of configured providers only
const configuredProviders = computed(() => {
  return providers.value.filter(provider => provider.configured);
});

// Computed property to get list of unconfigured providers
const unconfiguredProviders = computed(() => {
  return providers.value.filter(provider => !provider.configured);
});

// Computed property to check if all providers are configured
const allProvidersConfigured = computed(() => {
  return unconfiguredProviders.value.length === 0;
});

/**
 * Load subscription settings from API
 */
async function loadSettings() {
  try {
    const settings = await subscriptionService.getSettings();
    enabled.value = settings.enabled;
    monthlyPrice.value = SubscriptionService.millicentsToDisplay(settings.monthlyPrice);
    yearlyPrice.value = SubscriptionService.millicentsToDisplay(settings.yearlyPrice);
    currency.value = settings.currency;
    payWhatYouCan.value = settings.payWhatYouCan;
    gracePeriodDays.value = settings.gracePeriodDays;
  }
  catch (error) {
    console.error('Failed to load settings:', error);
    errorMessage.value = t('load_settings_error');
  }
  finally {
    loading.value = false;
  }
}

/**
 * Load provider configurations from API
 */
async function loadProviders() {
  try {
    providersLoading.value = true;
    providers.value = await subscriptionService.getProviders();
  }
  catch (error) {
    console.error('Failed to load providers:', error);
  }
  finally {
    providersLoading.value = false;
  }
}

/**
 * Load subscriptions list
 */
async function loadSubscriptions() {
  try {
    const result = await subscriptionService.listSubscriptions(subscriptionsPage.value, subscriptionsLimit.value);
    subscriptions.value = result.subscriptions || [];
    subscriptionsTotal.value = result.total || 0;
  }
  catch (error) {
    console.error('Failed to load subscriptions:', error);
  }
}

/**
 * Toggle enabled status and auto-save
 */
async function toggleEnabled() {
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const success = await subscriptionService.updateSettings({
      enabled: enabled.value,
      monthlyPrice: SubscriptionService.displayToMillicents(monthlyPrice.value),
      yearlyPrice: SubscriptionService.displayToMillicents(yearlyPrice.value),
      currency: currency.value,
      payWhatYouCan: payWhatYouCan.value,
      gracePeriodDays: gracePeriodDays.value,
    });

    if (success) {
      successMessage.value = t('settings_update_success');
      // Reload subscriptions if just enabled
      if (enabled.value) {
        await loadSubscriptions();
      }
    }
    else {
      errorMessage.value = t('settings_update_failed');
      // Revert checkbox on failure
      enabled.value = !enabled.value;
    }
  }
  catch (error) {
    console.error('Error updating settings:', error);
    errorMessage.value = t('settings_update_failed');
    // Revert checkbox on error
    enabled.value = !enabled.value;
  }
  finally {
    saving.value = false;
  }
}

/**
 * Update subscription settings
 */
async function updateSettings() {
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const success = await subscriptionService.updateSettings({
      enabled: enabled.value,
      monthlyPrice: SubscriptionService.displayToMillicents(monthlyPrice.value),
      yearlyPrice: SubscriptionService.displayToMillicents(yearlyPrice.value),
      currency: currency.value,
      payWhatYouCan: payWhatYouCan.value,
      gracePeriodDays: gracePeriodDays.value,
    });

    if (success) {
      successMessage.value = t('settings_update_success');
    }
    else {
      errorMessage.value = t('settings_update_failed');
    }
  }
  catch (error) {
    console.error('Error updating settings:', error);
    errorMessage.value = t('settings_update_failed');
  }
  finally {
    saving.value = false;
  }
}

/**
 * Open the Add Provider wizard
 */
function openAddProviderWizard() {
  showWizard.value = true;
}

/**
 * Handle wizard close event
 */
function handleWizardClose() {
  showWizard.value = false;
}

/**
 * Handle provider connected event from wizard
 */
async function handleProviderConnected() {
  showWizard.value = false;
  await loadProviders();
  successMessage.value = t('provider_connect_success', { provider: 'Provider' });
}

/**
 * Toggle provider enabled status
 */
async function toggleProvider(provider) {
  try {
    const success = await subscriptionService.updateProvider(provider.provider_type, {
      enabled: !provider.enabled,
    });

    if (success) {
      provider.enabled = !provider.enabled;
      successMessage.value = t('provider_update_success');
    }
    else {
      errorMessage.value = t('provider_update_failed');
    }
  }
  catch (error) {
    console.error('Failed to toggle provider:', error);
    errorMessage.value = t('provider_update_failed');
  }
}

/**
 * Disconnect a provider (phase 1: check for confirmation requirement)
 */
async function disconnectProvider(providerType) {
  try {
    errorMessage.value = '';

    // First call to check if confirmation is needed
    const result = await subscriptionService.disconnectProvider(providerType, false);

    if (result.requiresConfirmation) {
      // Show confirmation modal with active subscription count
      const provider = providers.value.find(p => p.providerType === providerType);
      disconnectModalData.value = {
        providerType: providerType,
        providerName: provider?.displayName || providerType,
        activeSubscriptionCount: result.activeSubscriptionCount || 0,
      };
      showDisconnectModal.value = true;
    } else if (result.success) {
      // No confirmation needed, disconnect was successful
      successMessage.value = t('provider_disconnect_success');
      await loadProviders();
    } else {
      errorMessage.value = t('provider_disconnect_failed');
    }
  }
  catch (error) {
    console.error('Failed to disconnect provider:', error);
    errorMessage.value = t('provider_disconnect_failed');
  }
}

/**
 * Confirm provider disconnection (phase 2: actual disconnect with confirmation)
 */
async function confirmDisconnect() {
  try {
    errorMessage.value = '';

    // Second call with confirmation=true to actually disconnect
    const result = await subscriptionService.disconnectProvider(
      disconnectModalData.value.providerType,
      true
    );

    if (result.success) {
      showDisconnectModal.value = false;
      successMessage.value = t('provider_disconnect_success');
      await loadProviders();
    } else {
      errorMessage.value = t('provider_disconnect_failed');
    }
  }
  catch (error) {
    console.error('Failed to disconnect provider:', error);
    errorMessage.value = t('provider_disconnect_failed');
  }
}

/**
 * Force cancel a subscription
 */
async function forceCancelSubscription(subscriptionId) {
  if (!confirm(t('force_cancel_confirm'))) {
    return;
  }

  try {
    const success = await subscriptionService.forceCancelSubscription(subscriptionId);

    if (success) {
      successMessage.value = t('force_cancel_success');
      await loadSubscriptions();
    }
    else {
      errorMessage.value = t('force_cancel_failed');
    }
  }
  catch (error) {
    console.error('Failed to force cancel subscription:', error);
    errorMessage.value = t('force_cancel_failed');
  }
}

/**
 * Get provider display name
 */
function getProviderName(providerType) {
  const provider = providers.value.find(p => p.provider_type === providerType);
  return provider?.display_name || providerType;
}

/**
 * Format currency amount
 */
function formatAmount(millicents, curr) {
  return SubscriptionService.formatCurrency(millicents, curr);
}

/**
 * Format date
 */
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString();
}

/**
 * Check URL query parameters for error or success messages
 */
function checkQueryParameters() {
  const error = route.query.error as string;
  const success = route.query.success as string;

  if (error) {
    // Map error codes to error messages
    const errorMessages: Record<string, string> = {
      access_denied: t('query_error.access_denied', { provider: 'provider' }),
      invalid_state: t('query_error.invalid_state'),
      connection_failed: t('query_error.connection_failed', { provider: 'provider' }),
    };

    errorMessage.value = errorMessages[error] || t('query_error.unknown');

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (errorMessage.value === errorMessages[error]) {
        errorMessage.value = '';
      }
    }, 10000);

    // Remove query parameter from URL
    router.replace({ query: {} });
  }

  if (success === 'stripe_connected') {
    successMessage.value = t('query_success.stripe_connected');

    // Close wizard if it's open
    showWizard.value = false;

    // Reload providers list
    loadProviders();

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (successMessage.value === t('query_success.stripe_connected')) {
        successMessage.value = '';
      }
    }, 10000);

    // Remove query parameter from URL
    router.replace({ query: {} });
  }
}

// Load data on mount
onMounted(async () => {
  checkQueryParameters();
  await loadSettings();
  await loadProviders();
  if (enabled.value) {
    await loadSubscriptions();
  }
});
</script>

<template>
  <section class="funding-settings" aria-labelledby="funding-heading">
    <h1 id="funding-heading">{{ t("title") }}</h1>

    <div role="status" aria-live="polite">
      <div v-if="successMessage" class="success-message">{{ successMessage }}</div>
      <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    </div>

    <div v-if="loading" class="loading">{{ t("loading") }}</div>

    <div v-else class="settings-content">
      <!-- Subscription Settings Form -->
      <form class="settings-form" @submit.prevent="updateSettings">
        <h2>{{ t("settings_section_title") }}</h2>

        <div class="form-group">
          <label class="form-label">
            <input type="checkbox" v-model="enabled" :disabled="saving" @change="toggleEnabled" />
            {{ t("enabled_label") }}
          </label>
          <div class="description">{{ t("enabled_description") }}</div>
        </div>

        <!-- Show provider setup message when enabled but no providers configured -->
        <div v-if="enabled && !hasConfiguredProvider" class="info-message">
          {{ t("setup_provider_message") }}
        </div>

        <!-- Only show pricing configuration when enabled AND at least one provider is configured -->
        <template v-if="enabled && hasConfiguredProvider">
          <div class="form-group">
            <label class="form-label">{{ t("currency_label") }}</label>
            <div class="form-field">
              <select v-model="currency" :disabled="saving">
                <option v-for="curr in currencyOptions" :key="curr.value" :value="curr.value">
                  {{ curr.label }}
                </option>
              </select>
              <div class="description">{{ t("currency_description") }}</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">{{ t("monthly_price_label") }}</label>
            <div class="form-field">
              <input
                type="number"
                v-model.number="monthlyPrice"
                step="0.01"
                min="0"
                :disabled="saving"
              />
              <div class="description">{{ t("monthly_price_description") }}</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">{{ t("yearly_price_label") }}</label>
            <div class="form-field">
              <input
                type="number"
                v-model.number="yearlyPrice"
                step="0.01"
                min="0"
                :disabled="saving"
              />
              <div class="description">{{ t("yearly_price_description") }}</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">
              <input type="checkbox" v-model="payWhatYouCan" :disabled="saving" />
              {{ t("pwyc_label") }}
            </label>
            <div class="description">{{ t("pwyc_description") }}</div>
          </div>

          <div class="form-group">
            <label class="form-label">{{ t("grace_period_label") }}</label>
            <div class="form-field">
              <input
                type="number"
                v-model.number="gracePeriodDays"
                min="0"
                :disabled="saving"
              />
              <div class="description">{{ t("grace_period_description") }}</div>
            </div>
          </div>

          <button type="submit" class="primary" :disabled="saving">
            {{ t("save_settings_button") }}
          </button>
        </template>
      </form>

      <!-- Payment Providers Section - only show when enabled -->
      <section v-if="enabled" class="providers-section">
        <div class="section-header-with-action">
          <h2>{{ t("providers_section_title") }}</h2>
          <button
            type="button"
            class="primary add-provider-button"
            @click="openAddProviderWizard"
            :disabled="allProvidersConfigured"
            :title="allProvidersConfigured ? t('add_provider_tooltip_disabled') : ''"
          >
            {{ t("add_provider_button") }}
          </button>
        </div>

        <div v-if="providersLoading" class="loading">{{ t("loading_providers") }}</div>

        <div v-else class="providers-list">
          <div v-for="provider in configuredProviders" :key="provider.provider_type" class="provider-item">
            <div class="provider-info">
              <h3>
                {{ provider.display_name }}
                <span class="connected-badge">
                  {{ t("connected_badge") }}
                </span>
              </h3>
              <span class="provider-type">{{ provider.provider_type }}</span>
            </div>

            <div class="provider-actions">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  :checked="provider.enabled"
                  @change="toggleProvider(provider)"
                />
                {{ t("provider_enabled_label") }}
              </label>
              <button
                type="button"
                class="secondary"
                @click="disconnectProvider(provider.provider_type)"
              >
                {{ t("disconnect_button") }}
              </button>
            </div>
          </div>

          <div v-if="configuredProviders.length === 0" class="no-providers">
            {{ t("no_providers") }}
          </div>
        </div>
      </section>

      <!-- Subscriptions List Section -->
      <section v-if="enabled" class="subscriptions-section">
        <h2>{{ t("subscriptions_section_title") }}</h2>

        <div v-if="subscriptions.length === 0" class="no-subscriptions">
          {{ t("no_subscriptions") }}
        </div>

        <table v-else class="subscriptions-table">
          <thead>
            <tr>
              <th>{{ t("subscription_user_column") }}</th>
              <th>{{ t("subscription_provider_column") }}</th>
              <th>{{ t("subscription_amount_column") }}</th>
              <th>{{ t("subscription_cycle_column") }}</th>
              <th>{{ t("subscription_status_column") }}</th>
              <th>{{ t("subscription_period_column") }}</th>
              <th>{{ t("subscription_actions_column") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sub in subscriptions" :key="sub.id">
              <td>{{ sub.account_email }}</td>
              <td>{{ getProviderName(sub.provider_type) }}</td>
              <td>{{ formatAmount(sub.amount, sub.currency) }}</td>
              <td>{{ t(`billing_cycle_${sub.billing_cycle}`) }}</td>
              <td>
                <span :class="`status-badge status-${sub.status}`">
                  {{ t(`status_${sub.status}`) }}
                </span>
              </td>
              <td>{{ formatDate(sub.current_period_end) }}</td>
              <td>
                <button
                  v-if="sub.status === 'active'"
                  type="button"
                  class="danger-small"
                  @click="forceCancelSubscription(sub.id)"
                >
                  {{ t("force_cancel_button") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="subscriptionsTotal > subscriptionsLimit" class="pagination">
          <button
            :disabled="subscriptionsPage === 1"
            @click="subscriptionsPage--; loadSubscriptions()"
          >
            {{ t("previous_page") }}
          </button>
          <span>{{ t("page_indicator", { page: subscriptionsPage, total: Math.ceil(subscriptionsTotal / subscriptionsLimit) }) }}</span>
          <button
            :disabled="subscriptionsPage * subscriptionsLimit >= subscriptionsTotal"
            @click="subscriptionsPage++; loadSubscriptions()"
          >
            {{ t("next_page") }}
          </button>
        </div>
      </section>
    </div>

    <!-- PayPal Configuration Modal -->
    <PayPalConfigModal
      :show="showPayPalModal"
      @close="showPayPalModal = false"
    />

    <!-- Disconnect Confirmation Modal -->
    <ConfirmDisconnectModal
      :show="showDisconnectModal"
      :provider-name="disconnectModalData.providerName"
      :active-subscription-count="disconnectModalData.activeSubscriptionCount"
      @close="showDisconnectModal = false"
      @confirm="confirmDisconnect"
    />

    <!-- Add Provider Wizard -->
    <AddProviderWizard
      :show="showWizard"
      :unconfigured-providers="unconfiguredProviders"
      @close="handleWizardClose"
      @provider-connected="handleProviderConnected"
    />
  </section>
</template>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.funding-settings {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  font-weight: 200;
  font-size: 2rem;
  margin-bottom: 1.5rem;
}

h2 {
  font-weight: 200;
  font-size: 1.5rem;
  margin-bottom: 1rem;
  margin-top: 2rem;
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

.info-message {
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  background-color: #f0f8ff;
  border: 1px solid #73a9d8;
  color: #2a5a7d;
  border-radius: 4px;

  @media (prefers-color-scheme: dark) {
    background-color: #1a3a4a;
    border-color: #4a7a9a;
    color: #a0c8e8;
  }
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.settings-form {
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

      input[type="checkbox"] {
        margin-right: 0.5rem;
      }
    }

    .form-field {
      input, select {
        width: 100%;
        max-width: 400px;
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

  button.primary {
    margin-top: 1rem;
  }
}

.providers-section {
  .section-header-with-action {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;

    h2 {
      margin: 0;
    }

    .add-provider-button {
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }

  .providers-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .provider-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border: 1px solid $light-mode-border;
    border-radius: $component-border-radius;
    background: $light-mode-panel-background;

    @media (prefers-color-scheme: dark) {
      border-color: $dark-mode-border;
      background: $dark-mode-panel-background;
    }

    .provider-info {
      h3 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .connected-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        background: #d4edda;
        color: #155724;
        border-radius: 12px;

        @media (prefers-color-scheme: dark) {
          background: #1e4620;
          color: #7fd68a;
        }
      }

      .provider-type {
        font-size: 0.875rem;
        color: $light-mode-secondary-text;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-secondary-text;
        }
      }
    }

    .provider-actions {
      display: flex;
      gap: 1rem;
      align-items: center;

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      button {
        position: relative;

        .connecting-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          margin-right: 0.5rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spinner-rotate 0.6s linear infinite;
        }
      }
    }
  }

  .no-providers {
    padding: 2rem;
    text-align: center;
    color: $light-mode-secondary-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }
}

.subscriptions-section {
  .subscriptions-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;

    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid $light-mode-border;

      @media (prefers-color-scheme: dark) {
        border-color: $dark-mode-border;
      }
    }

    th {
      font-weight: 600;
      background: $light-mode-selected-background;

      @media (prefers-color-scheme: dark) {
        background: $dark-mode-selected-background;
      }
    }

    .status-badge {
      padding: 0.25rem 0.5rem;
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

    button.danger-small {
      padding: 0.25rem 0.5rem;
      font-size: 0.875rem;
      background: #dc3545;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background: #c82333;
      }
    }
  }

  .no-subscriptions {
    padding: 2rem;
    text-align: center;
    color: $light-mode-secondary-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }

  .pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    margin-top: 1rem;

    button {
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

@keyframes spinner-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
