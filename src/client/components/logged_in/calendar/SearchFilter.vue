<template>
  <div class="search-filter">
    <!-- Search Input -->
    <div class="search-section">
      <label for="event-search" class="search-label">
        {{ t('search_events') }}
      </label>
      <div class="search-input-container">
        <input
          id="event-search"
          v-model="state.searchQuery"
          type="text"
          class="search-input"
          :placeholder="t('search_placeholder')"
          @input="onSearchInput"
        />
        <button
          v-if="state.searchQuery"
          type="button"
          class="clear-search"
          @click="clearSearch"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Category Filter -->
    <div class="category-filter-section" v-if="state.availableCategories.length > 0 || state.categoryError">
      <label class="filter-label">
        {{ t('filter_by_categories') }}
      </label>

      <div v-if="state.isLoadingCategories" class="loading">
        {{ t('loading_categories') }}
      </div>

      <div v-else-if="state.categoryError" class="error">
        {{ state.categoryError }}
      </div>

      <div v-else-if="state.availableCategories.length > 0" class="category-filter">
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
          <span class="category-name">
            {{ getCategoryName(category) }}
          </span>
        </div>
      </div>
    </div>


    <!-- Clear All Filters -->
    <div v-if="hasActiveFilters" class="clear-filters-section">
      <button type="button" class="clear-all-filters" @click="clearAllFilters">
        {{ t('clear_all_filters') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted, watch, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import CategoryService from '@/client/service/category';

const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
  initialFilters: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['filtersChanged']);

const { t, i18n } = useTranslation('calendars', {
  keyPrefix: 'search_filter',
});

const categoryService = new CategoryService();

const state = reactive({
  searchQuery: props.initialFilters.search || '',
  selectedCategoryIds: props.initialFilters.categories || [],

  availableCategories: [],
  isLoadingCategories: false,
  categoryError: '',

  searchTimeout: null,
});

// Computed properties
const hasActiveFilters = computed(() => {
  return state.searchQuery.trim() !== '' ||
         state.selectedCategoryIds.length > 0;
});

// Get category name with null safety
const getCategoryName = (category) => {
  if (!category) {
    return 'Unnamed Category';
  }

  // Safely access category content with the current language
  const currentLanguage = i18n?.language || 'en';

  if (typeof category.content === 'function') {
    const content = category.content(currentLanguage);
    return content?.name || 'Unnamed Category';
  }

  // Fallback for non-function content
  return category.name || 'Unnamed Category';
};

// Search with debouncing
const onSearchInput = () => {
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
  }

  state.searchTimeout = setTimeout(() => {
    emitFilters();
  }, 300); // 300ms debounce
};

// Category management
const loadCategories = async () => {
  if (!props.calendarId) return;

  state.isLoadingCategories = true;
  state.categoryError = '';

  try {
    state.availableCategories = await categoryService.loadCategories(props.calendarId);
  }
  catch (error) {
    console.error('Failed to load categories:', error);
    state.categoryError = t('categories_load_error');
  }
  finally {
    state.isLoadingCategories = false;
  }
};

const toggleCategory = (categoryId) => {
  const index = state.selectedCategoryIds.indexOf(categoryId);
  if (index > -1) {
    state.selectedCategoryIds.splice(index, 1);
  }
  else {
    state.selectedCategoryIds.push(categoryId);
  }
  emitFilters();
};


// Clear functions
const clearSearch = () => {
  state.searchQuery = '';
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
  }
  emitFilters();
};

const clearAllFilters = () => {
  state.searchQuery = '';
  state.selectedCategoryIds = [];

  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
  }

  emitFilters();
};

// Emit current filter state
const emitFilters = () => {
  const filters = {
    search: state.searchQuery.trim() || undefined,
    categories: state.selectedCategoryIds.length > 0 ? state.selectedCategoryIds : undefined,
  };

  // Remove undefined values
  Object.keys(filters).forEach(key => {
    if (filters[key] === undefined) {
      delete filters[key];
    }
  });

  emit('filtersChanged', filters);
};

// Watch for calendar ID changes
watch(() => props.calendarId, (newCalendarId) => {
  if (newCalendarId) {
    loadCategories();
  }
}, { immediate: true });

onMounted(() => {
  loadCategories();
});
</script>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

.search-filter {
  @include filter-container;
}

.search-section {
  @include filter-section;

  .search-label {
    @include filter-label;
  }

  .search-input-container {
    @include search-input-container;
  }

  .search-input {
    @include search-input;
  }

  .clear-search {
    @include search-clear-button;
  }
}

.category-filter-section {
  @include filter-section;

  .filter-label {
    @include filter-label;
  }

  .loading {
    @include filter-loading;
  }

  .error {
    @include filter-error;
  }

  .category-filter {
    @include category-filter-container;
  }

  .category-option {
    @include category-chip;
  }
}

.clear-filters-section {
  @include clear-filters-section;

  .clear-all-filters {
    @include clear-all-filters-btn;
  }
}
</style>
