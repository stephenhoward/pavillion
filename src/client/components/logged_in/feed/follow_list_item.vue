<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { type FollowRelationship } from '@/client/service/feed';
import ToggleSwitch from '@/client/components/common/toggle_switch.vue';

const { t } = useTranslation('feed', {
  keyPrefix: 'follows',
});

const props = defineProps<{
  follow: FollowRelationship;
}>();

const emit = defineEmits<{
  (e: 'policy-change', followId: string, autoRepostOriginals: boolean, autoRepostReposts: boolean): void;
  (e: 'unfollow', followId: string): void;
}>();

const handleOriginalsToggle = (value: boolean) => {
  // If turning off originals, also turn off reposts
  const newReposts = value ? props.follow.autoRepostReposts : false;
  emit('policy-change', props.follow.id, value, newReposts);
};

const handleRepostsToggle = (value: boolean) => {
  emit('policy-change', props.follow.id, props.follow.autoRepostOriginals, value);
};

const handleUnfollow = () => {
  emit('unfollow', props.follow.id);
};
</script>

<template>
  <div class="follow-list-item">
    <div class="follow-info">
      <div class="remote-identifier">
        {{ follow.calendarActorId }}
      </div>
    </div>

    <div class="follow-actions">
      <div class="policy-toggles">
        <ToggleSwitch
          :id="`auto-repost-originals-${follow.id}`"
          :model-value="follow.autoRepostOriginals"
          :label="t('auto_repost_originals')"
          :help-text="t('auto_repost_originals_help')"
          @update:model-value="handleOriginalsToggle"
        />

        <ToggleSwitch
          v-if="follow.autoRepostOriginals"
          :id="`auto-repost-reposts-${follow.id}`"
          :model-value="follow.autoRepostReposts"
          :label="t('auto_repost_reposts')"
          :help-text="t('auto_repost_reposts_help')"
          @update:model-value="handleRepostsToggle"
        />
      </div>

      <button
        type="button"
        class="unfollow-button"
        @click="handleUnfollow"
      >
        {{ t('unfollow_button') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
div.follow-list-item {
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

  @media (min-width: 768px) {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
  }

  div.follow-info {
    flex: 1;

    div.remote-identifier {
      font-size: 1rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }
  }

  div.follow-actions {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
    align-items: stretch;

    @media (min-width: 768px) {
      flex-direction: column;
      align-items: flex-end;
      gap: var(--pav-space-3);
    }

    div.policy-toggles {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-3);
      min-width: 240px;
    }

    button.unfollow-button {
      padding: var(--pav-space-2) var(--pav-space-3);
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: var(--pav-border-radius-pill);
      background: white;
      color: var(--pav-color-text-primary);
      font-size: 0.875rem;
      font-weight: var(--pav-font-weight-medium);
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.2s ease;
      align-self: flex-start;

      @media (min-width: 768px) {
        align-self: flex-end;
      }

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-surface-primary);
        border-color: rgba(255, 255, 255, 0.2);
      }

      &:hover {
        background: rgba(0, 0, 0, 0.05);

        @media (prefers-color-scheme: dark) {
          background: rgba(255, 255, 255, 0.1);
        }
      }

      &:focus {
        outline: 2px solid var(--pav-color-interactive-primary);
        outline-offset: 2px;
      }
    }
  }
}
</style>
