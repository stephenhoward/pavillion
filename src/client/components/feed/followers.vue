<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'followers',
});
const followers = ref([]);
</script>

<template>
  <div v-if="followers.length" class="events">
    <h2>{{ t("title") }}</h2>
    <ul>
      <li v-for="follower in followers" :key="follower.id">
        {{ follower.message }}
      </li>
    </ul>
  </div>
  <div v-else class="empty-screen">
    <h2>{{ t("no_followers") }}</h2>
  </div>
</template>

<style lang="scss">
@use '../../assets/layout.scss' as *;
</style>
