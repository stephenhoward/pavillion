<template>
  <div class="category-selector">
    <label class="category-label">{{ t('categories_label') }}</label>

    <!-- Loading State -->
    <div
      v-if="state.isLoading"
      class="loading"
      role="status"
      aria-live="polite"
    >
      {{ t('loading_categories') }}
    </div>

    <!-- Error State -->
    <div
      v-if="state.error"
      class="error"
      role="alert"
    >
      {{ state.error }}
    </div>

    <!-- Categories Selection -->
    <div v-else-if="state.availableCategories.length > 0" class="categories-list">
      <ToggleChip
        v-for="category in state.availableCategories"
        :key="category.id"
        :model-value="state.selectedCategoryIds.includes(category.id)"
        :label="category.content(currentLanguage)?.name || 'Unnamed Category'"
        @update:model-value="() => toggleCategory(category.id)"
      />
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
import ToggleChip from '@/client/components/common/ToggleChip.vue';

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
@use '@/client/assets/style/components/event-management' as *;

.category-selector {
  margin-bottom: 1.5rem;
}

.category-label {
  @include section-label;
  display: block;
  margin-bottom: 1rem;
}

.loading {
  text-align: center;
  padding: 1rem;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  font-style: italic;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.error {
  padding: 1rem;
  margin-bottom: 1rem;
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);
  border-radius: 0.75rem; // rounded-xl
  color: var(--pav-color-red-700);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
    color: var(--pav-color-red-300);
  }
}

.categories-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}

.no-categories {
  text-align: center;
  padding: 1.5rem 1rem;
  color: var(--pav-color-stone-500);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }

  p {
    margin: 0 0 0.5rem 0;

    &.help-text {
      font-size: 0.75rem;
      color: var(--pav-color-stone-400);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-500);
      }
    }
  }
}
</style>
