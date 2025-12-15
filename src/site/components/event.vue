<script setup>
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CalendarService from '../service/calendar';
import { useEventStore } from '../../client/stores/eventStore';
import NotFound from './notFound.vue';
import EventImage from './EventImage.vue';

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

    if (!state.calendar) {
      state.notFound = true;
      return;
    }
    else {
      // Load events for this calendar
      state.event = await calendarService.loadEvent(eventId);
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
  <div v-else-if="state.event">
    <header v-if="state.calendar">
      <!-- TODO: respect the user's language prefernces instead of using 'en' -->
      <p><router-link :to="{ name: 'calendar', params: { calendar: state.calendar.urlName } }">{{ state.calendar.content("en").name || state.calendar.urlName }}</router-link></p>
      <EventImage :media="state.event.media" :size="medium" />
      <h1>{{ state.event.content("en").name }}</h1>
    </header>
    <main>
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <EventImage :media="state.event.media" size="large" />
      <p>{{ state.event.content("en").description }}</p>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.event-category-badge {
  @include public-category-badge;
}
</style>
