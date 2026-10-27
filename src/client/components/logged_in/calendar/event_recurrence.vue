<style scoped lang="scss">
@use '@/client/assets/style/components/event-management' as *;
@use '@/client/assets/style/mixins/breakpoints' as *;

.recurrence-rule {
  .schedule-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pav-text-secondary);
  }

  .remove-schedule-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border: none;
    background: none;
    color: var(--pav-color-stone-400);
    cursor: pointer;
    transition: color 0.15s ease;

    &:hover {
      color: var(--pav-color-red-600);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
      border-radius: 0.25rem;
    }
  }

  .schedule-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;

    @include pav-media-down(sm) {
      grid-template-columns: 1fr;
    }
  }

  .grid-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .grid-field--full {
    grid-column: 1 / -1;
  }

  .grid-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pav-text-primary);
  }

  .grid-input {
    padding: 0.625rem 0.875rem;
    border: 1px solid var(--pav-border-secondary);
    border-radius: 0.375rem;
    font-size: 0.9375rem;
    background: var(--pav-surface-secondary);
    color: var(--pav-text-primary);
    font-family: inherit;
    transition: all 0.15s ease;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-500);
    }

    // The shared `.field-input--error` rule in _translatable-form.scss is
    // scoped to `.translatable-form-fields` and loses to the `border`
    // shorthand above, so the grid input carries the same treatment here.
    &.field-input--error,
    &.field-input--error:focus {
      border-color: var(--pav-border-error);
    }

    &.field-input--error:focus {
      box-shadow: var(--pav-focus-ring-error);
    }
  }

  .form-error {
    margin: 0;
    font-size: var(--pav-font-size-xs);
    color: var(--pav-text-error);
  }

  .recurrence-summary {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;

    .summary-text {
      font-size: 0.875rem;
      color: var(--pav-text-secondary);
    }
  }
}
</style>

<template>
  <div class="recurrence-rule">
    <div class="schedule-header">
      <span>{{ tEventEditor('recurrence.schedule_header', { n: props.index + 1 }) }}</span>
      <button
        v-if="props.canRemove"
        type="button"
        class="remove-schedule-btn"
        @click="emit('remove-schedule')"
        :aria-label="t('remove_schedule')"
      >
        <Trash2 :size="16" aria-hidden="true" />
      </button>
    </div>

    <!-- Date/Time Grid -->
    <div class="schedule-grid">
      <div class="grid-field">
        <label class="grid-label">{{ t('start_date_label') }}</label>
        <input type="date"
               v-model="state.date"
               @input="onStartDateChange()"
               class="grid-input"
               required />
      </div>

      <div class="grid-field">
        <label class="grid-label">{{ t('start_time_label') }}</label>
        <input type="time"
               ref="startTimeInput"
               v-model="state.time"
               @input="updateStartDate(); recheckTimeInput('start')"
               @blur="checkTimeInput('start')"
               class="grid-input"
               :class="{ 'field-input--error': state.timeIncomplete.start }"
               :aria-invalid="state.timeIncomplete.start ? 'true' : undefined"
               :aria-describedby="state.timeIncomplete.start ? startTimeErrorId : undefined"
               required />
        <p v-if="state.timeIncomplete.start" :id="startTimeErrorId" class="form-error">
          {{ t('error_time_incomplete') }}
        </p>
      </div>

      <div class="grid-field">
        <label class="grid-label">{{ t('end_date_label') }}</label>
        <input type="date"
               v-model="state.eventEndDate"
               @input="onEndDateManualChange()"
               class="grid-input" />
      </div>

      <div class="grid-field">
        <label class="grid-label">{{ t('end_time_label') }}</label>
        <input type="time"
               ref="endTimeInput"
               v-model="state.eventEndTime"
               @input="syncScheduleFromDateTime(); recheckTimeInput('end')"
               @blur="checkTimeInput('end')"
               class="grid-input"
               :class="{ 'field-input--error': state.timeIncomplete.end }"
               :aria-invalid="state.timeIncomplete.end ? 'true' : undefined"
               :aria-describedby="state.timeIncomplete.end ? endTimeErrorId : undefined" />
        <p v-if="state.timeIncomplete.end" :id="endTimeErrorId" class="form-error">
          {{ t('error_time_incomplete') }}
        </p>
      </div>

      <div class="grid-field grid-field--full">
        <label class="grid-label">{{ t('timezone_label') }}</label>
        <select v-model="state.timezone" @change="syncScheduleFromDateTime()" class="grid-input">
          <option v-for="tz in timezones" :key="tz" :value="tz">
            {{ formatTimezone(tz) }}
          </option>
        </select>
      </div>
    </div>

    <!-- Recurrence summary + trigger -->
    <div class="recurrence-summary">
      <template v-if="props.schedule.frequency">
        <span class="summary-text">{{ generateRecurrenceText(props.schedule, tEventEditor, i18next.language) }}</span>
        <button type="button" class="btn btn--secondary" @click="openRecurrenceSheet">
          <CalendarSync :size="16" aria-hidden="true" />
          {{ t('edit_recurrence') }}
        </button>
      </template>
      <template v-else>
        <button type="button" class="btn btn--secondary" @click="openRecurrenceSheet">
          <CalendarSync :size="16" aria-hidden="true" />
          {{ t('add_recurrence') }}
        </button>
      </template>
    </div>

    <RecurrenceEditorSheet
      v-if="state.showRecurrenceSheet"
      :schedule="props.schedule"
      @close="state.showRecurrenceSheet = false"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, useId } from 'vue';
import { CalendarEventSchedule } from '@/common/model/events';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { CalendarSync, Trash2 } from 'lucide-vue-next';
import RecurrenceEditorSheet from './RecurrenceEditorSheet.vue';
import { generateRecurrenceText } from '@/common/utils/recurrence-text';

const props = defineProps({
  schedule: CalendarEventSchedule,
  canRemove: {
    type: Boolean,
    default: true,
  },
  index: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(['remove-schedule']);

const { t } = useTranslation('event_editor', {
  keyPrefix: 'recurrence',
});

// Unprefixed translator for full-key lookups (e.g. when handing `t` to
// utilities that resolve their own keys, such as generateRecurrenceText).
const { t: tEventEditor } = useTranslation('event_editor');

/**
 * Returns the full list of IANA timezone identifiers supported by the browser.
 * Falls back to a representative set if the API is unavailable.
 */
const getTimezones = (): string[] => {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone');
  }
  // Fallback for environments without Intl.supportedValuesOf
  return [
    'Africa/Cairo',
    'Africa/Johannesburg',
    'Africa/Lagos',
    'Africa/Nairobi',
    'America/Anchorage',
    'America/Argentina/Buenos_Aires',
    'America/Bogota',
    'America/Chicago',
    'America/Denver',
    'America/Halifax',
    'America/Lima',
    'America/Los_Angeles',
    'America/Mexico_City',
    'America/New_York',
    'America/Santiago',
    'America/Sao_Paulo',
    'America/St_Johns',
    'America/Toronto',
    'America/Vancouver',
    'Asia/Bangkok',
    'Asia/Colombo',
    'Asia/Dhaka',
    'Asia/Dubai',
    'Asia/Hong_Kong',
    'Asia/Jakarta',
    'Asia/Karachi',
    'Asia/Kolkata',
    'Asia/Manila',
    'Asia/Seoul',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Asia/Taipei',
    'Asia/Tehran',
    'Asia/Tokyo',
    'Atlantic/Reykjavik',
    'Australia/Adelaide',
    'Australia/Brisbane',
    'Australia/Melbourne',
    'Australia/Perth',
    'Australia/Sydney',
    'Europe/Amsterdam',
    'Europe/Athens',
    'Europe/Berlin',
    'Europe/Brussels',
    'Europe/Dublin',
    'Europe/Helsinki',
    'Europe/Istanbul',
    'Europe/Lisbon',
    'Europe/London',
    'Europe/Madrid',
    'Europe/Moscow',
    'Europe/Oslo',
    'Europe/Paris',
    'Europe/Prague',
    'Europe/Rome',
    'Europe/Stockholm',
    'Europe/Vienna',
    'Europe/Warsaw',
    'Europe/Zurich',
    'Pacific/Auckland',
    'Pacific/Fiji',
    'Pacific/Honolulu',
    'UTC',
  ];
};

const timezones = getTimezones();

/**
 * Formats an IANA timezone identifier for display by replacing
 * underscores with spaces (e.g., "America/New_York" becomes "America/New York").
 */
const formatTimezone = (tz: string): string => {
  return tz.replace(/_/g, ' ');
};

/**
 * Returns the user's local timezone from the browser, or 'UTC' as a fallback.
 */
const getLocalTimezone = (): string => {
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local && timezones.includes(local)) {
      return local;
    }
  }
  catch {
    // Fall through to default
  }
  return 'UTC';
};

// Initialize date/time fields from startDate
const initDateTime = () => {
  if (props.schedule.startDate) {
    const dt = props.schedule.startDate;
    return {
      date: dt.toFormat('yyyy-MM-dd'),
      time: dt.toFormat('HH:mm'),
    };
  }
  return {
    date: '',
    time: '',
  };
};

/**
 * Initializes end date and end time fields from the schedule's eventEndTime.
 * Defaults end date to the start date if no eventEndTime is set.
 */
const initEndDateTime = () => {
  if (props.schedule.eventEndTime) {
    const dt = props.schedule.eventEndTime;
    return {
      eventEndDate: dt.toFormat('yyyy-MM-dd'),
      eventEndTime: dt.toFormat('HH:mm'),
      eventEndDateManuallySet: true,
    };
  }
  // Default end date to start date
  const startDate = props.schedule.startDate;
  return {
    eventEndDate: startDate ? startDate.toFormat('yyyy-MM-dd') : '',
    eventEndTime: '',
    eventEndDateManuallySet: false,
  };
};

const { date: initialDate, time: initialTime } = initDateTime();
const { eventEndDate: initialEndDate, eventEndTime: initialEndTime, eventEndDateManuallySet: initialEndDateManuallySet } = initEndDateTime();

const state = reactive({
  showRecurrenceSheet: false,
  date: initialDate,
  time: initialTime,
  eventEndDate: initialEndDate,
  eventEndTime: initialEndTime,
  eventEndDateManuallySet: initialEndDateManuallySet,
  previousStartDate: initialDate,
  timezone: getLocalTimezone(),
  timeIncomplete: { start: false, end: false },
});

type TimeField = 'start' | 'end';

const startTimeInput = ref<HTMLInputElement | null>(null);
const endTimeInput = ref<HTMLInputElement | null>(null);
const timeInputs = { start: startTimeInput, end: endTimeInput };

const fieldIdBase = useId();
const startTimeErrorId = `${fieldIdBase}-start-time-error`;
const endTimeErrorId = `${fieldIdBase}-end-time-error`;

/**
 * Marks a time input invalid while the browser reports it as partially
 * entered (validity.badInput: e.g. hour and minutes typed, AM/PM missing).
 * The value is empty in that state, so v-model alone cannot detect it, and
 * the browser does not say which segment is missing. Clears the mark once
 * the input is valid or empty.
 */
const checkTimeInput = (field: TimeField) => {
  state.timeIncomplete[field] = timeInputs[field].value?.validity.badInput ?? false;
};

/**
 * Re-checks a time input that is already marked, so the error clears as
 * soon as the entry becomes complete rather than waiting for blur.
 */
const recheckTimeInput = (field: TimeField) => {
  if (state.timeIncomplete[field]) {
    checkTimeInput(field);
  }
};

/**
 * Runs the incomplete-time check on both time inputs. Called by the event
 * editor's save path when validation finds no valid schedule.
 */
const checkTimeInputs = () => {
  checkTimeInput('start');
  checkTimeInput('end');
};

defineExpose({ checkTimeInputs });

/**
 * Builds a timezone-aware DateTime from the user-entered date and time fields,
 * using the selected IANA timezone (state.timezone).
 *
 * Using { zone: state.timezone } ensures Luxon interprets the wall-clock time
 * in the selected timezone rather than the system's local timezone. This
 * preserves the user's intended time across DST boundaries when recurring
 * event instances are generated -- without this, RRule would see a UTC-naive
 * date and produce instances that shift by 1 hour after a DST transition.
 */
const updateStartDate = () => {
  if (state.date && state.time) {
    const dateTimeString = `${state.date}T${state.time}`;
    props.schedule.startDate = DateTime.fromISO(dateTimeString, { zone: state.timezone });
  }
  syncScheduleFromDateTime();
};

/**
 * Handles start date input changes. Updates the start date and auto-syncs
 * the end date if the user has not manually overridden it.
 */
const onStartDateChange = () => {
  if (state.date && (!state.eventEndDateManuallySet || state.eventEndDate === state.previousStartDate)) {
    // Auto-sync end date when it matched the previous start date (same-day event)
    // or when the user hasn't manually changed the end date yet.
    state.eventEndDate = state.date;
  }
  state.previousStartDate = state.date;
  updateStartDate();
};

/**
 * Handles manual end date changes. Marks the end date as manually set
 * so it no longer auto-syncs with the start date.
 */
const onEndDateManualChange = () => {
  state.eventEndDateManuallySet = true;
  syncScheduleFromDateTime();
};

/**
 * Builds a timezone-aware DateTime for eventEndTime from the end date and
 * end time fields, following the same pattern as updateStartDate().
 */
const buildEventEndTime = (): DateTime | null => {
  if (state.eventEndDate && state.eventEndTime) {
    const dateTimeString = `${state.eventEndDate}T${state.eventEndTime}`;
    return DateTime.fromISO(dateTimeString, { zone: state.timezone });
  }
  return null;
};

/**
 * Syncs schedule.startDate, schedule.eventEndTime, and (for non-recurring
 * events) schedule.endDate from the current date/time/timezone inputs.
 *
 * Recurrence-rule fields (interval, byDay, count, endDate for recurring
 * events) are owned by RecurrenceEditorSheet and are not touched here.
 */
const syncScheduleFromDateTime = () => {
  // Update startDate from separate date/time fields
  if (state.date && state.time) {
    const dateTimeString = `${state.date}T${state.time}`;
    props.schedule.startDate = DateTime.fromISO(dateTimeString, { zone: state.timezone });
  }

  // Build eventEndTime from end date/time fields
  props.schedule.eventEndTime = buildEventEndTime();

  // For non-recurring events, keep endDate in sync with eventEndTime
  if (!props.schedule.frequency && props.schedule.eventEndTime) {
    props.schedule.endDate = props.schedule.eventEndTime;
  }
};

const openRecurrenceSheet = () => {
  state.showRecurrenceSheet = true;
};
</script>
