<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { CalendarPlus } from 'lucide-vue-next';

import CalendarEventInstance from '@/common/model/event_instance';
import { generateInstanceIcs, downloadIcs } from '@/common/utils/ics-generator';
import { useLocalizedContent } from '../composables/useLocalizedContent';

const props = defineProps<{
  instance: CalendarEventInstance;
}>();

const { t } = useTranslation('system');
const { localizedContent } = useLocalizedContent();

function handleDownload() {
  const content = localizedContent(props.instance.event);
  const eventName = content.name || '';
  const eventDescription = content.description || '';
  const hostname = window.location.hostname;
  const filename = eventName
    ? `${eventName.substring(0, 50).replace(/[^a-zA-Z0-9-_ ]/g, '').trim()}.ics`
    : 'event.ics';

  const icsContent = generateInstanceIcs(props.instance, eventName, eventDescription, hostname);
  downloadIcs(icsContent, filename);
}
</script>

<template>
  <button
    type="button"
    class="add-to-calendar-btn"
    @click="handleDownload"
  >
    <CalendarPlus :size="16" aria-hidden="true" />
    <span>{{ t('event_add_to_calendar') }}</span>
  </button>
</template>

<style scoped lang="scss">
@use '@/common/ui/assets/mixins' as *;

.add-to-calendar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $public-space-sm;
  width: 100%;
  padding: $public-space-md $public-space-lg;
  min-height: 44px;
  border: 1px solid var(--pav-accent);
  border-radius: $public-radius-md;
  background: transparent;
  color: var(--pav-accent);
  font-family: $public-font-family;
  font-size: $public-font-size-base;
  font-weight: $public-font-weight-medium;
  cursor: pointer;
  transition: $public-transition-fast;

  &:hover {
    background-color: var(--pav-accent);
    color: #fff;
  }

  &:focus-visible {
    @include public-focus-visible;
  }
}
</style>
