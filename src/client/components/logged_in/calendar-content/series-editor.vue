<script setup>
import { reactive, ref, computed, nextTick, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { ArrowLeft } from 'lucide-vue-next';
import iso6391 from 'iso-639-1-dir';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { DuplicateSeriesNameError, SeriesUrlNameAlreadyExistsError, InvalidSeriesUrlNameError } from '@/common/exceptions/series';
import SeriesService from '@/client/service/series';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import LanguagePicker from '@/client/components/common/language-picker.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import ImageUpload from '@/client/components/common/media/image-upload.vue';
import EventImage from '@/client/components/common/media/event-image.vue';

const emit = defineEmits(['close', 'saved']);

const props = defineProps({
  series: {
    type: Object, // EventSeries
    required: true,
  },
});

const { t } = useTranslation('series', {
  keyPrefix: 'management',
});

const { t: tEditor } = useTranslation('series', {
  keyPrefix: 'editor',
});

const seriesService = new SeriesService();

const state = reactive({
  isSaving: false,
  error: '',
});

// Create a local copy of the series to avoid mutating props
const localSeries = ref(null);

// Language management composable. Entity-level side effects (adding/dropping
// per-language content on the series) are wired through the hooks; the
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
    if (!localSeries.value) return;
    if (localSeries.value.getLanguages().includes(language)) return;
    localSeries.value.addContent(new EventSeriesContent(language, '', ''));
  },
  onLanguageRemoved: (language) => {
    if (!localSeries.value) return;
    localSeries.value.dropContent(language);
  },
});

// Initialize the local series when props change. Re-seed the language
// composable's active list from the entity so async-loaded series populate
// their tabs correctly.
watch(() => props.series, (newSeries) => {
  if (newSeries) {
    localSeries.value = newSeries;
    const seriesLanguages = newSeries.getLanguages();
    if (seriesLanguages.length > 0) {
      languages.value = [...new Set([DEFAULT_LANGUAGE_CODE, ...seriesLanguages])];
      currentLanguage.value = seriesLanguages[0];
    }
  }
}, { immediate: true });

const nameInput = ref(null);
const hasNewUpload = ref(false);

const currentMedia = computed(() => {
  const id = localSeries.value?.mediaId;
  return id ? { id } : null;
});

const erroredTabs = computed(() => {
  if (!localSeries.value) return [];
  return localSeries.value.getLanguages().filter(language => {
    const content = localSeries.value.content(language);
    return !content || !content.name || content.name.trim().length === 0;
  });
});

/**
 * Check if the series can be saved
 * Requires at least one non-empty name and a urlName for new series
 */
function canSaveSeries() {
  if (!localSeries.value) return false;

  const isNew = !localSeries.value.id;

  // For new series, urlName must be set
  if (isNew && (!localSeries.value.urlName || localSeries.value.urlName.trim().length === 0)) {
    return false;
  }

  // Must have at least one non-empty name
  const seriesLanguages = localSeries.value.getLanguages();
  return seriesLanguages.some(language => {
    const content = localSeries.value.content(language);
    return content && content.name.trim().length > 0;
  });
}

/**
 * Save the series
 */
async function saveSeries() {
  if (!canSaveSeries()) {
    state.error = tEditor('error_empty_name');
    return;
  }

  state.isSaving = true;
  state.error = '';

  try {
    const savedSeries = await seriesService.saveSeries(localSeries.value);
    emit('saved', savedSeries);
    emit('close');
  }
  catch (error) {
    if (error instanceof DuplicateSeriesNameError) {
      state.error = t('error_duplicate_name');
    }
    else if (error instanceof SeriesUrlNameAlreadyExistsError) {
      state.error = t('error_duplicate_url_name');
    }
    else if (error instanceof InvalidSeriesUrlNameError) {
      state.error = t('error_invalid_url_name');
    }
    else {
      console.error('Error saving series:', error);
      state.error = localSeries.value?.id ? t('error_update_series') : t('error_create_series');
    }
  }
  finally {
    state.isSaving = false;
  }
}

/**
 * Handle image upload completion
 */
function handleImageUpload(results) {
  if (results && results.length > 0 && results[0].success) {
    localSeries.value.mediaId = results[0].media.id;
  }
}

/**
 * Track whether a new file has been selected in the upload zone.
 * Used to hide the existing image preview when an upload is in progress.
 */
function handleFilesChanged(files) {
  hasNewUpload.value = files.length > 0;
}

/**
 * Handle adding a language from the picker. Delegates to the composable
 * for state and entity side effects (via onLanguageAdded), then closes
 * the picker modal.
 */
function handleAddLanguage(language) {
  addLanguage(language);
  closeLanguagePicker();
}

// Focus input when component mounts. The watch above handles seeding the
// composable's currentLanguage from the entity; here we just focus the
// first input.
onMounted(() => {
  nextTick(() => {
    if (nameInput.value) {
      nameInput.value.focus();
    }
  });
});
</script>

<template>
  <div class="series-editor-page">
    <!-- Page Header with Back Button and Actions -->
    <header class="page-header">
      <button
        type="button"
        class="back-button"
        @click="$emit('close')"
        :aria-label="t('cancel_button')"
      >
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <h1>{{ localSeries?.id ? t('edit_series_title') : t('add_series_title') }}</h1>
      <div class="header-actions">
        <button
          type="button"
          class="btn btn--ghost btn--pill"
          @click="$emit('close')"
          :disabled="state.isSaving"
        >
          {{ t('cancel_button') }}
        </button>
        <button
          type="button"
          class="btn-save"
          @click="saveSeries"
          :disabled="state.isSaving || !canSaveSeries()"
        >
          {{ state.isSaving
            ? (localSeries?.id ? t('updating') : t('creating'))
            : (localSeries?.id ? t('save_button') : t('create_button')) }}
        </button>
      </div>
    </header>

    <!-- Error Display -->
    <div
      v-if="state.error"
      class="error"
      role="alert"
    >
      {{ state.error }}
    </div>

    <!-- Main Content -->
    <main class="editor-main" role="main" :aria-label="localSeries?.id ? t('edit_series_title') : t('add_series_title')">
      <div class="editor-container">

        <!-- SERIES DETAILS Section -->
        <section class="editor-section">
          <h2 class="section-header">{{ tEditor('details_section') }}</h2>

          <div class="section-card translatable-form-fields">
            <!-- URL Name field - only shown for new series -->
            <div v-if="!localSeries?.id" class="form-field">
              <label class="field-label" for="series-url-name">
                {{ tEditor('url_name') }}
              </label>
              <input
                id="series-url-name"
                type="text"
                class="field-input"
                v-model="localSeries.urlName"
                :placeholder="tEditor('url_name_placeholder')"
                :disabled="state.isSaving"
              />
              <p class="field-help">{{ tEditor('url_name_help') }}</p>
            </div>

            <!-- Multilingual name and description fields -->
            <LanguageTabSelector
              v-model="currentLanguage"
              :languages="localSeries?.getLanguages() || []"
              :errored-tabs="erroredTabs"
              @add-language="openLanguagePicker"
              @remove-language="removeLanguage"
            />

            <div
              :dir="iso6391.getDir(currentLanguage) === 'rtl' ? 'rtl' : 'ltr'"
              class="event-fields"
            >
              <div class="form-field">
                <label class="field-label" :for="`name-${currentLanguage}`">
                  {{ tEditor('name') }}
                </label>
                <input
                  :id="`name-${currentLanguage}`"
                  type="text"
                  class="field-input"
                  v-model="localSeries.content(currentLanguage).name"
                  :placeholder="tEditor('name_placeholder')"
                  :disabled="state.isSaving"
                  @keyup.enter="saveSeries"
                  ref="nameInput"
                />
              </div>

              <div class="form-field">
                <label class="field-label" :for="`description-${currentLanguage}`">
                  {{ tEditor('description') }}
                </label>
                <textarea
                  :id="`description-${currentLanguage}`"
                  class="field-textarea"
                  v-model="localSeries.content(currentLanguage).description"
                  :placeholder="tEditor('description_placeholder')"
                  :disabled="state.isSaving"
                  rows="3"
                />
              </div>

              <button
                v-if="localSeries && localSeries.getLanguages().length > 1"
                type="button"
                class="remove-translation-link"
                @click="removeLanguage(currentLanguage)"
              >
                {{ t('remove_language', { language: iso6391.getName(currentLanguage) }) }}
              </button>
            </div>
          </div>
        </section>

        <!-- SERIES IMAGE Section -->
        <section class="editor-section">
          <h2 class="section-header">{{ tEditor('image_section') }}</h2>

          <div class="section-card translatable-form-fields">
            <!-- Existing image preview (hidden when a new upload is in progress) -->
            <div v-if="currentMedia && !hasNewUpload" class="current-image-section">
              <p class="field-label">{{ tEditor('current_image') }}</p>
              <EventImage :media="currentMedia" size="medium" />
            </div>

            <ImageUpload
              :calendar-id="localSeries?.calendarId || ''"
              :multiple="false"
              :aria-label="tEditor('image')"
              @upload-complete="handleImageUpload"
              @files-changed="handleFilesChanged"
            />
            <p class="field-help">{{ tEditor('image_help') }}</p>
          </div>
        </section>

      </div>
    </main>
  </div>

  <!-- Language Picker - rendered outside main for proper stacking -->
  <LanguagePicker
    v-if="showLanguagePicker"
    :languages="availableLanguages"
    :selectedLanguages="localSeries ? localSeries.getLanguages() : []"
    @select="handleAddLanguage"
    @close="closeLanguagePicker"
  />
</template>

<style lang="scss" scoped>
/* Full-screen overlay - covers the entire viewport */
.series-editor-page {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  background-color: var(--pav-color-stone-50);
  overflow-y: auto;

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-900);
  }
}

/* Page header with back button, title, and action buttons */
.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid var(--pav-color-stone-200);
  background-color: white;
  position: sticky;
  top: 0;
  z-index: 10;

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
    border-bottom-color: var(--pav-color-stone-700);
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-left: auto;
  }
}

.back-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 0.5rem;
  background-color: transparent;
  color: var(--pav-color-stone-700);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;

  svg {
    width: 20px;
    height: 20px;
    min-width: 20px;
    display: block;
    flex-shrink: 0;
  }

  &:hover {
    background-color: var(--pav-color-stone-100);
    color: var(--pav-color-stone-900);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);

    &:hover {
      background-color: var(--pav-color-stone-800);
      color: var(--pav-color-stone-200);
    }
  }
}

.btn-save {
  padding: 0.625rem 1.5rem;
  border: none;
  background: var(--pav-color-orange-500);
  color: white;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 9999px;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--pav-color-orange-600);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/* Error display */
.error {
  position: relative;
  color: var(--pav-color-red-700);
  font-size: 0.9rem;
  padding: 1rem 1.5rem;
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);
  margin: 1rem 2rem 0;
  border-radius: 0.75rem;
  max-width: 800px;
  width: calc(100% - 4rem);
  box-sizing: border-box;
  align-self: center;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-300);
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
  }
}

/* Main editor content area */
.editor-main {
  flex: 1;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
}

/* Container with sections */
.editor-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem;

  @media (max-width: 768px) {
    padding: 1rem;
    gap: 1.5rem;
  }
}

/* Section styling */
.editor-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-header {
  margin: 0;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.section-card {
  background: white;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.5rem;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
  }
}

/*
 * Form-field styling (.form-field, .field-label, .field-input,
 * .field-textarea, .field-help) is provided by the shared
 * `_translatable-form.scss` partial via the `.translatable-form-fields`
 * class added on .section-card. The .event-fields container uses the
 * same flex column layout as .section-card itself.
 */
.event-fields {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-lg);
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
</style>
