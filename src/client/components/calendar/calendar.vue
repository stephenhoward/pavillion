<script setup>
import { onBeforeMount, reactive, inject } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useEventStore } from '../../stores/eventStore';
import CalendarService from '../../service/calendar';
import EventService from '../../service/event';
import EventImage from '../media/EventImage.vue';

const { t } = useTranslation('calendars',{
  keyPrefix: 'calendar',
});
const site_config = inject('site_config');
const site_domain = site_config.settings().domain;
const eventService = new EventService();
const emit = defineEmits(['openEvent']);

const route = useRoute();
const router = useRouter();
const state = reactive({
  err: '',
  calendar: null,
  isLoading: false,
});
const calendarId = route.params.calendar;
const store = useEventStore();
const calendarService = new CalendarService();

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);

    // Load events for this calendar
    await eventService.loadCalendarEvents(calendarId);
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = 'Failed to load calendar data';
  }
  finally {
    state.isLoading = false;
  }
});

const newEvent = async () => {
  try {
    const event = eventService.initEvent(state.calendar);
    emit('openEvent', event);
  }
  catch (error) {
    console.error('Error checking calendars:', error);
  }
};
</script>

<template>
  <div v-if="state.err" class="error">{{ state.err }}</div>
  <div v-else>
    <h1>
      <span v-if="state.calendar">{{ state.calendar.urlName }}@{{ site_domain }}</span>
      <span v-else>{{ calendarId }}@{{ site_domain }}</span>
    </h1>
    <div v-if="store.events && store.events.length > 0">
      <ul class="event-list">
        <li v-for="event in store.events"
            :key="event.id"
            @click="$emit('openEvent', event.clone())"
            class="event-item">
          <EventImage :media="event.media" size="small" />
          <div class="event-content">
            <h3>{{ event.content("en").name }}</h3>
            <p v-if="event.content('en').description">{{ event.content("en").description }}</p>
          </div>
        </li>
      </ul>
    </div>
    <div v-else class="empty-screen">
      <h2>{{ t('noEvents') }}</h2>
      <p>{{ t('noEventsDescription') }}</p>
      <button type="button" class="primary" @click="newEvent()">
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

.event-list {
  list-style: none;
  padding: 0;
  margin: 20px;

  .event-item {
    display: flex;
    align-items: flex-start;
    gap: 15px;
    padding: 15px;
    margin-bottom: 15px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      border-color: #007bff;
      box-shadow: 0 2px 8px rgba(0, 123, 255, 0.1);
    }

    @include dark-mode {
      border-color: #444;

      &:hover {
        border-color: #007bff;
        box-shadow: 0 2px 8px rgba(0, 123, 255, 0.2);
      }
    }
  }

  .event-content {
    flex: 1;

    h3 {
      margin: 0 0 8px 0;
      font-size: 18px;
      color: #333;

      @include dark-mode {
        color: #fff;
      }
    }

    p {
      margin: 0;
      color: #666;
      font-size: 14px;
      line-height: 1.4;

      @include dark-mode {
        color: #ccc;
      }
    }
  }
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
