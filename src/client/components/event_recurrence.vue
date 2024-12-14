<style scoped lang="scss">
@use '../assets/mixins' as *;

button.disclosure {
    background: none;
    border: none;
    font-size: 16px;
    @include dark-mode {
        color: $dark-mode-text;
    }
}
input,select {
    font-size: 14px;
    border-radius: 6px;
    border: 1px solid $light-mode-border;
    padding: 6px;
    @include dark-mode {
        color: $dark-mode-input-text;
        background: $dark-mode-input-background;
        border-color: $dark-mode-border;
    }
}
form {
    margin-top: 15px;
}

label.repeat-interval {
    display: block;
    margin-bottom: 10px;
    input {
        width: 40px;
    }
}
div.end-type {
    margin-top: 15px;
    label {
        display: block;
        margin-top: 5px;
    }
    input[type="number"] {
        width: 40px;
    }
}
div.week-parameters {
    label {
        display: block;
    }
}
div.month-parameters {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    margin-top: 10px;
    & > div {
        min-width: 150px;
        margin-bottom: 15px;
    }
    label {
        display: block;
        input {
            margin-right: 5px;
        }
    }
}
</style>

<template>
<div class="recurrence-rule">
    <div class="summary">
        <input type="datetime-local" v-model="props.schedule.startDate" />
    <label>
        <!--button class="disclosure" v-if="props.schedule.frequency.length > 0" type="button" @click="state.showRecurrence = !state.showRecurrence">{{ state.showRecurrence ? '▼' : '▶' }}</button-->
        {{ t('frequency-label') }}:
            <select v-model="props.schedule.frequency" @change="state.showRecurrence = props.schedule.frequency.length > 0 ? true : false">
            <option value="">{{ t('frequencyNone') }}</option>
            <option value="daily">{{  t('frequencyDaily') }}</option>
            <option value="weekly">{{ t('frequencyWeekly') }}</option>
            <option value="monthly">{{  t('frequencyMonthly') }}</option>
            <option value="yearly">{{  t('frequencyYearly') }}</option>
        </select>
        </label>
    </div>
    <form class="repeats" v-if="state.showRecurrence == true">
        <label class="repeat-interval" v-if="props.schedule.frequency">
            every <input type="number" v-model="props.schedule.interval" /> {{  props.schedule.frequency ? t( props.schedule.frequency + 'Term') : '' }}
        </label>

        <div class="week-parameters" v-if="props.schedule.frequency === 'weekly'">
            {{ t('on-weekday-label') }}:
            <label v-for="day in ['sun','mon','tue','wed','thu','fri','sat']">
            <input type="checkbox" v-model="state.weekdays[day]" /> {{ t(day) }}
            </label>
        </div>

        <div class="month-parameters" v-if="props.schedule.frequency == 'monthly'" >
            <div v-for="week in [1,2,3,4,5]">
                <label v-for="day in ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']">
                    <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes[week + day.toUpperCase()]" /> {{ t(week + 'ord') }} {{ t(day) }}
                </label>
            </div>
        </div>

        <div class="end-type" v-if="props.schedule.frequency">
            {{ t('endType-label') }}: 
            <label><input type="radio" value="none" v-model="state.endType" /> never</label>
            <label><input type="radio" value="after" v-model="state.endType" /> after <input type="number" v-model="props.schedule.count" /> occurrences</label>
            <label><input type="radio" value="on" v-model="state.endType" /> on <input type="date" v-model="props.schedule.endDate" /></label>
        </div>
    </form>
</div>
</template>

<script setup>
import { reactive } from 'vue';
import { CalendarEventSchedule } from '../../common/model/events';
import { useI18n } from 'vue-i18n';

const props = defineProps({
    schedule: CalendarEventSchedule,
});

const { t } = useI18n({
        messages: {
            en: {
                'dailyTerm': 'days',
                'weeklyTerm': 'weeks',
                'monthlyTerm': 'months',
                'yearlyTerm': 'years',

                '1ord': '1st',
                '2ord': '2nd',
                '3ord': '3rd',
                '4ord': '4th',
                '5ord': '5th',

                'sun': 'Sunday',
                'mon': 'Monday',
                'tue': 'Tuesday',
                'wed': 'Wednesday',
                'thu': 'Thursday',
                'fri': 'Friday',
                'sat': 'Saturday',

                'frequency-label': 'repeats',
                'frequencyNone': 'Never',
                'frequencyDaily': 'Daily',
                'frequencyWeekly': 'Weekly',
                'frequencyMonthly': 'Monthly',
                'frequencyYearly': 'Yearly',

                'on-weekday-label': 'on',
                'endType-label': 'ends',
            }

        }
    });

const state = reactive({
    showRecurrence: false,
    endType: 'none',
    weekdays: {
        sun: false,
        mon: false,
        tue: false,
        wed: false,
        thu: false,
        fri: false,
        sat: false
    },
    monthlyWeekdayCheckboxes: {
        '1SUN': false,
        '1MON': false,
        '1TUE': false,
        '1WED': false,
        '1THU': false,
        '1FRI': false,
        '1SAT': false,
        '2SUN': false,
        '2MON': false,
        '2TUE': false,
        '2WED': false,
        '2THU': false,
        '2FRI': false,
        '2SAT': false,
        '3SUN': false,
        '3MON': false,
        '3TUE': false,
        '3WED': false,
        '3THU': false,
        '3FRI': false,
        '3SAT': false,
        '4SUN': false,
        '4MON': false,
        '4TUE': false,
        '4WED': false,
        '4THU': false,
        '4FRI': false,
        '4SAT': false,
        '5SUN': false,
        '5MON': false,
        '5TUE': false,
        '5WED': false,
        '5THU': false,
        '5FRI': false,
        '5SAT': false
    },
    monthlyWeekdayCheckboxes: {
        sunday: false,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false
    }
});    
</script>
