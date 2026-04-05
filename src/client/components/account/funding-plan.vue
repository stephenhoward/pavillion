<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { ref, computed, onMounted } from 'vue';
import FundingService from '@/client/service/funding';
import type { FundedCalendarInfo } from '@/client/service/funding';
import { useCalendarStore } from '@/client/stores/calendarStore';

const { t } = useTranslation('funding');

// Service instance
const fundingService = new FundingService();
const calendarStore = useCalendarStore();

// State management
const loading = ref(true);
const processing = ref(false);
const successMessage = ref('');
const errorMessage = ref('');

// Data state
const options = ref(null);
const status = ref(null);
const fundedCalendars = ref<FundedCalendarInfo[]>([]);

// Computed properties
const hasFundingPlan = computed(() => status.value !== null);

const isActive = computed(() => status.value?.status === 'active');

const isPastDue = computed(() => status.value?.status === 'past_due');

const isSuspended = computed(() => status.value?.status === 'suspended');

const isCancelled = computed(() => status.value?.status === 'cancelled');

const canCancel = computed(() => hasFundingPlan.value && (isActive.value || isPastDue.value));

const currentAmountDisplay = computed(() => {
  if (!status.value) return '';
  return FundingService.formatCurrency(status.value.amount, status.value.currency);
});

/**
 * Get the display name for a funded calendar
 */
function getCalendarName(calendarId: string): string {
  const calendar = calendarStore.getCalendarById(calendarId);
  if (calendar) {
    return calendar.content(i18next.language).name || calendarId;
  }
  return calendarId;
}

/**
 * Format the per-calendar amount for display
 */
function formatCalendarAmount(amount: number): string {
  if (!status.value) return '';
  return FundingService.formatCurrency(amount, status.value.currency);
}

/**
 * Load funding options and current status
 */
async function loadData() {
  try {
    loading.value = true;
    [options.value, status.value] = await Promise.all([
      fundingService.getOptions(),
      fundingService.getStatus(),
    ]);

    if (status.value) {
      try {
        fundedCalendars.value = await fundingService.getCalendarsInFundingPlan();
      }
      catch (error) {
        console.error('Failed to load funded calendars:', error);
        fundedCalendars.value = [];
      }
    }
  }
  catch (error) {
    console.error('Failed to load funding data:', error);
    errorMessage.value = t('load_error');
  }
  finally {
    loading.value = false;
  }
}

/**
 * Cancel funding plan
 */
async function cancelFundingPlan() {
  if (!confirm(t('cancel_confirm'))) {
    return;
  }

  processing.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const success = await fundingService.cancel();

    if (success) {
      successMessage.value = t('cancel_success');
      await loadData();
    }
    else {
      errorMessage.value = t('cancel_error');
    }
  }
  catch (error) {
    console.error('Failed to cancel funding plan:', error);
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
    const portalUrl = await fundingService.getPortalUrl();
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
  return new Date(dateString).toLocaleDateString(i18next.language);
}

// Load data on mount
onMounted(async () => {
  await loadData();
});
</script>

<template>
  <section class="settings funding-plan-management" aria-labelledby="funding-plan-heading">
    <div class="settings-header">
      <router-link to="/profile" class="back-button">{{ t("back_to_settings") }}</router-link>
      <h1 id="funding-plan-heading">{{ t("title") }}</h1>
    </div>

    <div role="status" aria-live="polite">
      <div v-if="successMessage" class="success-message">{{ successMessage }}</div>
      <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    </div>

    <div v-if="loading" class="loading">{{ t("loading") }}</div>

    <div v-else class="funding-plan-content">
      <!-- No funding plan - Direct user to calendar management -->
      <div v-if="!hasFundingPlan && options?.enabled" class="no-funding-plan">
        <h2>{{ t("no_funding_plan") }}</h2>
        <p>{{ t("no_plan_redirect") }}</p>
      </div>

      <!-- Active funding plan - Show status and management -->
      <div v-if="hasFundingPlan" class="funding-plan-status">
        <h2>{{ t("current_funding_plan") }}</h2>

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

        <div class="funding-plan-actions">
          <button
            v-if="isActive || isPastDue"
            type="button"
            class="btn btn--secondary"
            @click="openBillingPortal"
          >
            {{ t("manage_payment_button") }}
          </button>

          <button
            v-if="canCancel"
            type="button"
            class="danger"
            :disabled="processing"
            @click="cancelFundingPlan"
          >
            {{ t("cancel_funding_plan_button") }}
          </button>
        </div>
      </div>

      <!-- Funded calendars list -->
      <div v-if="hasFundingPlan" class="funded-calendars">
        <h2>{{ t("funded_calendars_title") }}</h2>

        <div v-if="fundedCalendars.length === 0" class="funded-calendars-empty">
          <p>{{ t("no_funded_calendars") }}</p>
        </div>

        <ul v-else class="funded-calendars-list">
          <li v-for="item in fundedCalendars" :key="item.calendarId" class="funded-calendar-item">
            <span class="calendar-name">{{ getCalendarName(item.calendarId) }}</span>
            <span class="calendar-amount">{{ t("funded_calendar_amount", { amount: formatCalendarAmount(item.amount) }) }}</span>
          </li>
        </ul>
      </div>

      <!-- Funding disabled message -->
      <div v-if="!options?.enabled" class="funding-disabled">
        <p>{{ t("funding_disabled") }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.funding-plan-management {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.settings-header {
  margin-bottom: 2rem;

  .back-button {
    display: inline-block;
    margin-bottom: 1rem;
    color: var(--pav-color-interactive-primary);
    text-decoration: none;
    font-size: 0.875rem;

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
  color: var(--pav-color-text-secondary);
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

.funding-plan-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.no-funding-plan {
  text-align: center;
  padding: 2rem;
}

.funded-calendars {
  .funded-calendars-empty {
    padding: 1rem;
    text-align: center;
    color: var(--pav-color-text-secondary);
  }

  .funded-calendars-list {
    list-style: none;
    padding: 0;
    margin: 0;

    .funded-calendar-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      border: 1px solid var(--pav-color-border-primary);
      border-radius: 8px;
      background: var(--pav-color-surface-secondary);
      margin-bottom: 0.5rem;

      .calendar-name {
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }

      .calendar-amount {
        font-size: 0.875rem;
        color: var(--pav-color-text-secondary);
      }
    }
  }
}

.funding-plan-status {
  .status-card {
    padding: 1.5rem;
    border: 1px solid var(--pav-color-border-primary);
    border-radius: 8px;
    background: var(--pav-color-surface-secondary);

    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--pav-color-border-primary);

      &:last-child {
        border-bottom: none;
      }

      .label {
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-secondary);
      }

      .status-badge {
        padding: 0.25rem 0.75rem;
        border-radius: 4px;
        font-size: 0.875rem;
        font-weight: var(--pav-font-weight-medium);

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

  .funding-plan-actions {
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

.funding-disabled {
  padding: 2rem;
  text-align: center;
  color: var(--pav-color-text-secondary);
}
</style>
