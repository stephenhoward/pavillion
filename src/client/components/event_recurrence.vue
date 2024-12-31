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
        <input type="datetime-local" v-model="state.startDate" @input="compileRecurrence()"/>
    <label>
        <!--button class="disclosure" v-if="props.schedule.frequency.length > 0" type="button" @click="state.showRecurrence = !state.showRecurrence">{{ state.showRecurrence ? '▼' : '▶' }}</button-->
        {{ t('frequency-label') }}:
            <select v-model="props.schedule.frequency" @change="state.showRecurrence = props.schedule.frequency.length > 0 ? true : false; compileRecurrence()">
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
            every <input type="number" v-model="props.schedule.interval" @change="compileRecurrence()" /> {{  props.schedule.frequency ? t( props.schedule.frequency + 'Term') : '' }}
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
            <label><input type="radio" value="none" v-model="state.endType" @change="compileRecurrence()"/> never</label>
            <label><input type="radio" value="after" v-model="state.endType" @change="compileRecurrence()" /> after <input type="number" v-model="props.schedule.count" @change="state.endType='after'; compileRecurrence()" /> occurrences</label>
            <label><input type="radio" value="on" v-model="state.endType" @change="compileRecurrence()" /> on <input type="date" v-model="state.endDate" @input="state.endType='on'; compileRecurrence()" /></label>
        </div>
    </form>
</div>
</template>

<script setup>
import { reactive } from 'vue';
import { CalendarEventSchedule } from '../../common/model/events';
import { useI18n } from 'vue-i18n';
import { DateTime } from 'luxon';

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

                'SU': 'Sunday',
                'MO': 'Monday',
                'TU': 'Tuesday',
                'WE': 'Wednesday',
                'TH': 'Thursday',
                'FR': 'Friday',
                'SA': 'Saturday',

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
    startDate: props.schedule.startDate ? props.schedule.startDate.toISO() : '',
    endDate: props.schedule.endDate ? props.schedule.endDate.toISO() : '',
    endType: 'none',
    weekdays: {
        SU: false,
        MO: false,
        TU: false,
        WE: false,
        TH: false,
        FR: false,
        SA: false
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
        '5SA': false
    }
});

const compileRecurrence = () => {

    props.schedule.startDate = state.startDate ? DateTime.fromISO(state.startDate) : null;
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

}
</script>
