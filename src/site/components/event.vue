<script setup>
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CalendarService from '../service/calendar';
import { useEventStore } from '../../client/stores/eventStore';
import NotFound from './notFound.vue';

const { t } = useTranslation('system');
const route = useRoute();
const calendarId = route.params.calendar;
const eventId = route.params.event;
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  event: null,
  isLoading: false,
});
const calendarService = new CalendarService();
const store = useEventStore();

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);
    console.log('Calendar:', state.calendar);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }
    else {
      // Load events for this calendar
      state.event = await calendarService.loadEvent(eventId);
      console.log('Event:', state.event);
      if (!state.event) {
        state.notFound = true;
        return;
      }
    }
  }
  catch (error) {
    console.error('Error loading event data:', error);
    state.err = 'Failed to load event data';
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
      <div v-if="store.events && store.events.length > 0">
        <ul>
          <li v-for="event in store.events" :key="event.id">
            {{ event.content("en").name }}
          </li>
        </ul>
      </div>
    </main>
  </div>
</template>

<style scoped lang="scss">
</style>
