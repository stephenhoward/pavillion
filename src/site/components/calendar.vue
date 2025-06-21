<script setup>
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CalendarService from '../service/calendar';
import { useEventInstanceStore } from '../stores/eventInstanceStore';
import NotFound from './notFound.vue';
import { DateTime } from 'luxon';
import EventImage from './EventImage.vue';

const { t } = useTranslation('system');
const route = useRoute();
const calendarId = route.params.calendar;
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  events: [],
  isLoading: false,
  dates: [],
});
const calendarService = new CalendarService();
const eventStore = useEventInstanceStore();

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }
    else {
      // Load events for this calendar
      state.events = await calendarService.loadCalendarEventsByDay(calendarId);
    }
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = 'Failed to load calendar data';
  }
  finally {
    state.isLoading = false;
  }
});

</script>

<template>
  <div v-if="state.notFound">
    <NotFound />
  </div>
  <div v-else>
    <header v-if="state.calendar">
      <!-- TODO: respect the user's language prefernces instead of using 'en' -->
      <h1>{{ state.calendar.content("en").name || state.calendar.urlName }}</h1>
    </header>
    <main>
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <div v-if="eventStore.instances && eventStore.instances.length > 0">
        <section class="day" v-for="day in Object.keys(state.events).sort()">
          <h2>{{ DateTime.fromISO(day).toLocaleString({weekday: 'long', month: 'long', day: 'numeric'}) }}</h2>
          <ul class="events">
            <li class="event" v-for="instance in state.events[day]">
              <EventImage :media="instance.event.media" :size="small" />
              <h3><router-link :to="{ name: 'instance', params: { event: instance.event.id, instance: instance.id } }">{{ instance.event.content("en").name }}</router-link></h3>
              <div>{{ instance.start.toLocaleString(DateTime.TIME_SIMPLE) }}</div>
            </li>
          </ul>
        </section>
      </div>
    </main>
  </div>
</template>

<style lang="scss">
@use '../../client/assets/mixins' as *;
h1 {
  font-size: 200%;
  font-weight: $font-light;
}
section.day {
  margin: 10px 0;
  h2 {
    font-size: 100%;
    margin: 0;
    padding: 0;
    font-weight: $font-medium;
  }
  ul.events {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: stretch;
    overflow-x: auto;
    padding: 20px 0px;
  li.event {
    list-style-type: none;
    padding: 10px;
    width: 150px;
    margin-right: 10px;
    box-shadow: rgba(0,0,0,0.2) 8px 8px 12px;
    background-color: rgba(0,0,0,0.1);
    display: flex;
    flex-direction: column;
    h3 {
      order: 1;
      font-size: 120%;
      margin-top: 10px;
      font-weight: $font-light;
      a {
        color: $light-mode-text;
        text-decoration: none;
        @include dark-mode {
          color: $dark-mode-text;
        }
      }
    }
  }
  }
}
</style>
