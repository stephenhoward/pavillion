<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';

const { t } = useTranslation('inbox');
const notifications = ref([]);
</script>

<template>
  <div v-if="notifications.length" class="inbox">
    <h2>{{ t("title") }}</h2>
    <ul>
      <li v-for="notification in notifications" :key="notification.id">
        {{ notification.message }}
      </li>
    </ul>
  </div>
  <div v-else class="empty-screen">
    <h2>{{ t("noNotifications") }}</h2>
    <p>{{ t("description") }}</p>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/layout.scss' as *;
</style>
