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
      v-else-if="state.error"
      class="error"
      role="alert"
    >
      {{ state.error }}
    </div>

    <template v-else>
      <!-- Categories Selection -->
      <div v-if="state.availableCategories.length > 0" class="categories-list">
        <ToggleChip
          v-for="category in state.availableCategories"
          :key="category.id"
          :model-value="state.selectedCategoryIds.includes(category.id)"
          :label="category.content(currentLanguage)?.name || 'Unnamed Category'"
          variant="orange"
          @update:model-value="() => toggleCategory(category.id)"
        />
      </div>

      <!-- No Categories State -->
      <div v-else class="no-categories">
        <p>{{ t('no_categories_available') }}</p>
        <p class="help-text">{{ t('no_categories_help') }}</p>
      </div>

      <!-- Inline Create Category Trigger -->
      <button
        ref="addCategoryButtonRef"
        type="button"
        class="btn btn--ghost add-category-button"
        data-test="add-category-button"
        @click="openCreateCategory"
      >
        {{ t('add_category_button') }}
      </button>
    </template>

    <!-- Inline Create Category Modal -->
    <CategoryEditor
      v-if="state.showCategoryEditor && state.newCategory"
      :category="state.newCategory"
      @saved="onCategorySaved"
      @close="closeCategoryEditor"
    />
  </div>
</template>

<script setup>
import { reactive, computed, onMounted, ref, nextTick, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import CategoryService from '@/client/service/category';
import ToggleChip from '@/client/components/common/toggle-chip.vue';
import CategoryEditor from '@/client/components/logged_in/calendar-content/category-editor.vue';

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
const currentLanguage = computed(() => i18next.language);

// Template ref to the "+ New category" trigger button; used to restore focus
// when the CategoryEditor modal closes (WCAG 2.4.3 Focus Order, 2.4.7 Focus Visible).
const addCategoryButtonRef = ref(null);

const state = reactive({
  availableCategories: [],
  selectedCategoryIds: [],
  isLoading: false,
  error: '',
  showCategoryEditor: false,
  newCategory: null,
});

/**
 * Construct a fresh EventCategory scoped to the current calendar and open
 * the CategoryEditor modal in create mode. Uses DEFAULT_LANGUAGE_CODE so
 * the seeded content matches the editor's initial language tab.
 */
function openCreateCategory() {
  const fresh = new EventCategory('', props.calendarId);
  fresh.addContent(new EventCategoryContent(DEFAULT_LANGUAGE_CODE, ''));
  state.newCategory = fresh;
  state.showCategoryEditor = true;
}

/**
 * Handle the CategoryEditor modal's 'saved' emit: append to the available
 * list, auto-select the new category, and notify the parent editor.
 */
function onCategorySaved(savedCategory) {
  // Why: CategoryService.loadCategories() returns the same array reference that
  // Pinia stores in categoryStore.categories[calendarId]. CategoryService.saveCategory()
  // then mutates that same array via store.addCategory(...).push(savedCategory) before
  // emitting 'saved'. As a result, state.availableCategories has already grown by one
  // when this handler runs, so a naive [...state.availableCategories, savedCategory]
  // would render the new chip twice. Dedupe by id to stay correct regardless of whether
  // the saved category is already present (defensive — fixing the broader service/store
  // coupling is out of scope for this bead; see pv-asqb).
  const existingIds = new Set(state.availableCategories.map(c => c.id));
  if (!existingIds.has(savedCategory.id)) {
    state.availableCategories = [...state.availableCategories, savedCategory];
  }
  if (!state.selectedCategoryIds.includes(savedCategory.id)) {
    state.selectedCategoryIds.push(savedCategory.id);
    emit('categoriesChanged', [...state.selectedCategoryIds]);
  }
}

/**
 * Close the CategoryEditor modal without applying any state changes.
 * Restores keyboard focus to the trigger button for WCAG 2.4.3 / 2.4.7
 * compliance so sighted keyboard users are not dropped onto document.body.
 */
function closeCategoryEditor() {
  state.showCategoryEditor = false;
  state.newCategory = null;
  nextTick(() => {
    addCategoryButtonRef.value?.focus();
  });
}

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

  // Emit the selected category IDs as strings
  emit('categoriesChanged', [...state.selectedCategoryIds]);
}

/**
 * Initialize selected categories from props.
 * The prop may contain string IDs or objects with an .id property.
 */
function initializeSelectedCategories() {
  if (props.selectedCategories && props.selectedCategories.length > 0) {
    state.selectedCategoryIds = props.selectedCategories.map(cat =>
      typeof cat === 'string' ? cat : cat.id,
    );
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

// Watch for selectedCategories prop changes, including the initial value on mount.
// Using { immediate: true } ensures pre-selected category IDs from the parent
// (e.g. in duplicate mode) are applied as soon as the component is created,
// even before the async loadCategories() call completes.
watch(() => props.selectedCategories, () => {
  initializeSelectedCategories();
}, { deep: true, immediate: true });

// Load categories when component mounts
onMounted(async () => {
  await loadCategories();
});
</script>

<style scoped lang="scss">
@use '@/client/assets/style/components/event-management' as *;

.category-selector {
  margin-bottom: var(--pav-space-6);
}

.category-label {
  @include section-label;
  display: block;
  margin-bottom: var(--pav-space-4);
}

.loading {
  text-align: center;
  padding: var(--pav-space-4);
  color: var(--pav-text-secondary);
  font-size: var(--pav-font-size-small);
  font-style: italic;
}

.error {
  padding: var(--pav-space-4);
  margin-bottom: var(--pav-space-4);
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);
  border-radius: var(--pav-border-radius-lg);
  color: var(--pav-color-red-700);
  font-size: var(--pav-font-size-small);

  @media (prefers-color-scheme: dark) {
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
    color: var(--pav-color-red-300);
  }
}

.categories-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--pav-space-3);

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}

.no-categories {
  text-align: center;
  padding: var(--pav-space-6) var(--pav-space-4);
  color: var(--pav-text-muted);
  font-size: var(--pav-font-size-small);

  p {
    margin: 0 0 var(--pav-space-2) 0;

    &.help-text {
      font-size: var(--pav-font-size-caption);
      color: var(--pav-text-muted);
    }
  }
}

.add-category-button {
  margin-block-start: var(--pav-space-3);
}
</style>
