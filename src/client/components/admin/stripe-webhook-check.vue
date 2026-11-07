<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { STRIPE_WEBHOOK_EVENTS } from '@/common/model/funding-plan';
import type { StripeWebhookCheck } from '@/common/model/funding-plan';

/**
 * Tells the admin, in plain words, when the Stripe webhook destination for
 * this instance will not deliver the events that renew, suspend and end
 * plans. Renders nothing when the check passed.
 *
 * A missing-events result lists only what is missing; a missing destination
 * or a check that could not run lists every required event, because the
 * admin has to set up (or confirm) the whole list.
 */
const props = defineProps<{
  check: StripeWebhookCheck;
  webhookUrl?: string;
}>();

const { t } = useTranslation('admin', { keyPrefix: 'funding.webhook_check' });

const eventsToList = computed<readonly string[]>(() => {
  switch (props.check.status) {
    case 'missing_events':
      return props.check.missingEvents;
    case 'no_destination':
    case 'unchecked':
      return STRIPE_WEBHOOK_EVENTS;
    default:
      return [];
  }
});

const url = computed(() => props.webhookUrl ?? t('this_instance_url'));

// The status picks the message key, so an unknown value from a newer server
// reads as "could not check" rather than a raw key
const KNOWN_STATUSES = ['missing_events', 'disabled', 'no_destination', 'unchecked'];
const messageKey = computed(() => (KNOWN_STATUSES.includes(props.check.status) ? props.check.status : 'unchecked'));
</script>

<template>
  <div v-if="check.status !== 'ok'" class="alert alert--warning webhook-check" role="alert">
    <div class="alert__content">
      <p class="alert__title">{{ t('title') }}</p>
      <p class="alert__message">{{ t(messageKey, { url }) }}</p>
      <ul v-if="eventsToList.length > 0" class="webhook-check__events">
        <li v-for="eventType in eventsToList" :key="eventType"><code>{{ eventType }}</code></li>
      </ul>
    </div>
  </div>
</template>

<style scoped lang="scss">
.webhook-check__events {
  margin: var(--pav-space-2) 0 0;
  padding-inline-start: var(--pav-space-5);

  code {
    font-size: var(--pav-font-size-sm);
  }
}
</style>
