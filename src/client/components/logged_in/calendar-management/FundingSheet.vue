<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/Sheet.vue';
import FundingForm from '@/client/components/account/FundingForm.vue';

defineProps<{
  calendarId: string;
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
    <FundingForm :calendarId="calendarId" @subscribed="onSubscribed" />
  </Sheet>
</template>
