<script setup>
import { reactive, ref, computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { ArrowLeft } from 'lucide-vue-next';
import SeriesService from '@/client/service/series';
import { seriesSaveErrorKey } from '@/client/composables/seriesSaveErrorKey';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import SeriesDetailsForm from './series-details-form.vue';
import ImageUpload from '@/client/components/common/media/image-upload.vue';
import EventImage from '@/client/components/common/media/event-image.vue';
import ImageAltEditor from '@/client/components/common/media/ImageAltEditor.vue';
import { clearImageAlt } from '@/client/components/common/media/image-alt';

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

watch(() => props.series, (newSeries) => {
  if (newSeries) {
    localSeries.value = newSeries;
  }
}, { immediate: true });

// The shared details form owns the language tabs and field validation, and
// reports which tab is showing. The image section's alt text is per-language
// content on the same series, so it follows that selection; until the form has
// announced one, the default language is what its tabs open on.
const detailsForm = ref(null);
const currentLanguage = ref(DEFAULT_LANGUAGE_CODE);
const hasNewUpload = ref(false);

const currentMedia = computed(() => {
  const id = localSeries.value?.mediaId;
  return id ? { id } : null;
});

/**
 * Check if the series can be saved; delegated to the details form.
 */
function canSaveSeries() {
  return detailsForm.value?.canSave() ?? false;
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
    const isNew = !localSeries.value?.id;
    const key = seriesSaveErrorKey(error, isNew);
    if (key === 'error_create_series' || key === 'error_update_series') {
      console.error('Error saving series:', error);
    }
    state.error = t(key);
  }
  finally {
    state.isSaving = false;
  }
}

/**
 * Handle image upload completion
 *
 * The upload zone here is always offered, not just while the series has no
 * image, so this is also the replace path. Alt text describes one particular
 * photograph: carried over to a different one it would be saved as a
 * description of the new image, and a screen reader would confidently report
 * something that image does not show. So a change of media drops the
 * description in every language — re-uploading the same media leaves it alone.
 */
function handleImageUpload(results) {
  if (results && results.length > 0 && results[0].success) {
    const uploadedMediaId = results[0].media.id;

    if (localSeries.value.mediaId !== uploadedMediaId) {
      clearImageAlt(localSeries.value);
    }

    localSeries.value.mediaId = uploadedMediaId;
  }
}

/**
 * Track whether a new file has been selected in the upload zone.
 * Used to hide the existing image preview when an upload is in progress.
 */
function handleFilesChanged(files) {
  hasNewUpload.value = files.length > 0;
}
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

          <div class="section-card">
            <SeriesDetailsForm
              v-if="localSeries"
              ref="detailsForm"
              :series="localSeries"
              :disabled="state.isSaving"
              @submit="saveSeries"
              @language-change="currentLanguage = $event"
            />
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

            <!--
              Alt text is per-language content on the series, so the editor
              follows the language tab chosen in the details section above
              rather than carrying a selector of its own. It is only offered
              once there is an image to describe.

              Keyed on the media so a replacement image gets a fresh editor.
              The editor seeds Decorative-or-Describe once, from the model it is
              handed, and re-seeds only when that model's identity changes —
              which an upload over an existing image does not do. Without the
              key the editor would sit on Describe with an empty box, offering
              the new photograph a mode its own content does not support.
            -->
            <ImageAltEditor
              v-if="currentMedia"
              :key="localSeries.mediaId"
              :model="localSeries"
              :language="currentLanguage"
              :disabled="state.isSaving"
            />
          </div>
        </section>

      </div>
    </main>
  </div>
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

</style>
