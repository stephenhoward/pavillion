<script setup lang="ts">
import type { FollowerRelationship } from '@/client/service/feed';

defineProps<{
  follower: FollowerRelationship;
}>();
</script>

<template>
  <div class="follower-list-item">
    <div class="follower-info">
      <div class="remote-identifier">
        {{ follower.remoteCalendarId }}
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

div.follower-list-item {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
  padding: $spacing-lg;
  background: $light-mode-background;
  border-radius: $form-input-border-radius;
  border: 1px solid rgba(0, 0, 0, 0.1);

  @media (prefers-color-scheme: dark) {
    background: $dark-mode-button-background;
    border-color: rgba(255, 255, 255, 0.1);
  }

  div.follower-info {
    flex: 1;

    div.remote-identifier {
      font-size: 1rem;
      font-weight: $font-medium;
      color: $light-mode-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
    }
  }
}
</style>
