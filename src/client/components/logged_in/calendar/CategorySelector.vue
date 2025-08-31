<template>
  <div class="category-selector">
    <label class="category-label">{{ t('categories_label') }}</label>

    <!-- Loading State -->
    <div v-if="state.isLoading" class="loading">
      {{ t('loading_categories') }}
    </div>

    <!-- Error State -->
    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>

    <!-- Categories Selection -->
    <div v-else-if="state.availableCategories.length > 0" class="categories-list">
      <div
        v-for="category in state.availableCategories"
        :key="category.id"
        class="category-option"
        :class="{ 'selected': state.selectedCategoryIds.includes(category.id) }"
        @click="toggleCategory(category.id)"
      >
        <input
          type="checkbox"
          :checked="state.selectedCategoryIds.includes(category.id)"
          @change="toggleCategory(category.id)"
        />
        <span class="category-name">{{ category.content(currentLanguage)?.name || 'Unnamed Category' }}</span>
      </div>
    </div>

    <!-- No Categories State -->
    <div v-else class="no-categories">
      <p>{{ t('no_categories_available') }}</p>
      <p class="help-text">{{ t('no_categories_help') }}</p>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import CategoryService from '@/client/service/category';

const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
  selectedCategories: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['categoriesChanged']);

const { t } = useTranslation('event_editor', {
  keyPrefix: 'categories',
});

const categoryService = new CategoryService();
const currentLanguage = 'en'; // TODO: Get from language picker/preference

const state = reactive({
  availableCategories: [],
  selectedCategoryIds: [],
  isLoading: false,
  error: '',
});

/**
 * Load categories for the calendar
 */
async function loadCategories() {
  if (!props.calendarId) return;

  state.isLoading = true;
  state.error = '';

  try {
    state.availableCategories = await categoryService.loadCategories(props.calendarId);
  }
  catch (error) {
    console.error('Error loading categories:', error);
    state.error = t('error_loading_categories');
  }
  finally {
    state.isLoading = false;
  }
}

/**
 * Toggle a category selection
 */
function toggleCategory(categoryId) {
  const index = state.selectedCategoryIds.indexOf(categoryId);
  if (index >= 0) {
    // Remove category
    state.selectedCategoryIds.splice(index, 1);
  }
  else {
    // Add category
    state.selectedCategoryIds.push(categoryId);
  }

  // Emit the selected category objects
  const selectedCategories = state.availableCategories.filter(
    cat => state.selectedCategoryIds.includes(cat.id),
  );
  emit('categoriesChanged', selectedCategories);
}

/**
 * Initialize selected categories from props
 */
function initializeSelectedCategories() {
  if (props.selectedCategories && props.selectedCategories.length > 0) {
    state.selectedCategoryIds = props.selectedCategories.map(cat => cat.id);
  }
  else {
    state.selectedCategoryIds = [];
  }
}

// Watch for calendar changes to reload categories
watch(() => props.calendarId, (newCalendarId) => {
  if (newCalendarId) {
    loadCategories();
  }
});

// Watch for selectedCategories prop changes
watch(() => props.selectedCategories, () => {
  initializeSelectedCategories();
}, { deep: true });

// Load categories when component mounts
onMounted(async () => {
  initializeSelectedCategories();
  await loadCategories();
});
</script>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

.category-selector {
  margin-bottom: 20px;
}

.category-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--color-text, #374151);
}

.loading {
  text-align: center;
  padding: 16px;
  color: var(--color-text-secondary, #6b7280);
  font-size: 14px;
}

.error {
  padding: 12px;
  margin-bottom: 16px;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  color: rgb(153, 27, 27);
  font-size: 14px;
}

.categories-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: 6px;
  padding: 8px;
}

.category-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: var(--color-surface-hover, #f9fafb);
  }

  &.selected {
    background-color: var(--color-primary-light, #fef3c7);
    border-color: var(--color-primary, #ea580c);
  }
}

.category-option input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

.category-name {
  flex: 1;
  font-size: 14px;
  color: var(--color-text, #374151);
}

.no-categories {
  text-align: center;
  padding: 24px 16px;
  color: var(--color-text-secondary, #6b7280);

  p {
    margin: 0 0 8px 0;

    &.help-text {
      font-size: 12px;
      color: var(--color-text-tertiary, #9ca3af);
    }
  }
}

@include dark-mode {
  .category-label {
    color: var(--color-text-dark, #f9fafb);
  }

  .category-option {
    &:hover {
      background-color: var(--color-surface-hover-dark, #374151);
    }

    &.selected {
      background-color: var(--color-primary-light-dark, #451a03);
    }
  }

  .category-name {
    color: var(--color-text-dark, #f9fafb);
  }

  .categories-list {
    border-color: var(--color-border-dark, #4b5563);
    background-color: var(--color-surface-dark, #1f2937);
  }
}
</style>
