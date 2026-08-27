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
            class="translatable-fields translatable-form-fields"
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

        <!--
          Extended Features.

          The whole section is hidden while the gate answer is unknown. An
          unreadable funding state is not an uncovered one, and this is the
          site where that mattered: the old chain tested three status values
          and let everything else — including the empty initial value — fall
          through to the upsell branch, so a failed read structurally rendered
          as "your community owes money". There are only three states here now
          and the third renders nothing.
        -->
        <div v-if="extendedFeaturesAccess !== 'unknown'" class="setting-card">
          <h3 class="setting-label">{{ t('extended_features_label') }}</h3>

          <!--
            No standing "these features need funding" line under the heading.
            It would repeat the upsell card's own pitch in the denied state,
            and contradict the granted one on an instance that does not charge
            at all — where every gate is open and the badge below is the whole
            truth. Each state says its own piece instead.
          -->

          <!--
            Granted. What the calendar may do comes from the feature gate; the
            badge wording comes from the display status, which is the only
            thing that vocabulary decides.
          -->
          <div v-if="extendedFeaturesAccess === 'granted'" class="setting-extended-status">
            <span class="setting-badge setting-badge--enabled">
              {{ t(extendedFeaturesBadgeKey) }}
            </span>

            <template v-if="canCancelPlan">
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
            </template>
          </div>

          <!-- Denied. The card re-checks the gate before it shows anything. -->
          <FundingUpsellCard
            v-else
            :calendarId="props.calendarId"
            :feature="EXTENDED_FEATURE"
            @plan-started="onPlanStarted"
          />
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
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import iso6391 from 'iso-639-1-dir';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import type { DefaultDateRange } from '@/common/model/calendar';
import type { Media } from '@/common/model/media';
import type { FundingGatedFeature } from '@/common/model/funding-plan';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import type { UploadResult } from '@/client/service/media';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import ImageUpload from '@/client/components/common/media/image-upload.vue';
import EventImage from '@/client/components/common/media/event-image.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import LanguagePicker from '@/client/components/common/language-picker.vue';
import FundingUpsellCard from '@/client/components/common/FundingUpsellCard.vue';
import { useFundingAccess } from '@/client/composables/useFundingAccess';

// Props
const props = defineProps<{
  calendarId: string;
}>();

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'settings',
});

// Services
const calendarService = new CalendarService();
const fundingService = new FundingService();

// The calendar's funding gate. `extendedFeaturesAccess` decides what the
// section may offer; `fundingStatus` only labels it. They are separate reads
// because they answer separate questions and are allowed to disagree.
const {
  status: fundingStatus,
  accessState: fundingAccessState,
  ensureLoaded: ensureFundingLoaded,
  refresh: refreshFundingAccess,
} = useFundingAccess(props.calendarId);

// Local calendar clone for translatable content editing
const localCalendar = ref<Calendar | null>(null);
const contentLangTabs = ref<InstanceType<typeof LanguageTabSelector> | null>(null);

// Component state
const state = reactive<{
  isLoading: boolean;
  isSaving: boolean;
  error: string;
  success: string;
  defaultDateRange: DefaultDateRange;
  defaultEventImage: Media | null;
  isDisabling: boolean;
  showDisableConfirm: boolean;
}>({
  isLoading: false,
  isSaving: false,
  error: '',
  success: '',
  defaultDateRange: '2weeks',
  defaultEventImage: null,
  isDisabling: false,
  showDisableConfirm: false,
});

/**
 * The registry key this section gates on and hands to the upsell card.
 *
 * Annotated so that the string is checked against `FUNDING_GATED_FEATURES`
 * here, in the script, rather than only where it is consumed: a renamed or
 * removed key is a compile error at this line.
 */
const EXTENDED_FEATURE: FundingGatedFeature = 'widget_embedding';

/**
 * The gate answer this section is about.
 *
 * "Extended features" is the user-facing name for the funding-gated set, and
 * widget embedding is the whole of that set today. When a second feature is
 * registered this becomes a fold over the registry rather than one key.
 */
const extendedFeaturesAccess = computed(() => fundingAccessState(EXTENDED_FEATURE));

/**
 * Whether there is a plan to cancel.
 *
 * This is the one place a control's presence follows the display status, and
 * it is not an entitlement check: what the calendar may do is already settled
 * by `extendedFeaturesAccess`. The question here is which funding relationship
 * grants it, because only a plan is something the owner can end — an admin
 * exemption and a grant have nothing to cancel.
 */
const canCancelPlan = computed(() => fundingStatus.value === 'covered');

/**
 * Which badge names the granted state. Display vocabulary only — nothing about
 * what the calendar may do is decided here.
 *
 * Every status is listed so that a new `FundingStatus` value fails to compile
 * here instead of silently inheriting the "enabled" wording. `null` is the
 * not-yet-loaded value, which the granted branch never renders.
 */
const extendedFeaturesBadgeKey = computed(() => {
  const status = fundingStatus.value;
  switch (status) {
    case 'admin_exempt':
      return 'extended_features_admin_exempt';
    case 'grant':
      return 'extended_features_grant';
    case 'covered':
    case 'not_covered':
    case null:
      return 'extended_features_enabled';
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled funding status: ${String(unhandled)}`);
    }
  }
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
  addLanguage,
  removeLanguage,
  openLanguagePicker,
  closeLanguagePicker,
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
  const calendar = localCalendar.value;
  return calendar.getLanguages().filter((lang) => {
    const content = calendar.content(lang);
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

      // Re-seed the composable's `languages` so its `availableLanguages`
      // computed (used by the picker modal) excludes the languages this
      // calendar already has. The LanguageTabSelector renders tabs from
      // localCalendar.getLanguages() directly, so the seeding here drives
      // the picker exclusion list, not the visible tab row.
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

    const contentPayload: Record<string, { name: string; description: string }> = {};
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
const handleAddLanguage = (language: string) => {
  addLanguage(language);
  closeLanguagePicker();
};

/**
 * Handle default image upload completion
 */
const handleDefaultImageUpload = async (results: UploadResult[]) => {
  const successResult = results.find((r) => r.success && r.media);
  if (!successResult?.media) return;

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
    await refreshFundingAccess();
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
 * Report a funding plan started from the upsell card. The card has already
 * re-read the gate, so the section has switched to its granted state by the
 * time this runs.
 */
const onPlanStarted = () => {
  state.success = t('extended_features_enabled_success');
  clearMessages();
};

// Load settings and funding status when component mounts. The instance name
// the upsell needs is the card's own business, not this screen's.
onMounted(() => {
  loadSettings();
  ensureFundingLoaded();
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
  color: var(--pav-text-primary);
  margin: 0 0 var(--pav-space-6) 0;
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
}

.setting-label {
  font-size: 1rem;
  font-weight: 500;
  color: var(--pav-text-primary);
  margin: 0 0 var(--pav-space-2) 0;
}

.setting-input {
  width: 100%;
  max-width: 24rem;
  padding: 0.75rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--pav-color-neutral-100);
  color: var(--pav-text-primary);
  font-size: 1rem;
  transition: box-shadow 0.2s;

  &:focus {
    outline: none;
    box-shadow: var(--pav-shadow-focus-brand);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.setting-textarea {
  width: 100%;
  max-width: 24rem;
  padding: 0.75rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--pav-color-neutral-100);
  color: var(--pav-text-primary);
  font-size: 1rem;
  transition: box-shadow 0.2s;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;

  &:focus {
    outline: none;
    box-shadow: var(--pav-shadow-focus-brand);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.setting-select {
  width: 100%;
  max-width: 20rem; // 320px (max-w-xs)
  padding: 0.75rem 1rem;
  border: 0;
  border-radius: 0.75rem;
  background: var(--pav-color-neutral-100);
  color: var(--pav-text-primary);
  font-size: 1rem;
  transition: box-shadow 0.2s;
  cursor: pointer;

  &:focus {
    outline: none;
    box-shadow: var(--pav-shadow-focus-brand);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/*
 * `.form-field` and `.field-label` styles inside `.translatable-fields`
 * are provided by the shared `_translatable-form.scss` partial via the
 * `.translatable-form-fields` class added on the .translatable-fields
 * container. Local override below preserves the legacy
 * .translatable-fields container's margin-top spacing the partial does
 * not set; the partial's column flex/gap layout matches the original.
 */
.translatable-fields {
  margin-top: var(--pav-space-4);
}

.remove-translation-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-text-error);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-text-error-hover);
    text-decoration: underline;
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
  border: 1px solid var(--pav-border-error);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--pav-text-error);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: var(--pav-surface-error);
    color: var(--pav-text-error-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
    background-color: var(--pav-badge-emerald-bg);
    color: var(--pav-badge-emerald-text);
  }
}

.setting-disable-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pav-border-error);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--pav-text-error);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: var(--pav-surface-error);
    color: var(--pav-text-error-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.setting-cancel-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pav-border-primary);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--pav-text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: var(--pav-interactive-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.setting-confirm {
  width: 100%;
}

.setting-confirm-message {
  margin: 0 0 var(--pav-space-3) 0;
  color: var(--pav-text-secondary);
  font-size: 0.875rem;
}

.setting-confirm-actions {
  display: flex;
  gap: var(--pav-space-2);
}

// Error/success variants come from the shared admin-alert mixin
// (semantic error tokens; the colorblind-safe blue success palette).
.alert {
  @include admin-alert;
}
</style>
