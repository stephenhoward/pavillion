<script setup>
import { onBeforeMount, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import { CalendarEvent } from '../../../common/model/events';
import ModelService from '../../service/models';
import { useEventStore } from '../../stores/eventStore';

const { t } = useTranslation('calendars',{
  keyPrefix: 'calendar'
});

const state = reactive({ err: ''});
const store = useEventStore();

onBeforeMount(async () => {
  let events = await ModelService.listModels('/api/v1/events');
  store.events = events.map(event => CalendarEvent.fromObject(event)); 
});
</script>

<template>
  <p>{{ t('title') }}</p>
  <ul v-for="event in store.events">
    <li @click="$emit('openEvent',event.clone())">{{ event.content("en").name }}</li>
  </ul>
</template>

<style scoped lang="scss">
</style>