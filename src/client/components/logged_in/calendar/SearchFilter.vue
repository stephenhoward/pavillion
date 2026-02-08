<template>
  <div class="search-filter">
    <!-- Search Input -->
    <div class="search-section">
      <label for="event-search" class="sr-only">
        {{ t('search_events') }}
      </label>
      <div class="search-input-wrapper">
        <Search :size="20" class="search-icon" />
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
          aria-label="Clear search"
        >
          <X :size="16" />
        </button>
      </div>
    </div>

    <!-- Category Filter -->
    <div class="category-filter-section" v-if="state.availableCategories.length > 0 || state.categoryError">
      <label class="filter-label">
        {{ t('filter_by_categories') }}
      </label>

      <div
        v-if="state.isLoadingCategories"
        class="loading"
        role="status"
        aria-live="polite"
      >
        {{ t('loading_categories') }}
      </div>

      <div
        v-else-if="state.categoryError"
        class="error"
        role="alert"
      >
        {{ state.categoryError }}
      </div>

      <div v-else-if="state.availableCategories.length > 0" class="category-filter-container">
        <div ref="categoryScrollRef" class="category-chips">
          <ToggleChip
            v-for="category in state.availableCategories"
            :key="category.id"
            :model-value="state.selectedCategoryIds.includes(category.id)"
            :label="getCategoryName(category)"
            @update:model-value="() => toggleCategory(category.id)"
          />
        </div>

        <!-- Left fade gradient with chevron -->
        <div v-if="state.showStartFade" class="scroll-indicator start">
          <div class="fade-gradient start-gradient"/>
          <div class="chevron-icon">
            <svg width="16"
                 height="16"
                 fill="none"
                 viewBox="0 0 24 24"
                 stroke="currentColor"
                 stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </div>
        </div>

        <!-- Right fade gradient with chevron -->
        <div v-if="state.showEndFade" class="scroll-indicator end">
          <div class="fade-gradient end-gradient"/>
          <div class="chevron-icon">
            <svg width="16"
                 height="16"
                 fill="none"
                 viewBox="0 0 24 24"
                 stroke="currentColor"
                 stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Filter State Announcement for Screen Readers -->
    <div
      class="sr-only"
      aria-live="polite"
      role="status"
    >
      {{ filterStateAnnouncement }}
    </div>

    <!-- Clear All Filters -->
    <div v-if="hasActiveFilters" class="clear-filters-section">
      <PillButton variant="ghost" size="sm" @click="clearAllFilters">
        {{ t('clear_all_filters') }}
      </PillButton>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted, onUnmounted, watch, computed, ref, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Search, X } from 'lucide-vue-next';
import CategoryService from '@/client/service/category';
import ToggleChip from '@/client/components/common/ToggleChip.vue';
import PillButton from '@/client/components/common/PillButton.vue';

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

// Ref for category scroll container
const categoryScrollRef = ref(null);

const state = reactive({
  searchQuery: props.initialFilters.search || '',
  selectedCategoryIds: props.initialFilters.categories || [],

  availableCategories: [],
  isLoadingCategories: false,
  categoryError: '',

  searchTimeout: null,

  // Scroll indicator states
  showStartFade: false,
  showEndFade: false,
});

// Computed properties
const hasActiveFilters = computed(() => {
  return state.searchQuery.trim() !== '' ||
         state.selectedCategoryIds.length > 0;
});

/**
 * Computed announcement text for screen readers when filter state changes
 */
const filterStateAnnouncement = computed(() => {
  const parts = [];

  if (state.selectedCategoryIds.length > 0) {
    parts.push(t('sr_categories_selected', { count: state.selectedCategoryIds.length }));
  }

  if (state.searchQuery.trim()) {
    parts.push(t('sr_searching_for', { query: state.searchQuery.trim() }));
  }

  if (parts.length === 0) {
    return t('sr_no_filters_active');
  }

  return parts.join(', ');
});

// Scroll indicator logic
const checkOverflow = () => {
  const el = categoryScrollRef.value;
  if (el) {
    const hasOverflow = el.scrollWidth > el.clientWidth;
    const isScrolledToEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    const isScrolledToStart = el.scrollLeft <= 1;
    state.showEndFade = hasOverflow && !isScrolledToEnd;
    state.showStartFade = hasOverflow && !isScrolledToStart;
  }
};


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
    // Check overflow after categories load and render
    await nextTick();
    checkOverflow();
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

// Watch for category changes to update overflow indicators
watch(() => state.availableCategories, async () => {
  await nextTick();
  checkOverflow();
});

onMounted(async () => {
  await loadCategories();

  // Set up event listeners for scroll indicators after categories load
  await nextTick();

  window.addEventListener('resize', checkOverflow);

  const el = categoryScrollRef.value;
  if (el) {
    el.addEventListener('scroll', checkOverflow);
    // Initial check
    checkOverflow();
  }
});

onUnmounted(() => {
  // Clean up event listeners
  window.removeEventListener('resize', checkOverflow);

  const el = categoryScrollRef.value;
  if (el) {
    el.removeEventListener('scroll', checkOverflow);
  }
});
</script>

<style scoped lang="scss">
@use '../../../assets/style/components/event-management' as *;

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.search-filter {
  max-width: 56rem; // max-w-4xl
  margin: 0 auto;
  padding: 1rem;
}

.search-section {
  margin-bottom: 1.5rem;

  .search-input-wrapper {
    @include pill-search-input;
  }
}

.category-filter-section {
  margin-bottom: 1rem;

  .filter-label {
    @include section-label;
    margin-bottom: 0.75rem;
  }

  .loading {
    color: var(--pav-color-stone-600);
    font-style: italic;
    padding: 1rem 0;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .error {
    color: var(--pav-color-red-600);
    padding: 1rem;
    background: var(--pav-color-red-50);
    border-radius: 0.5rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-300);
      background: rgba(220, 53, 69, 0.1);
    }
  }

  .category-filter-container {
    @include category-filter-container;

    // Scroll indicators
    .scroll-indicator {
      position: absolute;
      inset-block: 0;
      display: flex;
      align-items: center;
      pointer-events: none;

      &.start {
        inset-inline-start: 0;
      }

      &.end {
        inset-inline-end: 0;
      }

      .fade-gradient {
        width: 3rem;
        height: 100%;

        &.start-gradient {
          background: linear-gradient(to right, white, rgba(255, 255, 255, 0.8), transparent);

          @media (prefers-color-scheme: dark) {
            background: linear-gradient(to right, var(--pav-color-stone-900), rgba(28, 25, 23, 0.8), transparent);
          }
        }

        &.end-gradient {
          background: linear-gradient(to left, white, rgba(255, 255, 255, 0.8), transparent);

          @media (prefers-color-scheme: dark) {
            background: linear-gradient(to left, var(--pav-color-stone-900), rgba(28, 25, 23, 0.8), transparent);
          }
        }
      }

      .chevron-icon {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        margin-top: -0.125rem;
        color: var(--pav-color-stone-400);

        @media (prefers-color-scheme: dark) {
          color: var(--pav-color-stone-500);
        }
      }

      &.start .chevron-icon {
        inset-inline-start: 0;
      }

      &.end .chevron-icon {
        inset-inline-end: 0;
      }
    }
  }
}

.clear-filters-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }
}
</style>
