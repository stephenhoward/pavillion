<script setup>
import { ref, computed, nextTick, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import iso6391 from 'iso-639-1-dir';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import LanguagePicker from '@/client/components/common/language-picker.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';

/**
 * The "Series Details" fields shared by the full-page series editor and the
 * inline create-series modal on the event editor. Mutates the passed series
 * directly; the host owns saving. Exposes `canSave()` so the host can gate
 * its own submit control.
 */
const props = defineProps({
  series: {
    type: Object, // EventSeries
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['submit']);

const { t } = useTranslation('series', {
  keyPrefix: 'management',
});

const { t: tEditor } = useTranslation('series', {
  keyPrefix: 'editor',
});

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
    if (props.series.getLanguages().includes(language)) return;
    props.series.addContent(new EventSeriesContent(language, '', ''));
  },
  onLanguageRemoved: (language) => {
    props.series.dropContent(language);
  },
});

// Re-seed the language composable's active list from the entity so
// async-loaded series populate their tabs correctly.
watch(() => props.series, (newSeries) => {
  const seriesLanguages = newSeries.getLanguages();
  if (seriesLanguages.length > 0) {
    languages.value = [...new Set([DEFAULT_LANGUAGE_CODE, ...seriesLanguages])];
    currentLanguage.value = seriesLanguages[0];
  }
}, { immediate: true });

const urlNameInput = ref(null);
const nameInput = ref(null);
const isNew = computed(() => !props.series.id);

const erroredTabs = computed(() => {
  return props.series.getLanguages().filter(language => {
    const content = props.series.content(language);
    return !content || !content.name || content.name.trim().length === 0;
  });
});

/**
 * A series can be saved when it has at least one non-empty name and, for a
 * new series, a urlName.
 */
function canSave() {
  if (isNew.value && (!props.series.urlName || props.series.urlName.trim().length === 0)) {
    return false;
  }
  return props.series.getLanguages().some(language => {
    const content = props.series.content(language);
    return content && content.name.trim().length > 0;
  });
}

function handleAddLanguage(language) {
  addLanguage(language);
  closeLanguagePicker();
}

// Focus the first field on mount. The same field carries `autofocus` so a
// host <dialog> (via useDialog.setInitialFocus) leaves focus here rather
// than moving it to the dialog heading.
onMounted(() => {
  nextTick(() => {
    (urlNameInput.value ?? nameInput.value)?.focus();
  });
});

defineExpose({ canSave });
</script>

<template>
  <div class="series-details-form translatable-form-fields">
    <!-- URL Name field - only shown for new series -->
    <div v-if="isNew" class="form-field">
      <label class="field-label" for="series-url-name">
        {{ tEditor('url_name') }}
      </label>
      <input
        id="series-url-name"
        type="text"
        class="field-input"
        v-model="series.urlName"
        :placeholder="tEditor('url_name_placeholder')"
        :disabled="disabled"
        autofocus
        ref="urlNameInput"
      />
      <p class="field-help">{{ tEditor('url_name_help') }}</p>
    </div>

    <!-- Multilingual name and description fields -->
    <LanguageTabSelector
      v-model="currentLanguage"
      :languages="series.getLanguages()"
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
          v-model="series.content(currentLanguage).name"
          :placeholder="tEditor('name_placeholder')"
          :disabled="disabled"
          :autofocus="!isNew"
          @keyup.enter="emit('submit')"
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
          v-model="series.content(currentLanguage).description"
          :placeholder="tEditor('description_placeholder')"
          :disabled="disabled"
          rows="3"
        />
      </div>

      <button
        v-if="series.getLanguages().length > 1"
        type="button"
        class="remove-translation-link"
        @click="removeLanguage(currentLanguage)"
      >
        {{ t('remove_language', { language: iso6391.getName(currentLanguage) }) }}
      </button>
    </div>

    <!-- Language Picker - rendered inside the form so it stacks above whichever host (page or modal) contains it -->
    <LanguagePicker
      v-if="showLanguagePicker"
      :languages="availableLanguages"
      :selectedLanguages="series.getLanguages()"
      @select="handleAddLanguage"
      @close="closeLanguagePicker"
    />
  </div>
</template>

<style lang="scss" scoped>
/*
 * Form-field styling (.form-field, .field-label, .field-input,
 * .field-textarea, .field-help) is provided by the shared
 * `_translatable-form.scss` partial via the `.translatable-form-fields`
 * class on the root.
 */
.series-details-form,
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
