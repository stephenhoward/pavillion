<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const { t } = useTranslation('inbox');
const notifications = ref([]);
</script>

<template>
  <section v-if="notifications.length" class="inbox">
    <h2>{{ t("title") }}</h2>
    <ul>
      <li v-for="notification in notifications" :key="notification.id">
        {{ notification.message }}
      </li>
    </ul>
  </section>
  <EmptyLayout v-else :title="t('noNotifications')" :description="t('description')" />
</template>
