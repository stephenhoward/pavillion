<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';
import { useFeedStore } from '@/client/stores/feedStore';
import FeedService, { type RemoteCalendarPreview, AutoRepostPolicy } from '@/client/service/feed';

const { t } = useTranslation('feed', {
  keyPrefix: 'add_calendar_modal',
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'follow-success'): void;
}>();

const feedStore = useFeedStore();
const identifier = ref('');
const selectedPolicy = ref<AutoRepostPolicy>(AutoRepostPolicy.MANUAL);
const preview = ref<RemoteCalendarPreview | null>(null);
const isLookingUp = ref(false);
const lookupError = ref('');
const isFollowing = ref(false);

const policyOptions = computed(() => [
  { value: AutoRepostPolicy.MANUAL, label: t('policy_manual') },
  { value: AutoRepostPolicy.ORIGINAL, label: t('policy_original') },
  { value: AutoRepostPolicy.ALL, label: t('policy_all') },
]);

const isValidIdentifier = computed(() => {
  return identifier.value.includes('@') && identifier.value.split('@').length === 2;
});

const canLookup = computed(() => {
  return isValidIdentifier.value && !isLookingUp.value;
});

const canFollow = computed(() => {
  return preview.value !== null && !isFollowing.value;
});

let lookupTimeout: ReturnType<typeof setTimeout> | null = null;

const handleIdentifierInput = () => {
  // Clear previous lookup results
  preview.value = null;
  lookupError.value = '';

  // Debounce lookup
  if (lookupTimeout) {
    clearTimeout(lookupTimeout);
  }

  if (isValidIdentifier.value) {
    lookupTimeout = setTimeout(() => {
      lookupRemoteCalendar();
    }, 500);
  }
};

const lookupRemoteCalendar = async () => {
  if (!isValidIdentifier.value) {
    return;
  }

  isLookingUp.value = true;
  lookupError.value = '';
  preview.value = null;

  try {
    const feedService = new FeedService();
    const result = await feedService.lookupRemoteCalendar(identifier.value);

    // Check for self-follow (local calendar matching selected calendar)
    if (result.calendarId && result.calendarId === feedStore.selectedCalendarId) {
      lookupError.value = t('self_follow_error');
      return;
    }

    preview.value = result;
  }
  catch (error: any) {
    console.error('Error looking up remote calendar:', error);
    // Show specific error message from backend, or fallback to generic message
    lookupError.value = error.message || t('lookup_error');
  }
  finally {
    isLookingUp.value = false;
  }
};

const handleFollow = async () => {
  if (!canFollow.value) {
    return;
  }

  isFollowing.value = true;

  try {
    await feedStore.followCalendar(identifier.value, selectedPolicy.value);
    emit('follow-success');
    handleClose();
  }
  catch (error) {
    console.error('Error following calendar:', error);
    lookupError.value = t('follow_error');
  }
  finally {
    isFollowing.value = false;
  }
};

const handleClose = () => {
  // Reset form
  identifier.value = '';
  selectedPolicy.value = AutoRepostPolicy.MANUAL;
  preview.value = null;
  lookupError.value = '';
  isLookingUp.value = false;
  isFollowing.value = false;

  if (lookupTimeout) {
    clearTimeout(lookupTimeout);
    lookupTimeout = null;
  }

  emit('close');
};
</script>

<template>
  <Modal
    :title="t('title')"
    @close="handleClose"
  >
    <div class="add-calendar-modal">
      <div class="form-group">
        <label for="calendar-identifier">
          {{ t('identifier_label') }}
        </label>
        <input
          id="calendar-identifier"
          v-model="identifier"
          type="text"
          :placeholder="t('identifier_placeholder')"
          @input="handleIdentifierInput"
          class="identifier-input"
        />
        <p class="help-text">
          {{ t('identifier_help') }}
        </p>
      </div>

      <div v-if="isLookingUp" class="loading-state">
        {{ t('looking_up') }}
      </div>

      <div v-if="lookupError" class="error-state">
        {{ lookupError }}
      </div>

      <div v-if="preview" class="preview-section">
        <h3>{{ t('preview_title') }}</h3>
        <div class="preview-content">
          <div class="preview-item">
            <strong>{{ t('preview_name') }}:</strong> {{ preview.name }}
          </div>
          <div v-if="preview.description" class="preview-item">
            <strong>{{ t('preview_description') }}:</strong> {{ preview.description }}
          </div>
          <div class="preview-item">
            <strong>{{ t('preview_domain') }}:</strong> {{ preview.domain }}
          </div>
        </div>

        <div class="form-group">
          <label for="repost-policy">
            {{ t('policy_label') }}
          </label>
          <select
            id="repost-policy"
            v-model="selectedPolicy"
            class="policy-select"
          >
            <option
              v-for="option in policyOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <p class="help-text">
            {{ t('policy_help') }}
          </p>
        </div>
      </div>

      <div class="modal-actions">
        <button
          type="button"
          class="secondary"
          @click="handleClose"
        >
          {{ t('cancel_button') }}
        </button>
        <button
          type="button"
          class="primary"
          :disabled="!canFollow"
          @click="handleFollow"
        >
          {{ isFollowing ? t('following_button') : t('follow_button') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

div.add-calendar-modal {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  min-width: 300px;

  @media (min-width: 768px) {
    min-width: 500px;
  }

  div.form-group {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;

    label {
      font-weight: $font-medium;
      color: $light-mode-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
    }

    input.identifier-input,
    select.policy-select {
      padding: $spacing-md;
      border-radius: $form-input-border-radius;
      border: 1px solid rgba(0, 0, 0, 0.2);
      background: white;
      color: $light-mode-text;
      font-size: 1rem;

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

    p.help-text {
      font-size: 0.875rem;
      color: rgba(0, 0, 0, 0.6);
      margin: 0;

      @media (prefers-color-scheme: dark) {
        color: rgba(255, 255, 255, 0.6);
      }
    }
  }

  div.loading-state {
    padding: $spacing-md;
    text-align: center;
    color: $light-mode-text;
    font-style: italic;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  div.error-state {
    padding: $spacing-md;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: $form-input-border-radius;
    color: rgb(239, 68, 68);
  }

  div.preview-section {
    padding: $spacing-lg;
    background: rgba(0, 0, 0, 0.05);
    border-radius: $form-input-border-radius;

    @media (prefers-color-scheme: dark) {
      background: rgba(255, 255, 255, 0.05);
    }

    h3 {
      margin: 0 0 $spacing-md 0;
      font-size: 1.125rem;
      font-weight: $font-medium;
      color: $light-mode-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
    }

    div.preview-content {
      display: flex;
      flex-direction: column;
      gap: $spacing-sm;
      margin-bottom: $spacing-lg;

      div.preview-item {
        font-size: 0.875rem;
        color: $light-mode-text;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-text;
        }

        strong {
          font-weight: $font-medium;
        }
      }
    }
  }

  div.modal-actions {
    display: flex;
    gap: $spacing-md;
    justify-content: flex-end;
    margin-top: $spacing-md;

    button {
      padding: $spacing-sm $spacing-lg;
      border-radius: $form-input-border-radius;
      font-weight: $font-medium;
      cursor: pointer;
      transition: all 0.2s ease;

      &.secondary {
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.2);
        color: $light-mode-text;

        @media (prefers-color-scheme: dark) {
          border-color: rgba(255, 255, 255, 0.2);
          color: $dark-mode-text;
        }

        &:hover {
          background: rgba(0, 0, 0, 0.05);

          @media (prefers-color-scheme: dark) {
            background: rgba(255, 255, 255, 0.05);
          }
        }
      }

      &.primary {
        background: $light-mode-button-background;
        border: none;
        color: white;

        &:hover:not(:disabled) {
          background: darken($light-mode-button-background, 10%);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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
