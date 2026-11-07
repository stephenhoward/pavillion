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
</script>

<template>
  <div v-if="check.status !== 'ok'" class="webhook-check">
    <p class="webhook-check__title">{{ t('title') }}</p>
    <p class="webhook-check__message">{{ t(check.status, { url }) }}</p>
    <ul v-if="eventsToList.length > 0" class="webhook-check__events">
      <li v-for="eventType in eventsToList" :key="eventType"><code>{{ eventType }}</code></li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.webhook-check {
  margin-block-start: var(--pav-space-3);
  padding: var(--pav-space-3) var(--pav-space-4);
  border-inline-start: 3px solid var(--pav-color-warning);
  border-radius: var(--pav-border-radius-sm);
  background: var(--pav-color-surface-secondary);
  text-align: start;

  &__title {
    margin: 0 0 var(--pav-space-1);
    font-weight: var(--pav-font-weight-semibold);
  }

  &__message {
    margin: 0;
  }

  &__events {
    margin: var(--pav-space-2) 0 0;
    padding-inline-start: var(--pav-space-5);

    code {
      font-size: var(--pav-font-size-sm);
    }
  }
}
</style>
