<script setup>
import { useTranslation } from 'i18next-vue';
import { ref } from 'vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'follows',
});
const follows = ref([]);
</script>

<template>
  <section v-if="follows.length" class="events">
    <h2>{{ t("title") }}</h2>
    {{ t("description") }}
    <ul>
      <li v-for="follow in follows" :key="follow.id">
        {{ follow.message }}
      </li>
    </ul>
  </section>
  <EmptyLayout v-else :title="t('no_follows')" >
    <button type="button" class="primary" >{{  t("follow_button") }}</button>
  </EmptyLayout>
</template>
