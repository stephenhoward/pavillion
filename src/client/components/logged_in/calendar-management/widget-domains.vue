<template>
  <div class="widget-domains">
    <!-- Error Display -->
    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>

    <!-- Success Display -->
    <div v-if="state.success" class="success">
      {{ state.success }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Domains List -->
    <div v-else class="domains-content">
      <!-- Current Domain Display -->
      <div v-if="state.currentDomain" class="current-domain-section">
        <h3>{{ t('current_domain_title') }}</h3>
        <div class="current-domain-item">
          <div class="domain-info">
            <span class="domain-name">{{ state.currentDomain }}</span>
          </div>
          <button
            class="change-domain-btn"
            :disabled="state.removingId !== null"
            @click="removeDomain"
          >
            {{ state.removingId !== null ? t('removing') : t('change_button') }}
          </button>
        </div>
      </div>

      <!-- Add Domain Form (only shown when no domain exists) -->
      <div v-else class="add-domain-section">
        <label for="newDomain">{{ t('add_domain_label') }}</label>
        <p class="help-text">{{ t('add_domain_help') }}</p>
        <div class="add-domain-form">
          <input
            id="newDomain"
            v-model="state.newDomain"
            type="text"
            placeholder="example.com"
            :disabled="state.isAdding"
            @keyup.enter="addDomain"
          />
          <button
            class="add-domain-btn"
            :disabled="state.isAdding || !state.newDomain.trim()"
            @click="addDomain"
          >
            {{ state.isAdding ? t('adding') : t('add_button') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import { validateAndEncodeId } from '@/client/service/utils';

// Props
const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
});

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'widget.domains',
});

// Component state
const state = reactive({
  isLoading: false,
  isAdding: false,
  removingId: null,
  error: '',
  success: '',
  newDomain: '',
  currentDomain: null, // Changed from domains array to single domain
});

/**
 * Validate domain format
 */
const isValidDomain = (domain) => {
  if (!domain || domain.trim() === '') {
    return false;
  }

  // Reject domains with protocol
  if (domain.includes('://')) {
    return false;
  }

  // Reject domains with path
  if (domain.includes('/')) {
    return false;
  }

  // Reject domains with spaces
  if (domain.includes(' ')) {
    return false;
  }

  // Basic domain validation: letters, numbers, dots, hyphens, and optional port
  const domainPattern = /^[a-z0-9.-]+(:\d+)?$/i;
  if (!domainPattern.test(domain)) {
    return false;
  }

  // Must have at least one dot (e.g., "example.com")
  if (!domain.includes('.')) {
    return false;
  }

  return true;
};

/**
 * Clear messages with a timeout
 */
const clearMessages = (delay = 5000) => {
  setTimeout(() => {
    state.error = '';
    state.success = '';
  }, delay);
};

/**
 * Load allowed domain
 */
const loadDomains = async () => {
  try {
    state.isLoading = true;
    state.error = '';

    const encodedId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    const response = await axios.get(`/api/v1/calendars/${encodedId}/widget/domain`);
    state.currentDomain = response.data.domain;
  }
  catch (error) {
    console.error('Error loading domain:', error);
    state.error = t('error_loading');
    clearMessages();
  }
  finally {
    state.isLoading = false;
  }
};

/**
 * Set the allowed domain
 */
const addDomain = async () => {
  const domain = state.newDomain.trim();

  if (!isValidDomain(domain)) {
    state.error = t('error_invalid_domain');
    clearMessages();
    return;
  }

  try {
    state.isAdding = true;
    state.error = '';
    state.success = '';

    const encodedId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    const response = await axios.put(`/api/v1/calendars/${encodedId}/widget/domain`, {
      domain: domain,
    });

    state.currentDomain = response.data.domain;
    state.newDomain = '';
    state.success = t('add_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error setting domain:', error);
    if (error.response?.data?.errorName === 'InvalidDomainFormatError') {
      state.error = t('error_invalid_domain');
    }
    else {
      state.error = t('error_adding');
    }
    clearMessages();
  }
  finally {
    state.isAdding = false;
  }
};

/**
 * Clear the allowed domain
 */
const removeDomain = async () => {
  if (!window.confirm(t('confirm_remove', { domain: state.currentDomain }))) {
    return;
  }

  try {
    state.removingId = true;
    state.error = '';
    state.success = '';

    const encodedCalendarId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    await axios.delete(`/api/v1/calendars/${encodedCalendarId}/widget/domain`);

    state.currentDomain = null;
    state.success = t('remove_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error clearing domain:', error);
    state.error = t('error_removing');
    clearMessages();
  }
  finally {
    state.removingId = null;
  }
};

// Load domains when component mounts
onMounted(loadDomains);
</script>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

.widget-domains {
  max-width: 700px;
  margin: 0 auto;

  .domains-content {
    .current-domain-section {
      margin-bottom: $spacing-2xl;

      h3 {
        margin: 0 0 $spacing-lg 0;
        font-size: 18px;
        font-weight: $font-medium;
        color: $light-mode-text;

        @include dark-mode {
          color: $dark-mode-text;
        }
      }

      .current-domain-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: $spacing-lg;
        border: 1px solid $light-mode-border;
        border-radius: $component-border-radius-small;
        background: $light-mode-panel-background;

        @include dark-mode {
          background: $dark-mode-input-background;
          border-color: $dark-mode-border;
        }

        .domain-info {
          display: flex;
          flex-direction: column;
          gap: $spacing-xs;

          .domain-name {
            font-size: 16px;
            font-weight: $font-medium;
            color: $light-mode-text;

            @include dark-mode {
              color: $dark-mode-text;
            }
          }

          .domain-date {
            font-size: 13px;
            color: $light-mode-secondary-text;

            @include dark-mode {
              color: $dark-mode-secondary-text;
            }
          }
        }

        .change-domain-btn {
          padding: $spacing-sm $spacing-lg;
          background: transparent;
          color: rgb(220, 38, 38);
          border: 1px solid rgb(220, 38, 38);
          border-radius: $component-border-radius-small;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
          min-height: 36px;

          @include dark-mode {
            color: rgb(252, 165, 165);
            border-color: rgb(252, 165, 165);
          }

          &:hover:not(:disabled) {
            background: rgb(220, 38, 38);
            color: white;

            @include dark-mode {
              background: rgb(252, 165, 165);
              color: rgb(127, 29, 29);
            }
          }

          &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        }
      }
    }

    .add-domain-section {
      margin-bottom: $spacing-2xl;

      label {
        display: block;
        margin-bottom: $spacing-sm;
        font-weight: $font-medium;
        color: $light-mode-text;
        font-size: 16px;

        @include dark-mode {
          color: $dark-mode-text;
        }
      }

      .help-text {
        margin: 0 0 $spacing-md 0;
        font-size: 14px;
        color: $light-mode-secondary-text;
        line-height: 1.5;

        @include dark-mode {
          color: $dark-mode-secondary-text;
        }
      }

      .add-domain-form {
        display: flex;
        gap: $spacing-md;

        input {
          flex: 1;
          padding: $spacing-md $spacing-lg;
          border: 1px solid $light-mode-border;
          border-radius: $component-border-radius-small;
          font-size: 16px;
          background: $light-mode-panel-background;
          color: $light-mode-text;
          transition: all 0.2s ease;
          min-height: 44px;

          @include dark-mode {
            background: $dark-mode-input-background;
            border-color: $dark-mode-border;
            color: $dark-mode-input-text;
          }

          &:focus {
            outline: none;
            border-color: $focus-color;
            box-shadow: 0 0 0 3px rgba($focus-color, 0.1);

            @include dark-mode {
              border-color: $focus-color-dark;
              box-shadow: 0 0 0 3px rgba($focus-color-dark, 0.1);
            }
          }

          &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        }

        .add-domain-btn {
          padding: $spacing-md $spacing-xl;
          background: $light-mode-button-background;
          color: white;
          border: none;
          border-radius: $component-border-radius-small;
          font-size: 16px;
          font-weight: $font-medium;
          cursor: pointer;
          transition: all 0.2s ease;
          min-height: 44px;
          white-space: nowrap;

          @include dark-mode {
            background: $dark-mode-button-background;
            color: white;
          }

          &:hover:not(:disabled) {
            opacity: 0.9;
          }

          &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        }
      }
    }

    .domains-list {
      h3 {
        margin: 0 0 $spacing-lg 0;
        font-size: 18px;
        font-weight: $font-medium;
        color: $light-mode-text;

        @include dark-mode {
          color: $dark-mode-text;
        }
      }

      .empty-state {
        padding: $spacing-2xl;
        text-align: center;
        color: $light-mode-secondary-text;
        font-size: 14px;

        @include dark-mode {
          color: $dark-mode-secondary-text;
        }
      }

      .domain-items {
        list-style: none;
        padding: 0;
        margin: 0;

        .domain-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: $spacing-lg;
          border: 1px solid $light-mode-border;
          border-radius: $component-border-radius-small;
          margin-bottom: $spacing-md;
          background: $light-mode-panel-background;

          @include dark-mode {
            background: $dark-mode-input-background;
            border-color: $dark-mode-border;
          }

          .domain-info {
            display: flex;
            flex-direction: column;
            gap: $spacing-xs;

            .domain-name {
              font-size: 16px;
              font-weight: $font-medium;
              color: $light-mode-text;

              @include dark-mode {
                color: $dark-mode-text;
              }
            }

            .domain-date {
              font-size: 13px;
              color: $light-mode-secondary-text;

              @include dark-mode {
                color: $dark-mode-secondary-text;
              }
            }
          }

          .remove-domain-btn {
            padding: $spacing-sm $spacing-lg;
            background: transparent;
            color: rgb(220, 38, 38);
            border: 1px solid rgb(220, 38, 38);
            border-radius: $component-border-radius-small;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
            min-height: 36px;

            @include dark-mode {
              color: rgb(252, 165, 165);
              border-color: rgb(252, 165, 165);
            }

            &:hover:not(:disabled) {
              background: rgb(220, 38, 38);
              color: white;

              @include dark-mode {
                background: rgb(252, 165, 165);
                color: rgb(127, 29, 29);
              }
            }

            &:disabled {
              opacity: 0.6;
              cursor: not-allowed;
            }
          }
        }
      }
    }
  }

  .error {
    padding: $spacing-lg;
    margin-bottom: $spacing-lg;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: $component-border-radius-small;
    color: rgb(153, 27, 27);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(239, 68, 68, 0.5);
    animation: slideIn 0.3s ease;

    @include dark-mode {
      background-color: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: rgb(248, 113, 113);
    }

    &::before {
      content: '⚠️';
      margin-right: $spacing-sm;
    }
  }

  .success {
    padding: $spacing-lg;
    margin-bottom: $spacing-lg;
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.25);
    border-radius: $component-border-radius-small;
    color: rgb(21, 128, 61);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(34, 197, 94, 0.5);
    animation: slideIn 0.3s ease;

    @include dark-mode {
      background-color: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.3);
      color: rgb(74, 222, 128);
    }

    &::before {
      content: '✅';
      margin-right: $spacing-sm;
    }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
</style>
