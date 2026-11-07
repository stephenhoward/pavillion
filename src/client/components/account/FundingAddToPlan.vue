<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import FundingService from '@/client/service/funding';
import type { AddToPlanOffer } from '@/client/service/funding';

/**
 * Adds a calendar to the funding plan the account already holds.
 *
 * What an owner with a plan gets in place of a checkout, which would be refused:
 * one plan per account, so a second calendar joins the first (DEC-022). The
 * parent decides whether the offer applies; this says what it costs and acts.
 */
const props = defineProps<{
  calendarId: string;
  offer: AddToPlanOffer;
}>();

const emit = defineEmits<{
  /** The calendar is on the plan. The parent re-reads the calendar's access. */
  added: [];
}>();

const { t } = useTranslation('funding', { keyPrefix: 'add_to_plan' });

const fundingService = new FundingService();

const processing = ref(false);
const errorMessage = ref('');

const message = computed(() => {
  const price = FundingService.formatCurrency(props.offer.price, props.offer.currency);
  return t(props.offer.billingCycle === 'monthly' ? 'message_monthly' : 'message_yearly', { price });
});

async function addCalendar() {
  if (processing.value) {
    return;
  }

  processing.value = true;
  errorMessage.value = '';

  try {
    // A pay-what-you-can instance requires an amount, so it is sent the one
    // this offer named. A fixed-price instance sets the amount itself.
    await fundingService.addCalendarToFundingPlan(
      props.calendarId,
      props.offer.payWhatYouCan ? props.offer.price : undefined,
    );
    emit('added');
  }
  catch {
    errorMessage.value = t('error');
  }
  finally {
    processing.value = false;
  }
}
</script>

<template>
  <div class="funding-add-to-plan">
    <div role="status" aria-live="polite">
      <div v-if="errorMessage" class="alert alert--error">{{ errorMessage }}</div>
    </div>
    <div class="alert alert--info funding-upsell">
      <p class="funding-upsell__message">{{ message }}</p>
      <!--
        aria-disabled, not disabled: a disabled button drops focus to <body>, so
        a keyboard user could not retry after a refusal.
      -->
      <button
        type="button"
        class="btn btn--primary btn--sm funding-upsell__action"
        :aria-disabled="processing ? 'true' : undefined"
        @click="addCalendar"
      >
        {{ processing ? t('adding') : t('action') }}
      </button>
    </div>
  </div>
</template>
