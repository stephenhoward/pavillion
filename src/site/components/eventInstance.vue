<script setup>
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import { DateTime } from 'luxon';

import CalendarService from '../service/calendar';
import NotFound from './notFound.vue';

const { t } = useTranslation('system');
const route = useRoute();
const calendarId = route.params.calendar;
const eventId = route.params.event;
const instanceId = route.params.instance;
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  instance: null,
  isLoading: false,
});
const calendarService = new CalendarService();

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    state.instance = await calendarService.loadEventInstance(instanceId);
    console.log('Event instance:', state.instance);
    if (!state.instance) {
      state.notFound = true;
      return;
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
  <div v-else-if="state.instance">
    <header v-if="state.calendar">
      <!-- TODO: respect the user's language prefernces instead of using 'en' -->
      <p><router-link :to="{ name: 'calendar', params: { calendar: state.calendar.urlName } }">{{ state.calendar.content("en").name || state.calendar.urlName }}</router-link></p>
      <h1>{{ state.instance.event.content("en").name }}</h1>
      <time :datetime="state.instance.start.toISO()">{{ state.instance.start.toLocaleString(DateTime.DATETIME_MED) }}</time>
    </header>
    <main>
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <p>{{ state.instance.event.content("en").description }}</p>
    </main>
  </div>
</template>

<style scoped lang="scss">
</style>
