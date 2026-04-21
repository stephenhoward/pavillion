<script setup lang="ts">
import { reactive, useId } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import Sheet from '@/client/components/common/Sheet.vue';
import { CalendarEventSchedule } from '@/common/model/events';

const props = defineProps({
  schedule: {
    type: CalendarEventSchedule,
    required: true,
  },
});

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation('event_editor', {
  keyPrefix: 'recurrence',
});

const frequencySelectId = useId();

/**
 * Initializes weekday checkboxes from the schedule's byDay array.
 */
const initWeekdays = (): Record<string, boolean> => {
  const byDay = props.schedule.byDay ?? [];
  return {
    SU: byDay.includes('SU'),
    MO: byDay.includes('MO'),
    TU: byDay.includes('TU'),
    WE: byDay.includes('WE'),
    TH: byDay.includes('TH'),
    FR: byDay.includes('FR'),
    SA: byDay.includes('SA'),
  };
};

/**
 * Initializes monthly weekday checkboxes from the schedule's byDay array.
 * byDay entries for monthly recurrence use the format "NDD" (e.g. "1MO", "3FR").
 */
const initMonthlyWeekdayCheckboxes = (): Record<string, boolean> => {
  const byDay = props.schedule.byDay ?? [];
  const keys = [
    '1SU', '1MO', '1TU', '1WE', '1TH', '1FR', '1SA',
    '2SU', '2MO', '2TU', '2WE', '2TH', '2FR', '2SA',
    '3SU', '3MO', '3TU', '3WE', '3TH', '3FR', '3SA',
    '4SU', '4MO', '4TU', '4WE', '4TH', '4FR', '4SA',
    '5SU', '5MO', '5TU', '5WE', '5TH', '5FR', '5SA',
  ];
  return Object.fromEntries(keys.map(key => [key, byDay.includes(key)]));
};

/**
 * Determines the end-type string from existing schedule data.
 * Used to restore the correct radio button state when editing or duplicating
 * a recurring event that already has count or endDate set.
 */
const initEndType = (): string => {
  if (props.schedule.count && props.schedule.count > 0) {
    return 'after';
  }
  if (props.schedule.endDate) {
    return 'on';
  }
  return 'none';
};

const state = reactive({
  frequency: (props.schedule.frequency as string) || '',
  endType: initEndType(),
  endDate: props.schedule.endDate ? props.schedule.endDate.toISO() : '',
  weekdays: initWeekdays(),
  monthlyWeekdayCheckboxes: initMonthlyWeekdayCheckboxes(),
});

/**
 * Handles frequency selector changes. Syncs the local state.frequency
 * value to props.schedule.frequency and triggers recurrence compilation.
 */
const onFrequencyChange = () => {
  props.schedule.frequency = state.frequency || null;
  compileRecurrence();
};

/**
 * Rebuilds the schedule's recurrence fields from the current form state.
 * Called on every change so edits persist to props.schedule live, with no
 * separate Save/Cancel step.
 */
const compileRecurrence = () => {
  props.schedule.interval = props.schedule.frequency ? props.schedule.interval || 1 : 0;
  props.schedule.count = props.schedule.frequency && state.endType == 'after' ? props.schedule.count : 0;

  props.schedule.byDay = props.schedule.frequency == 'weekly'
    ? Object.keys(state.weekdays).filter((day) => state.weekdays[day])
    : props.schedule.frequency == 'monthly'
      ? Object.keys(state.monthlyWeekdayCheckboxes).filter((day) => state.monthlyWeekdayCheckboxes[day])
      : [];

  props.schedule.endDate = state.endType == 'on' && state.endDate
    ? DateTime.fromISO(state.endDate)
    : null;
};
</script>

<template>
  <Sheet :title="t('recurrence_sheet_title')" @close="emit('close')">
    <form class="repeats" @submit.prevent>
      <!-- Frequency Selector -->
      <div class="frequency-field">
        <label class="frequency-label" :for="frequencySelectId">{{ t('frequency_label') }}</label>
        <select
          :id="frequencySelectId"
          class="frequency-select"
          v-model="state.frequency"
          @change="onFrequencyChange()"
        >
          <option value="">{{ t('frequency_none') }}</option>
          <option value="daily">{{ t('frequency_daily') }}</option>
          <option value="weekly">{{ t('frequency_weekly') }}</option>
          <option value="monthly">{{ t('frequency_monthly') }}</option>
          <option value="yearly">{{ t('frequency_yearly') }}</option>
        </select>
      </div>

      <label class="repeat-interval" v-if="props.schedule.frequency">
        {{ t('every') }}
        <input type="number"
               v-model="props.schedule.interval"
               @change="compileRecurrence()" />
        {{ props.schedule.frequency ? t(props.schedule.frequency + 'Term') : '' }}
      </label>

      <div class="week-parameters" v-if="props.schedule.frequency === 'weekly'">
        {{ t('on_weekday_label') }}:
        <div class="weekday-chips">
          <label v-for="day in Object.keys(state.weekdays)" :key="day">
            <input type="checkbox"
                   v-model="state.weekdays[day]"
                   @change="compileRecurrence()" />
            <span>{{ t(day) }}</span>
          </label>
        </div>
      </div>

      <div class="month-parameters" v-if="props.schedule.frequency === 'monthly'">
        <div v-for="week in [1, 2, 3, 4, 5]" :key="week">
          <label v-for="day in Object.keys(state.weekdays)" :key="week + day">
            <input type="checkbox"
                   v-model="state.monthlyWeekdayCheckboxes[week + day]"
                   @change="compileRecurrence()" />
            {{ t(week + 'ord') }} {{ t(day) }}
          </label>
        </div>
      </div>

      <div class="end-type" v-if="props.schedule.frequency">
        {{ t('end_type_label') }}:
        <label>
          <input type="radio"
                 value="none"
                 v-model="state.endType"
                 @change="compileRecurrence()" />
          {{ t('never') }}
        </label>
        <label>
          <input type="radio"
                 value="after"
                 v-model="state.endType"
                 @change="compileRecurrence()" />
          {{ t('after') }}
          <input type="number"
                 v-model="props.schedule.count"
                 @change="state.endType = 'after'; compileRecurrence()" />
          {{ t('occurrences') }}
        </label>
        <label>
          <input type="radio"
                 value="on"
                 v-model="state.endType"
                 @change="compileRecurrence()" />
          {{ t('on_date') }}
          <input type="date"
                 v-model="state.endDate"
                 @input="state.endType = 'on'; compileRecurrence()" />
        </label>
      </div>
    </form>
  </Sheet>
</template>

<!--
  Styles for `form.repeats`, `.week-parameters`, `.month-parameters`, and
  `.end-type` come from the shared partial:
    src/client/assets/style/components/_recurrence-form.scss
  which is registered globally in main.scss (pv-j1pi.1). No scoped styles
  are needed here so both this sheet and the inline form in
  event_recurrence.vue render from a single source of truth.
-->
