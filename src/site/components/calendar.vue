<script setup>
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CalendarService from '../../client/service/calendar';
import EventService from '../../client/service/event';
import { useEventStore } from '../../client/stores/eventStore';

const { t } = useTranslation('system');
const route = useRoute();
const calendarId = route.params.calendar;
const state = reactive({
  err: '',
  calendar: null,
  isLoading: false,
});
const calendarService = new CalendarService();
const eventService = new EventService();
const store = useEventStore();

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);
    console.log('Calendar:', state.calendar);

    if (!state.calendar) {
      state.err = t('calendar.notFound', { calendarId });
      return;
    }
    else {
      // Load events for this calendar
      await eventService.loadCalendarEvents(calendarId);
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
</template>

<style scoped lang="scss">
</style>
