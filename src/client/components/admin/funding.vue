<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SubscriptionService from '@/client/service/subscription';
import PayPalConfigModal from './PayPalConfigModal.vue';
import ConfirmDisconnectModal from './ConfirmDisconnectModal.vue';
import AddProviderWizard from './AddProviderWizard.vue';
import GrantForm from './GrantForm.vue';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';

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
const activeSubTab = ref<'subscriptions' | 'settings' | 'grants'>('subscriptions');

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

// Grants state
const grants = ref<ComplimentaryGrant[]>([]);
const grantsLoading = ref(false);
const includeRevoked = ref(false);

// Grant form modal state
const grantFormOpen = ref(false);

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
 * Load complimentary grants
 */
async function loadGrants() {
  try {
    grantsLoading.value = true;
    grants.value = await subscriptionService.listGrants(includeRevoked.value);
  }
  catch (error) {
    console.error('Failed to load grants:', error);
    errorMessage.value = t('grants.load_error');
  }
  finally {
    grantsLoading.value = false;
  }
}

/**
 * Handle tab switch to grants — load on first open
 */
async function switchToGrants() {
  activeSubTab.value = 'grants';
  if (grants.value.length === 0 && !grantsLoading.value) {
    await loadGrants();
  }
}

/**
 * Toggle includeRevoked and reload grants
 */
async function toggleIncludeRevoked() {
  await loadGrants();
}

/**
 * Open the grant creation modal
 */
function openGrantForm() {
  grantFormOpen.value = true;
}

/**
 * Handle grant created event from modal
 */
async function onGrantCreated() {
  grantFormOpen.value = false;
  successMessage.value = t('grants.created');
  await loadGrants();
}

/**
 * Revoke a grant
 */
async function revokeGrant(grantId: string) {
  errorMessage.value = '';
  successMessage.value = '';

  try {
    await subscriptionService.revokeGrant(grantId);
    successMessage.value = t('grants.revoked');
    await loadGrants();
  }
  catch (error) {
    console.error('Failed to revoke grant:', error);
    errorMessage.value = t('grants.revoke_error');
  }
}

/**
 * Get grant status label
 */
function getGrantStatus(grant: ComplimentaryGrant): string {
  if (grant.revokedAt) {
    return t('grants.status.revoked');
  }
  if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) {
    return t('grants.status.expired');
  }
  return t('grants.status.active');
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
  if (!dateString) return t('grants.never_expires');
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
      <button
        v-if="activeSubTab === 'grants'"
        type="button"
        class="create-grant-button"
        @click="openGrantForm"
      >
        <svg width="20"
             height="20"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             stroke-width="2"
             stroke-linecap="round"
             stroke-linejoin="round"
             aria-hidden="true">
          <path d="M12 4v16m8-8H4" />
        </svg>
        {{ t("grants.create_new_grant") }}
      </button>
    </div>

    <!-- Status Messages -->
    <div role="status" aria-live="polite">
      <div v-if="successMessage" class="alert alert--success">
        <svg class="alert-icon"
             width="20"
             height="20"
             viewBox="0 0 20 20"
             fill="currentColor"
             aria-hidden="true">
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
             stroke-width="2"
             aria-hidden="true">
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
        <nav role="tablist" :aria-label="t('subtab_nav_label')" class="subtab-nav">
          <button
            type="button"
            role="tab"
            :aria-selected="activeSubTab === 'subscriptions' ? 'true' : 'false'"
            aria-controls="subscriptions-panel"
            class="subtab"
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
            @click="activeSubTab = 'settings'"
          >
            {{ t("settings_section_title") }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeSubTab === 'grants' ? 'true' : 'false'"
            aria-controls="grants-panel"
            class="subtab"
            @click="switchToGrants"
          >
            {{ t("grants.tab_title") }}
            <span
              v-if="grants.length > 0"
              class="subtab-badge"
              :class="{ 'subtab-badge--active': activeSubTab === 'grants' }"
            >
              {{ grants.length }}
            </span>
          </button>
        </nav>
      </div>

      <!-- Subscriptions Tab Panel -->
      <section
        id="subscriptions-panel"
        role="tabpanel"
        tabindex="-1"
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
               stroke-width="1.5"
               aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p class="empty-title">{{ t("no_subscriptions") }}</p>
          <p class="empty-description">{{ t("subscriptions_empty_state") }}</p>
        </div>

        <!-- Subscriptions list -->
        <div v-else class="subscriptions-card">
          <!-- Desktop Table -->
          <div class="subscriptions-table-desktop">
            <table class="subscriptions-table" role="table" :aria-label="t('subscriptions_table_aria')">
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
                  {{ t("subscription_period_end") }} {{ formatDate(sub.current_period_end) }}
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
        tabindex="-1"
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
                 stroke-width="2"
                 aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p class="alert-title">{{ t("setup_provider_message") }}</p>
              <p class="alert-description">{{ t("add_first_provider_description") }}</p>
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
                     stroke-linejoin="round"
                     aria-hidden="true">
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
                     stroke-width="1.5"
                     aria-hidden="true">
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
                       stroke-linejoin="round"
                       aria-hidden="true">
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                  {{ t("add_first_provider") }}
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
                <h2 class="card-title">{{ t("subscription_pricing_title") }}</h2>
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

      <!-- Grants Tab Panel -->
      <section
        id="grants-panel"
        role="tabpanel"
        tabindex="-1"
        :aria-hidden="activeSubTab !== 'grants' ? 'true' : 'false'"
        :hidden="activeSubTab !== 'grants'"
        class="tab-panel"
      >
        <div class="grants-content">
          <!-- Grants List -->
          <section class="grants-list-card" aria-labelledby="grants-list-heading">
            <div class="card-header">
              <h2 id="grants-list-heading" class="card-title">{{ t("grants.tab_title") }}</h2>
              <label class="toggle-inline">
                <input
                  type="checkbox"
                  v-model="includeRevoked"
                  class="toggle-checkbox-small"
                  @change="toggleIncludeRevoked"
                />
                <span class="toggle-inline-label">{{ t("grants.show_revoked") }}</span>
              </label>
            </div>

            <div class="grants-live-region" aria-live="polite" :aria-busy="grantsLoading ? 'true' : 'false'">
              <div v-if="grantsLoading" class="loading-state loading-state--card">{{ t("loading") }}</div>

              <template v-else>
                <!-- Empty state -->
                <div v-if="grants.length === 0" class="empty-card-inline">
                  <svg class="empty-icon-small"
                       width="48"
                       height="48"
                       viewBox="0 0 24 24"
                       fill="none"
                       stroke="currentColor"
                       stroke-width="1.5"
                       aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p class="empty-title">{{ t("grants.empty_state") }}</p>
                </div>

                <!-- Desktop Table -->
                <div v-else class="grants-table-desktop">
                  <table class="grants-table" role="table" :aria-label="t('grants.tab_title')">
                    <thead>
                      <tr>
                        <th scope="col">{{ t("grants.table.account") }}</th>
                        <th scope="col">{{ t("grants.table.reason") }}</th>
                        <th scope="col">{{ t("grants.table.expires") }}</th>
                        <th scope="col">{{ t("grants.table.granted_by") }}</th>
                        <th scope="col">{{ t("grants.table.created") }}</th>
                        <th scope="col" class="col-actions">{{ t("grants.table.actions") }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="grant in grants"
                        :key="grant.id"
                        :class="{ 'grant-row--revoked': grant.revokedAt }"
                      >
                        <td class="cell-account">{{ grant.accountEmail || grant.accountId }}</td>
                        <td class="cell-reason">{{ grant.reason || '—' }}</td>
                        <td class="cell-expires">
                          {{ grant.expiresAt ? formatDate(grant.expiresAt) : t('grants.never_expires') }}
                        </td>
                        <td class="cell-granted-by">{{ grant.grantedByEmail || grant.grantedBy }}</td>
                        <td class="cell-created">{{ formatDate(grant.createdAt?.toString()) }}</td>
                        <td class="cell-actions">
                          <span
                            class="badge badge--sm"
                            :class="{
                              'badge--success': !grant.revokedAt && grant.isActive,
                              'badge--subtle': grant.revokedAt,
                              'badge--warning': !grant.revokedAt && !grant.isActive,
                            }"
                          >
                            {{ getGrantStatus(grant) }}
                          </span>
                          <button
                            v-if="grant.isActive"
                            type="button"
                            class="action-link action-link--danger"
                            @click="revokeGrant(grant.id)"
                            :aria-label="`${t('grants.revoke_button')} ${grant.accountEmail || grant.accountId}`"
                          >
                            {{ t("grants.revoke_button") }}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Mobile Cards -->
                <div v-if="grants.length > 0" class="grants-mobile">
                  <div
                    v-for="grant in grants"
                    :key="grant.id"
                    class="grant-card"
                    :class="{ 'grant-card--revoked': grant.revokedAt }"
                  >
                    <div class="grant-card-header">
                      <div class="grant-card-info">
                        <p class="grant-card-account">{{ grant.accountEmail || grant.accountId }}</p>
                        <p v-if="grant.reason" class="grant-card-reason">{{ grant.reason }}</p>
                      </div>
                      <span
                        class="badge badge--sm"
                        :class="{
                          'badge--success': !grant.revokedAt && grant.isActive,
                          'badge--subtle': grant.revokedAt,
                          'badge--warning': !grant.revokedAt && !grant.isActive,
                        }"
                      >
                        {{ getGrantStatus(grant) }}
                      </span>
                    </div>
                    <div class="grant-card-footer">
                      <p class="grant-card-meta">
                        {{ t("grants.table.expires") }}:
                        {{ grant.expiresAt ? formatDate(grant.expiresAt) : t('grants.never_expires') }}
                      </p>
                      <button
                        v-if="grant.isActive"
                        type="button"
                        class="action-link-mobile action-link--danger"
                        @click="revokeGrant(grant.id)"
                        :aria-label="`${t('grants.revoke_button')} ${grant.accountEmail || grant.accountId}`"
                      >
                        {{ t("grants.revoke_button") }}
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </section>
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

    <!-- Grant Form Modal -->
    <GrantForm
      v-if="grantFormOpen"
      @close="grantFormOpen = false"
      @created="onGrantCreated"
    />
  </section>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;
@use '../../assets/style/mixins/tabs' as *;

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

    .create-grant-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--pav-space-2);
      padding: var(--pav-space-2_5) var(--pav-space-6);
      background: var(--pav-color-brand-primary);
      color: var(--pav-color-text-inverse);
      font-weight: var(--pav-font-weight-medium);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      border: none;
      border-radius: var(--pav-border-radius-full);
      cursor: pointer;
      transition: background-color 0.2s ease;
      width: 100%;

      @include pav-media(sm) {
        width: auto;
      }

      &:hover {
        background: var(--pav-color-brand-primary-dark);
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-brand-primary);
        outline-offset: 2px;
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
    margin: 0 calc(-1 * var(--pav-space-4));
    padding: 0 var(--pav-space-4);

    @include pav-media(md) {
      margin: 0;
      padding: 0;
    }

    .subtab-nav {
      @include tab-navigation;
      overflow-x: auto;

      .subtab {
        @include tab-button;
        white-space: nowrap;
        flex-shrink: 0;

        .subtab-badge {
          margin-inline-start: var(--pav-space-2);
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
        text-align: start;
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
        color: var(--pav-color-text-primary);
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
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
    padding: var(--pav-space-5) var(--pav-space-6);
  }

  /* Toggle */
  .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: var(--pav-space-3);
    cursor: pointer;

    &--compact {
      margin-bottom: var(--pav-space-4);
    }

    .toggle-checkbox {
      margin-top: var(--pav-space-0_5);
      flex-shrink: 0;
    }

    .toggle-text {
      .toggle-label {
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }

      .toggle-description {
        margin: var(--pav-space-1) 0 0;
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

    .toggle-checkbox-small {
      flex-shrink: 0;
    }

    .toggle-inline-label {
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-text-secondary);
    }
  }

  /* Providers */
  .providers-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pav-space-4);
    padding: var(--pav-space-4) var(--pav-space-6);

    &--border-only {
      border-bottom: 1px solid var(--pav-border-color-light);
    }

    .card-title {
      margin: 0;
      font-size: var(--pav-font-size-base);
      font-weight: var(--pav-font-weight-semibold);
      color: var(--pav-color-text-primary);
    }
  }

  .providers-list {
    .provider-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pav-space-4);
      padding: var(--pav-space-4) var(--pav-space-6);
      border-bottom: 1px solid var(--pav-border-color-light);

      &:last-child {
        border-bottom: none;
      }

      .provider-info {
        .provider-name-row {
          display: flex;
          align-items: center;
          gap: var(--pav-space-2);

          .provider-name {
            margin: 0;
            font-size: var(--pav-font-size-sm);
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
          }

          .connected-badge {
            padding: var(--pav-space-0_5) var(--pav-space-2);
            border-radius: var(--pav-border-radius-full);
            font-size: var(--pav-font-size-2xs);
            font-weight: var(--pav-font-weight-medium);
            background: var(--pav-color-emerald-100);
            color: var(--pav-color-emerald-700);
          }
        }

        .provider-type {
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-muted);
          text-transform: capitalize;
        }
      }

      .provider-actions {
        display: flex;
        align-items: center;
        gap: var(--pav-space-4);
        flex-shrink: 0;
      }
    }
  }

  /* Pricing Form */
  .pricing-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;
  }

  .pricing-form {
    padding: var(--pav-space-6);
  }

  .pricing-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--pav-space-4);

    @include pav-media(sm) {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .pricing-options {
    margin-top: var(--pav-space-6);
    padding-top: var(--pav-space-6);
    border-top: 1px solid var(--pav-border-color-light);
  }

  .pricing-actions {
    margin-top: var(--pav-space-6);
    display: flex;
    justify-content: flex-end;
  }

  /* Form Elements */
  .form-group {
    &--inline {
      display: flex;
      align-items: center;
      gap: var(--pav-space-3);
      flex-wrap: wrap;
    }
  }

  .form-label {
    display: block;
    margin-bottom: var(--pav-space-1_5);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-secondary);
  }

  .form-required {
    color: var(--pav-color-red-500);
    margin-inline-start: var(--pav-space-1);
  }

  .form-input {
    width: 100%;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-border-color-medium);
    border-radius: var(--pav-border-radius-md);
    background: var(--pav-color-surface-primary);
    font-size: var(--pav-font-size-sm);
    font-family: inherit;
    color: var(--pav-color-text-primary);
    box-sizing: border-box;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: 0 0 0 3px var(--pav-color-orange-100);
    }

    &--error {
      border-color: var(--pav-color-red-400);

      &:focus {
        box-shadow: 0 0 0 3px var(--pav-color-red-100);
      }
    }

    &--narrow {
      width: auto;
      min-width: 80px;
    }

    &--date {
      cursor: pointer;
    }
  }

  .form-select {
    width: 100%;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-border-color-medium);
    border-radius: var(--pav-border-radius-md);
    background: var(--pav-color-surface-primary);
    font-size: var(--pav-font-size-sm);
    font-family: inherit;
    color: var(--pav-color-text-primary);
    cursor: pointer;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: 0 0 0 3px var(--pav-color-orange-100);
    }
  }

  .form-textarea {
    width: 100%;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-border-color-medium);
    border-radius: var(--pav-border-radius-md);
    background: var(--pav-color-surface-primary);
    font-size: var(--pav-font-size-sm);
    font-family: inherit;
    color: var(--pav-color-text-primary);
    resize: vertical;
    box-sizing: border-box;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: 0 0 0 3px var(--pav-color-orange-100);
    }
  }

  .form-hint {
    margin: var(--pav-space-1) 0 0;
    font-size: var(--pav-font-size-xs);
    color: var(--pav-color-text-muted);
  }

  .form-error {
    margin: var(--pav-space-1) 0 0;
    font-size: var(--pav-font-size-xs);
    color: var(--pav-color-red-600);
  }

  /* Buttons */
  .btn-primary {
    padding: var(--pav-space-2) var(--pav-space-5);
    border: none;
    border-radius: var(--pav-border-radius-full);
    background: var(--pav-color-orange-500);
    font-size: var(--pav-font-size-sm);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: var(--pav-text-inverse);
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover:not(:disabled) {
      background: var(--pav-color-orange-600);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .btn-text-orange {
    display: inline-flex;
    align-items: center;
    gap: var(--pav-space-1_5);
    padding: var(--pav-space-1_5) var(--pav-space-3);
    border: none;
    border-radius: var(--pav-border-radius-full);
    background: none;
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    color: var(--pav-color-orange-600);
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover:not(:disabled) {
      background: var(--pav-color-orange-50);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  .action-link {
    padding: var(--pav-space-1) var(--pav-space-2_5);
    border: none;
    border-radius: var(--pav-border-radius-md);
    background: none;
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;
    transition: background-color 0.15s ease;

    &--danger {
      color: var(--pav-color-red-600);

      &:hover {
        background: var(--pav-color-red-50);
      }
    }
  }

  .action-link-mobile {
    padding: var(--pav-space-1_5) var(--pav-space-3);
    border: 1px solid currentColor;
    border-radius: var(--pav-border-radius-full);
    background: none;
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    font-family: inherit;
    cursor: pointer;

    &--danger {
      color: var(--pav-color-red-600);

      &:hover {
        background: var(--pav-color-red-50);
      }
    }
  }

  /* Grants */
  .grants-content {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-6);
  }

  .grants-live-region {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
  }

  .grants-list-card {
    background: var(--pav-color-surface-primary);
    border-radius: var(--pav-border-radius-xl);
    border: 1px solid var(--pav-border-color-light);
    overflow: hidden;
  }

  /* Grants Table */
  .grants-table-desktop {
    display: none;

    @include pav-media(md) {
      display: block;
    }

    .grants-table {
      width: 100%;
      border-collapse: collapse;

      thead {
        tr {
          border-bottom: 1px solid var(--pav-border-color-light);
          background: var(--pav-color-stone-50);
        }

        th {
          padding: var(--pav-space-3) var(--pav-space-6);
          text-align: start;
          font-size: var(--pav-font-size-2xs);
          font-weight: var(--pav-font-weight-semibold);
          color: var(--pav-color-text-muted);
          text-transform: uppercase;
          letter-spacing: var(--pav-letter-spacing-wider);

          &.col-actions {
            text-align: end;
          }
        }
      }

      tbody {
        tr {
          border-bottom: 1px solid var(--pav-border-color-light);

          &:last-child {
            border-bottom: none;
          }

          &.grant-row--revoked {
            opacity: 0.6;
          }
        }

        td {
          padding: var(--pav-space-4) var(--pav-space-6);
          font-size: var(--pav-font-size-sm);
        }

        .cell-account {
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-primary);
        }

        .cell-reason {
          color: var(--pav-color-text-secondary);
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cell-expires,
        .cell-granted-by,
        .cell-created {
          color: var(--pav-color-text-muted);
          font-size: var(--pav-font-size-xs);
        }

        .cell-actions {
          text-align: end;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--pav-space-2);
        }
      }
    }
  }

  /* Grants Mobile */
  .grants-mobile {
    display: block;

    @include pav-media(md) {
      display: none;
    }

    .grant-card {
      padding: var(--pav-space-4);
      border-bottom: 1px solid var(--pav-border-color-light);

      &:last-child {
        border-bottom: none;
      }

      &--revoked {
        opacity: 0.6;
      }

      .grant-card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--pav-space-3);

        .grant-card-info {
          min-width: 0;
          flex: 1;

          .grant-card-account {
            margin: 0;
            font-weight: var(--pav-font-weight-medium);
            color: var(--pav-color-text-primary);
            word-break: break-all;
          }

          .grant-card-reason {
            margin: var(--pav-space-1) 0 0;
            font-size: var(--pav-font-size-xs);
            color: var(--pav-color-text-muted);
          }
        }
      }

      .grant-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pav-space-3);
        margin-top: var(--pav-space-3);

        .grant-card-meta {
          margin: 0;
          font-size: var(--pav-font-size-xs);
          color: var(--pav-color-text-muted);
        }
      }
    }
  }
}
</style>
