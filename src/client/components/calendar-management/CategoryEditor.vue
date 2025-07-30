<template>
  <ModalLayout
    :title="props.category.id ? t('edit_category_title') : t('add_category_title')"
    @close="$emit('close')"
  >
    <div class="category-editor">
      <div v-if="state.error" class="error">
        {{ state.error }}
      </div>
      <div class="form-group">
        <p class="help-text">{{ t('category_name_help') }}</p>
        <label v-for="lang in props.category.getLanguages()" for="categoryName">
          <span class="labeltext">{{ iso6391.getNativeName(lang) }}:</span>
          <input
            id="categoryName"
            type="text"
            v-model="props.category.content(lang).name"
            :dir="iso6391.getDir(lang) == 'rtl' ? 'rtl' : ''"
            :placeholder="t('category_name_placeholder')"
            :disabled="state.isSaving"
            @keyup.enter="saveCategory"
            ref="categoryNameInput"
          />
          <button
            v-if="props.category && props.category.getLanguages().length > 1"
            type="button"
            class="remove-language-btn"
            aria-label="Remove Language"
            @click="removeLanguage(lang)"
          >
            ×
          </button>
        </label>
      </div>
      <div class="form-group controls">
        <button
          type="button"
          class="add-language-btn"
          @click="state.showLanguagePicker = true"
        >
          {{ t('add_language') }}
        </button>
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="primary"
          @click="saveCategory"
          :disabled="state.isSaving || !canSaveCategory()"
        >
          {{ state.isSaving ? (props.category.id ? t('updating') : t('creating')) : (props.category.id ? t('save_button') : t('create_button')) }}
        </button>
        <button
          type="button"
          @click="$emit('close')"
          :disabled="state.isSaving"
        >
          {{ t('cancel_button') }}
        </button>
      </div>
    </div>
  </ModalLayout>

  <!-- Language Picker -->
  <LanguagePicker
    v-if="state.showLanguagePicker"
    :languages="availableLanguages"
    :selectedLanguages="props.category ? props.category.getLanguages() : []"
    @select="addLanguage"
    @close="state.showLanguagePicker = false"
  />
</template>

<script setup>
import { reactive, ref, nextTick, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import iso6391 from 'iso-639-1-dir';
import { EventCategoryContent } from '../../../common/model/event_category_content';
import CategoryService from '../../service/category';
import ModalLayout from '../modal.vue';
import LanguagePicker from '../languagePicker.vue';

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

const categoryNameInput = ref(null);

/**
 * Check if the category can be saved (has at least one non-empty name)
 */
function canSaveCategory() {
  if (!props.category) return false;
  const languages = props.category.getLanguages();
  return languages.some(lang => {
    const content = props.category.content(lang);
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
    console.log('Saving category:', props.category);
    savedCategory = await categoryService.saveCategory(props.category);

    emit('saved', savedCategory);
    emit('close');
  }
  catch (error) {
    console.error('Error saving category:', error);
    state.error = props.category.id ? t('error_update_category') : t('error_create_category');
  }
  finally {
    state.isSaving = false;
  }
}

/**
 * Add a new language to the category
 */
function addLanguage(language) {
  if (!props.category) return;

  // Check if language already exists
  if (props.category.getLanguages().includes(language)) {
    state.showLanguagePicker = false;
    return;
  }

  // Add new language with empty content
  props.category.addContent(new EventCategoryContent(language, ''));
  state.currentLanguage = language;
  state.showLanguagePicker = false;
}

/**
 * Remove a language from the category
 */
function removeLanguage(language) {
  if (!props.category) return;

  // Don't allow removing the last language
  if (props.category.getLanguages().length <= 1) {
    return;
  }

  props.category.dropContent(language);

  // Switch to the first available language
  const remainingLanguages = props.category.getLanguages();
  if (remainingLanguages.length > 0) {
    state.currentLanguage = remainingLanguages[0];
  }
}

// Focus input when component mounts
onMounted(() => {
  // Set current language to first available language
  const languages = props.category.getLanguages();
  if (languages.length > 0) {
    state.currentLanguage = languages[0];
  }

  nextTick(() => {
    if (categoryNameInput.value) {
      categoryNameInput.value.focus();
    }
  });
});
</script>

<style>

dialog .modal-content {
  max-width: 500px;
}
.category-editor {
  padding: 1rem;
}

.form-group {
  margin-bottom: 1rem;

  &.controls {
    text-align: center;
  }

  label {
  display: grid;
  grid-template-columns: 60px 1fr 48px;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-primary);
  width: 100%;
  padding: 0.75rem;
  border-radius: 0.375rem;
  border-color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.2);
  align-items: center;

  span.labeltext {
    display: block;
    font-size: 80%;
    grid-column-start: 1;
    grid-column-end: 2;
  }
  input {
    font-size: 1rem;
    flex: 1;
    background: transparent;
    border: none;
    margin: 0 0.5rem;
    grid-column-start: 2;
    grid-column-end: 3;
  }
  button {
    grid-column-start: 3;
    grid-column-end: 4;
    margin-left: 15px;
  }
}
}

.help-text {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}

.error {
  color: var(--error-color);
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: var(--error-background);
  border: 1px solid var(--error-border);
  border-radius: 0.375rem;
}
</style>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.language-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.language-tabs {
  display: flex;
  gap: 5px;
}

.remove-language-btn {
  padding: 5px 10px;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;

  &:hover {
    background: #c82333;
    border-color: #bd2130;
  }
}
</style>
