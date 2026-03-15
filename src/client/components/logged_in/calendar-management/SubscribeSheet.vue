<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/Sheet.vue';
import SubscribeForm from '@/client/components/account/SubscribeForm.vue';

defineProps<{
  calendarId: string;
}>();

const emit = defineEmits<{
  close: [];
  subscribed: [];
}>();

const { t } = useTranslation('subscription');

function onSubscribed() {
  emit('subscribed');
  emit('close');
}
</script>

<template>
  <Sheet :title="t('subscribe_to_fund_title')" @close="emit('close')">
    <SubscribeForm :calendarId="calendarId" @subscribed="onSubscribed" />
  </Sheet>
</template>
