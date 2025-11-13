<template>
  <div class="vstack stack--lg" :aria-busy="state.isLoading ? 'true': 'false'">

    <!-- Error Display -->
    <div v-if="state.error" class="alert alert--error">
      {{ state.error }}
    </div>

    <!-- Success Message -->
    <div v-if="state.successMessage" class="alert alert--success">
      {{ state.successMessage }}
    </div>

    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Categories List -->
    <div v-else-if="state.categories.length > 0" class="vstack stack--md">
      <div class="hstack hstack--between">
        <button
          type="button"
          class="primary"
          @click="openCreateEditor"
        >
          {{ t('add_category_button') }}
        </button>
      </div>
      <div
        v-for="category in state.categories"
        :key="category.id"
        class="hstack hstack--between stack--md category-item"
      >
        <div class="hstack stack--sm category-info-with-checkbox">
          <input
            type="checkbox"
            :checked="state.selectedCategories.has(category.id)"
            @change="toggleCategorySelection(category.id)"
            :aria-label="`Select ${category.content(currentLanguage)?.name || 'Unnamed Category'}`"
          />
          <div class="category-info">
            <span class="category-name">
              {{ category.content(currentLanguage)?.name || 'Unnamed Category' }}
              <span class="event-count">({{ category.eventCount || 0 }})</span>
            </span>
          </div>
        </div>
        <div class="hstack stack--sm">
          <button
            type="button"
            class="btn btn--sm btn--secondary"
            @click="openEditEditor(category)"
            :disabled="state.isDeleting === category.id"
          >
            {{ t('edit_button') }}
          </button>
          <button
            type="button"
            class="btn btn--sm btn--danger"
            @click="confirmDeleteCategory(category)"
            :disabled="state.isDeleting === category.id"
          >
            {{ state.isDeleting === category.id ? t('deleting') : t('delete_button') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <EmptyLayout v-else :title="t('no_categories')" :description="t('no_categories_description')">
      <button
        type="button"
        class="primary"
        @click="openCreateEditor"
        :disabled="state.isLoading"
      >
        {{ t('add_category_button') }}
      </button>
    </EmptyLayout>

    <!-- Category Editor Modal -->
    <CategoryEditor
      v-if="state.showEditor && state.categoryToEdit"
      :category="state.categoryToEdit"
      @close="closeEditor"
      @saved="onCategorySaved"
    />

    <!-- Enhanced Delete Category Modal -->
    <ModalLayout
      v-if="state.showDeleteDialog && state.categoryToDelete"
      :title="t('confirm_delete_title')"
      @close="cancelDeleteCategory"
    >
      <div class="delete-dialog">
        <p>
          {{ t('confirm_delete_message', {
            name: state.categoryToDelete.content(currentLanguage)?.name || 'Unnamed Category',
            count: state.categoryToDelete.eventCount || 0
          }) }}
        </p>

        <div class="vstack stack--md">
          <label class="radio-option">
            <input
              type="radio"
              v-model="state.deleteAction"
              value="remove"
              name="delete-action"
            />
            <span>{{ t('delete_option_remove') }}</span>
          </label>

          <label class="radio-option">
            <input
              type="radio"
              v-model="state.deleteAction"
              value="migrate"
              name="delete-action"
            />
            <span>{{ t('delete_option_migrate') }}</span>
          </label>

          <div v-if="state.deleteAction === 'migrate'" class="migration-target-selector">
            <label for="migration-target">{{ t('migrate_to_label') }}</label>
            <select
              id="migration-target"
              v-model="state.deleteMigrationTarget"
              class="migration-target"
            >
              <option value="">{{ t('select_category') }}</option>
              <option
                v-for="cat in otherCategories"
                :key="cat.id"
                :value="cat.id"
              >
                {{ cat.content(currentLanguage)?.name || 'Unnamed Category' }}
              </option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="danger btn-confirm-delete"
            @click="deleteCategory"
            :disabled="!canConfirmDelete || state.isDeleting === state.categoryToDelete?.id"
          >
            {{ state.isDeleting === state.categoryToDelete?.id ? t('deleting') : t('delete_button') }}
          </button>
          <button
            type="button"
            @click="cancelDeleteCategory"
            :disabled="state.isDeleting === state.categoryToDelete?.id"
          >
            {{ t('cancel') }}
          </button>
        </div>
      </div>
    </ModalLayout>

    <!-- Merge Categories Modal -->
    <ModalLayout
      v-if="state.showMergeDialog"
      :title="t('merge_categories_title')"
      @close="cancelMergeDialog"
    >
      <div class="merge-dialog">
        <p>{{ t('merge_categories_description') }}</p>

        <div class="vstack stack--md">
          <div class="merge-category-list">
            <label
              v-for="category in selectedCategoriesArray"
              :key="category.id"
              class="radio-option"
            >
              <input
                type="radio"
                v-model="state.mergeTargetId"
                :value="category.id"
                name="merge-target"
              />
              <span>
                {{ category.content(currentLanguage)?.name || 'Unnamed Category' }}
                <span class="event-count">({{ category.eventCount || 0 }} {{ t('events') }})</span>
              </span>
            </label>
          </div>

          <div class="total-events">
            <strong>{{ t('total_affected_events') }}:</strong> {{ totalAffectedEvents }}
          </div>
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="primary btn-confirm-merge"
            @click="mergeCategories"
            :disabled="!state.mergeTargetId || state.isMerging"
          >
            {{ state.isMerging ? t('merging') : t('merge_button') }}
          </button>
          <button
            type="button"
            @click="cancelMergeDialog"
            :disabled="state.isMerging"
          >
            {{ t('cancel') }}
          </button>
        </div>
      </div>
    </ModalLayout>

    <!-- Bulk Categories Menu -->
    <BulkCategoriesMenu
      :selected-count="selectedCount"
      @merge-categories="openMergeDialog"
      @deselect-all="deselectAll"
    />
  </div>
</template>

<script setup>
import { reactive, onMounted, ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { EventCategory } from '@/common/model/event_category';
import CategoryService from '@/client/service/category';
import CategoryEditor from './CategoryEditor.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import { EventCategoryContent } from '@/common/model/event_category_content';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import BulkCategoriesMenu from './BulkCategoriesMenu.vue';

const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['categoriesUpdated']);

const { t } = useTranslation('calendars', {
  keyPrefix: 'management',
});

const categoryService = new CategoryService();
const currentLanguage = 'en'; // TODO: Get from language picker/preference

const state = reactive({
  categories: [],
  isLoading: false,
  error: '',
  successMessage: '',

  // Editor state
  showEditor: false,
  categoryToEdit: null,
  isDeleting: '',

  // Bulk selection state
  selectedCategories: new Set(),

  // Delete dialog state
  showDeleteDialog: false,
  categoryToDelete: null,
  deleteAction: '',
  deleteMigrationTarget: '',

  // Merge dialog state
  showMergeDialog: false,
  mergeTargetId: '',
  isMerging: false,
});

const categoryNameInput = ref(null);

/**
 * Computed: Get categories excluding the one being deleted
 */
const otherCategories = computed(() => {
  if (!state.categoryToDelete) {
    return state.categories;
  }
  return state.categories.filter(cat => cat.id !== state.categoryToDelete.id);
});

/**
 * Computed: Check if delete can be confirmed
 */
const canConfirmDelete = computed(() => {
  if (!state.deleteAction) {
    return false;
  }
  if (state.deleteAction === 'migrate' && !state.deleteMigrationTarget) {
    return false;
  }
  return true;
});

/**
 * Computed: Get array of selected categories
 */
const selectedCategoriesArray = computed(() => {
  return state.categories.filter(cat => state.selectedCategories.has(cat.id));
});

/**
 * Computed: Calculate total affected events for merge
 */
const totalAffectedEvents = computed(() => {
  return selectedCategoriesArray.value.reduce((sum, cat) => sum + (cat.eventCount || 0), 0);
});

/**
 * Computed: Get count of selected categories
 */
const selectedCount = computed(() => {
  return state.selectedCategories.size;
});

/**
 * Load categories from the server
 */
async function loadCategories() {
  state.isLoading = true;
  state.error = '';
  state.successMessage = '';

  try {
    state.categories = await categoryService.loadCategories(props.calendarId);
  }
  catch (error) {
    console.error('Error loading categories:', error);
    state.error = t('error_loading');
  }
  finally {
    state.isLoading = false;
  }
}

/**
 * Toggle category selection for bulk operations
 */
function toggleCategorySelection(categoryId) {
  if (state.selectedCategories.has(categoryId)) {
    state.selectedCategories.delete(categoryId);
  }
  else {
    state.selectedCategories.add(categoryId);
  }
}

/**
 * Open the category editor for creating a new category
 */
function openCreateEditor() {
  const newCategory = new EventCategory(
    null, // ID will be generated by the server
    props.calendarId,
  );
  // Initialize with current language
  newCategory.addContent(EventCategoryContent.fromObject({
    language: 'en',
    name: '',
  }));
  state.categoryToEdit = newCategory;
  state.showEditor = true;
}

/**
 * Open the category editor for editing an existing category
 */
function openEditEditor(category) {
  // Create a copy of the category for editing
  const categoryToEdit = new EventCategory(
    category.id,
    category.calendarId,
  );

  // Copy all content from the original category
  const languages = category.getLanguages();
  languages.forEach(lang => {
    const content = category.content(lang);
    if (content) {
      categoryToEdit.addContent(EventCategoryContent.fromObject({
        language: lang,
        name: content.name,
      }));
    }
  });

  state.categoryToEdit = categoryToEdit;
  state.showEditor = true;
}

/**
 * Close the category editor
 */
function closeEditor() {
  state.showEditor = false;
  state.categoryToEdit = null;
}

/**
 * Handle category saved from editor
 */
async function onCategorySaved() {
  await loadCategories();
  emit('categoriesUpdated');
}

/**
 * Confirm delete category - open dialog
 */
function confirmDeleteCategory(category) {
  state.categoryToDelete = category;
  state.showDeleteDialog = true;
  state.deleteAction = 'migrate';
  state.deleteMigrationTarget = '';
}

/**
 * Cancel delete category
 */
function cancelDeleteCategory() {
  state.categoryToDelete = null;
  state.showDeleteDialog = false;
  state.deleteAction = '';
  state.deleteMigrationTarget = '';
  state.isDeleting = '';
}

/**
 * Delete a category with migration options
 */
async function deleteCategory() {
  if (!state.categoryToDelete || !canConfirmDelete.value) {
    return;
  }

  state.isDeleting = state.categoryToDelete.id;
  state.error = '';

  try {
    const affectedEventCount = await categoryService.deleteCategory(
      state.categoryToDelete.id,
      props.calendarId,
      state.deleteAction,
      state.deleteMigrationTarget || undefined
    );

    state.successMessage = t('category_deleted_success', { count: affectedEventCount });

    await loadCategories();
    cancelDeleteCategory();
    emit('categoriesUpdated');

    // Clear success message after 3 seconds
    setTimeout(() => {
      state.successMessage = '';
    }, 3000);
  }
  catch (error) {
    console.error('Error deleting category:', error);
    state.error = t('error_deleting');
  }
  finally {
    state.isDeleting = '';
  }
}

/**
 * Open merge categories dialog
 */
function openMergeDialog() {
  state.showMergeDialog = true;
  // Default to first selected category as target
  const firstSelected = Array.from(state.selectedCategories)[0];
  state.mergeTargetId = firstSelected || '';
}

/**
 * Cancel merge dialog
 */
function cancelMergeDialog() {
  state.showMergeDialog = false;
  state.mergeTargetId = '';
}

/**
 * Deselect all categories
 */
function deselectAll() {
  state.selectedCategories.clear();
}

/**
 * Merge selected categories
 */
async function mergeCategories() {
  if (!state.mergeTargetId || state.selectedCategories.size < 2) {
    return;
  }

  state.isMerging = true;
  state.error = '';

  try {
    // Get source categories (all selected except target)
    const sourceCategoryIds = Array.from(state.selectedCategories).filter(
      id => id !== state.mergeTargetId
    );

    const result = await categoryService.mergeCategories(
      props.calendarId,
      state.mergeTargetId,
      sourceCategoryIds
    );

    state.successMessage = t('categories_merged_success', {
      count: result.totalAffectedEvents
    });

    // Clear selection
    state.selectedCategories.clear();

    await loadCategories();
    cancelMergeDialog();
    emit('categoriesUpdated');

    // Clear success message after 3 seconds
    setTimeout(() => {
      state.successMessage = '';
    }, 3000);
  }
  catch (error) {
    console.error('Error merging categories:', error);
    state.error = t('error_merging');
  }
  finally {
    state.isMerging = false;
  }
}

// Load categories when component mounts
onMounted(async () => {
  await loadCategories();
});
</script>

<style scoped lang="scss">
.category-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  transition: border-color 0.2s ease;

  &:hover {
    border-color: var(--color-border-hover);
  }
}

.category-info-with-checkbox {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;

  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }
}

.category-info {
  flex: 1;

  .category-name {
    font-weight: 500;
    color: var(--color-text);

    .event-count {
      font-weight: 400;
      color: var(--color-text-secondary);
      margin-left: 4px;
    }
  }
}

.category-actions {
  display: flex;
  gap: 8px;

  button {
    padding: 6px 12px;
    font-size: 14px;
  }
}

.delete-dialog,
.merge-dialog {
  p {
    margin: 0 0 24px 0;
    color: var(--color-text);
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background-color: var(--color-surface-hover);
    }

    input[type="radio"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    span {
      flex: 1;
      color: var(--color-text);
    }

    .event-count {
      color: var(--color-text-secondary);
      font-size: 14px;
    }
  }

  .migration-target-selector {
    margin-top: 12px;
    padding-left: 30px;

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      color: var(--color-text);
    }

    select {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background-color: var(--color-surface);
      color: var(--color-text);
      font-size: 14px;

      &:focus {
        outline: none;
        border-color: var(--color-primary);
      }
    }
  }

  .merge-category-list {
    max-height: 300px;
    overflow-y: auto;
  }

  .total-events {
    padding: 16px;
    background-color: var(--color-surface-secondary);
    border-radius: 6px;
    text-align: center;

    strong {
      color: var(--color-text);
    }
  }

  .form-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 24px;
  }
}

.alert {
  padding: 12px;
  margin-bottom: 16px;
  border-radius: 6px;
  font-size: 14px;

  &.alert--error {
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: rgb(153, 27, 27);
  }

  &.alert--success {
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: rgb(21, 128, 61);
  }
}

.loading {
  text-align: center;
  padding: 48px 24px;
  color: var(--color-text-secondary);
}
</style>
