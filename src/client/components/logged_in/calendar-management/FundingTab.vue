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

    <!-- Subscriptions disabled - hide funding UI entirely -->
    <template v-else-if="state.fundingDisabled" />

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

        <!-- Plan summary -->
        <div v-if="state.fundingPlan" class="plan-summary">
          <p class="plan-summary-text">
            {{ t('plan_summary', {
              count: state.fundedCalendars.length,
              amount: formatPlanAmount(state.fundingPlan.amount, state.fundingPlan.currency, state.fundingPlan.billing_cycle),
            }) }}
          </p>
        </div>

        <div class="funding-actions">
          <RouterLink
            :to="{ name: 'funding_plan' }"
            class="funding-button funding-button--primary"
          >
            {{ t('manage_funding_plan_link') }}
          </RouterLink>
          <button
            type="button"
            class="funding-button funding-button--secondary"
            :disabled="state.isActing"
            @click="removeFromFundingPlan"
          >
            {{ state.isActing ? t('removing') : t('remove_button') }}
          </button>
        </div>
      </div>

      <!-- Unfunded Status - Has existing funding plan -->
      <div v-else-if="state.fundingStatus === 'unfunded' && state.hasFundingPlan" class="funding-card">
        <div class="funding-status-badge funding-status-badge--unfunded">
          {{ t('status_unfunded') }}
        </div>
        <p class="funding-description">{{ t('unfunded_description') }}</p>

        <!-- Plan summary -->
        <div v-if="state.fundingPlan" class="plan-summary">
          <p class="plan-summary-text">
            {{ t('plan_summary', {
              count: state.fundedCalendars.length,
              amount: formatPlanAmount(state.fundingPlan.amount, state.fundingPlan.currency, state.fundingPlan.billing_cycle),
            }) }}
          </p>
          <p class="plan-summary-text plan-summary-text--projected">
            {{ t('projected_total', {
              count: state.fundedCalendars.length + 1,
              amount: projectedTotalDisplay,
            }) }}
          </p>
        </div>

        <!-- PWYC: monthly amount input + yearly opt-in checkbox -->
        <template v-if="state.fundingOptions?.payWhatYouCan">
          <div class="form-group">
            <label class="form-label" for="pwyc-add-monthly">
              {{ t('monthly_amount_label') }}
            </label>
            <div class="form-field">
              <div class="currency-input">
                <span class="currency-symbol">{{ currencySymbol }}</span>
                <input
                  id="pwyc-add-monthly"
                  type="number"
                  v-model.number="state.monthlyAmount"
                  step="0.01"
                  min="1"
                />
              </div>
              <div class="description">
                {{ t('suggested_amount', { amount: suggestedAmountDisplay }) }}
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="yearly-opt-in">
              <input
                type="checkbox"
                v-model="state.yearlyOptIn"
              />
              <span>{{ t('yearly_opt_in_label', { amount: pwycYearlyDisplay }) }}</span>
            </label>
            <div
              v-if="state.fundingOptions.payWhatYouCanYearlyDiscount > 0"
              class="description yearly-discount-note"
            >
              {{ t('yearly_discount_note', { percent: state.fundingOptions.payWhatYouCanYearlyDiscount }) }}
            </div>
          </div>
        </template>

        <p class="proration-note">{{ t('proration_note') }}</p>

        <button
          type="button"
          class="funding-button funding-button--primary"
          :disabled="state.isActing"
          @click="addToFundingPlan"
        >
          {{ state.isActing ? t('adding') : t('add_button') }}
        </button>
      </div>

      <!-- Unfunded Status - No funding plan -->
      <div v-else class="funding-card">
        <div class="funding-status-badge funding-status-badge--unfunded">
          {{ t('status_unfunded') }}
        </div>
        <p class="funding-description">{{ t('no_funding_plan_prompt') }}</p>

        <!-- Non-PWYC: pricing cards (unchanged) -->
        <template v-if="state.fundingOptions && !state.fundingOptions.payWhatYouCan">
          <div class="pricing-cards">
            <button
              type="button"
              class="pricing-card"
              :class="{ 'pricing-card--selected': state.selectedCycle === 'monthly' }"
              @click="state.selectedCycle = 'monthly'"
            >
              <span class="pricing-card-cycle">{{ t('cycle_monthly') }}</span>
              <span class="pricing-card-price">
                {{ formatPrice(state.fundingOptions.monthlyPrice, state.fundingOptions.currency) }}
              </span>
              <span class="pricing-card-interval">{{ t('per_month') }}</span>
            </button>
            <button
              type="button"
              class="pricing-card"
              :class="{ 'pricing-card--selected': state.selectedCycle === 'yearly' }"
              @click="state.selectedCycle = 'yearly'"
            >
              <span class="pricing-card-cycle">{{ t('cycle_yearly') }}</span>
              <span class="pricing-card-price">
                {{ formatPrice(state.fundingOptions.yearlyPrice, state.fundingOptions.currency) }}
              </span>
              <span class="pricing-card-interval">{{ t('per_year') }}</span>
            </button>
          </div>
        </template>

        <!-- PWYC: monthly amount input + yearly opt-in checkbox -->
        <template v-if="state.fundingOptions?.payWhatYouCan">
          <div class="form-group">
            <label class="form-label" for="pwyc-new-monthly">
              {{ t('monthly_amount_label') }}
            </label>
            <div class="form-field">
              <div class="currency-input">
                <span class="currency-symbol">{{ currencySymbol }}</span>
                <input
                  id="pwyc-new-monthly"
                  type="number"
                  v-model.number="state.monthlyAmount"
                  step="0.01"
                  min="1"
                />
              </div>
              <div class="description">
                {{ t('suggested_amount', { amount: suggestedAmountDisplay }) }}
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="yearly-opt-in">
              <input
                type="checkbox"
                v-model="state.yearlyOptIn"
              />
              <span>{{ t('yearly_opt_in_label', { amount: pwycYearlyDisplay }) }}</span>
            </label>
            <div
              v-if="state.fundingOptions.payWhatYouCanYearlyDiscount > 0"
              class="description yearly-discount-note"
            >
              {{ t('yearly_discount_note', { percent: state.fundingOptions.payWhatYouCanYearlyDiscount }) }}
            </div>
          </div>
        </template>

        <button
          type="button"
          class="funding-button funding-button--primary"
          :disabled="state.checkoutState === 'processing'"
          @click="startCheckout"
        >
          {{ state.checkoutState === 'processing' ? t('loading') : t('fund_this_calendar_button') }}
        </button>
      </div>

      <!-- Inline Stripe Checkout -->
      <div v-if="state.checkoutState === 'checkout'" class="funding-card checkout-card">
        <div ref="checkoutContainerRef" class="stripe-checkout-container" />
        <button
          type="button"
          class="funding-button funding-button--secondary"
          @click="cancelCheckout"
        >
          {{ t('cancel') }}
        </button>
      </div>

      <!-- Checkout Result -->
      <div v-if="state.checkoutState === 'result'" class="funding-card">
        <div v-if="state.resultStatus === 'success'" class="alert alert--success" role="status">
          {{ t('checkout_success') }}
        </div>
        <div v-else class="alert alert--error" role="alert">
          {{ t('checkout_error') }}
        </div>
        <button
          type="button"
          class="funding-button funding-button--primary"
          @click="state.checkoutState = 'idle'; loadFundingStatus()"
        >
          {{ state.resultStatus === 'success' ? t('continue') : t('try_again') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { useRoute, RouterLink } from 'vue-router';
import FundingService from '@/client/service/funding';
import type { FundingStatus, FundingOptions, FundingPlanStatus, FundedCalendarInfo } from '@/client/service/funding';
import { loadStripe } from '@/client/service/stripe-loader';
import LoadingMessage from '@/client/components/common/loading_message.vue';

const props = defineProps<{
  calendarId: string;
}>();

const { t } = useTranslation('calendars', {
  keyPrefix: 'funding',
});

const route = useRoute();
const fundingService = new FundingService();

const state = reactive({
  isLoading: false,
  isActing: false,
  error: '',
  success: '',
  fundingStatus: '' as FundingStatus['status'] | '',
  grantInfo: null as { reason?: string; expiresAt?: string } | null,
  hasFundingPlan: false,
  fundingDisabled: false,
  checkoutState: 'idle' as 'idle' | 'processing' | 'checkout' | 'result',
  resultStatus: 'success' as 'success' | 'error',
  fundingOptions: null as FundingOptions | null,
  fundingPlan: null as FundingPlanStatus | null,
  fundedCalendars: [] as FundedCalendarInfo[],
  selectedCycle: 'monthly' as 'monthly' | 'yearly',
  customAmount: 10.00,
  monthlyAmount: 0,
  yearlyOptIn: false,
});

// Stripe embedded checkout refs
const checkoutContainerRef = ref<HTMLElement | null>(null);
let checkoutInstance: any = null;

/**
 * Computed discounted yearly amount based on PWYC monthly input.
 * Formula: monthly * 12 * (1 - discount/100)
 */
const pwycYearlyAmount = computed((): number => {
  const discount = state.fundingOptions?.payWhatYouCanYearlyDiscount ?? 0;
  return state.monthlyAmount * 12 * (1 - discount / 100);
});

/**
 * Formatted PWYC yearly amount for display
 */
const pwycYearlyDisplay = computed((): string => {
  if (!state.fundingOptions) return '';
  const millicents = FundingService.displayToMillicents(pwycYearlyAmount.value);
  return FundingService.formatCurrency(millicents, state.fundingOptions.currency);
});

/**
 * Formatted suggested monthly amount for display
 */
const suggestedAmountDisplay = computed((): string => {
  if (!state.fundingOptions) return '';
  return FundingService.formatCurrency(state.fundingOptions.monthlyPrice, state.fundingOptions.currency);
});

/**
 * Get the per-calendar price based on the active billing cycle
 */
const perCalendarPrice = computed((): number => {
  if (!state.fundingOptions) return 0;

  if (state.fundingOptions.payWhatYouCan) {
    if (state.yearlyOptIn) {
      return FundingService.displayToMillicents(pwycYearlyAmount.value);
    }
    return FundingService.displayToMillicents(state.monthlyAmount);
  }

  const cycle = state.fundingPlan?.billing_cycle ?? state.selectedCycle;
  return cycle === 'yearly'
    ? state.fundingOptions.yearlyPrice
    : state.fundingOptions.monthlyPrice;
});

/**
 * Compute projected total after adding this calendar (in millicents)
 */
const projectedTotal = computed((): number => {
  const currentTotal = state.fundedCalendars.reduce((sum, cal) => sum + cal.amount, 0);
  return currentTotal + perCalendarPrice.value;
});

/**
 * Formatted projected total for display
 */
const projectedTotalDisplay = computed((): string => {
  const currency = state.fundingOptions?.currency ?? state.fundingPlan?.currency ?? 'USD';
  const cycle = state.fundingPlan?.billing_cycle ?? state.selectedCycle;
  const amount = FundingService.formatCurrency(projectedTotal.value, currency);
  return cycle === 'yearly'
    ? `${amount}${t('per_year')}`
    : `${amount}${t('per_month')}`;
});

/**
 * Currency symbol for PWYC inputs
 */
const currencySymbol = computed((): string => {
  const currency = state.fundingOptions?.currency ?? 'USD';
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
 */
async function handleCheckoutComplete(sessionId: string) {
  if (state.checkoutState !== 'checkout') return;

  try {
    const status = await fundingService.getCheckoutSessionStatus(sessionId);
    destroyCheckout();

    if (status.status === 'complete') {
      state.resultStatus = 'success';
      state.checkoutState = 'result';

      // Auto-add this calendar to the new funding plan
      try {
        await fundingService.addCalendarToFundingPlan(props.calendarId, perCalendarPrice.value);
      }
      catch {
        // Non-fatal — plan was created, calendar add can be retried
      }
      await loadFundingStatus();
      return;
    }

    state.resultStatus = 'error';
    state.checkoutState = 'result';
  }
  catch {
    destroyCheckout();
    state.resultStatus = 'error';
    state.checkoutState = 'result';
  }
}

/**
 * Start Stripe checkout directly from FundingTab (no sheet/dialog)
 */
async function startCheckout() {
  if (!state.fundingOptions) return;

  const provider = state.fundingOptions.providers.find(p => p.providerType === 'stripe');
  if (!provider?.publishableKey) {
    state.error = t('error_loading');
    clearMessages();
    return;
  }

  state.checkoutState = 'processing';
  state.error = '';

  try {
    const params: Record<string, any> = {
      returnUrl: window.location.href,
    };

    if (state.fundingOptions.payWhatYouCan) {
      if (state.yearlyOptIn) {
        params.billingCycle = 'yearly';
        params.amount = FundingService.displayToMillicents(pwycYearlyAmount.value);
      }
      else {
        params.billingCycle = 'monthly';
        params.amount = FundingService.displayToMillicents(state.monthlyAmount);
      }
    }
    else {
      params.billingCycle = state.selectedCycle;
    }

    params.calendarIds = [props.calendarId];

    const session = await fundingService.createCheckoutSession(params);
    const stripeInstance = await loadStripe(provider.publishableKey);

    checkoutInstance = await stripeInstance.initEmbeddedCheckout({
      clientSecret: session.clientSecret,
      onComplete: () => handleCheckoutComplete(session.sessionId),
    });

    state.checkoutState = 'checkout';

    await nextTick();
    const container = checkoutContainerRef.value;
    if (container) {
      checkoutInstance.mount(container);
    }
  }
  catch (error) {
    console.error('Failed to start checkout:', error);
    state.error = t('error_loading');
    state.checkoutState = 'idle';
    clearMessages();
  }
}

/**
 * Return to idle state from checkout
 */
function cancelCheckout() {
  destroyCheckout();
  state.checkoutState = 'idle';
}

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
    return new Date(dateString).toLocaleDateString(i18next.language);
  }
  catch {
    return dateString;
  }
};

/**
 * Format a price from millicents for display
 */
const formatPrice = (millicents: number, currency: string): string => {
  return FundingService.formatCurrency(millicents, currency);
};

/**
 * Format plan amount with cycle suffix
 */
const formatPlanAmount = (millicents: number, currency: string, cycle: string): string => {
  const amount = FundingService.formatCurrency(millicents, currency);
  const suffix = cycle === 'yearly' ? t('per_year') : t('per_month');
  return `${amount}${suffix}`;
};

/**
 * Load the funding status, plan state, and funded calendars
 */
const loadFundingStatus = async () => {
  try {
    state.isLoading = true;
    state.error = '';

    const [fundingResult, fundingPlanStatus, fundingPlanOptions] = await Promise.all([
      fundingService.getFundingStatus(props.calendarId),
      fundingService.getStatus(),
      fundingService.getOptions(),
    ]);

    state.fundingStatus = fundingResult.status;
    state.grantInfo = fundingResult.grantInfo ?? null;
    state.hasFundingPlan = fundingPlanStatus !== null;
    state.fundingPlan = fundingPlanStatus;
    state.fundingOptions = fundingPlanOptions;
    state.fundingDisabled = !fundingPlanOptions.enabled;

    // Prefill PWYC monthly amount from admin's suggested price
    if (fundingPlanOptions.payWhatYouCan) {
      state.monthlyAmount = FundingService.millicentsToDisplay(fundingPlanOptions.monthlyPrice);
      state.customAmount = state.monthlyAmount;
    }

    // If user has a funding plan, load funded calendars
    if (fundingPlanStatus !== null) {
      try {
        state.fundedCalendars = await fundingService.getCalendarsInFundingPlan();
      }
      catch {
        state.fundedCalendars = [];
      }
      // Lock cycle to existing plan's cycle
      state.selectedCycle = fundingPlanStatus.billing_cycle;
    }
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
 * Add this calendar to the user's funding plan
 */
const addToFundingPlan = async () => {
  try {
    state.isActing = true;
    state.error = '';
    state.success = '';

    await fundingService.addCalendarToFundingPlan(props.calendarId, perCalendarPrice.value);

    state.success = t('add_success');
    clearMessages();
    await loadFundingStatus();
  }
  catch (error) {
    console.error('Error adding calendar to funding plan:', error);
    state.error = t('error_adding');
    clearMessages();
  }
  finally {
    state.isActing = false;
  }
};

/**
 * Remove this calendar from the user's funding plan
 */
const removeFromFundingPlan = async () => {
  try {
    state.isActing = true;
    state.error = '';
    state.success = '';

    await fundingService.removeCalendarFromFundingPlan(props.calendarId);

    state.success = t('remove_success');
    clearMessages();
    await loadFundingStatus();
  }
  catch (error) {
    console.error('Error removing calendar from funding plan:', error);
    state.error = t('error_removing');
    clearMessages();
  }
  finally {
    state.isActing = false;
  }
};


onBeforeUnmount(() => {
  destroyCheckout();
});

onMounted(async () => {
  await loadFundingStatus();

  // Handle checkout return
  if (route.query.checkout === 'success') {
    state.success = t('checkout_return_success');
    clearMessages();
    await loadFundingStatus();
  }
});
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

/* Plan summary */
.plan-summary {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
  padding: var(--pav-space-3);
  background: var(--pav-color-stone-50);
  border-radius: 0.5rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
  }
}

.plan-summary-text {
  margin: 0;
  font-size: 0.875rem;
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }

  &--projected {
    font-weight: 600;
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }
}

/* Proration note */
.proration-note {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--pav-color-stone-500);
  font-style: italic;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

/* Pricing cards */
.pricing-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--pav-space-3);
}

.pricing-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--pav-space-1);
  padding: var(--pav-space-4);
  border: 2px solid var(--pav-color-stone-200);
  border-radius: 0.75rem;
  background: var(--pav-surface-primary);
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;

  &:hover {
    border-color: var(--pav-color-stone-400);
  }

  &--selected {
    border-color: var(--pav-color-orange-500);
    background: rgba(249, 115, 22, 0.05);

    &:hover {
      border-color: var(--pav-color-orange-500);
    }
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-700);
    background: var(--pav-color-stone-800);

    &:hover {
      border-color: var(--pav-color-stone-500);
    }

    &--selected {
      border-color: var(--pav-color-orange-500);
      background: rgba(249, 115, 22, 0.1);

      &:hover {
        border-color: var(--pav-color-orange-500);
      }
    }
  }
}

.pricing-card-cycle {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.pricing-card-price {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--pav-color-stone-900);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.pricing-card-interval {
  font-size: 0.8125rem;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

/* Stripe checkout */
.checkout-card {
  margin-top: var(--pav-space-4);
}

.stripe-checkout-container {
  min-height: 300px;
  margin-bottom: var(--pav-space-4);
}

/* Currency input */
.currency-input {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 200px;

  .currency-symbol {
    font-weight: 500;
    color: var(--pav-color-stone-600);
    font-size: 1rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  input {
    flex: 1;
  }
}

/* PWYC form groups - mirroring FundingForm pattern */
.form-group {
  margin-bottom: 1.5rem;

  .form-label {
    display: block;
    font-weight: var(--pav-font-weight-medium, 500);
    margin-bottom: 0.5rem;
    color: var(--pav-color-text-primary, var(--pav-color-stone-900));

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-text-primary, var(--pav-color-stone-100));
    }
  }

  .form-field {
    input {
      width: 100%;
      max-width: 200px;
      padding: 0.5rem;
      border: 1px solid var(--pav-color-border-primary, var(--pav-color-stone-300));
      border-radius: 8px;
      background: var(--pav-color-surface-secondary, var(--pav-surface-primary));
      color: var(--pav-color-text-primary, var(--pav-color-stone-900));

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-surface-tertiary, var(--pav-color-stone-800));
        color: var(--pav-color-text-primary, var(--pav-color-stone-100));
      }
    }

    .description {
      margin-top: 0.5rem;
      font-size: 0.875rem;
      color: var(--pav-color-text-secondary, var(--pav-color-stone-500));
    }
  }

  .yearly-opt-in {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--pav-color-border-primary, var(--pav-color-stone-300));
    border-radius: 8px;
    cursor: pointer;

    &:hover {
      background: var(--pav-color-surface-hover, var(--pav-color-stone-50));
    }

    input[type="checkbox"] {
      margin: 0;
    }
  }

  .yearly-discount-note {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: var(--pav-color-text-secondary, var(--pav-color-stone-500));
  }
}

/* Funding actions */
.funding-actions {
  display: flex;
  gap: var(--pav-space-3);
  flex-wrap: wrap;
  align-items: center;
}

/* Buttons */
.funding-button {
  padding: 0.5rem 1rem;
  border: 0;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
  width: fit-content;
  text-decoration: none;
  display: inline-flex;
  align-items: center;

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
