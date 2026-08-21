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
  'plan-started': [];
}>();

const { t } = useTranslation('funding');

function onPlanStarted() {
  emit('plan-started');
  emit('close');
}
</script>

<template>
  <Sheet :title="t('extended_features_title')" @close="emit('close')">
    <p class="input-description">
      {{ t('extended_features_description', { instanceName: instanceName }) }}
    </p>
    <FundingForm
      :calendarId="calendarId"
      :initialCycle="initialCycle"
      :initialAmount="initialAmount"
      @plan-started="onPlanStarted"
    />
  </Sheet>
</template>
