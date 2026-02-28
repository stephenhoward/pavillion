<script setup>
import { reactive, ref, nextTick, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { X } from 'lucide-vue-next';
import iso6391 from 'iso-639-1-dir';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { DuplicateSeriesNameError, SeriesUrlNameAlreadyExistsError, InvalidSeriesUrlNameError } from '@/common/exceptions/series';
import SeriesService from '@/client/service/series';
import ModalLayout from '@/client/components/common/modal.vue';
import LanguagePicker from '@/client/components/common/languagePicker.vue';
import PillButton from '@/client/components/common/PillButton.vue';

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
const defaultLanguage = 'en';
let allLanguages = iso6391.getAllCodes();
allLanguages.unshift(defaultLanguage);
let availableLanguages = ref([...new Set(allLanguages)]);

const state = reactive({
  currentLanguage: defaultLanguage,
  showLanguagePicker: false,
  isSaving: false,
  error: '',
});

// Create a local copy of the series to avoid mutating props
const localSeries = ref(null);

// Initialize the local series when props change
watch(() => props.series, (newSeries) => {
  if (newSeries) {
    localSeries.value = newSeries;
  }
}, { immediate: true });

const nameInput = ref(null);

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
  const languages = localSeries.value.getLanguages();
  return languages.some(lang => {
    const content = localSeries.value.content(lang);
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
 * Add a new language to the series
 */
function addLanguage(language) {
  if (!localSeries.value) return;

  // Check if language already exists
  if (localSeries.value.getLanguages().includes(language)) {
    state.showLanguagePicker = false;
    return;
  }

  // Add new language with empty content
  localSeries.value.addContent(new EventSeriesContent(language, '', ''));
  state.currentLanguage = language;
  state.showLanguagePicker = false;
}

/**
 * Remove a language from the series
 */
function removeLanguage(language) {
  if (!localSeries.value) return;

  // Don't allow removing the last language
  if (localSeries.value.getLanguages().length <= 1) {
    return;
  }

  localSeries.value.dropContent(language);

  // Switch to the first available language
  const remainingLanguages = localSeries.value.getLanguages();
  if (remainingLanguages.length > 0) {
    state.currentLanguage = remainingLanguages[0];
  }
}

// Focus input when component mounts
onMounted(() => {
  // Set current language to first available language
  const languages = localSeries.value?.getLanguages();
  if (languages && languages.length > 0) {
    state.currentLanguage = languages[0];
  }

  nextTick(() => {
    const firstInput = Array.isArray(nameInput.value)
      ? nameInput.value[0]
      : nameInput.value;
    if (firstInput) {
      firstInput.focus();
    }
  });
});
</script>

<template>
  <ModalLayout
    :title="localSeries?.id ? t('edit_series_title') : t('add_series_title')"
    modal-class="series-editor-modal"
    @close="$emit('close')"
  >
    <div class="series-editor">
      <div
        v-if="state.error"
        class="alert alert--error"
        role="alert"
      >
        {{ state.error }}
      </div>

      <!-- URL Name field - only shown for new series -->
      <div v-if="!localSeries?.id" class="form-field">
        <label class="form-label" for="series-url-name">
          {{ tEditor('url_name') }}
        </label>
        <input
          id="series-url-name"
          type="text"
          class="form-input"
          v-model="localSeries.urlName"
          :placeholder="tEditor('url_name_placeholder')"
          :disabled="state.isSaving"
        />
        <p class="field-help">{{ tEditor('url_name_help') }}</p>
      </div>

      <!-- Multilingual name and description fields -->
      <p class="form-helper">{{ tEditor('name_help') }}</p>

      <div class="language-fields">
        <div
          v-for="lang in localSeries?.getLanguages()"
          :key="lang"
          class="language-section"
        >
          <div class="language-section-header">
            <span class="language-label">{{ iso6391.getNativeName(lang) }}</span>
            <button
              v-if="localSeries && localSeries.getLanguages().length > 1"
              type="button"
              class="remove-language-button"
              :aria-label="t('remove_language')"
              @click="removeLanguage(lang)"
            >
              <X :size="16" :stroke-width="2" />
            </button>
          </div>

          <div class="language-field">
            <label class="field-label" :for="`name-${lang}`">
              {{ tEditor('name') }}
            </label>
            <input
              :id="`name-${lang}`"
              type="text"
              class="form-input"
              v-model="localSeries.content(lang).name"
              :dir="iso6391.getDir(lang) == 'rtl' ? 'rtl' : ''"
              :placeholder="tEditor('name_placeholder')"
              :disabled="state.isSaving"
              @keyup.enter="saveSeries"
              ref="nameInput"
            />
          </div>

          <div class="language-field">
            <label class="field-label" :for="`description-${lang}`">
              {{ tEditor('description') }}
            </label>
            <textarea
              :id="`description-${lang}`"
              class="form-textarea"
              v-model="localSeries.content(lang).description"
              :dir="iso6391.getDir(lang) == 'rtl' ? 'rtl' : ''"
              :placeholder="tEditor('description_placeholder')"
              :disabled="state.isSaving"
              rows="3"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        class="add-language-button"
        @click="state.showLanguagePicker = true"
      >
        + {{ t('add_language') }}
      </button>

      <div class="form-actions">
        <button
          type="button"
          class="btn-ghost"
          @click="$emit('close')"
          :disabled="state.isSaving"
        >
          {{ t('cancel_button') }}
        </button>
        <PillButton
          variant="primary"
          @click="saveSeries"
          :disabled="state.isSaving || !canSaveSeries()"
        >
          {{ state.isSaving ? (localSeries?.id ? t('updating') : t('creating')) : (localSeries?.id ? t('save_button') : t('create_button')) }}
        </PillButton>
      </div>
    </div>

    <!-- Language Picker - Inside dialog for proper z-index layering -->
    <LanguagePicker
      v-if="state.showLanguagePicker"
      :languages="availableLanguages"
      :selectedLanguages="localSeries ? localSeries.getLanguages() : []"
      @select="addLanguage"
      @close="state.showLanguagePicker = false"
    />
  </ModalLayout>
</template>

<style lang="scss" scoped>
@use '../../../assets/style/components/calendar-admin' as *;

// Constrain modal width to match reference design
:global(.series-editor-modal > div) {
  max-width: 600px !important;
}

.series-editor {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.form-helper {
  margin: 0;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.form-label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.form-input {
  @include admin-form-input;
}

.form-textarea {
  @include admin-form-input;
  resize: vertical;
  min-height: 80px;
}

.field-help {
  margin: 0;
  font-size: 0.75rem;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.language-fields {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
}

.language-section {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
  padding: var(--pav-space-4);
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.75rem;

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-700);
  }
}

.language-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.language-label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.language-field {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-1);
}

.field-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.remove-language-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--pav-space-2);
  background: none;
  border: none;
  border-radius: 0.375rem;
  color: var(--pav-color-stone-400);
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;

  &:hover {
    color: var(--pav-color-stone-600);
    background: var(--pav-color-stone-100);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
      background: var(--pav-color-stone-700);
    }
  }
}

.add-language-button {
  align-self: flex-start;
  padding: var(--pav-space-2) var(--pav-space-3);
  background: none;
  border: none;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s;

  &:hover {
    color: var(--pav-color-orange-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-orange-400);
    }
  }
}

.form-actions {
  display: flex;
  gap: var(--pav-space-3);
  justify-content: flex-end;
  margin-top: var(--pav-space-4);
  padding-top: var(--pav-space-4);
  border-top: 1px solid var(--pav-border-primary);
}

.btn-ghost {
  padding: var(--pav-space-2) var(--pav-space-4);
  background: none;
  border: none;
  color: var(--pav-color-stone-600);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s;

  &:hover {
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
}
</style>
