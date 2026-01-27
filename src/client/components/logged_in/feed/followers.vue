<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useFeedStore } from '@/client/stores/feedStore';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import FollowerListItem from './follower_list_item.vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'followers',
});

const feedStore = useFeedStore();

const followers = computed(() => feedStore.followers);
const isLoading = computed(() => feedStore.isLoadingFollowers);
</script>

<template>
  <section v-if="isLoading" class="loading">
    {{ t('loading') }}
  </section>
  <section v-else-if="followers.length" class="followers-list">
    <div class="followers-header">
      <h2>{{ t('title') }}</h2>
    </div>

    <div class="followers-items">
      <FollowerListItem
        v-for="follower in followers"
        :key="follower.id"
        :follower="follower"
      />
    </div>
  </section>
  <EmptyLayout
    v-else
    :title="t('no_followers')"
  />
</template>

<style scoped lang="scss">
section.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  color: var(--pav-color-text-primary);
  font-style: italic;
}

section.followers-list {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  padding: var(--pav-space-4);

  div.followers-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pav-space-3);

    h2 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }

  div.followers-items {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
  }
}
</style>
