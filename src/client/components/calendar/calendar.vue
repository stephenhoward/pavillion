<script setup>
import { onBeforeMount, reactive, inject } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useEventStore } from '../../stores/eventStore';
import CalendarService from '../../service/calendar';
import EventService from '../../service/event';

const { t } = useTranslation('calendars',{
  keyPrefix: 'calendar',
});
const site_config = inject('site_config');
const site_domain = site_config.settings().domain;

const route = useRoute();
const state = reactive({
  err: '',
  calendar: null,
  isLoading: false,
});
const calendarId = route.params.calendar;
const store = useEventStore();

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await CalendarService.getCalendarByUrlName(calendarId);

    // Load events for this calendar
    await EventService.loadCalendarEvents(calendarId);
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
  <div v-if="state.err" class="error">{{ state.err }}</div>
  <div v-else>
    <h1>
      <span v-if="state.calendar">{{ state.calendar.urlName }}@{{ site_domain }}</span>
      <span v-else>{{ calendarId }}@{{ site_domain }}</span>
    </h1>
    <div v-if="store.events && store.events.length > 0">
      <ul>
        <li v-for="event in store.events" :key="event.id" @click="$emit('openEvent', event.clone())">
          {{ event.content("en").name }}
        </li>
      </ul>
    </div>
    <div v-else class="empty-screen">
      <h2>{{ t('noEvents') }}</h2>
      <p>{{ t('noEventsDescription') }}</p>
      <button type="button" class="primary" @click="$emit('createEvent')">
        {{ t('createEvent') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

h1 {
  font-size: 16pt;
  font-weight: 200;
  margin: 20px;
}
.empty-screen {
  @include empty-screen;
}
.error {
  color: red;
  padding: 20px;
  text-align: center;
}
</style>
