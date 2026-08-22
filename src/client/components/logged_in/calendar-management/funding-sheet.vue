<script setup lang="ts">
import { ref } from 'vue';
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

const sheetRef = ref<InstanceType<typeof Sheet> | null>(null);

function onPlanStarted() {
  // Close through the Sheet so its dialog lifecycle runs — restoring focus to
  // the element that opened it — and it emits `close` on our behalf. Emitting
  // `close` directly lets the parent tear the sheet down before focus is
  // ever restored.
  sheetRef.value?.close();
  emit('plan-started');
}
</script>

<template>
  <Sheet ref="sheetRef" :title="t('extended_features_title')" @close="emit('close')">
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
