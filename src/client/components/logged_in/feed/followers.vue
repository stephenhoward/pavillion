<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'followers',
});
const followers = ref([]);
</script>

<template>
  <section v-if="followers.length" class="events">
    <h2>{{ t("title") }}</h2>
    <ul>
      <li v-for="follower in followers" :key="follower.id">
        {{ follower.message }}
      </li>
    </ul>
  </section>
  <EmptyLayout v-else :title="t('no_followers')" />
</template>
