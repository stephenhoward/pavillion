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
div.calendar-selector {
  display: flex;
  align-items: center;
  gap: var(--pav-space-3);
  padding: var(--pav-space-4);
  background: var(--pav-color-surface-secondary);
  border-bottom: 1px solid var(--pav-color-border-primary);

  label {
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-primary);
  }

  select {
    flex: 1;
    max-width: 300px;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-color-border-primary);
    border-radius: var(--pav-border-radius-sm);
    background: var(--pav-color-surface-tertiary);
    color: var(--pav-color-text-primary);
    font-size: 14px;
    cursor: pointer;

    &:focus {
      outline: 2px solid var(--pav-color-interactive-primary);
      outline-offset: 2px;
    }
  }

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
    gap: var(--pav-space-2);

    select {
      max-width: none;
    }
  }
}
</style>
