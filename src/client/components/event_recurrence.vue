<template>
<div class="recurrence-rule">
    <button class="open-recurrence" v-if="state.showRecurrence == false" type="button" @click="state.showRecurrence = true"><img src="../assets/repeat_event_icon.svg" alt="repeats"/></button>
    <input type="datetime-local" v-model="props.schedule.startDate" />
    <form class="repeats" v-if="state.showRecurrence == true">
        <button type="button" @click="state.showRecurrence = false">Close</button>
        <label>Repeats:
            <select v-model="props.schedule.frequency" @change="console.log(props.schedule.frequency)">
            <option value="">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
        </select>
        </label>
   
        <div v-if="props.schedule.frequency">
            every <input type="number" v-model="props.schedule.interval" />
        </div>

        <div v-if="props.schedule.frequency === 'weekly'">
            on:
            <input type="checkbox" v-model="state.weekdays.sunday" /> Sun
            <input type="checkbox" v-model="state.weekdays.monday" /> Mon
            <input type="checkbox" v-model="state.weekdays.tuesday" /> Tue
            <input type="checkbox" v-model="state.weekdays.wednesday" /> Wed
            <input type="checkbox" v-model="state.weekdays.thursday" /> Thu
            <input type="checkbox" v-model="state.weekdays.friday" /> Fri
            <input type="checkbox" v-model="state.weekdays.saturday" /> Sat
        </div>

        <div v-if="props.schedule.frequency === 'monthly'">
            <input type="radio" value="day" v-model="state.monthlyType" /> By Day
            <input type="radio" value="weekday" v-model="state.monthlyType" /> By Weekday
            <div v-if="state.monthlyType == 'weekday'">
                month weekdays:
                <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes.sunday" /> Sun
                <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes.monday" /> Mon
                <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes.tuesday" /> Tue
                <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes.wednesday" /> Wed
                <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes.thursday" /> Thu
                <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes.friday" /> Fri
                <input type="checkbox" v-model="state.monthlyWeekdayCheckboxes.saturday" /> Sat
            </div>
            <div v-if="state.monthlyType == 'day'">
                <input type="number" v-model="props.schedule.dayOfMonth" />
            </div>
        </div>

        <div v-if="props.schedule.frequency">
            Ends 
            <label><input type="radio" value="none" v-model="state.endType" /> Never</label>
            <label><input type="radio" value="after" v-model="state.endType" /> After <input type="number" v-model="props.schedule.count" /> occurrences</label>
            <label><input type="radio" value="on" v-model="state.endType" /> On <input type="date" v-model="props.schedule.endDate" /></label>
        </div>
    </form>
</div>
</template>

<script setup>
import { defineProps, reactive } from 'vue';
import { CalendarEventSchedule } from '../../common/model/events';

const props = defineProps({
    schedule: CalendarEventSchedule,
});

const state = reactive({
    showRecurrence: false,
    endType: 'none',
    monthlyType: 'day',
    weekdays: {
        sunday: false,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false
    },
    monthlyWeekdayCheckboxes: {
        sunday: false,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false
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

<style scoped lang="scss">
label {
    display: block;
}

button.open-recurrence {
    background: none;
    border: none;
    display: block;
    float: right;
    img {
        width: 16px;
    }
}
</style>