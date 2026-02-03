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
        {{ follower.calendarActorId }}
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
div.follower-list-item {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
  padding: var(--pav-space-4);
  background: var(--pav-color-surface-primary);
  border-radius: var(--pav-border-radius-pill);
  border: 1px solid rgba(0, 0, 0, 0.1);

  @media (prefers-color-scheme: dark) {
    border-color: rgba(255, 255, 255, 0.1);
  }

  div.follower-info {
    flex: 1;

    div.remote-identifier {
      font-size: 1rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }
}
</style>
