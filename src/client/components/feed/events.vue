<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'events'});
const events = ref([]);
</script>

<template>
  <div v-if="events.length" class="events">
    <h2>{{ t("title") }}</h2>
    {{ t("description") }}
    <ul>
      <li v-for="events in events" :key="events.id">
        {{ events.message }}
      </li>
    </ul>
  </div>
  <div v-else class="empty-screen">
    <h2>{{ t("no_events") }}</h2>
    <button type="button" class="primary" >{{  t("follow_button") }}</button>
  </div>
</template>

<style lang="scss">
@use '../../assets/layout.scss' as *;
</style>
