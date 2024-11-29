<script setup>
import { onBeforeMount, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarEvent } from '../../common/model/events';
import ModelService from '../service/models';

const { t } = useI18n({
    messages: {
        en: {
            'create_button': 'Create Event',
            'update_button': 'Update Event',
            name_placeholder: 'event name',
            description_placeholder: 'event description',
        }

    }
});

const state = reactive({ err: '', events: []});

onBeforeMount(async () => {
    state.events = await ModelService.listModels('/api/v1/events');
});
</script>

<template>
  <p>Calendar</p>
  <ul v-for="event in state.events">
    <li>{{ event.name }}</li>
  </ul>
</template>

<style scoped lang="scss">
</style>