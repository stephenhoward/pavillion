<template>
  <div class="settings-tab">
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

    <!-- Settings Form -->
    <div v-else class="settings-form">
      <div class="form-group">
        <label for="defaultDateRange">{{ t('default_date_range_label') }}</label>
        <p class="help-text">{{ t('default_date_range_help') }}</p>
        <select
          id="defaultDateRange"
          v-model="state.defaultDateRange"
          :disabled="state.isSaving"
          @change="saveSettings"
        >
          <option value="1week">{{ t('date_range_1week') }}</option>
          <option value="2weeks">{{ t('date_range_2weeks') }}</option>
          <option value="1month">{{ t('date_range_1month') }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import LoadingMessage from '@/client/components/common/loading_message.vue';

// Props
const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
});

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'settings',
});

// Services
const calendarService = new CalendarService();

// Component state
const state = reactive({
  isLoading: false,
  isSaving: false,
  error: '',
  success: '',
  defaultDateRange: '2weeks',
});

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
 * Load calendar settings
 */
const loadSettings = async () => {
  try {
    state.isLoading = true;
    state.error = '';

    const calendar = await calendarService.getCalendarById(props.calendarId);
    if (calendar) {
      state.defaultDateRange = calendar.defaultDateRange || '2weeks';
    }
  }
  catch (error) {
    console.error('Error loading settings:', error);
    state.error = t('error_loading');
    clearMessages();
  }
  finally {
    state.isLoading = false;
  }
};

/**
 * Save calendar settings
 */
const saveSettings = async () => {
  try {
    state.isSaving = true;
    state.error = '';
    state.success = '';

    await calendarService.updateCalendarSettings(props.calendarId, {
      defaultDateRange: state.defaultDateRange,
    });

    state.success = t('save_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error saving settings:', error);
    state.error = t('error_saving');
    clearMessages();
  }
  finally {
    state.isSaving = false;
  }
};

// Load settings when component mounts
onMounted(loadSettings);
</script>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

.settings-tab {
  max-width: 600px;
  margin: 0 auto;

  .settings-form {
    .form-group {
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

      select {
        width: 100%;
        max-width: 300px;
        padding: $spacing-md $spacing-lg;
        border: 1px solid $light-mode-border;
        border-radius: $component-border-radius-small;
        font-size: 16px;
        background: $light-mode-panel-background;
        color: $light-mode-text;
        transition: all 0.2s ease;
        min-height: 44px;
        cursor: pointer;

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
