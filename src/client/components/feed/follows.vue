<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'follows',
});
const follows = ref([]);
</script>

<template>
  <div v-if="follows.length" class="events">
    <h2>{{ t("title") }}</h2>
    {{ t("description") }}
    <ul>
      <li v-for="follow in follows" :key="follow.id">
        {{ follow.message }}
      </li>
    </ul>
  </div>
  <div v-else class="empty-screen">
    <h2>{{ t("no_follows") }}</h2>
    <button type="button" class="primary" >{{  t("follow_button") }}</button>
  </div>
</template>

<style lang="scss">
@use '../../assets/layout.scss' as *;
</style>
