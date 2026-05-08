<template>
  <ModalLayout
    :title="localCategory?.id ? t('edit_category_title') : t('add_category_title')"
    modal-class="category-editor-modal"
    @close="$emit('close')"
  >
    <div class="category-editor">
      <div
        v-if="state.error"
        class="alert alert--error"
        role="alert"
      >
        {{ state.error }}
      </div>

      <p class="form-helper">{{ t('category_name_help') }}</p>

      <div class="language-fields">
        <div
          v-for="lang in localCategory?.getLanguages()"
          :key="lang"
          class="language-field"
        >
          <label class="language-label">{{ iso6391.getNativeName(lang) }}:</label>
          <div class="language-input-wrapper">
            <input
              type="text"
              class="language-input"
              v-model="localCategory.content(lang).name"
              :dir="iso6391.getDir(lang) == 'rtl' ? 'rtl' : ''"
              :placeholder="t('category_name_placeholder')"
              :disabled="state.isSaving"
              @keyup.enter="saveCategory"
              ref="categoryNameInput"
            />
            <button
              v-if="localCategory && localCategory.getLanguages().length > 1"
              type="button"
              class="remove-language-button"
              :aria-label="t('remove_language')"
              @click="removeLanguage(lang)"
            >
              <X :size="16" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="add-language-button"
        @click="openLanguagePicker"
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
          @click="saveCategory"
          :disabled="state.isSaving || !canSaveCategory()"
        >
          {{ state.isSaving ? (localCategory?.id ? t('updating') : t('creating')) : (localCategory?.id ? t('save_button') : t('create_button')) }}
        </PillButton>
      </div>
    </div>

    <!-- Language Picker - Inside dialog for proper z-index layering -->
    <LanguagePicker
      v-if="showLanguagePicker"
      :languages="availableLanguages"
      :selectedLanguages="localCategory ? localCategory.getLanguages() : []"
      @select="handleAddLanguage"
      @close="closeLanguagePicker"
    />
  </ModalLayout>
</template>

<script setup>
import { reactive, ref, nextTick, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { X } from 'lucide-vue-next';
import iso6391 from 'iso-639-1-dir';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { DuplicateCategoryNameError } from '@/common/exceptions/category';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import CategoryService from '@/client/service/category';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';
import ModalLayout from '@/client/components/common/modal.vue';
import LanguagePicker from '@/client/components/common/language-picker.vue';
import PillButton from '@/client/components/common/pill-button.vue';

const emit = defineEmits(['close', 'saved']);

const props = defineProps({
  category: {
    type: Object, // EventCategory
    required: true,
  },
});

const { t } = useTranslation('categories', {
  keyPrefix: 'management',
});

const categoryService = new CategoryService();

const state = reactive({
  isSaving: false,
  error: '',
});

// Create a local copy of the category to avoid mutating props
const localCategory = ref(null);

// Language management composable. Entity-level side effects (adding/dropping
// per-language content on the category) are wired through the hooks; the
// composable owns only UI state (active languages, current selection,
// picker modal visibility). Destructured so refs auto-unwrap in the
// template.
const {
  languages,
  availableLanguages,
  showLanguagePicker,
  addLanguage,
  removeLanguage,
  openLanguagePicker,
  closeLanguagePicker,
} = useLanguageManagement({
  onLanguageAdded: (language) => {
    if (!localCategory.value) return;
    if (localCategory.value.getLanguages().includes(language)) return;
    localCategory.value.addContent(new EventCategoryContent(language, ''));
  },
  onLanguageRemoved: (language) => {
    if (!localCategory.value) return;
    localCategory.value.dropContent(language);
  },
});

// Initialize the local category when props change. Re-seed the language
// composable's active list from the entity so async-loaded categories
// populate `availableLanguages` (which the picker excludes from). The
// composable's `currentLanguage` is unused here — this component renders
// all languages inline via v-for rather than via a tab selector.
watch(() => props.category, (newCategory) => {
  if (newCategory) {
    localCategory.value = newCategory;
    const categoryLanguages = newCategory.getLanguages();
    if (categoryLanguages.length > 0) {
      languages.value = [...new Set([DEFAULT_LANGUAGE_CODE, ...categoryLanguages])];
    }
  }
}, { immediate: true });

const categoryNameInput = ref(null);

/**
 * Check if the category can be saved (has at least one non-empty name)
 */
function canSaveCategory() {
  if (!localCategory.value) return false;
  const categoryLanguages = localCategory.value.getLanguages();
  return categoryLanguages.some(language => {
    const content = localCategory.value.content(language);
    return content && content.name.trim().length > 0;
  });
}

/**
 * Save the category
 */
async function saveCategory() {
  if (!canSaveCategory()) {
    state.error = t('error_empty_name');
    return;
  }

  state.isSaving = true;
  state.error = '';

  try {
    let savedCategory;
    savedCategory = await categoryService.saveCategory(localCategory.value);

    emit('saved', savedCategory);
    emit('close');
  }
  catch (error) {
    if (error instanceof DuplicateCategoryNameError) {
      state.error = t('error_duplicate_name');
    }
    else {
      console.error('Error saving category:', error);
      state.error = localCategory.value?.id ? t('error_update_category') : t('error_create_category');
    }
  }
  finally {
    state.isSaving = false;
  }
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
    // categoryNameInput.value is an array because the ref is used in a v-for
    const firstInput = Array.isArray(categoryNameInput.value)
      ? categoryNameInput.value[0]
      : categoryNameInput.value;
    if (firstInput) {
      firstInput.focus();
    }
  });
});
</script>

<style lang="scss" scoped>
@use '../../../assets/style/components/calendar-admin' as *;

// Constrain modal width to match reference design
:global(.category-editor-modal > div) {
  max-width: 600px !important;
}

.category-editor {
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

.language-fields {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
}

.language-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--pav-space-3);
}

.language-label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--pav-color-stone-700);
  min-width: 80px;
  flex-shrink: 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.language-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--pav-space-2);
  flex: 1;
}

.language-input {
  @include admin-form-input;
  flex: 1;
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
