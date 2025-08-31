<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'events'});
const events = ref([]);
</script>

<template>
  <section v-if="events.length" class="events">
    <h2>{{ t("title") }}</h2>
    {{ t("description") }}
    <ul>
      <li v-for="events in events" :key="events.id">
        {{ events.message }}
      </li>
    </ul>
  </section>
  <EmptyLayout v-else :title="t('no_events')" >
    <button type="button" class="primary" >{{  t("follow_button") }}</button>
  </EmptyLayout>
</template>
