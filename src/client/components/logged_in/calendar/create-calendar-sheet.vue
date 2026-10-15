<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/sheet.vue';
import CreateCalendarForm from './CreateCalendarForm.vue';

defineProps<{
  /** Named route the new calendar opens on; the form defaults to `calendar`. */
  routeName?: string;
}>();

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
    <CreateCalendarForm :route-name="routeName" @created="onCreated" />
  </Sheet>
</template>
