<template>
  <div class="funding-tab">
    <!-- Error Display -->
    <div
      v-if="state.error"
      class="alert alert--error"
      role="alert"
      aria-live="polite"
    >
      {{ state.error }}
    </div>

    <!-- Success Display -->
    <div
      v-if="state.success"
      class="alert alert--success"
      role="alert"
      aria-live="polite"
    >
      {{ state.success }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Funding Content -->
    <div v-else class="funding-content">
      <h2 class="funding-title">{{ t('title') }}</h2>

      <!-- Admin Exempt Status -->
      <div v-if="state.fundingStatus === 'admin-exempt'" class="funding-card">
        <div class="funding-status-badge funding-status-badge--exempt">
          {{ t('status_admin_exempt') }}
        </div>
        <p class="funding-description">{{ t('admin_exempt_description') }}</p>
      </div>

      <!-- Grant Status -->
      <div v-else-if="state.fundingStatus === 'grant'" class="funding-card">
        <div class="funding-status-badge funding-status-badge--grant">
          {{ t('status_grant') }}
        </div>
        <p class="funding-description">{{ t('grant_description') }}</p>
        <div v-if="state.grantInfo" class="grant-details">
          <p v-if="state.grantInfo.reason" class="grant-detail">
            <span class="grant-detail-label">{{ t('grant_reason') }}</span>
            {{ state.grantInfo.reason }}
          </p>
          <p v-if="state.grantInfo.expiresAt" class="grant-detail">
            <span class="grant-detail-label">{{ t('grant_expires') }}</span>
            {{ formatDate(state.grantInfo.expiresAt) }}
          </p>
        </div>
      </div>

      <!-- Funded Status -->
      <div v-else-if="state.fundingStatus === 'funded'" class="funding-card">
        <div class="funding-status-badge funding-status-badge--funded">
          {{ t('status_funded') }}
        </div>
        <p class="funding-description">{{ t('funded_description') }}</p>
        <button
          type="button"
          class="funding-button funding-button--secondary"
          :disabled="state.isActing"
          @click="removeFromSubscription"
        >
          {{ state.isActing ? t('removing') : t('remove_button') }}
        </button>
      </div>

      <!-- Unfunded Status -->
      <div v-else class="funding-card">
        <div class="funding-status-badge funding-status-badge--unfunded">
          {{ t('status_unfunded') }}
        </div>
        <p class="funding-description">{{ t('unfunded_description') }}</p>
        <button
          type="button"
          class="funding-button funding-button--primary"
          :disabled="state.isActing"
          @click="addToSubscription"
        >
          {{ state.isActing ? t('adding') : t('add_button') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import SubscriptionService from '@/client/service/subscription';
import type { FundingStatus } from '@/client/service/subscription';
import LoadingMessage from '@/client/components/common/loading_message.vue';

const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
});

const { t } = useTranslation('calendars', {
  keyPrefix: 'funding',
});

const subscriptionService = new SubscriptionService();

const state = reactive({
  isLoading: false,
  isActing: false,
  error: '',
  success: '',
  fundingStatus: '' as FundingStatus['status'] | '',
  grantInfo: null as Record<string, any> | null,
  subscriptionInfo: null as Record<string, any> | null,
});

/**
 * Clear messages after a delay
 */
const clearMessages = (delay = 5000) => {
  setTimeout(() => {
    state.error = '';
    state.success = '';
  }, delay);
};

/**
 * Format a date string for display
 */
const formatDate = (dateString: string): string => {
  try {
    return new Date(dateString).toLocaleDateString();
  }
  catch {
    return dateString;
  }
};

/**
 * Load the funding status for this calendar
 */
const loadFundingStatus = async () => {
  try {
    state.isLoading = true;
    state.error = '';

    const result: FundingStatus = await subscriptionService.getFundingStatus(props.calendarId);
    state.fundingStatus = result.status;
    state.grantInfo = result.grantInfo ?? null;
    state.subscriptionInfo = result.subscriptionInfo ?? null;
  }
  catch (error) {
    console.error('Error loading funding status:', error);
    state.error = t('error_loading');
    clearMessages();
  }
  finally {
    state.isLoading = false;
  }
};

/**
 * Add this calendar to the user's subscription
 */
const addToSubscription = async () => {
  try {
    state.isActing = true;
    state.error = '';
    state.success = '';

    await subscriptionService.addCalendarToSubscription(props.calendarId, 0);

    state.success = t('add_success');
    clearMessages();
    await loadFundingStatus();
  }
  catch (error) {
    console.error('Error adding calendar to subscription:', error);
    state.error = t('error_adding');
    clearMessages();
  }
  finally {
    state.isActing = false;
  }
};

/**
 * Remove this calendar from the user's subscription
 */
const removeFromSubscription = async () => {
  try {
    state.isActing = true;
    state.error = '';
    state.success = '';

    await subscriptionService.removeCalendarFromSubscription(props.calendarId);

    state.success = t('remove_success');
    clearMessages();
    await loadFundingStatus();
  }
  catch (error) {
    console.error('Error removing calendar from subscription:', error);
    state.error = t('error_removing');
    clearMessages();
  }
  finally {
    state.isActing = false;
  }
};

onMounted(loadFundingStatus);
</script>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

.funding-tab {
  padding: var(--pav-space-4) 0;

  @media (min-width: 640px) {
    padding: var(--pav-space-6) 0;
  }
}

.funding-content {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
}

.funding-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--pav-color-stone-900);
  margin: 0 0 var(--pav-space-6) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.funding-card {
  background: var(--pav-surface-primary);
  border-radius: 0.75rem;
  padding: var(--pav-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  max-width: 36rem;

  @media (min-width: 640px) {
    padding: var(--pav-space-6);
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
  }
}

.funding-description {
  margin: 0;
  color: var(--pav-color-stone-500);
  font-size: 0.875rem;
  line-height: 1.5;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.funding-status-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--pav-space-1) var(--pav-space-3);
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 500;
  width: fit-content;

  &--funded {
    background-color: rgba(34, 197, 94, 0.1);
    color: var(--pav-color-green-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-green-400);
    }
  }

  &--unfunded {
    background-color: rgba(234, 179, 8, 0.1);
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }

  &--grant {
    background-color: rgba(59, 130, 246, 0.1);
    color: #1d4ed8;

    @media (prefers-color-scheme: dark) {
      color: #60a5fa;
    }
  }

  &--exempt {
    background-color: rgba(107, 114, 128, 0.1);
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.grant-details {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.grant-detail {
  margin: 0;
  font-size: 0.875rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.grant-detail-label {
  font-weight: 500;
  margin-right: var(--pav-space-2);
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.funding-button {
  padding: 0.5rem 1rem;
  border: 0;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
  width: fit-content;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--primary {
    background: var(--pav-color-orange-500);
    color: white;

    &:hover:not(:disabled) {
      opacity: 0.9;
    }
  }

  &--secondary {
    background: var(--pav-color-stone-200);
    color: var(--pav-color-stone-700);

    &:hover:not(:disabled) {
      background: var(--pav-color-stone-300);
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-700);
      color: var(--pav-color-stone-300);

      &:hover:not(:disabled) {
        background: var(--pav-color-stone-600);
      }
    }
  }
}

.alert {
  padding: var(--pav-space-3);
  margin-bottom: var(--pav-space-4);
  border-radius: 0.75rem;
  font-size: 0.875rem;

  &.alert--error {
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }

  &.alert--success {
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: var(--pav-color-green-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-green-400);
    }
  }
}
</style>
