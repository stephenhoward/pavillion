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
    <LoadingMessage v-if="state.isLoading || !localCalendar" :description="t('loading')" />

    <!-- Settings Form -->
    <div v-else class="settings-content">
      <h2 class="settings-title">{{ t('title') }}</h2>

      <div class="settings-container">
        <!-- Calendar Title & Description (Translatable) -->
        <div class="setting-card">
          <h3 class="setting-label">{{ t('calendar_content_section') }}</h3>
          <p class="input-description">{{ t('calendar_title_help') }}</p>

          <LanguageTabSelector
            ref="contentLangTabs"
            v-model="currentLanguage"
            :languages="localCalendar ? localCalendar.getLanguages() : []"
            :errored-tabs="erroredTabs"
            @add-language="openLanguagePicker"
            @remove-language="removeLanguage"
          />

          <div
            :id="contentLangTabs?.panelId(currentLanguage)"
            role="tabpanel"
            :aria-labelledby="contentLangTabs?.tabId(currentLanguage)"
            :dir="iso6391.getDir(currentLanguage) === 'rtl' ? 'rtl' : 'ltr'"
            class="translatable-fields"
          >
            <div class="form-field">
              <label class="field-label" :for="`calendarTitle-${currentLanguage}`">
                {{ t('calendar_title_label') }}
              </label>
              <input
                :id="`calendarTitle-${currentLanguage}`"
                type="text"
                class="setting-input"
                v-model="localCalendar.content(currentLanguage).name"
                :disabled="state.isSaving"
                :placeholder="t('calendar_title_placeholder')"
                @blur="saveSettings"
              />
            </div>

            <div class="form-field">
              <label class="field-label" :for="`calendarDescription-${currentLanguage}`">
                {{ t('calendar_description_label') }}
              </label>
              <p class="input-description">{{ t('calendar_description_help') }}</p>
              <textarea
                :id="`calendarDescription-${currentLanguage}`"
                class="setting-textarea"
                v-model="localCalendar.content(currentLanguage).description"
                :disabled="state.isSaving"
                :placeholder="t('calendar_description_placeholder')"
                rows="3"
                @blur="saveSettings"
              />
            </div>

            <button
              v-if="localCalendar && localCalendar.getLanguages().length > 1"
              type="button"
              class="remove-translation-link"
              @click="removeLanguage(currentLanguage)"
            >
              {{ t('remove_language', { language: iso6391.getName(currentLanguage) }) }}
            </button>
          </div>
        </div>

        <!-- Default Date Range -->
        <div class="setting-card">
          <h3 class="setting-label">{{ t('default_date_range_label') }}</h3>
          <p class="input-description">{{ t('default_date_range_help') }}</p>
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

        <!-- Default Event Image -->
        <div class="setting-card">
          <h3 class="setting-label">{{ t('default_event_image_label') }}</h3>
          <p class="input-description">{{ t('default_event_image_help') }}</p>

          <!-- Existing image preview -->
          <div v-if="state.defaultEventImage" class="default-image-preview">
            <EventImage
              :media="state.defaultEventImage"
              size="medium"
            />
            <button
              type="button"
              class="remove-image-btn"
              :disabled="state.isSaving"
              @click="removeDefaultImage"
            >
              {{ t('default_event_image_remove_button') }}
            </button>
          </div>

          <!-- Upload zone (shown when no image is set) -->
          <div v-else class="default-image-upload">
            <ImageUpload
              :calendar-id="props.calendarId"
              :multiple="false"
              @upload-complete="handleDefaultImageUpload"
            />
          </div>
        </div>

        <!-- Extended Features -->
        <div v-if="!state.fundingDisabled && !state.fundingLoading" class="setting-card">
          <h3 class="setting-label">{{ t('extended_features_label') }}</h3>
          <p class="input-description">
            {{ t('extended_features_description', { instanceName: instanceName }) }}
          </p>

          <!-- Admin exempt -->
          <div v-if="state.fundingStatus === 'admin-exempt'" class="setting-extended-status">
            <span class="setting-badge setting-badge--enabled">
              {{ t('extended_features_admin_exempt') }}
            </span>
          </div>

          <!-- Grant -->
          <div v-else-if="state.fundingStatus === 'grant'" class="setting-extended-status">
            <span class="setting-badge setting-badge--enabled">
              {{ t('extended_features_grant') }}
            </span>
          </div>

          <!-- Funded -->
          <div v-else-if="state.fundingStatus === 'funded'" class="setting-extended-status">
            <span class="setting-badge setting-badge--enabled">
              {{ t('extended_features_enabled') }}
            </span>
            <template v-if="!state.showDisableConfirm">
              <button
                type="button"
                class="setting-disable-btn"
                @click="state.showDisableConfirm = true"
              >
                {{ t('extended_features_disable_button') }}
              </button>
            </template>
            <div v-else class="setting-confirm">
              <p class="setting-confirm-message">{{ t('confirm_disable_message') }}</p>
              <div class="setting-confirm-actions">
                <button
                  type="button"
                  class="setting-disable-btn"
                  :disabled="state.isDisabling"
                  @click="disableExtendedFeatures"
                >
                  {{ state.isDisabling ? t('extended_features_disabling') : t('confirm_disable_button') }}
                </button>
                <button
                  type="button"
                  class="setting-cancel-btn"
                  :disabled="state.isDisabling"
                  @click="state.showDisableConfirm = false"
                >
                  {{ t('confirm_cancel_button') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Unfunded -->
          <div v-else class="setting-extended-status">
            <button
              type="button"
              class="setting-enable-btn"
              @click="state.showFundingSheet = true"
            >
              {{ t('extended_features_enable_button') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <LanguagePicker
    v-if="showLanguagePicker"
    :languages="availableLanguages"
    :selectedLanguages="localCalendar ? localCalendar.getLanguages() : []"
    @select="handleAddLanguage"
    @close="closeLanguagePicker"
  />

  <FundingSheet
    v-if="state.showFundingSheet"
    :calendarId="props.calendarId"
    @close="state.showFundingSheet = false"
    @subscribed="onSubscribed"
    :instanceName="instanceName"
  />
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import iso6391 from 'iso-639-1-dir';
import { CalendarContent } from '@/common/model/calendar';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import Config from '@/client/service/config';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import ImageUpload from '@/client/components/common/media/image-upload.vue';
import EventImage from '@/client/components/common/media/event-image.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import LanguagePicker from '@/client/components/common/language-picker.vue';
import FundingSheet from './FundingSheet.vue';

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
const fundingService = new FundingService();

// Instance name for extended features description
const instanceName = ref('this instance');

// Local calendar clone for translatable content editing
const localCalendar = ref(null);
const contentLangTabs = ref(null);

// Component state
const state = reactive({
  isLoading: false,
  isSaving: false,
  error: '',
  success: '',
  defaultDateRange: '2weeks',
  defaultEventImage: null,
  fundingStatus: '',
  fundingDisabled: false,
  fundingLoading: false,
  showFundingSheet: false,
  isDisabling: false,
  showDisableConfirm: false,
});

// Language management composable. Entity-level side effects (adding/dropping
// per-language content on the calendar) are wired through the hooks; the
// composable owns only UI state (active languages, current selection,
// picker modal visibility). Destructured so refs auto-unwrap in the
// template.
const {
  languages,
  availableLanguages,
  currentLanguage,
  showLanguagePicker,
  removeLanguage,
  openLanguagePicker,
  closeLanguagePicker,
  addLanguage,
} = useLanguageManagement({
  onLanguageAdded: (language) => {
    if (!localCalendar.value) return;
    if (localCalendar.value.getLanguages().includes(language)) return;
    localCalendar.value.addContent(new CalendarContent(language, '', ''));
  },
  onLanguageRemoved: (language) => {
    if (!localCalendar.value) return;
    localCalendar.value.dropContent(language);
  },
});

const erroredTabs = computed(() => {
  if (!localCalendar.value) return [];
  return localCalendar.value.getLanguages().filter(lang => {
    const content = localCalendar.value.content(lang);
    return !content || !content.name || content.name.trim().length === 0;
  });
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
      localCalendar.value = calendar.clone();
      state.defaultDateRange = calendar.defaultDateRange || '2weeks';
      state.defaultEventImage = calendar.defaultEventImage || null;

      // Re-seed the language composable's active list from the entity so
      // the language tabs reflect the calendar's actual languages.
      const calendarLanguages = localCalendar.value.getLanguages();
      if (calendarLanguages.length > 0) {
        languages.value = [...new Set([DEFAULT_LANGUAGE_CODE, ...calendarLanguages])];
        currentLanguage.value = calendarLanguages[0];
      }
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

    const contentPayload = {};
    if (localCalendar.value) {
      for (const lang of localCalendar.value.getLanguages()) {
        const c = localCalendar.value.content(lang);
        contentPayload[lang] = {
          name: c.name,
          description: c.description,
        };
      }
    }

    await calendarService.updateCalendarSettings(props.calendarId, {
      defaultDateRange: state.defaultDateRange,
      content: contentPayload,
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

/**
 * Handle adding a language from the picker. Delegates to the composable
 * for state and entity side effects (via onLanguageAdded), then closes
 * the picker modal.
 */
const handleAddLanguage = (language) => {
  addLanguage(language);
  closeLanguagePicker();
};

/**
 * Handle default image upload completion
 */
const handleDefaultImageUpload = async (results) => {
  const successResult = results.find((r) => r.success && r.media);
  if (!successResult) return;

  try {
    state.isSaving = true;
    state.error = '';
    state.success = '';

    const updatedCalendar = await calendarService.updateCalendarSettings(props.calendarId, {
      defaultEventImageId: successResult.media.id,
    });

    // Update local state with the response; image may be null while processing
    state.defaultEventImage = updatedCalendar.defaultEventImage || successResult.media;
    state.success = t('save_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error saving default image:', error);
    state.error = t('error_saving');
    clearMessages();
  }
  finally {
    state.isSaving = false;
  }
};

/**
 * Remove the default event image
 */
const removeDefaultImage = async () => {
  try {
    state.isSaving = true;
    state.error = '';
    state.success = '';

    await calendarService.updateCalendarSettings(props.calendarId, {
      defaultEventImageId: null,
    });

    state.defaultEventImage = null;
    state.success = t('save_success');
    clearMessages();
  }
  catch (error) {
    console.error('Error removing default image:', error);
    state.error = t('error_saving');
    clearMessages();
  }
  finally {
    state.isSaving = false;
  }
};

/**
 * Load funding status for this calendar
 */
const loadFundingStatus = async () => {
  try {
    state.fundingLoading = true;
    const options = await fundingService.getOptions();
    state.fundingDisabled = !options.enabled || options.providers.length === 0;

    if (options.enabled && options.providers.length > 0) {
      const status = await fundingService.getFundingStatus(props.calendarId);
      state.fundingStatus = status.status;
    }
  }
  catch (error) {
    console.error('Error loading funding status:', error);
    state.fundingDisabled = true;
  }
  finally {
    state.fundingLoading = false;
  }
};

/**
 * Disable extended features by removing calendar from funding plan
 */
const disableExtendedFeatures = async () => {
  try {
    state.isDisabling = true;
    state.error = '';
    await fundingService.removeCalendarFromFundingPlan(props.calendarId);
    state.success = t('extended_features_disable_success');
    state.showDisableConfirm = false;
    clearMessages();
    await loadFundingStatus();
  }
  catch (error) {
    console.error('Error disabling extended features:', error);
    state.error = t('extended_features_disable_error');
    clearMessages();
  }
  finally {
    state.isDisabling = false;
  }
};

/**
 * Handle successful funding subscription from FundingSheet
 */
const onSubscribed = async () => {
  state.showFundingSheet = false;
  state.success = t('extended_features_enabled_success');
  clearMessages();
  await loadFundingStatus();
};

// Load settings and funding status when component mounts
onMounted(async () => {
  loadSettings();
  loadFundingStatus();
  const config = await Config.init();
  instanceName.value = config.settings().siteTitle || 'this instance';
});
</script>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

.settings-tab {
  padding: var(--pav-space-4) 0;

  @media (min-width: 640px) {
    padding: var(--pav-space-6) 0;
  }
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
}

.settings-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--pav-color-stone-900);
  margin: 0 0 var(--pav-space-6) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.settings-container {
  max-width: 36rem; // 576px (max-w-xl)
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.setting-card {
  background: var(--pav-surface-primary);
  border-radius: 0.75rem;
  padding: var(--pav-space-4);

  @media (min-width: 640px) {
    padding: var(--pav-space-6);
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
  }
}

.setting-label {
  font-size: 1rem;
  font-weight: 500;
  color: var(--pav-color-stone-900);
  margin: 0 0 var(--pav-space-2) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.setting-input {
  width: 100%;
  max-width: 24rem;
  padding: 0.75rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--pav-color-stone-100);
  color: var(--pav-color-stone-900);
  font-size: 1rem;
  transition: box-shadow 0.2s;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    color: var(--pav-color-stone-100);
  }
}

.setting-textarea {
  width: 100%;
  max-width: 24rem;
  padding: 0.75rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--pav-color-stone-100);
  color: var(--pav-color-stone-900);
  font-size: 1rem;
  transition: box-shadow 0.2s;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    color: var(--pav-color-stone-100);
  }
}

.setting-select {
  width: 100%;
  max-width: 20rem; // 320px (max-w-xs)
  padding: 0.75rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--pav-color-stone-100);
  color: var(--pav-color-stone-900);
  font-size: 1rem;
  transition: box-shadow 0.2s;
  cursor: pointer;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    color: var(--pav-color-stone-100);
  }
}

.translatable-fields {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  margin-top: var(--pav-space-4);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.field-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.remove-translation-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-color-red-600);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-red-700);
    text-decoration: underline;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-400);

    &:hover {
      color: var(--pav-color-red-300);
    }
  }
}

.default-image-preview {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
  max-width: 24rem;
}

.remove-image-btn {
  align-self: flex-start;
  padding: 0.5rem 1rem;
  border: 1px solid var(--pav-color-red-300);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--pav-color-red-600);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: var(--pav-color-red-50);
    color: var(--pav-color-red-700);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-red-700);
    color: var(--pav-color-red-400);

    &:hover {
      background: rgba(239, 68, 68, 0.1);
      color: var(--pav-color-red-300);
    }
  }
}

.default-image-upload {
  max-width: 24rem;
}

.setting-extended-status {
  display: flex;
  align-items: center;
  gap: var(--pav-space-3);
  flex-wrap: wrap;
}

.setting-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;

  &--enabled {
    background-color: rgba(34, 197, 94, 0.1);
    color: var(--pav-color-green-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-green-400);
    }
  }
}

.setting-enable-btn {
  padding: 0.5rem 1rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--pav-color-orange-500);
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: var(--pav-color-orange-600);
  }
}

.setting-disable-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pav-color-red-300);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--pav-color-red-600);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: var(--pav-color-red-50);
    color: var(--pav-color-red-700);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-red-700);
    color: var(--pav-color-red-400);

    &:hover {
      background: rgba(239, 68, 68, 0.1);
      color: var(--pav-color-red-300);
    }
  }
}

.setting-cancel-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pav-color-stone-300);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: var(--pav-color-stone-100);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-400);

    &:hover {
      background: var(--pav-color-stone-800);
    }
  }
}

.setting-confirm {
  width: 100%;
}

.setting-confirm-message {
  margin: 0 0 var(--pav-space-3) 0;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.setting-confirm-actions {
  display: flex;
  gap: var(--pav-space-2);
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
