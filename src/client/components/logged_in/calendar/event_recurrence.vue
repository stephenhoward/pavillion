<style scoped lang="scss">
@use '@/client/assets/mixins' as *;
@use '@/client/assets/style/components/event-management' as *;

.recurrence-rule {
  .schedule-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
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

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-500);

      &:hover {
        color: var(--pav-color-red-400);
      }
    }
  }

  .schedule-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .grid-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .grid-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }

  .grid-input {
    padding: 0.625rem 0.875rem;
    border: 1px solid var(--pav-color-stone-200);
    border-radius: 0.375rem;
    font-size: 0.9375rem;
    background: white;
    color: var(--pav-color-stone-900);
    font-family: inherit;
    transition: all 0.15s ease;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-500);
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-900);
      color: var(--pav-color-stone-100);
      border-color: var(--pav-color-stone-700);

      &:focus {
        border-color: var(--pav-color-orange-500);
      }
    }
  }

  .add-recurrence-btn {
    padding: 0;
    border: none;
    background: none;
    color: var(--pav-color-orange-500);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;

    &:hover {
      color: var(--pav-color-orange-600);
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-orange-400);

      &:hover {
        color: var(--pav-color-orange-300);
      }
    }
  }

  form.repeats {
    margin-top: 1.5rem;
    padding: 1.5rem;
    background-color: var(--pav-color-stone-50);
    border: 1px solid var(--pav-color-stone-200);
    border-radius: 0.75rem; // rounded-xl

    @media (prefers-color-scheme: dark) {
      background-color: var(--pav-color-stone-800);
      border-color: var(--pav-color-stone-700);
    }

    label.repeat-interval {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      color: var(--pav-color-stone-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-300);
      }

      input[type="number"] {
        @include form-input-rounded;
        width: 60px;
        text-align: center;
      }
    }

    div.week-parameters {
      margin-bottom: 1.5rem;
      color: var(--pav-color-stone-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-300);
      }

      > label:first-of-type {
        display: block;
        margin-bottom: 0.75rem;
        font-weight: 500;
      }

      label {
        display: inline-flex;
        align-items: center;
        margin-right: 0.5rem;
        margin-bottom: 0.5rem;

        input[type="checkbox"] {
          // Hide the actual checkbox
          position: absolute;
          opacity: 0;
          pointer-events: none;

          // Style the label as a button
          & + * {
            display: inline-block;
            padding: 0.5rem 1rem;
            background-color: var(--pav-color-stone-100);
            color: var(--pav-color-stone-600);
            border: 1px solid var(--pav-color-stone-300);
            border-radius: 9999px; // rounded-full (pill)
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            user-select: none;

            @media (prefers-color-scheme: dark) {
              background-color: var(--pav-color-stone-700);
              color: var(--pav-color-stone-300);
              border-color: var(--pav-color-stone-600);
            }
          }

          // Hover state
          &:not(:checked) + *:hover {
            background-color: var(--pav-color-stone-200);
            border-color: var(--pav-color-stone-400);

            @media (prefers-color-scheme: dark) {
              background-color: var(--pav-color-stone-600);
              border-color: var(--pav-color-stone-500);
            }
          }

          // Selected (checked) state
          &:checked + * {
            background-color: var(--pav-color-orange-500);
            color: white;
            border-color: var(--pav-color-orange-600);

            @media (prefers-color-scheme: dark) {
              background-color: var(--pav-color-orange-500);
              border-color: var(--pav-color-orange-400);
            }
          }

          // Focus state
          &:focus-visible + * {
            outline: 2px solid var(--pav-color-orange-500);
            outline-offset: 2px;
          }
        }
      }
    }

    div.month-parameters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;

      > div {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;

        label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--pav-color-stone-700);

          @media (prefers-color-scheme: dark) {
            color: var(--pav-color-stone-300);
          }

          input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--pav-color-orange-500);
          }
        }
      }
    }

    div.end-type {
      color: var(--pav-color-stone-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-300);
      }

      > label:first-of-type {
        display: block;
        margin-bottom: 0.75rem;
        font-weight: 500;
      }

      label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
        font-size: 0.875rem;

        input[type="radio"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
          accent-color: var(--pav-color-orange-500);
        }

        input[type="number"] {
          @include form-input-rounded;
          width: 60px;
          text-align: center;
        }

        input[type="date"] {
          @include form-input-rounded;
        }
      }
    }
  }

  // Compact mode for sidebar display
  &--compact {
    .summary {
      gap: 0.75rem;

      input[type="datetime-local"] {
        font-size: 0.875rem;
        padding: 0.625rem 0.875rem;
      }

      label {
        font-size: 0.875rem;
        gap: 0.375rem;

        select {
          font-size: 0.875rem;
          padding: 0.625rem 0.875rem;
        }
      }
    }

    form.repeats {
      margin-top: 1rem;
      padding: 1rem;

      label.repeat-interval {
        margin-bottom: 1rem;
        font-size: 0.875rem;

        input[type="number"] {
          width: 50px;
          font-size: 0.875rem;
          padding: 0.5rem 0.625rem;
        }
      }

      div.week-parameters {
        margin-bottom: 1rem;
        font-size: 0.875rem;

        > label:first-of-type {
          margin-bottom: 0.5rem;
        }

        label {
          input[type="checkbox"] + * {
            padding: 0.375rem 0.75rem;
            font-size: 0.8125rem;
          }
        }
      }

      div.month-parameters {
        gap: 0.75rem;
        margin-bottom: 1rem;

        > div {
          gap: 0.375rem;

          label {
            font-size: 0.8125rem;

            input[type="checkbox"] {
              width: 16px;
              height: 16px;
            }
          }
        }
      }

      div.end-type {
        font-size: 0.875rem;

        > label:first-of-type {
          margin-bottom: 0.5rem;
        }

        label {
          font-size: 0.8125rem;
          margin-bottom: 0.375rem;

          input[type="radio"] {
            width: 16px;
            height: 16px;
          }

          input[type="number"] {
            width: 50px;
            font-size: 0.8125rem;
            padding: 0.5rem 0.625rem;
          }

          input[type="date"] {
            font-size: 0.8125rem;
            padding: 0.5rem 0.625rem;
          }
        }
      }
    }
  }
}
</style>

<template>
  <div :class="['recurrence-rule', { 'recurrence-rule--compact': compact }]">
    <div class="schedule-header">
      <span>Schedule</span>
      <button
        type="button"
        class="remove-schedule-btn"
        @click="emit('remove-schedule')"
        aria-label="Remove this schedule"
      >
        <Trash2 :size="16" aria-hidden="true" />
      </button>
    </div>

    <!-- Date/Time Grid -->
    <div class="schedule-grid">
      <div class="grid-field">
        <label class="grid-label">Date</label>
        <input type="date"
               v-model="state.date"
               @input="updateStartDate()"
               class="grid-input"/>
      </div>

      <div class="grid-field">
        <label class="grid-label">Time</label>
        <input type="time"
               v-model="state.time"
               @input="updateStartDate()"
               class="grid-input"/>
      </div>

      <div class="grid-field">
        <label class="grid-label">Duration (minutes)</label>
        <input type="number"
               v-model="state.duration"
               @input="compileRecurrence()"
               class="grid-input"
               min="0"
               step="15"/>
      </div>

      <div class="grid-field">
        <label class="grid-label">Timezone</label>
        <select v-model="state.timezone" @change="compileRecurrence()" class="grid-input">
          <option value="America/Los_Angeles">America/Los Angeles</option>
          <option value="America/Denver">America/Denver</option>
          <option value="America/Chicago">America/Chicago</option>
          <option value="America/New_York">America/New York</option>
          <option value="UTC">UTC</option>
        </select>
      </div>
    </div>

    <!-- Add Recurrence Toggle -->
    <button
      type="button"
      class="add-recurrence-btn"
      @click="state.showRecurrence = !state.showRecurrence"
      v-if="!state.showRecurrence"
    >
      + Add recurrence
    </button>

    <!-- Recurrence Form -->
    <form class="repeats" v-if="state.showRecurrence">
      <label class="repeat-interval" v-if="props.schedule.frequency">
        {{ t('every') }} <input type="number" v-model="props.schedule.interval" @change="compileRecurrence()" /> {{  props.schedule.frequency ? t( props.schedule.frequency + 'Term') : '' }}
      </label>

      <div class="week-parameters" v-if="props.schedule.frequency === 'weekly'">
        {{ t('on-weekday-label') }}:
        <label v-for="day in Object.keys(state.weekdays)">
          <input type="checkbox" v-model="state.weekdays[day]" @change="compileRecurrence()" /> {{ t(day) }}
        </label>
      </div>

      <div class="month-parameters" v-if="props.schedule.frequency == 'monthly'" >
        <div v-for="week in [1,2,3,4,5]">
          <label v-for="day in Object.keys(state.weekdays)">
            <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes[week + day]" @change="compileRecurrence()" /> {{ t(week + 'ord') }} {{ t(day) }}
          </label>
        </div>
      </div>

      <div class="end-type" v-if="props.schedule.frequency">
        {{ t('endType-label') }}:
        <label><input type="radio"
                      value="none"
                      v-model="state.endType"
                      @change="compileRecurrence()"/> {{ t('never') }}</label>
        <label><input type="radio"
                      value="after"
                      v-model="state.endType"
                      @change="compileRecurrence()" /> {{ t('after') }} <input type="number" v-model="props.schedule.count" @change="state.endType='after'; compileRecurrence()" /> {{ t('occurrences') }}</label>
        <label><input type="radio"
                      value="on"
                      v-model="state.endType"
                      @change="compileRecurrence()" /> {{ t('on_date') }} <input type="date" v-model="state.endDate" @input="state.endType='on'; compileRecurrence()" /></label>
      </div>
    </form>
  </div>
</template>

<script setup>
import { reactive } from 'vue';
import { CalendarEventSchedule } from '@/common/model/events';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { Trash2 } from 'lucide-vue-next';

const props = defineProps({
  schedule: CalendarEventSchedule,
  compact: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['remove-schedule']);

const { t } = useTranslation('event_editor', {
  keyPrefix: 'recurrence',
});

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

const { date: initialDate, time: initialTime } = initDateTime();

const state = reactive({
  showRecurrence: false,
  date: initialDate,
  time: initialTime,
  duration: 60, // Default duration in minutes
  timezone: 'America/Los_Angeles', // Default timezone
  endDate: props.schedule.endDate ? props.schedule.endDate.toISO() : '',
  endType: 'none',
  weekdays: {
    SU: false,
    MO: false,
    TU: false,
    WE: false,
    TH: false,
    FR: false,
    SA: false,
  },
  monthlyWeekdayCheckboxes: {
    '1SU': false,
    '1MO': false,
    '1TU': false,
    '1WE': false,
    '1TH': false,
    '1FR': false,
    '1SA': false,
    '2SU': false,
    '2MO': false,
    '2TU': false,
    '2WE': false,
    '2TH': false,
    '2FR': false,
    '2SA': false,
    '3SU': false,
    '3MO': false,
    '3TU': false,
    '3WE': false,
    '3TH': false,
    '3FR': false,
    '3SA': false,
    '4SU': false,
    '4MO': false,
    '4TU': false,
    '4WE': false,
    '4TH': false,
    '4FR': false,
    '4SA': false,
    '5SU': false,
    '5MO': false,
    '5TU': false,
    '5WE': false,
    '5TH': false,
    '5FR': false,
    '5SA': false,
  },
});

const updateStartDate = () => {
  if (state.date && state.time) {
    const dateTimeString = `${state.date}T${state.time}`;
    props.schedule.startDate = DateTime.fromISO(dateTimeString);
  }
};

const compileRecurrence = () => {
  // Update startDate from separate date/time fields
  updateStartDate();

  props.schedule.interval = props.schedule.frequency ? props.schedule.interval || 1 : 0;
  props.schedule.count = props.schedule.frequency && state.endType == 'after' ? props.schedule.count : 0;
  props.schedule.endDate = props.schedule.frequency && state.endType == 'on' ? props.schedule.endDate : '';

  props.schedule.byDay = props.schedule.frequency == 'weekly'
    ? Object.keys(state.weekdays).filter( (day) => state.weekdays[day] )
    : props.schedule.frequency == 'monthly'
      ? Object.keys(state.monthlyWeekdayCheckboxes).filter( (day) => state.monthlyWeekdayCheckboxes[day] )
      : [];

  props.schedule.endDate = state.endType == 'on' && state.endDate
    ? DateTime.fromISO(state.endDate)
    : null;

};
</script>
