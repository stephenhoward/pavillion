<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { type FollowRelationship, AutoRepostPolicy } from '@/client/service/feed';

const { t } = useTranslation('feed', {
  keyPrefix: 'follows',
});

const props = defineProps<{
  follow: FollowRelationship;
}>();

const emit = defineEmits<{
  (e: 'policy-change', followId: string, policy: AutoRepostPolicy): void;
  (e: 'unfollow', followId: string): void;
}>();

const policyOptions = computed(() => [
  { value: AutoRepostPolicy.MANUAL, label: t('policy_manual') },
  { value: AutoRepostPolicy.ORIGINAL, label: t('policy_original') },
  { value: AutoRepostPolicy.ALL, label: t('policy_all') },
]);

const handlePolicyChange = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  const newPolicy = target.value as AutoRepostPolicy;
  emit('policy-change', props.follow.id, newPolicy);
};

const handleUnfollow = () => {
  emit('unfollow', props.follow.id);
};
</script>

<template>
  <div class="follow-list-item">
    <div class="follow-info">
      <div class="remote-identifier">
        {{ follow.remoteCalendarId }}
      </div>
    </div>

    <div class="follow-actions">
      <div class="policy-selector">
        <label :for="`policy-${follow.id}`" class="policy-label">
          {{ t('policy_label') }}
        </label>
        <select
          :id="`policy-${follow.id}`"
          :value="follow.repostPolicy"
          @change="handlePolicyChange"
          class="policy-dropdown"
        >
          <option
            v-for="option in policyOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
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
@use '@/client/assets/mixins' as *;

div.follow-list-item {
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

  @media (min-width: 768px) {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  div.follow-info {
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

  div.follow-actions {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;
    align-items: stretch;

    @media (min-width: 768px) {
      flex-direction: row;
      align-items: center;
      gap: $spacing-md;
    }

    div.policy-selector {
      display: flex;
      flex-direction: column;
      gap: $spacing-xs;

      @media (min-width: 768px) {
        flex-direction: row;
        align-items: center;
        gap: $spacing-sm;
      }

      label.policy-label {
        font-size: 0.875rem;
        font-weight: $font-medium;
        color: $light-mode-text;
        white-space: nowrap;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-text;
        }
      }

      select.policy-dropdown {
        padding: $spacing-sm $spacing-md;
        border-radius: $form-input-border-radius;
        border: 1px solid rgba(0, 0, 0, 0.2);
        background: white;
        color: $light-mode-text;
        font-size: 0.875rem;
        cursor: pointer;

        @media (prefers-color-scheme: dark) {
          background: $dark-mode-background;
          color: $dark-mode-text;
          border-color: rgba(255, 255, 255, 0.2);
        }

        &:focus {
          outline: 2px solid $light-mode-button-background;
          outline-offset: 2px;
        }
      }
    }

    button.unfollow-button {
      padding: $spacing-sm $spacing-md;
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: $form-input-border-radius;
      background: white;
      color: $light-mode-text;
      font-size: 0.875rem;
      font-weight: $font-medium;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.2s ease;

      @media (prefers-color-scheme: dark) {
        background: $dark-mode-background;
        color: $dark-mode-text;
        border-color: rgba(255, 255, 255, 0.2);
      }

      &:hover {
        background: rgba(0, 0, 0, 0.05);

        @media (prefers-color-scheme: dark) {
          background: rgba(255, 255, 255, 0.1);
        }
      }

      &:focus {
        outline: 2px solid $light-mode-button-background;
        outline-offset: 2px;
      }
    }
  }
}
</style>
