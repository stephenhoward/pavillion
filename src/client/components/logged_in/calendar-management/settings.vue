<template>
  <div class="settings-tab">
    <!-- Error Display -->
    <div v-if="state.error" class="alert alert--error">
      {{ state.error }}
    </div>

    <!-- Success Display -->
    <div v-if="state.success" class="alert alert--success">
      {{ state.success }}
    </div>

    <!-- Loading State -->
    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Settings Form -->
    <div v-else class="settings-content">
      <h2 class="settings-title">{{ t('calendar_settings') }}</h2>

      <div class="setting-section">
        <h3 class="setting-label">{{ t('default_date_range_label') }}</h3>
        <p class="setting-description">{{ t('default_date_range_help') }}</p>
        <select
          id="defaultDateRange"
          class="setting-select"
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
@use '../../../assets/style/components/calendar-admin' as *;

.settings-tab {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
}

.settings-title {
  @include admin-section-title;
  margin: 0;
}

.setting-section {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
}

.setting-label {
  font-size: 1rem;
  font-weight: 500;
  color: var(--pav-color-stone-900);
  margin: 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.setting-description {
  margin: 0;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  line-height: 1.5;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.setting-select {
  width: 100%;
  max-width: 300px;
  padding: var(--pav-space-3) var(--pav-space-4);
  border: 1px solid var(--pav-border-primary);
  border-radius: 0.75rem;
  background: var(--pav-color-stone-50);
  color: var(--pav-text-primary);
  font-size: 1rem;
  transition: border-color 0.2s, box-shadow 0.2s;
  cursor: pointer;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 3px oklch(0.705 0.213 47.604 / 0.4);
    border-color: var(--pav-color-orange-500);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
  }
}

.alert {
  padding: var(--pav-space-3);
  margin-bottom: var(--pav-space-4);
  border-radius: 0.75rem;
  font-size: 0.875rem;

  &.alert--error {
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }

  &.alert--success {
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: var(--pav-color-green-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-green-400);
    }
  }
}
</style>
