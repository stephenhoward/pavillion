<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useFeedStore } from '@/client/stores/feedStore';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import FollowListItem from './follow_list_item.vue';
import AddCalendarModal from './add_calendar_modal.vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'follows',
});

const feedStore = useFeedStore();
const showAddModal = ref(false);

const follows = computed(() => feedStore.follows);
const isLoading = computed(() => feedStore.isLoadingFollows);

const handlePolicyChange = async (followId: string, autoRepostOriginals: boolean, autoRepostReposts: boolean) => {
  try {
    await feedStore.updateFollowPolicy(followId, autoRepostOriginals, autoRepostReposts);
  }
  catch (error) {
    console.error('Error updating follow policy:', error);
  }
};

const handleUnfollow = async (followId: string) => {
  try {
    await feedStore.unfollowCalendar(followId);
  }
  catch (error) {
    console.error('Error unfollowing calendar:', error);
  }
};

const handleOpenAddModal = () => {
  showAddModal.value = true;
};

const handleCloseAddModal = () => {
  showAddModal.value = false;
};

const handleFollowSuccess = async () => {
  // Refresh follows list after successful follow
  try {
    await feedStore.loadFollows();
  }
  catch (error) {
    console.error('Error refreshing follows:', error);
  }
};
</script>

<template>
  <section v-if="isLoading" class="loading">
    {{ t('loading') }}
  </section>
  <section v-else-if="follows.length" class="follows-list">
    <div class="follows-header">
      <h2>{{ t('title') }}</h2>
      <button
        type="button"
        class="primary add-button"
        @click="handleOpenAddModal"
      >
        {{ t('follow_button') }}
      </button>
    </div>

    <div class="follows-items">
      <FollowListItem
        v-for="follow in follows"
        :key="follow.id"
        :follow="follow"
        @policy-change="handlePolicyChange"
        @unfollow="handleUnfollow"
      />
    </div>
  </section>
  <EmptyLayout
    v-else
    :title="t('no_follows')"
  >
    <button
      type="button"
      class="primary"
      @click="handleOpenAddModal"
    >
      {{ t('follow_button') }}
    </button>
  </EmptyLayout>

  <AddCalendarModal
    v-if="showAddModal"
    @close="handleCloseAddModal"
    @follow-success="handleFollowSuccess"
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

section.follows-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  padding: $spacing-lg;

  div.follows-header {
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

    button.add-button {
      padding: $spacing-sm $spacing-lg;
      background: $light-mode-button-background;
      color: white;
      border: none;
      border-radius: $form-input-border-radius;
      font-weight: $font-medium;
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover {
        background: darken($light-mode-button-background, 10%);
      }

      &:focus {
        outline: 2px solid $light-mode-button-background;
        outline-offset: 2px;
      }
    }
  }

  div.follows-items {
    display: flex;
    flex-direction: column;
    gap: $spacing-md;
  }
}
</style>
