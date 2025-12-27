<script setup>
import { computed } from 'vue';
import { useCalendarStore } from '@/client/stores/calendarStore';

const props = defineProps({
  selectedCalendarId: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['change']);

const calendarStore = useCalendarStore();

const calendars = computed(() => calendarStore.calendars);
const selectedCalendar = computed(() => {
  if (!props.selectedCalendarId) {
    return null;
  }
  return calendarStore.getCalendarById(props.selectedCalendarId);
});

const handleChange = (event) => {
  emit('change', event.target.value);
};
</script>

<template>
  <div class="calendar-selector">
    <label for="calendar-select">
      Calendar:
    </label>
    <select
      id="calendar-select"
      :value="selectedCalendarId"
      @change="handleChange"
    >
      <option
        v-if="!selectedCalendarId"
        value=""
        disabled
      >
        Select a calendar
      </option>
      <option
        v-for="calendar in calendars"
        :key="calendar.id"
        :value="calendar.id"
      >
        {{ calendar.content('en').title || calendar.urlName }}
      </option>
    </select>
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

div.calendar-selector {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-lg;
  background: $light-mode-panel-background;
  border-bottom: 1px solid $light-mode-border;

  @media (prefers-color-scheme: dark) {
    background: $dark-mode-panel-background;
    border-bottom-color: $dark-mode-border;
  }

  label {
    font-weight: $font-medium;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  select {
    flex: 1;
    max-width: 300px;
    padding: $spacing-sm $spacing-md;
    border: 1px solid $light-mode-border;
    border-radius: $component-border-radius-small;
    background: $light-mode-panel-background;
    color: $light-mode-text;
    font-size: 14px;
    cursor: pointer;

    &:focus {
      outline: 2px solid $focus-color;
      outline-offset: 2px;
    }

    @media (prefers-color-scheme: dark) {
      background: $dark-mode-input-background;
      color: $dark-mode-input-text;
      border-color: $dark-mode-border;

      &:focus {
        outline-color: $focus-color-dark;
      }
    }
  }

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
    gap: $spacing-sm;

    select {
      max-width: none;
    }
  }
}
</style>
