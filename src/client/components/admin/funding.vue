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

// Sub-tab state
const activeSubTab = ref<'subscriptions' | 'settings'>('subscriptions');

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
  return providers.value?.some(provider => provider.configured) ?? false;
});

// Computed property to get list of configured providers only
const configuredProviders = computed(() => {
  return providers.value?.filter(provider => provider.configured) ?? [];
});

// Computed property to get list of unconfigured providers
const unconfiguredProviders = computed(() => {
  return providers.value?.filter(provider => !provider.configured) ?? [];
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
    }
    else if (result.success) {
      // No confirmation needed, disconnect was successful
      successMessage.value = t('provider_disconnect_success');
      await loadProviders();
    }
    else {
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
      true,
    );

    if (result.success) {
      showDisconnectModal.value = false;
      successMessage.value = t('provider_disconnect_success');
      await loadProviders();
    }
    else {
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
  <section class="funding-page" aria-labelledby="funding-heading">
    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header-text">
        <h1 id="funding-heading">{{ t("title") }}</h1>
        <p class="page-subtitle">{{ t("settings_section_title") }}</p>
      </div>
    </div>

    <!-- Status Messages -->
    <div role="status" aria-live="polite">
      <div v-if="successMessage" class="alert alert--success">
        <svg class="alert-icon"
             width="20"
             height="20"
             viewBox="0 0 20 20"
             fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        {{ successMessage }}
      </div>
      <div v-if="errorMessage" class="alert alert--error">
        <svg class="alert-icon"
             width="20"
             height="20"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12"
                y1="8"
                x2="12"
                y2="12" />
          <line x1="12"
                y1="16"
                x2="12.01"
                y2="16" />
        </svg>
        {{ errorMessage }}
      </div>
    </div>

    <div v-if="loading" class="loading-state">{{ t("loading") }}</div>

    <template v-else>
      <!-- Sub-Tab Navigation -->
      <div class="subtab-border">
        <nav role="tablist" aria-label="Funding sections" class="subtab-nav">
          <button
            type="button"
            role="tab"
            :aria-selected="activeSubTab === 'subscriptions' ? 'true' : 'false'"
            aria-controls="subscriptions-panel"
            class="subtab"
            :class="{ 'subtab--active': activeSubTab === 'subscriptions' }"
            @click="activeSubTab = 'subscriptions'"
          >
            {{ t("subscriptions_section_title") }}
            <span
              v-if="subscriptions.length > 0"
              class="subtab-badge"
              :class="{ 'subtab-badge--active': activeSubTab === 'subscriptions' }"
            >
              {{ subscriptions.length }}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeSubTab === 'settings' ? 'true' : 'false'"
            aria-controls="settings-panel"
            class="subtab"
            :class="{ 'subtab--active': activeSubTab === 'settings' }"
            @click="activeSubTab = 'settings'"
          >
            {{ t("settings_section_title") }}
          </button>
        </nav>
      </div>

      <!-- Subscriptions Tab Panel -->
      <section
        id="subscriptions-panel"
        role="tabpanel"
        :aria-hidden="activeSubTab !== 'subscriptions' ? 'true' : 'false'"
        :hidden="activeSubTab !== 'subscriptions'"
        class="tab-panel"
      >
        <!-- Empty state -->
        <div v-if="subscriptions.length === 0" class="empty-card">
          <svg class="empty-icon"
               width="48"
               height="48"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p class="empty-title">{{ t("no_subscriptions") }}</p>
          <p class="empty-description">Subscriptions will appear here when users subscribe to your instance</p>
        </div>

        <!-- Subscriptions list -->
        <div v-else class="subscriptions-card">
          <!-- Desktop Table -->
          <div class="subscriptions-table-desktop">
            <table class="subscriptions-table" role="table" aria-label="Subscriptions">
              <thead>
                <tr>
                  <th scope="col">{{ t("subscription_user_column") }}</th>
                  <th scope="col">{{ t("subscription_amount_column") }}</th>
                  <th scope="col">{{ t("subscription_cycle_column") }}</th>
                  <th scope="col">{{ t("subscription_status_column") }}</th>
                  <th scope="col">{{ t("subscription_period_column") }}</th>
                  <th scope="col" class="col-actions">{{ t("subscription_actions_column") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sub in subscriptions" :key="sub.id">
                  <td class="cell-user">{{ sub.account_email }}</td>
                  <td class="cell-amount">{{ formatAmount(sub.amount, sub.currency) }}</td>
                  <td class="cell-cycle">{{ t(`billing_cycle_${sub.billing_cycle}`) }}</td>
                  <td class="cell-status">
                    <span
                      class="status-badge"
                      :class="`status-badge--${sub.status}`"
                    >
                      {{ t(`status_${sub.status}`) }}
                    </span>
                  </td>
                  <td class="cell-date">{{ formatDate(sub.current_period_end) }}</td>
                  <td class="cell-actions">
                    <button
                      v-if="sub.status === 'active'"
                      type="button"
                      class="action-link action-link--danger"
                      @click="forceCancelSubscription(sub.id)"
                    >
                      {{ t("force_cancel_button") }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Mobile Cards -->
          <div class="subscriptions-mobile">
            <div v-for="sub in subscriptions" :key="sub.id" class="subscription-card">
              <div class="subscription-card-header">
                <div class="subscription-card-info">
                  <p class="subscription-card-email">{{ sub.account_email }}</p>
                  <p class="subscription-card-amount">
                    <span class="amount-value">{{ formatAmount(sub.amount, sub.currency) }}</span>
                    / {{ t(`billing_cycle_${sub.billing_cycle}`) }}
                  </p>
                </div>
                <span
                  class="status-badge"
                  :class="`status-badge--${sub.status}`"
                >
                  {{ t(`status_${sub.status}`) }}
                </span>
              </div>
              <div class="subscription-card-footer">
                <p class="subscription-card-period">
                  Period ends {{ formatDate(sub.current_period_end) }}
                </p>
                <button
                  v-if="sub.status === 'active'"
                  type="button"
                  class="action-link-mobile action-link--danger"
                  @click="forceCancelSubscription(sub.id)"
                >
                  {{ t("force_cancel_button") }}
                </button>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div v-if="subscriptionsTotal > subscriptionsLimit" class="pagination">
            <p class="pagination-info">
              {{ t("page_indicator", { page: subscriptionsPage, total: Math.ceil(subscriptionsTotal / subscriptionsLimit) }) }}
            </p>
            <div class="pagination-buttons">
              <button
                class="pagination-btn"
                :disabled="subscriptionsPage === 1"
                @click="subscriptionsPage--; loadSubscriptions()"
              >
                {{ t("previous_page") }}
              </button>
              <button
                class="pagination-btn"
                :disabled="subscriptionsPage * subscriptionsLimit >= subscriptionsTotal"
                @click="subscriptionsPage++; loadSubscriptions()"
              >
                {{ t("next_page") }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Settings Tab Panel -->
      <section
        id="settings-panel"
        role="tabpanel"
        :aria-hidden="activeSubTab !== 'settings' ? 'true' : 'false'"
        :hidden="activeSubTab !== 'settings'"
        class="tab-panel"
      >
        <div class="settings-content">
          <!-- Enable Subscriptions Toggle Card -->
          <div class="settings-card">
            <label class="toggle-row">
              <input
                type="checkbox"
                v-model="enabled"
                :disabled="saving"
                class="toggle-checkbox"
                @change="toggleEnabled"
              />
              <div class="toggle-text">
                <span class="toggle-label">{{ t("enabled_label") }}</span>
                <p class="toggle-description">{{ t("enabled_description") }}</p>
              </div>
            </label>
          </div>

          <!-- Show provider setup message when enabled but no providers configured -->
          <div v-if="enabled && !hasConfiguredProvider" class="alert alert--warning">
            <svg class="alert-icon"
                 width="20"
                 height="20"
                 viewBox="0 0 24 24"
                 fill="none"
                 stroke="currentColor"
                 stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p class="alert-title">{{ t("setup_provider_message") }}</p>
              <p class="alert-description">Add a payment provider below to start accepting subscriptions.</p>
            </div>
          </div>

          <!-- Payment Providers Section - only show when enabled -->
          <section v-if="enabled" class="providers-card">
            <div class="card-header">
              <h2 class="card-title">{{ t("providers_section_title") }}</h2>
              <button
                type="button"
                class="btn-text-orange"
                @click="openAddProviderWizard"
                :disabled="allProvidersConfigured"
                :title="allProvidersConfigured ? t('add_provider_tooltip_disabled') : ''"
              >
                <svg width="20"
                     height="20"
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     stroke-width="2"
                     stroke-linecap="round"
                     stroke-linejoin="round">
                  <path d="M12 4v16m8-8H4" />
                </svg>
                {{ t("add_provider_button") }}
              </button>
            </div>

            <div v-if="providersLoading" class="loading-state loading-state--card">{{ t("loading_providers") }}</div>

            <template v-else>
              <!-- Empty providers -->
              <div v-if="configuredProviders.length === 0" class="empty-card-inline">
                <svg class="empty-icon-small"
                     width="48"
                     height="48"
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <p class="empty-title">{{ t("no_providers") }}</p>
                <button type="button" class="btn-text-orange" @click="openAddProviderWizard">
                  <svg width="20"
                       height="20"
                       viewBox="0 0 24 24"
                       fill="none"
                       stroke="currentColor"
                       stroke-width="2"
                       stroke-linecap="round"
                       stroke-linejoin="round">
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                  Add your first provider
                </button>
              </div>

              <!-- Provider items -->
              <div v-else class="providers-list">
                <div v-for="provider in configuredProviders" :key="provider.provider_type" class="provider-item">
                  <div class="provider-info">
                    <div class="provider-name-row">
                      <h3 class="provider-name">{{ provider.display_name }}</h3>
                      <span class="connected-badge">{{ t("connected_badge") }}</span>
                    </div>
                    <span class="provider-type">{{ provider.provider_type }}</span>
                  </div>
                  <div class="provider-actions">
                    <label class="toggle-inline">
                      <input
                        type="checkbox"
                        :checked="provider.enabled"
                        @change="toggleProvider(provider)"
                      />
                      <span class="toggle-inline-label">{{ t("provider_enabled_label") }}</span>
                    </label>
                    <button
                      type="button"
                      class="action-link action-link--danger"
                      @click="disconnectProvider(provider.provider_type)"
                    >
                      {{ t("disconnect_button") }}
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </section>

          <!-- Subscription Pricing Section - only show when enabled AND provider configured -->
          <template v-if="enabled && hasConfiguredProvider">
            <section class="pricing-card">
              <div class="card-header card-header--border-only">
                <h2 class="card-title">Subscription Pricing</h2>
              </div>

              <form class="pricing-form" @submit.prevent="updateSettings">
                <div class="pricing-grid">
                  <!-- Currency -->
                  <div class="form-group">
                    <label class="form-label" for="funding-currency">{{ t("currency_label") }}</label>
                    <select
                      id="funding-currency"
                      v-model="currency"
                      :disabled="saving"
                      class="form-select"
                    >
                      <option v-for="curr in currencyOptions" :key="curr.value" :value="curr.value">
                        {{ curr.label }}
                      </option>
                    </select>
                  </div>

                  <!-- Monthly Price -->
                  <div class="form-group">
                    <label class="form-label" for="funding-monthly">{{ t("monthly_price_label") }}</label>
                    <input
                      id="funding-monthly"
                      type="number"
                      v-model.number="monthlyPrice"
                      step="0.01"
                      min="0"
                      :disabled="saving"
                      class="form-input"
                    />
                    <p class="form-hint">{{ t("monthly_price_description") }}</p>
                  </div>

                  <!-- Yearly Price -->
                  <div class="form-group">
                    <label class="form-label" for="funding-yearly">{{ t("yearly_price_label") }}</label>
                    <input
                      id="funding-yearly"
                      type="number"
                      v-model.number="yearlyPrice"
                      step="0.01"
                      min="0"
                      :disabled="saving"
                      class="form-input"
                    />
                    <p class="form-hint">{{ t("yearly_price_description") }}</p>
                  </div>
                </div>

                <div class="pricing-options">
                  <!-- Pay What You Can -->
                  <label class="toggle-row toggle-row--compact">
                    <input type="checkbox"
                           v-model="payWhatYouCan"
                           :disabled="saving"
                           class="toggle-checkbox" />
                    <div class="toggle-text">
                      <span class="toggle-label">{{ t("pwyc_label") }}</span>
                      <p class="toggle-description">{{ t("pwyc_description") }}</p>
                    </div>
                  </label>

                  <!-- Grace Period -->
                  <div class="form-group form-group--inline">
                    <label class="form-label" for="funding-grace">{{ t("grace_period_label") }}</label>
                    <input
                      id="funding-grace"
                      type="number"
                      v-model.number="gracePeriodDays"
                      min="0"
                      :disabled="saving"
                      class="form-input form-input--narrow"
                    />
                    <p class="form-hint">{{ t("grace_period_description") }}</p>
                  </div>
                </div>

                <div class="pricing-actions">
                  <button type="submit" class="btn-primary" :disabled="saving">
                    {{ t("save_settings_button") }}
                  </button>
                </div>
              </form>
            </section>
          </template>
        </div>
      </section>
    </template>

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
@use '../../assets/style/tokens/breakpoints' as *;

.funding-page {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  /* Page Header */
  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);

    @include pav-media(sm) {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .page-header-text {
      h1 {
        margin: 0 0 var(--pav-space-1) 0;
        font-size: var(--pav-font-size-2xl);
        font-weight: var(--pav-font-weight-light);
        color: var(--pav-color-text-primary);
      }

      .page-subtitle {
        margin: 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }
  }

  /* Alerts */
  .alert {
    display: flex;
    align-items: flex-start;
    gap: var(--pav-space-3);
    padding: var(--pav-space-3) var(--pav-space-4);
    border-radius: var(--pav-border-radius-lg);
    font-size: var(--pav-font-size-xs);

    .alert-icon {
      flex-shrink: 0;
      margin-top: var(--pav-space-0_5);
    }

    .alert-title {
      margin: 0;
      font-weight: var(--pav-font-weight-medium);
    }

    .alert-description {
      margin: var(--pav-space-1) 0 0;
      font-size: var(--pav-font-size-xs);
    }

    &--success {
      background: var(--pav-color-emerald-50);
      border: 1px solid var(--pav-color-emerald-200);
      color: var(--pav-color-emerald-700);
    }

    &--error {
      background: var(--pav-color-red-50);
      border: 1px solid var(--pav-color-red-200);
      color: var(--pav-color-red-700);
    }

    &--warning {
      background: var(--pav-color-amber-50);
      border: 1px solid var(--pav-color-amber-200);
      color: var(--pav-color-amber-800);
    }
  }

  /* Loading */
  .loading-state {
    padding: var(--pav-space-12);
    text-align: center;
    color: var(--pav-color-text-muted);

    &--card {
      padding: var(--pav-space-8);
    }
  }

  /* Sub-Tab Navigation */
  .subtab-border {
    border-bottom: 1px solid var(--pav-border-color-light);
    margin: 0 calc(-1 * var(--pav-space-4));
    padding: 0 var(--pav-space-4);

    @include pav-media(md) {
      margin: 0;
      padding: 0;
    }

    .subtab-nav {
      display: flex;
      gap: var(--pav-space-4);
      overflow-x: auto;

      @include pav-media(sm) {
        gap: var(--pav-space-6);
      }

      .subtab {
        padding-bottom: var(--pav-space-3);
        font-size: var(--pav-font-size-xs);
        font-weight: var(--pav-font-weight-medium);
        font-family: inherit;
        border: none;
        border-bottom: 2px solid transparent;
        background: none;
        color: var(--pav-color-text-muted);
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: color 0.2s ease, border-color 0.2s ease;

        &:hover {
          color: var(--pav-color-text-secondary);
        }

        &--active {
          border-bottom-color: var(--pav-color-orange-500);
          color: var(--pav-color-orange-600);
        }

        .subtab-badge {
          margin-left: var(--pav-space-2);
          padding: var(--pav-space-0_5) var(--pav-space-2);
          border-radius: var(--pav-border-radius-full);
          font-size: var(--pav-font-size-2xs);
          background: var(--pav-color-stone-100);
          color: var(--pav-color-text-muted);

          &--active {
            background: var(--pav-color-orange-100);
            color: var(--pav-color-orange-600);
          }
        }
      }
    }
  }

  .tab-panel {
    outline: none;
  }

  /* Empty States */
  .empty-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    padding: var(--pav-space-12);
    text-align: center;

    .empty-icon {
      color: var(--pav-color-stone-300);
      margin: 0 auto var(--pav-space-4);
      display: block;
    }

    .empty-title {
      margin: 0;
      color: var(--pav-color-text-muted);
    }

    .empty-description {
      margin: var(--pav-space-1) 0 0;
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-stone-400);
    }
  }

  .empty-card-inline {
    padding: var(--pav-space-12);
    text-align: center;

    .empty-icon-small {
      color: var(--pav-color-stone-300);
      margin: 0 auto var(--pav-space-4);
      display: block;
    }

    .empty-title {
      margin: 0 0 var(--pav-space-4);
      color: var(--pav-color-text-muted);
    }
  }

  /* Status Badges */
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--pav-space-1) var(--pav-space-2_5);
    border-radius: var(--pav-border-radius-full);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-medium);
    text-transform: capitalize;

    &--active {
      background: var(--pav-color-emerald-100);
      color: var(--pav-color-emerald-700);
    }

    &--past_due {
      background: var(--pav-color-amber-100);
      color: var(--pav-color-amber-700);
    }

    &--suspended {
      background: var(--pav-color-red-100);
      color: var(--pav-color-red-700);
    }

    &--cancelled {
      background: var(--pav-color-stone-100);
      color: var(--pav-color-stone-500);
    }
  }

  /* Subscriptions Card (table + mobile) */
  .subscriptions-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;

    .subscriptions-table-desktop {
      display: none;

      @include pav-media(md) {
        display: block;
      }

      .subscriptions-table {
        width: 100%;
        border-collapse: collapse;

        thead {
          tr {
            border-bottom: 1px solid var(--pav-border-color-light);
            background: var(--pav-color-stone-50);
          }

          th {
            padding: var(--pav-space-3) var(--pav-space-6);
            text-align: left;
            font-size: var(--pav-font-size-2xs);
            font-weight: var(--pav-font-weight-semibold);
            color: var(--pav-color-text-muted);
            text-transform: uppercase;
            letter-spacing: var(--pav-letter-spacing-wider);

            &.col-actions {
              text-align: right;
            }
          }
        }

        tbody {
          tr {
            border-bottom: 1px solid var(--pav-border-color-light);
            transition: background-color 0.15s ease;

            &:last-child {
              border-bottom: none;
            }

            &:hover {
              background: var(--pav-color-stone-50);
            }
          }

          td {
            padding: var(--pav-space-4) var(--pav-space-6);
          }

          .cell-user {
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .cell-amount {
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .cell-cycle {
            color: var(--pav-color-text-secondary);
            text-transform: capitalize;
          }

          .cell-date {
            color: var(--pav-color-text-secondary);
            font-size: var(--pav-font-size-xs);
          }

          .cell-actions {
            text-align: right;
          }
        }
      }
    }

    .subscriptions-mobile {
      display: block;

      @include pav-media(md) {
        display: none;
      }

      .subscription-card {
        padding: var(--pav-space-4);
        border-bottom: 1px solid var(--pav-border-color-light);

        &:last-child {
          border-bottom: none;
        }

        .subscription-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--pav-space-3);

          .subscription-card-info {
            min-width: 0;
            flex: 1;

            .subscription-card-email {
              margin: 0;
              font-weight: var(--pav-font-weight-medium);
              color: var(--pav-color-text-primary);
              word-break: break-all;
            }

            .subscription-card-amount {
              margin: var(--pav-space-1) 0 0;
              font-size: var(--pav-font-size-xs);
              color: var(--pav-color-text-muted);

              .amount-value {
                font-weight: var(--pav-font-weight-medium);
                color: var(--pav-color-text-primary);
              }
            }
          }
        }

        .subscription-card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--pav-space-3);
          margin-top: var(--pav-space-3);

          .subscription-card-period {
            margin: 0;
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-muted);
          }
        }
      }
    }
  }

  /* Pagination */
  .pagination {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4) var(--pav-space-6);
    border-top: 1px solid var(--pav-border-color-light);

    @include pav-media(sm) {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .pagination-info {
      margin: 0;
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-text-muted);
      text-align: center;

      @include pav-media(sm) {
        text-align: left;
      }
    }

    .pagination-buttons {
      display: flex;
      gap: var(--pav-space-2);
      justify-content: center;

      @include pav-media(sm) {
        justify-content: flex-end;
      }
    }

    .pagination-btn {
      padding: var(--pav-space-1_5) var(--pav-space-4);
      border: 1px solid var(--pav-border-color-medium);
      border-radius: var(--pav-border-radius-full);
      background: none;
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      font-family: inherit;
      color: var(--pav-color-text-secondary);
      cursor: pointer;
      transition: background-color 0.2s ease, color 0.2s ease;

      &:hover:not(:disabled) {
        background: var(--pav-color-stone-50);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }

  /* Action Links */
  .action-link {
    background: none;
    border: none;
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s ease;

    &--danger {
      color: var(--pav-color-red-600);

      &:hover {
        color: var(--pav-color-red-700);
      }
    }
  }

  .action-link-mobile {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: var(--pav-space-1_5) var(--pav-space-3);
    border-radius: var(--pav-border-radius-full);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    transition: color 0.2s ease, background-color 0.2s ease;

    &.action-link--danger {
      color: var(--pav-color-red-600);

      &:hover {
        background: var(--pav-color-red-50);
      }
    }
  }

  /* Settings Content */
  .settings-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-6);
  }

  .settings-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    padding: var(--pav-space-6);
  }

  /* Toggle Rows */
  .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: var(--pav-space-3);
    cursor: pointer;

    &--compact {
      padding: 0;
    }

    .toggle-checkbox {
      width: 1.25rem;
      height: 1.25rem;
      margin-top: var(--pav-space-0_5);
      border-radius: var(--pav-border-radius-xs);
      border: 1px solid var(--pav-border-color-medium);
      accent-color: var(--pav-color-orange-500);
      cursor: pointer;
    }

    .toggle-text {
      .toggle-label {
        display: block;
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }

      .toggle-description {
        margin: var(--pav-space-0_5) 0 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-muted);
      }
    }
  }

  .toggle-inline {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
    cursor: pointer;

    input[type="checkbox"] {
      width: 1rem;
      height: 1rem;
      border-radius: var(--pav-border-radius-xs);
      accent-color: var(--pav-color-orange-500);
      cursor: pointer;
    }

    .toggle-inline-label {
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-text-secondary);
    }
  }

  /* Provider Card */
  .providers-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;
  }

  .card-header {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4) var(--pav-space-6);
    border-bottom: 1px solid var(--pav-border-color-light);

    @include pav-media(sm) {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    &--border-only {
      border-bottom: 1px solid var(--pav-border-color-light);
    }

    .card-title {
      margin: 0;
      font-size: var(--pav-font-size-base);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }

  .btn-text-orange {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--pav-space-2);
    padding: var(--pav-space-2) var(--pav-space-6);
    background: none;
    border: none;
    border-radius: var(--pav-border-radius-full);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: var(--pav-color-orange-600);
    cursor: pointer;
    transition: background-color 0.2s ease;
    width: 100%;

    @include pav-media(sm) {
      width: auto;
    }

    &:hover {
      background: var(--pav-color-orange-50);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .providers-list {
    .provider-item {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-4);
      padding: var(--pav-space-4) var(--pav-space-6);
      border-bottom: 1px solid var(--pav-border-color-light);

      @include pav-media(sm) {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }

      &:last-child {
        border-bottom: none;
      }

      .provider-info {
        .provider-name-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--pav-space-2);

          .provider-name {
            margin: 0;
            font-size: var(--pav-font-size-sm);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .connected-badge {
            display: inline-block;
            padding: var(--pav-space-0_5) var(--pav-space-2);
            font-size: var(--pav-font-size-2xs);
            font-weight: var(--pav-font-weight-medium);
            background: var(--pav-color-emerald-100);
            color: var(--pav-color-emerald-700);
            border-radius: var(--pav-border-radius-xs);
          }
        }

        .provider-type {
          display: block;
          margin-top: var(--pav-space-0_5);
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-muted);
        }
      }

      .provider-actions {
        display: flex;
        gap: var(--pav-space-4);
        align-items: center;
      }
    }
  }

  /* Pricing Card */
  .pricing-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;
  }

  .pricing-form {
    padding: var(--pav-space-6);
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-6);
  }

  .pricing-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--pav-space-6);

    @include pav-media(md) {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .pricing-options {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--pav-space-6);

    @include pav-media(md) {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .pricing-actions {
    padding-top: var(--pav-space-2);
  }

  /* Form Elements */
  .form-group {
    display: flex;
    flex-direction: column;

    &--inline {
      gap: var(--pav-space-2);
    }

    .form-label {
      display: block;
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-secondary);
      margin-bottom: var(--pav-space-2);
    }

    .form-hint {
      margin: var(--pav-space-1) 0 0;
      font-size: var(--pav-font-size-2xs);
      color: var(--pav-color-text-muted);
    }
  }

  .form-input,
  .form-select {
    width: 100%;
    padding: var(--pav-space-2_5) var(--pav-space-5);
    background: var(--pav-color-surface-primary);
    border: 1px solid var(--pav-border-color-medium);
    border-radius: var(--pav-border-radius-full);
    font-size: var(--pav-font-size-xs);
    font-family: inherit;
    color: var(--pav-color-text-primary);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-500);
      box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }

  .form-select {
    appearance: none;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
    background-position: right 0.75rem center;
    background-repeat: no-repeat;
    background-size: 1.25rem;
    padding-right: var(--pav-space-10);
  }

  .form-input--narrow {
    max-width: 120px;
  }

  /* Primary Button */
  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--pav-space-2_5) var(--pav-space-6);
    background: var(--pav-color-orange-500);
    color: var(--pav-color-text-inverse);
    font-weight: var(--pav-font-weight-medium);
    font-size: var(--pav-font-size-xs);
    font-family: inherit;
    border: none;
    border-radius: var(--pav-border-radius-full);
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background: var(--pav-color-orange-600);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
}

/* Dark Mode */
@media (prefers-color-scheme: dark) {
  .funding-page {
    .subtab-border {
      .subtab-nav {
        .subtab {
          &--active {
            color: var(--pav-color-orange-400);
          }

          &:hover {
            color: var(--pav-color-stone-300);
          }

          .subtab-badge {
            background: var(--pav-color-stone-800);
            color: var(--pav-color-stone-400);

            &--active {
              background: rgba(249, 115, 22, 0.15);
              color: var(--pav-color-orange-300);
            }
          }
        }
      }
    }

    .empty-card {
      .empty-icon {
        color: var(--pav-color-stone-600);
      }

      .empty-description {
        color: var(--pav-color-stone-500);
      }
    }

    .empty-card-inline {
      .empty-icon-small {
        color: var(--pav-color-stone-600);
      }
    }

    .alert {
      &--success {
        background: rgba(16, 185, 129, 0.1);
        border-color: var(--pav-color-emerald-800);
        color: var(--pav-color-emerald-300);
      }

      &--error {
        background: rgba(239, 68, 68, 0.1);
        border-color: var(--pav-color-red-800);
        color: var(--pav-color-red-300);
      }

      &--warning {
        background: rgba(245, 158, 11, 0.1);
        border-color: var(--pav-color-amber-800);
        color: var(--pav-color-amber-200);
      }
    }

    .status-badge {
      &--active {
        background: rgba(16, 185, 129, 0.15);
        color: var(--pav-color-emerald-300);
      }

      &--past_due {
        background: rgba(245, 158, 11, 0.15);
        color: var(--pav-color-amber-300);
      }

      &--suspended {
        background: rgba(239, 68, 68, 0.15);
        color: var(--pav-color-red-300);
      }

      &--cancelled {
        background: var(--pav-color-stone-800);
        color: var(--pav-color-stone-400);
      }
    }

    .subscriptions-card {
      .subscriptions-table-desktop {
        .subscriptions-table {
          thead tr {
            background: rgba(41, 37, 36, 0.5);
          }

          tbody tr:hover {
            background: rgba(41, 37, 36, 0.3);
          }
        }
      }
    }

    .pagination-btn {
      &:hover:not(:disabled) {
        background: var(--pav-color-stone-800);
      }
    }

    .action-link {
      &--danger {
        color: var(--pav-color-red-400);

        &:hover {
          color: var(--pav-color-red-300);
        }
      }
    }

    .action-link-mobile {
      &.action-link--danger {
        color: var(--pav-color-red-400);

        &:hover {
          background: rgba(239, 68, 68, 0.1);
        }
      }
    }

    .toggle-row {
      .toggle-text {
        .toggle-label {
          color: var(--pav-color-stone-100);
        }
      }
    }

    .toggle-inline {
      .toggle-inline-label {
        color: var(--pav-color-stone-400);
      }
    }

    .providers-list {
      .provider-item {
        .provider-info {
          .connected-badge {
            background: rgba(16, 185, 129, 0.15);
            color: var(--pav-color-emerald-300);
          }
        }
      }
    }

    .btn-text-orange {
      color: var(--pav-color-orange-400);

      &:hover {
        background: rgba(249, 115, 22, 0.1);
      }
    }

    .form-input,
    .form-select {
      background: var(--pav-color-stone-800);
      border-color: var(--pav-color-stone-600);
      color: var(--pav-color-stone-100);

      &:focus {
        border-color: var(--pav-color-orange-400);
        box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.15);
      }
    }

    .form-select {
      background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23a8a29e' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
    }
  }
}
</style>
