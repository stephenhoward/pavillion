<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/sheet.vue';
import CreateCalendarForm from './CreateCalendarForm.vue';

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation('calendars', {
  keyPrefix: 'list',
});

function onCreated() {
  emit('close');
}
</script>

<template>
  <Sheet :title="t('create_new_calendar_header')" @close="emit('close')">
    <CreateCalendarForm @created="onCreated" />
  </Sheet>
</template>
