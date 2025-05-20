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
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  isLoading: false,
});
const calendarService = new CalendarService();
const eventStore = useEventStore();

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
      await calendarService.loadCalendarEvents(calendarId);
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
      <div v-if="eventStore.events && eventStore.events.length > 0">
        <ul>
          <li v-for="event in eventStore.events" :key="event.id">
            <router-link :to="{ name: 'event', params: { event: event.id } }">{{ event.content("en").name }}</router-link>
          </li>
        </ul>
      </div>
    </main>
  </div>
</template>

<style scoped lang="scss">
</style>
