<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { CalendarPlus } from 'lucide-vue-next';

import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { generateInstanceIcs, generateEventIcs, downloadIcs } from '@/common/utils/ics-generator';
import { useLocalizedContent } from '../composables/useLocalizedContent';

const props = defineProps<{
  event: CalendarEvent;
  instance?: CalendarEventInstance | null;
}>();

const { t } = useTranslation('system');
const { localizedContent } = useLocalizedContent();

function handleDownload() {
  const content = localizedContent(props.event);
  const eventName = content.name || '';
  const eventDescription = content.description || '';
  const hostname = window.location.hostname;
  const filename = eventName
    ? `${eventName.substring(0, 50).replace(/[^a-zA-Z0-9-_ ]/g, '').trim()}.ics`
    : 'event.ics';

  let icsContent: string;

  if (props.instance) {
    icsContent = generateInstanceIcs(props.instance, eventName, eventDescription, hostname);
  }
  else {
    icsContent = generateEventIcs(props.event, eventName, eventDescription, hostname);
  }

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
@use '../assets/mixins' as *;

.add-to-calendar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $public-space-sm;
  width: 100%;
  padding: $public-space-md $public-space-lg;
  min-height: 44px;
  border: 1px solid $public-accent-light;
  border-radius: $public-radius-md;
  background: transparent;
  color: $public-accent-light;
  font-family: $public-font-family;
  font-size: $public-font-size-base;
  font-weight: $public-font-weight-medium;
  cursor: pointer;
  transition: $public-transition-fast;

  &:hover {
    background-color: $public-accent-light;
    color: #fff;
  }

  &:focus-visible {
    @include public-focus-visible;
  }

  @include public-dark-mode {
    border-color: $public-accent-dark;
    color: $public-accent-dark;

    &:hover {
      background-color: $public-accent-dark;
      color: #fff;
    }
  }
}
</style>
