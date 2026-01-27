<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';
import ToggleSwitch from '@/client/components/common/toggle_switch.vue';
import { useFeedStore } from '@/client/stores/feedStore';
import FeedService, { type RemoteCalendarPreview } from '@/client/service/feed';
import {
  InvalidRemoteCalendarIdentifierError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
} from '@/common/exceptions/activitypub';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

const { t } = useTranslation('feed');

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'follow-success'): void;
}>();

const feedStore = useFeedStore();
const identifier = ref('');
const autoRepostOriginals = ref(false);
const autoRepostReposts = ref(false);
const preview = ref<RemoteCalendarPreview | null>(null);
const isLookingUp = ref(false);
const lookupError = ref('');
const isFollowing = ref(false);

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
      lookupError.value = t('add_calendar_modal.self_follow_error');
      return;
    }

    preview.value = result;
  }
  catch (error: any) {
    console.error('Error looking up remote calendar:', error);
    // Map exception types to translated error messages
    switch (error.constructor) {
      case InvalidRemoteCalendarIdentifierError:
        lookupError.value = t('errors.InvalidRemoteCalendarIdentifierError');
        break;
      case RemoteCalendarNotFoundError:
        lookupError.value = t('errors.RemoteCalendarNotFoundError');
        break;
      case RemoteDomainUnreachableError:
        lookupError.value = t('errors.RemoteDomainUnreachableError');
        break;
      case ActivityPubNotSupportedError:
        lookupError.value = t('errors.ActivityPubNotSupportedError');
        break;
      case RemoteProfileFetchError:
        lookupError.value = t('errors.RemoteProfileFetchError');
        break;
      default:
        lookupError.value = t('add_calendar_modal.lookup_error');
    }
  }
  finally {
    isLookingUp.value = false;
  }
};

const handleOriginalsToggle = (value: boolean) => {
  autoRepostOriginals.value = value;
  // If turning off originals, also turn off reposts
  if (!value) {
    autoRepostReposts.value = false;
  }
};

const handleRepostsToggle = (value: boolean) => {
  autoRepostReposts.value = value;
};

const handleFollow = async () => {
  if (!canFollow.value) {
    return;
  }

  isFollowing.value = true;

  try {
    await feedStore.followCalendar(identifier.value, autoRepostOriginals.value, autoRepostReposts.value);
    emit('follow-success');
    handleClose();
  }
  catch (error: any) {
    console.error('Error following calendar:', error);
    // Map exception types to translated error messages
    switch (error.constructor) {
      case InvalidRemoteCalendarIdentifierError:
        lookupError.value = t('errors.InvalidRemoteCalendarIdentifierError');
        break;
      case InsufficientCalendarPermissionsError:
        lookupError.value = t('errors.InsufficientCalendarPermissionsError');
        break;
      case SelfFollowError:
        lookupError.value = t('errors.SelfFollowError');
        break;
      default:
        lookupError.value = t('add_calendar_modal.follow_error');
    }
  }
  finally {
    isFollowing.value = false;
  }
};

const handleClose = () => {
  // Reset form
  identifier.value = '';
  autoRepostOriginals.value = false;
  autoRepostReposts.value = false;
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
    :title="t('add_calendar_modal.title')"
    @close="handleClose"
  >
    <div class="add-calendar-modal">
      <div class="form-group">
        <label for="calendar-identifier">
          {{ t('add_calendar_modal.identifier_label') }}
        </label>
        <input
          id="calendar-identifier"
          v-model="identifier"
          type="text"
          :placeholder="t('add_calendar_modal.identifier_placeholder')"
          @input="handleIdentifierInput"
          class="identifier-input"
        />
        <p class="help-text">
          {{ t('add_calendar_modal.identifier_help') }}
        </p>
      </div>

      <div v-if="isLookingUp" class="loading-state">
        {{ t('add_calendar_modal.looking_up') }}
      </div>

      <div v-if="lookupError" class="error-state">
        {{ lookupError }}
      </div>

      <div v-if="preview" class="preview-section">
        <h3>{{ t('add_calendar_modal.preview_title') }}</h3>
        <div class="preview-content">
          <div class="preview-item">
            <strong>{{ t('add_calendar_modal.preview_name') }}:</strong> {{ preview.name }}
          </div>
          <div v-if="preview.description" class="preview-item">
            <strong>{{ t('add_calendar_modal.preview_description') }}:</strong> {{ preview.description }}
          </div>
          <div class="preview-item">
            <strong>{{ t('add_calendar_modal.preview_domain') }}:</strong> {{ preview.domain }}
          </div>
        </div>

        <div class="policy-section">
          <h4>{{ t('add_calendar_modal.policy_title') }}</h4>
          <p class="policy-description">{{ t('add_calendar_modal.policy_description') }}</p>

          <div class="policy-toggles">
            <ToggleSwitch
              id="auto-repost-originals"
              :model-value="autoRepostOriginals"
              :label="t('add_calendar_modal.auto_repost_originals')"
              :help-text="t('add_calendar_modal.auto_repost_originals_help')"
              @update:model-value="handleOriginalsToggle"
            />

            <ToggleSwitch
              v-if="autoRepostOriginals"
              id="auto-repost-reposts"
              :model-value="autoRepostReposts"
              :label="t('add_calendar_modal.auto_repost_reposts')"
              :help-text="t('add_calendar_modal.auto_repost_reposts_help')"
              @update:model-value="handleRepostsToggle"
            />
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button
          type="button"
          class="secondary"
          @click="handleClose"
        >
          {{ t('add_calendar_modal.cancel_button') }}
        </button>
        <button
          type="button"
          class="primary"
          :disabled="!canFollow"
          @click="handleFollow"
        >
          {{ isFollowing ? t('add_calendar_modal.following_button') : t('add_calendar_modal.follow_button') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped lang="scss">
div.add-calendar-modal {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  min-width: 300px;

  @media (min-width: 768px) {
    min-width: 500px;
  }

  div.form-group {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-2);

    label {
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    input.identifier-input {
      padding: var(--pav-space-3);
      border-radius: var(--pav-border-radius-pill);
      border: 1px solid rgba(0, 0, 0, 0.2);
      background: white;
      color: var(--pav-color-text-primary);
      font-size: 1rem;

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-surface-primary);
        border-color: rgba(255, 255, 255, 0.2);
      }

      &:focus {
        outline: 2px solid var(--pav-color-interactive-primary);
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
    padding: var(--pav-space-3);
    text-align: center;
    color: var(--pav-color-text-primary);
    font-style: italic;
  }

  div.error-state {
    padding: var(--pav-space-3);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--pav-border-radius-pill);
    color: rgb(239, 68, 68);
  }

  div.preview-section {
    padding: var(--pav-space-4);
    background: rgba(0, 0, 0, 0.05);
    border-radius: var(--pav-border-radius-pill);

    @media (prefers-color-scheme: dark) {
      background: rgba(255, 255, 255, 0.05);
    }

    h3 {
      margin: 0 0 var(--pav-space-3) 0;
      font-size: 1.125rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
    }

    div.preview-content {
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-2);
      margin-bottom: var(--pav-space-4);

      div.preview-item {
        font-size: 0.875rem;
        color: var(--pav-color-text-primary);

        strong {
          font-weight: var(--pav-font-weight-medium);
        }
      }
    }

    div.policy-section {
      border-top: 1px solid rgba(0, 0, 0, 0.1);
      padding-top: var(--pav-space-4);

      @media (prefers-color-scheme: dark) {
        border-color: rgba(255, 255, 255, 0.1);
      }

      h4 {
        margin: 0 0 var(--pav-space-2) 0;
        font-size: 1rem;
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }

      p.policy-description {
        font-size: 0.875rem;
        color: rgba(0, 0, 0, 0.6);
        margin: 0 0 var(--pav-space-3) 0;

        @media (prefers-color-scheme: dark) {
          color: rgba(255, 255, 255, 0.6);
        }
      }

      div.policy-toggles {
        display: flex;
        flex-direction: column;
        gap: var(--pav-space-3);
      }
    }
  }

  div.modal-actions {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
    margin-top: var(--pav-space-3);

    button {
      padding: var(--pav-space-2) var(--pav-space-4);
      border-radius: var(--pav-border-radius-pill);
      font-weight: var(--pav-font-weight-medium);
      cursor: pointer;
      transition: all 0.2s ease;

      &.secondary {
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.2);
        color: var(--pav-color-text-primary);

        @media (prefers-color-scheme: dark) {
          border-color: rgba(255, 255, 255, 0.2);
        }

        &:hover {
          background: rgba(0, 0, 0, 0.05);

          @media (prefers-color-scheme: dark) {
            background: rgba(255, 255, 255, 0.05);
          }
        }
      }

      &.primary {
        background: var(--pav-color-interactive-primary);
        border: none;
        color: white;

        &:hover:not(:disabled) {
          background: var(--pav-color-interactive-primary-hover);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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
