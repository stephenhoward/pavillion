<script setup>
import { onBeforeMount, reactive } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { CalendarEvent } from '../../../common/model/events';
import ModelService from '../../service/models';
import { useEventStore } from '../../stores/eventStore';

const { t } = useTranslation('calendars',{
  keyPrefix: 'calendar',
});

const route = useRoute();
const state = reactive({ err: ''});
const calendarId = route.params.calendar;
const store = useEventStore();

onBeforeMount(async () => {
  let events = await ModelService.listModels('/api/v1/calendars/' + calendarId + '/events');
  store.events = events.map(event => CalendarEvent.fromObject(event));
});
</script>

<template>
  <div v-if="store.events && store.events.length > 0">
    <p>{{ t('title') }}</p>
    <ul v-for="event in store.events">
      <li @click="$emit('openEvent',event.clone())">{{ event.content("en").name }}</li>
    </ul>
  </div>
  <div v-else class="empty-screen">
    <h2>{{ t('noEvents') }}</h2>
    <p>{{ t('noEventsDescription') }}</p>
    <button type="button" class="primary" @click="$emit('createEvent')">
      {{ t('createEvent') }}
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.empty-screen {
  @include empty-screen;
}
</style>
