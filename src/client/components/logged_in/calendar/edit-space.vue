<script setup lang="ts">
/**
 * Edit Space component
 *
 * Inline editor for an `EventLocationSpace` (a sub-area of an `EventLocation`,
 * e.g. a meeting room within a community center). Pairs `LanguageTabSelector`
 * with per-language `name` + `accessibilityInfo` form fields.
 *
 * Acts as a child-emits-data sub-editor: emits `save` with a staged content
 * payload and `cancel` with no payload. The parent (`edit-place.vue`'s Spaces
 * section, pv-0pht) is responsible for merging the payload into its working
 * `place.spaces` buffer (creating a new entry with a generated `clientId` for
 * staged-but-unsaved Spaces, or replacing the existing entry's content).
 *
 * Validation rule: at least one language must have a non-empty name.
 */
import { ref, reactive, computed, onBeforeMount, watch, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import languagePicker from '@/client/components/common/language-picker.vue';
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import iso6391 from 'iso-639-1-dir';

const props = defineProps<{
  /**
   * The Space being edited, or `null` for create mode. The parent passes its
   * working-buffer entry directly; this component reads (but does not mutate)
   * it during initialization and emits a fresh staged copy on save.
   */
  space?: EventLocationSpace | null;
}>();

const emit = defineEmits<{
  (e: 'save', payload: EventLocationSpace): void;
  (e: 'cancel'): void;
}>();

const { t } = useTranslation('calendars', {
  keyPrefix: 'places.space',
});

const isEditMode = computed(() => Boolean(props.space?.id || props.space?.clientId));

const state = reactive({
  error: '' as string,
});

// Error container ref for focus management on validation/save failure.
const errorContainer = ref<HTMLElement | null>(null);

// Per-language form data, keyed by language code.
const nameByLang = reactive<Record<string, string>>({});
const accessibilityByLang = reactive<Record<string, string>>({});

// Language tab management.
const defaultLanguage = 'en';
const languages = ref<string[]>([defaultLanguage]);
const currentLanguage = ref(defaultLanguage);
const showLanguagePicker = ref(false);
const langTabs = ref<InstanceType<typeof LanguageTabSelector> | null>(null);

watch(() => state.error, async (newError) => {
  if (newError) {
    await nextTick();
    errorContainer.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    errorContainer.value?.focus();
  }
});

const availableLanguages = computed(() => {
  const allLanguages = iso6391.getAllCodes();
  return allLanguages.filter((code: string) => !languages.value.includes(code));
});

function openLanguagePicker() {
  showLanguagePicker.value = true;
}

function closeLanguagePicker() {
  showLanguagePicker.value = false;
}

function handleAddLanguage(language: string) {
  if (!languages.value.includes(language)) {
    languages.value.push(language);
    if (!(language in nameByLang)) nameByLang[language] = '';
    if (!(language in accessibilityByLang)) accessibilityByLang[language] = '';
    currentLanguage.value = language;
  }
  closeLanguagePicker();
}

/**
 * Build a staged `EventLocationSpace` carrying the form's per-language
 * content. Preserves the source row's identity (server `id` and/or `clientId`)
 * when editing an existing entry; create mode leaves both fields empty so the
 * parent can stamp a fresh `clientId` before merging into `place.spaces`.
 *
 * Only languages with a non-empty name OR non-empty accessibility info are
 * included so empty tabs don't pollute the staged payload.
 */
function buildStagedSpace(): EventLocationSpace {
  const source = props.space ?? null;
  const staged = new EventLocationSpace(source?.id || undefined, source?.placeId || undefined);
  if (source?.clientId) {
    staged.clientId = source.clientId;
  }
  // eventCount is read-only — preserve the source row's value so the parent's
  // delete-dialog branch logic continues to work after an edit.
  if (source && typeof source.eventCount === 'number') {
    staged.eventCount = source.eventCount;
  }

  for (const lang of languages.value) {
    const name = (nameByLang[lang] ?? '').trim();
    const accessibilityInfo = (accessibilityByLang[lang] ?? '').trim();
    if (name.length > 0 || accessibilityInfo.length > 0) {
      staged.addContent(new EventLocationSpaceContent(lang, name, accessibilityInfo));
    }
  }
  return staged;
}

/**
 * Validate that at least one language has a non-empty name.
 */
function hasAtLeastOneName(): boolean {
  return languages.value.some(lang => (nameByLang[lang] ?? '').trim().length > 0);
}

function handleSave() {
  state.error = '';

  if (!hasAtLeastOneName()) {
    state.error = t('error_name_required');
    return;
  }

  const staged = buildStagedSpace();
  emit('save', staged);
}

function handleCancel() {
  emit('cancel');
}

/**
 * Initialize form state. In edit mode, populate per-language inputs from the
 * source `space` prop (the parent's working-buffer entry). The component does
 * not mutate the prop — `handleSave` emits a freshly-built staged copy.
 */
onBeforeMount(() => {
  // Always seed the default language so the form has at least one tab.
  if (!(defaultLanguage in nameByLang)) nameByLang[defaultLanguage] = '';
  if (!(defaultLanguage in accessibilityByLang)) accessibilityByLang[defaultLanguage] = '';

  const source = props.space ?? null;
  if (!source) {
    return;
  }

  const contentLanguages = source.getLanguages();
  for (const lang of contentLanguages) {
    if (!languages.value.includes(lang)) {
      languages.value.push(lang);
    }
    const c = source.content(lang);
    nameByLang[lang] = c.name ?? '';
    accessibilityByLang[lang] = c.accessibilityInfo ?? '';
  }
  if (contentLanguages.length > 0) {
    currentLanguage.value = contentLanguages[0];
  }
});
</script>

<template>
  <div class="space-editor">
    <form
      class="space-editor-form"
      :aria-label="t('editor_form_aria_label')"
      @submit.prevent="handleSave"
    >
      <header class="space-editor-header">
        <h3 class="space-editor-title">
          {{ isEditMode ? t('editor_title_edit') : t('editor_title_new') }}
        </h3>
      </header>

      <!-- Error display -->
      <div
        v-if="state.error"
        ref="errorContainer"
        class="space-editor-error"
        role="alert"
        aria-live="polite"
        tabindex="-1"
      >
        <button
          type="button"
          class="error-dismiss"
          :aria-label="t('dismiss_error')"
          @click="state.error = ''"
        >&times;</button>
        {{ state.error }}
      </div>

      <LanguageTabSelector
        ref="langTabs"
        v-model="currentLanguage"
        :languages="languages"
        @add-language="openLanguagePicker"
      />

      <div
        :id="langTabs?.panelId(currentLanguage)"
        role="tabpanel"
        :aria-labelledby="langTabs?.tabId(currentLanguage)"
        class="translatable-form-fields"
      >
        <div class="form-field">
          <label
            :for="`space-name-${currentLanguage}`"
            class="field-label"
          >
            {{ t('field_name') }}
            <span class="required-indicator" aria-hidden="true">*</span>
          </label>
          <input
            :id="`space-name-${currentLanguage}`"
            v-model="nameByLang[currentLanguage]"
            type="text"
            class="field-input"
            aria-required="true"
          />
        </div>

        <div class="form-field">
          <label
            :for="`space-accessibility-${currentLanguage}`"
            class="field-label"
          >
            {{ t('field_accessibility_info') }}
          </label>
          <textarea
            :id="`space-accessibility-${currentLanguage}`"
            v-model="accessibilityByLang[currentLanguage]"
            class="field-textarea"
            rows="4"
          />
        </div>
      </div>

      <footer class="space-editor-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="handleCancel"
        >
          {{ t('cancel') }}
        </button>
        <button
          type="submit"
          class="btn-save"
        >
          {{ t('done') }}
        </button>
      </footer>
    </form>

    <div v-if="showLanguagePicker">
      <language-picker
        :languages="availableLanguages"
        :selectedLanguages="languages"
        @close="closeLanguagePicker"
        @select="handleAddLanguage"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
/*
 * Form-field primitives (.form-field, .field-label, .field-input,
 * .field-textarea, .required-indicator) and the .translatable-form-fields
 * container live in the shared _translatable-form.scss partial loaded via
 * @layer components — see edit-place.vue for the other consumer.
 */

.space-editor {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
}

.space-editor-form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
  padding: var(--pav-space-lg);
  background: var(--pav-surface-primary);
  border: var(--pav-border-width-1) solid var(--pav-border-secondary);
  border-radius: var(--pav-border-radius-lg);
}

.space-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.space-editor-title {
  margin: 0;
  font-size: var(--pav-font-size-h5);
  font-weight: var(--pav-font-weight-medium);
  color: var(--pav-text-primary);
}

.space-editor-error {
  position: relative;
  color: var(--pav-text-primary);
  font-size: var(--pav-font-size-sm);
  padding: var(--pav-space-md) var(--pav-space-2xl) var(--pav-space-md) var(--pav-space-md);
  border-radius: var(--pav-border-radius-md);
  background-color: var(--pav-surface-secondary);
  border: var(--pav-border-width-1) solid var(--pav-color-red-200);
}

.error-dismiss {
  position: absolute;
  inset-block-start: var(--pav-space-sm);
  inset-inline-end: var(--pav-space-sm);
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--pav-font-size-base);
  line-height: 1;
  color: var(--pav-text-primary);
  padding: var(--pav-space-1);
  border-radius: var(--pav-border-radius-sm);

  &:hover {
    background-color: var(--pav-interactive-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-interactive-active);
    outline-offset: 2px;
  }
}

.space-editor-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--pav-space-md);
}

.btn-cancel {
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-text-secondary);
  font-size: var(--pav-font-size-sm);
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover:not(:disabled) {
    color: var(--pav-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-interactive-active);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-save {
  padding: var(--pav-space-sm) var(--pav-space-lg);
  border: none;
  background: var(--pav-color-interactive-active);
  color: var(--pav-text-inverse);
  font-size: var(--pav-font-size-sm);
  font-weight: var(--pav-font-weight-medium);
  cursor: pointer;
  border-radius: var(--pav-border-radius-full);
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-interactive-active);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
