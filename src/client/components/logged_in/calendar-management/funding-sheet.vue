<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/sheet.vue';
import FundingForm from '@/client/components/account/FundingForm.vue';

defineProps<{
  calendarId: string;
  initialCycle?: 'monthly' | 'yearly';
  initialAmount?: number;
  instanceName: string;
}>();

const emit = defineEmits<{
  close: [];
  subscribed: [];
}>();

const { t } = useTranslation('funding');

function onSubscribed() {
  emit('subscribed');
  emit('close');
}
</script>

<template>
  <Sheet :title="t('subscribe_to_fund_title')" @close="emit('close')">
    <p class="input-description">
      {{ t('subscribe_to_fund_description', { instanceName: instanceName }) }}
    </p>
    <FundingForm
      :calendarId="calendarId"
      :initialCycle="initialCycle"
      :initialAmount="initialAmount"
      @subscribed="onSubscribed"
    />
  </Sheet>
</template>
