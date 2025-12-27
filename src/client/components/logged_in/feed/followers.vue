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
@use '@/client/assets/mixins' as *;

section.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  color: $light-mode-text;
  font-style: italic;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-text;
  }
}

section.followers-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  padding: $spacing-lg;

  div.followers-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: $spacing-md;

    h2 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: $font-medium;
      color: $light-mode-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
    }
  }

  div.followers-items {
    display: flex;
    flex-direction: column;
    gap: $spacing-md;
  }
}
</style>
