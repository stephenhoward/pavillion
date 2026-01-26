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
    <div v-else-if="state.categories.length > 0" class="categories-content">
      <div class="categories-header">
        <h2 class="categories-title">{{ t('event_categories') }}</h2>
        <PillButton
          variant="primary"
          @click="openCreateEditor"
        >
          <Plus :size="20" :stroke-width="2" />
          {{ t('add_category_button') }}
        </PillButton>
      </div>

      <div class="categories-list">
        <div
          v-for="category in state.categories"
          :key="category.id"
          class="category-card"
          :class="{ 'category-card--selected': state.selectedCategories.has(category.id) }"
        >
          <input
            type="checkbox"
            :checked="state.selectedCategories.has(category.id)"
            @change="toggleCategorySelection(category.id)"
            :aria-label="`Select ${category.content(currentLanguage)?.name || 'Unnamed Category'}`"
            class="category-checkbox"
          />

          <div class="category-info">
            <div class="category-name">
              {{ category.content(currentLanguage)?.name || 'Unnamed Category' }}
            </div>
            <div class="category-meta">
              <span class="event-count">{{ category.eventCount || 0 }} events</span>
              <span class="language-indicator">
                <Languages :size="16" :stroke-width="2" />
                {{ category.getLanguages().length }} languages
              </span>
            </div>
          </div>

          <div class="category-actions">
            <button
              type="button"
              class="icon-button"
              @click="openEditEditor(category)"
              :disabled="state.isDeleting === category.id"
              :aria-label="t('edit_button')"
            >
              <Pencil :size="20" :stroke-width="2" />
            </button>
            <button
              type="button"
              class="icon-button icon-button--danger"
              @click="confirmDeleteCategory(category)"
              :disabled="state.isDeleting === category.id"
              :aria-label="t('delete_button')"
            >
              <Trash2 :size="20" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <EmptyLayout v-else :title="t('no_categories')" :description="t('no_categories_description')">
      <PillButton
        variant="primary"
        @click="openCreateEditor"
        :disabled="state.isLoading"
      >
        <Plus :size="20" :stroke-width="2" />
        {{ t('add_category_button') }}
      </PillButton>
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
      modal-class="delete-category-modal"
      @close="cancelDeleteCategory"
    >
      <div class="delete-dialog">
        <p class="delete-description">
          Are you sure you want to delete "<strong>{{ state.categoryToDelete.content(currentLanguage)?.name || 'Unnamed Category' }}</strong>"?
          <span v-if="(state.categoryToDelete.eventCount || 0) > 0">
            This category is assigned to <strong>{{ state.categoryToDelete.eventCount }} {{ state.categoryToDelete.eventCount === 1 ? 'event' : 'events' }}</strong>.
          </span>
        </p>

        <div class="delete-options">
          <label
            class="delete-radio-option"
            :class="{ 'delete-radio-option--selected': state.deleteAction === 'remove' }"
          >
            <input
              type="radio"
              v-model="state.deleteAction"
              value="remove"
              name="delete-action"
            />
            <div class="option-content">
              <span class="option-title">{{ t('delete_option_remove') }}</span>
              <p class="option-description">Events will remain but won't have this category</p>
            </div>
          </label>

          <label
            v-if="otherCategories.length > 0"
            class="delete-radio-option"
            :class="{ 'delete-radio-option--selected': state.deleteAction === 'migrate' }"
          >
            <input
              type="radio"
              v-model="state.deleteAction"
              value="migrate"
              name="delete-action"
            />
            <div class="option-content">
              <span class="option-title">{{ t('delete_option_migrate') }}</span>
              <p class="option-description">Move all events to a different category</p>
              <select
                v-if="state.deleteAction === 'migrate'"
                v-model="state.deleteMigrationTarget"
                class="migration-target"
                @click.stop
              >
                <option
                  v-for="cat in otherCategories"
                  :key="cat.id"
                  :value="cat.id"
                >
                  {{ cat.content(currentLanguage)?.name || 'Unnamed Category' }}
                </option>
              </select>
            </div>
          </label>
        </div>

        <div class="delete-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="cancelDeleteCategory"
            :disabled="state.isDeleting === state.categoryToDelete?.id"
          >
            {{ t('cancel') }}
          </button>
          <PillButton
            variant="danger"
            @click="deleteCategory"
            :disabled="!canConfirmDelete || state.isDeleting === state.categoryToDelete?.id"
          >
            {{ state.isDeleting === state.categoryToDelete?.id ? t('deleting') : t('delete_button') }}
          </PillButton>
        </div>
      </div>
    </ModalLayout>

    <!-- Merge Categories Modal -->
    <ModalLayout
      v-if="state.showMergeDialog"
      :title="t('merge_categories_title')"
      modal-class="merge-categories-modal"
      @close="cancelMergeDialog"
    >
      <div class="merge-dialog">
        <p class="merge-description">{{ t('merge_categories_description') }}</p>

        <div class="merge-category-list">
          <label
            v-for="category in selectedCategoriesArray"
            :key="category.id"
            class="merge-radio-option"
            :class="{ 'merge-radio-option--selected': state.mergeTargetId === category.id }"
          >
            <input
              type="radio"
              v-model="state.mergeTargetId"
              :value="category.id"
              name="merge-target"
            />
            <div class="category-info">
              <span class="category-name">
                {{ category.content(currentLanguage)?.name || 'Unnamed Category' }}
              </span>
              <span class="category-event-count">
                {{ category.eventCount || 0 }} {{ category.eventCount === 1 ? 'event' : 'events' }}
              </span>
            </div>
          </label>
        </div>

        <div class="total-events-section">
          {{ t('total_affected_events') }}: <span class="total-count">{{ totalAffectedEvents }}</span>
        </div>

        <div class="merge-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="cancelMergeDialog"
            :disabled="state.isMerging"
          >
            {{ t('cancel') }}
          </button>
          <PillButton
            variant="primary"
            @click="mergeCategories"
            :disabled="!state.mergeTargetId || state.isMerging"
          >
            {{ state.isMerging ? t('merging') : t('merge_button') }}
          </PillButton>
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
import { Plus, Pencil, Trash2, Languages } from 'lucide-vue-next';
import { EventCategory } from '@/common/model/event_category';
import CategoryService from '@/client/service/category';
import CategoryEditor from './CategoryEditor.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import { EventCategoryContent } from '@/common/model/event_category_content';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import BulkCategoriesMenu from './BulkCategoriesMenu.vue';
import PillButton from '@/client/components/common/PillButton.vue';

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
      state.deleteMigrationTarget || undefined,
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
      id => id !== state.mergeTargetId,
    );

    const result = await categoryService.mergeCategories(
      props.calendarId,
      state.mergeTargetId,
      sourceCategoryIds,
    );

    state.successMessage = t('categories_merged_success', {
      count: result.totalAffectedEvents,
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
@use '../../../assets/style/components/calendar-admin' as *;

.categories-content {
  @include admin-section;
}

.categories-header {
  @include admin-section-header;
}

.categories-title {
  @include admin-section-title;
}

.categories-list {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
}

.category-card {
  @include admin-card;

  &:hover {
    border-color: var(--pav-color-stone-300);

    @media (prefers-color-scheme: dark) {
      border-color: var(--pav-color-stone-600);
    }
  }

  &--selected {
    background-color: var(--pav-color-orange-50);
    border-color: var(--pav-color-orange-200);

    @media (prefers-color-scheme: dark) {
      background-color: oklch(0.705 0.213 47.604 / 0.1);
      border-color: var(--pav-color-orange-800);
    }
  }
}

.category-checkbox {
  width: 20px;
  height: 20px;
  cursor: pointer;
  flex-shrink: 0;
}

.category-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.category-name {
  font-weight: 500;
  font-size: 1rem;
  color: var(--pav-color-stone-900);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.category-meta {
  display: flex;
  align-items: center;
  gap: var(--pav-space-3);
  font-size: 0.875rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.event-count {
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.language-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.category-actions {
  display: flex;
  gap: var(--pav-space-2);
  align-items: center;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--pav-space-2);
  background: none;
  border: none;
  border-radius: 0.375rem;
  color: var(--pav-color-stone-500);
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;

  &:hover {
    color: var(--pav-color-orange-600);
    background: var(--pav-color-stone-100);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-orange-400);
      background: var(--pav-color-stone-800);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--danger:hover {
    color: var(--pav-color-red-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }
}

// Constrain modal widths to match reference design
:global(.merge-categories-modal > div),
:global(.delete-category-modal > div) {
  max-width: 600px !important;
}

.delete-dialog,
.merge-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

.delete-dialog {
  .delete-description {
    margin: 0 0 var(--pav-space-4) 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;
    line-height: 1.5;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .delete-options {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
  }

  .delete-radio-option {
    display: flex;
    align-items: flex-start;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4);
    border: 2px solid var(--pav-color-stone-200);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s ease;

    @media (prefers-color-scheme: dark) {
      border-color: var(--pav-color-stone-700);
    }

    &:hover {
      background-color: var(--pav-color-stone-50);

      @media (prefers-color-scheme: dark) {
        background-color: var(--pav-color-stone-800);
      }
    }

    &--selected {
      border-color: var(--pav-color-orange-500);
      background-color: var(--pav-color-orange-50);

      @media (prefers-color-scheme: dark) {
        background-color: oklch(0.705 0.213 47.604 / 0.1);
      }
    }

    input[type="radio"] {
      margin-top: 0.125rem;
      width: 16px;
      height: 16px;
      cursor: pointer;
      flex-shrink: 0;
      accent-color: var(--pav-color-orange-500);
    }

    .option-content {
      flex: 1;
      min-width: 0;
    }

    .option-title {
      display: block;
      font-weight: 500;
      font-size: 0.875rem;
      color: var(--pav-color-stone-900);
      margin-bottom: 0.125rem;

      @media (min-width: 640px) {
        font-size: 1rem;
      }

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-100);
      }
    }

    .option-description {
      margin: 0 0 var(--pav-space-3) 0;
      font-size: 0.75rem;
      color: var(--pav-color-stone-500);
      line-height: 1.4;

      @media (min-width: 640px) {
        font-size: 0.875rem;
      }

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-400);
      }
    }

    .migration-target {
      width: 100%;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      background-color: var(--pav-color-stone-100);
      border: none;
      font-size: 0.875rem;
      color: var(--pav-color-stone-900);
      cursor: pointer;

      &:focus {
        outline: none;
        box-shadow: 0 0 0 2px var(--pav-color-orange-500);
      }

      @media (min-width: 640px) {
        padding: 0.625rem 1rem;
      }

      @media (prefers-color-scheme: dark) {
        background-color: var(--pav-color-stone-800);
        color: var(--pav-color-stone-100);
      }
    }
  }

  .delete-actions {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
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
}

.merge-dialog {
  .merge-description {
    margin-bottom: var(--pav-space-4);
  }

  .merge-category-list {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
    max-height: 300px;
    overflow-y: auto;
  }

  .merge-radio-option {
    display: flex;
    align-items: center;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4);
    border: 2px solid var(--pav-color-stone-200);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s ease;

    @media (prefers-color-scheme: dark) {
      border-color: var(--pav-color-stone-700);
    }

    &:hover {
      background-color: var(--pav-color-stone-50);

      @media (prefers-color-scheme: dark) {
        background-color: var(--pav-color-stone-800);
      }
    }

    &--selected {
      border-color: var(--pav-color-orange-500);
      background-color: var(--pav-color-orange-50);

      @media (prefers-color-scheme: dark) {
        background-color: oklch(0.705 0.213 47.604 / 0.1);
      }
    }

    input[type="radio"] {
      width: 20px;
      height: 20px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .category-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-1);
    }

    .category-name {
      color: var(--pav-color-stone-900);
      font-weight: 500;
      font-size: 1rem;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-100);
      }
    }

    .category-event-count {
      color: var(--pav-color-stone-600);
      font-size: 0.875rem;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-400);
      }
    }
  }

  .total-events-section {
    padding: var(--pav-space-4);
    background-color: var(--pav-color-stone-100);
    border-radius: 0.75rem;
    text-align: start;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      background-color: var(--pav-color-stone-800);
      color: var(--pav-color-stone-100);
    }

    .total-count {
      color: var(--pav-color-orange-600);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-orange-400);
      }
    }
  }

  .merge-actions {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
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

  &.alert--success {
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: rgb(21, 128, 61);

    @media (prefers-color-scheme: dark) {
      color: rgb(134, 239, 172);
    }
  }
}
</style>
