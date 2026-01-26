<template>
  <ModalLayout
    :title="localCategory?.id ? t('edit_category_title') : t('add_category_title')"
    modal-class="category-editor-modal"
    @close="$emit('close')"
  >
    <div class="category-editor">
      <div v-if="state.error" class="alert alert--error">
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
              aria-label="Remove Language"
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
          @click="saveCategory"
          :disabled="state.isSaving || !canSaveCategory()"
        >
          {{ state.isSaving ? (localCategory?.id ? t('updating') : t('creating')) : (localCategory?.id ? t('save_button') : t('create_button')) }}
        </PillButton>
      </div>
    </div>

    <!-- Language Picker - Inside dialog for proper z-index layering -->
    <LanguagePicker
      v-if="state.showLanguagePicker"
      :languages="availableLanguages"
      :selectedLanguages="localCategory ? localCategory.getLanguages() : []"
      @select="addLanguage"
      @close="state.showLanguagePicker = false"
    />
  </ModalLayout>
</template>

<script setup>
import { reactive, ref, nextTick, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { X } from 'lucide-vue-next';
import iso6391 from 'iso-639-1-dir';
import { EventCategoryContent } from '@/common/model/event_category_content';
import CategoryService from '@/client/service/category';
import ModalLayout from '@/client/components/common/modal.vue';
import LanguagePicker from '@/client/components/common/languagePicker.vue';
import PillButton from '@/client/components/common/PillButton.vue';

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

// Create a local copy of the category to avoid mutating props
const localCategory = ref(null);

// Initialize the local category when props change
watch(() => props.category, (newCategory) => {
  if (newCategory) {
    localCategory.value = newCategory;
  }
}, { immediate: true });

const categoryNameInput = ref(null);

/**
 * Check if the category can be saved (has at least one non-empty name)
 */
function canSaveCategory() {
  if (!localCategory.value) return false;
  const languages = localCategory.value.getLanguages();
  return languages.some(lang => {
    const content = localCategory.value.content(lang);
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
    console.error('Error saving category:', error);
    state.error = localCategory.value?.id ? t('error_update_category') : t('error_create_category');
  }
  finally {
    state.isSaving = false;
  }
}

/**
 * Add a new language to the category
 */
function addLanguage(language) {
  if (!localCategory.value) return;

  // Check if language already exists
  if (localCategory.value.getLanguages().includes(language)) {
    state.showLanguagePicker = false;
    return;
  }

  // Add new language with empty content
  localCategory.value.addContent(new EventCategoryContent(language, ''));
  state.currentLanguage = language;
  state.showLanguagePicker = false;
}

/**
 * Remove a language from the category
 */
function removeLanguage(language) {
  if (!localCategory.value) return;

  // Don't allow removing the last language
  if (localCategory.value.getLanguages().length <= 1) {
    return;
  }

  localCategory.value.dropContent(language);

  // Switch to the first available language
  const remainingLanguages = localCategory.value.getLanguages();
  if (remainingLanguages.length > 0) {
    state.currentLanguage = remainingLanguages[0];
  }
}

// Focus input when component mounts
onMounted(() => {
  // Set current language to first available language
  const languages = localCategory.value?.getLanguages();
  if (languages && languages.length > 0) {
    state.currentLanguage = languages[0];
  }

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
