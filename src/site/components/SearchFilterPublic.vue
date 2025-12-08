<template>
  <div class="search-filter-public">
    <!-- Search Input (always visible, outside accordion on mobile) -->
    <div class="search-section">
      <label for="public-event-search" class="search-label sr-only">
        {{ t('search_events') }}
      </label>
      <div class="search-input-container">
        <input
          id="public-event-search"
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
          :aria-label="t('clear_search')"
        >
          ✕
        </button>
      </div>
      <div v-if="state.searchQuery.trim().length > 0 && state.searchQuery.trim().length < 3" class="search-helper-text">
        {{ t('search_min_chars') }}
      </div>
    </div>

    <!-- Filter Accordion (mobile) / Horizontal Layout (desktop) -->
    <div class="filter-accordion-wrapper">
      <!-- Accordion toggle button (mobile only) -->
      <button
        class="accordion-toggle"
        @click="toggleAccordion"
        :aria-expanded="state.isAccordionOpen"
        :aria-label="t('toggle_filters')"
      >
        <span>{{ t('more_filters') }}</span>
        <span class="accordion-icon" :class="{ open: state.isAccordionOpen }">▼</span>
      </button>

      <!-- Filter content (collapsible on mobile, always visible on desktop) -->
      <div
        class="filter-accordion"
        :class="{ open: state.isAccordionOpen }"
      >
        <!-- Category Filter Section -->
        <div v-if="publicStore.availableCategories.length > 0" class="category-filter-section">
          <label class="filter-label">
            {{ t('filter_by_categories') }}
          </label>

          <CategoryPillSelector
            :categories="publicStore.availableCategories"
            :selected-categories="publicStore.selectedCategoryNames"
            :disabled="publicStore.isLoadingCategories"
            @update:selected-categories="handleCategoryChange"
          />
        </div>

        <!-- Date Range Filter Section -->
        <div class="date-range-section">
          <label class="filter-label">
            {{ t('filter_by_date_range') }}
          </label>

          <!-- Date Filter Mode Selector (Segmented Control) -->
          <div class="date-mode-selector" role="radiogroup" aria-label="Date range options">
            <button
              type="button"
              role="radio"
              :aria-checked="state.dateFilterMode === 'thisWeek'"
              :class="['mode-btn', { active: state.dateFilterMode === 'thisWeek' }]"
              @click="setThisWeek"
            >
              {{ t('this_week') }}
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="state.dateFilterMode === 'nextWeek'"
              :class="['mode-btn', { active: state.dateFilterMode === 'nextWeek' }]"
              @click="setNextWeek"
            >
              {{ t('next_week') }}
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="state.dateFilterMode === 'custom'"
              :class="['mode-btn', { active: state.dateFilterMode === 'custom' }]"
              @click="setCustomMode"
            >
              {{ t('custom') }}
            </button>
          </div>

          <!-- Custom Date Inputs (only visible when Custom is selected) -->
          <transition name="date-inputs-slide">
            <div v-if="state.dateFilterMode === 'custom'" class="date-inputs">
              <div class="date-input-group">
                <label for="start-date" class="date-label">{{ t('start_date') }}</label>
                <input
                  id="start-date"
                  v-model="state.startDate"
                  type="date"
                  class="date-input"
                  @change="onDateChange"
                />
              </div>
              <div class="date-input-group">
                <label for="end-date" class="date-label">{{ t('end_date') }}</label>
                <input
                  id="end-date"
                  v-model="state.endDate"
                  type="date"
                  class="date-input"
                  @change="onDateChange"
                />
              </div>
            </div>
          </transition>
        </div>
      </div>
    </div>

    <!-- Clear All Filters Button -->
    <div v-if="publicStore.hasActiveFilters" class="clear-filters-section">
      <button
        type="button"
        class="clear-all-filters"
        @click="clearAllFilters"
      >
        {{ t('clear_all_filters') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import { usePublicCalendarStore } from '../stores/publicCalendarStore';
import CategoryPillSelector from './CategoryPillSelector.vue';
import { getThisWeek, getNextWeek } from '@/common/utils/datePresets';

const { t } = useTranslation('system', {
  keyPrefix: 'public_search_filter',
});

const route = useRoute();
const router = useRouter();
const publicStore = usePublicCalendarStore();

const state = reactive({
  searchQuery: '',
  startDate: null as string | null,
  endDate: null as string | null,
  isAccordionOpen: false,
  searchTimeout: null as ReturnType<typeof setTimeout> | null,
  dateFilterMode: null as 'thisWeek' | 'nextWeek' | 'custom' | null,
});

// Expose isAccordionOpen for testing
defineExpose({
  isAccordionOpen: state.isAccordionOpen,
});

// Toggle accordion (mobile)
const toggleAccordion = () => {
  state.isAccordionOpen = !state.isAccordionOpen;
};

// Search with debouncing
const onSearchInput = () => {
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
  }

  state.searchTimeout = setTimeout(() => {
    // Only search if query is empty (to clear) or has at least 3 characters
    const trimmedQuery = state.searchQuery.trim();
    if (trimmedQuery.length === 0 || trimmedQuery.length >= 3) {
      publicStore.setSearchQuery(state.searchQuery);
      publicStore.reloadWithFilters();
      updateURL();
    }
  }, 300); // 300ms debounce
};

// Clear search
const clearSearch = () => {
  state.searchQuery = '';
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
  }
  publicStore.setSearchQuery('');
  publicStore.reloadWithFilters();
  updateURL();
};

// Handle category changes
const handleCategoryChange = async (categoryNames: string[]) => {
  publicStore.setSelectedCategories(categoryNames);
  await publicStore.reloadWithFilters();
  updateURL();
};

// Set "This Week" preset (toggle if already active)
const setThisWeek = () => {
  if (state.dateFilterMode === 'thisWeek') {
    // Toggle off - clear date filter
    state.dateFilterMode = null;
    state.startDate = null;
    state.endDate = null;
    publicStore.setDateRange(null, null);
    publicStore.reloadWithFilters();
    updateURL();
  } else {
    // Activate This Week
    state.dateFilterMode = 'thisWeek';
    const { startDate, endDate } = getThisWeek();
    state.startDate = startDate;
    state.endDate = endDate;
    publicStore.setDateRange(startDate, endDate);
    publicStore.reloadWithFilters();
    updateURL();
  }
};

// Set "Next Week" preset (toggle if already active)
const setNextWeek = () => {
  if (state.dateFilterMode === 'nextWeek') {
    // Toggle off - clear date filter
    state.dateFilterMode = null;
    state.startDate = null;
    state.endDate = null;
    publicStore.setDateRange(null, null);
    publicStore.reloadWithFilters();
    updateURL();
  } else {
    // Activate Next Week
    state.dateFilterMode = 'nextWeek';
    const { startDate, endDate } = getNextWeek();
    state.startDate = startDate;
    state.endDate = endDate;
    publicStore.setDateRange(startDate, endDate);
    publicStore.reloadWithFilters();
    updateURL();
  }
};

// Set "Custom" mode (toggle if already active)
const setCustomMode = () => {
  if (state.dateFilterMode === 'custom') {
    // Toggle off - clear date filter
    state.dateFilterMode = null;
    state.startDate = null;
    state.endDate = null;
    publicStore.setDateRange(null, null);
    publicStore.reloadWithFilters();
    updateURL();
  } else {
    // Activate Custom mode - show date inputs
    state.dateFilterMode = 'custom';
    // Don't automatically apply filters - wait for user to select dates
    // If dates are already set, keep them; otherwise they remain null
  }
};

// Handle manual date changes
const onDateChange = () => {
  publicStore.setDateRange(state.startDate, state.endDate);
  publicStore.reloadWithFilters();
  updateURL();
};

// Clear all filters
const clearAllFilters = () => {
  state.searchQuery = '';
  state.startDate = null;
  state.endDate = null;
  state.dateFilterMode = null;

  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
  }

  publicStore.clearAllFilters();
  publicStore.reloadWithFilters();
  updateURL();
};

// Update URL with current filter state
const updateURL = () => {
  const query: Record<string, any> = { ...route.query };

  // Update search parameter
  if (publicStore.searchQuery.trim()) {
    query.search = publicStore.searchQuery.trim();
  }
  else {
    delete query.search;
  }

  // Update category parameters
  if (publicStore.selectedCategoryNames.length > 0) {
    query.category = publicStore.selectedCategoryNames;
  }
  else {
    delete query.category;
  }

  // Update date range parameters
  if (publicStore.startDate) {
    query.startDate = publicStore.startDate;
  }
  else {
    delete query.startDate;
  }

  if (publicStore.endDate) {
    query.endDate = publicStore.endDate;
  }
  else {
    delete query.endDate;
  }

  // Use replace to avoid adding to browser history
  router.replace({ query });
};

// Initialize filters from URL parameters on mount
const initializeFromURL = () => {
  const query = route.query;

  // Initialize search
  if (query.search && typeof query.search === 'string') {
    state.searchQuery = query.search;
    publicStore.setSearchQuery(query.search);
  }

  // Initialize categories
  if (query.category) {
    const categories = Array.isArray(query.category) ? query.category : [query.category];
    publicStore.setSelectedCategories(categories as string[]);
  }

  // Initialize date range
  if (query.startDate && typeof query.startDate === 'string') {
    state.startDate = query.startDate;
    publicStore.startDate = query.startDate;
  }

  if (query.endDate && typeof query.endDate === 'string') {
    state.endDate = query.endDate;
    publicStore.endDate = query.endDate;
  }

  // Only set date filter mode to custom if:
  // 1. Dates are present in URL AND
  // 2. No mode is currently set (e.g., not just set by a preset button click)
  // This prevents the mode from being overridden when preset buttons update the URL
  if ((query.startDate || query.endDate) && !state.dateFilterMode) {
    state.dateFilterMode = 'custom';
  } else if (!query.startDate && !query.endDate) {
    state.dateFilterMode = null;
  }
};

// Watch for URL changes (browser back/forward)
watch(() => route.query, () => {
  initializeFromURL();
  publicStore.reloadWithFilters();
}, { deep: true });

onMounted(() => {
  initializeFromURL();
  // Load events with current filter state (including no filters for initial load)
  publicStore.reloadWithFilters();
});
</script>

<style scoped lang="scss">
@use '../../client/assets/mixins' as *;

.search-filter-public {
  @include filter-container;

  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

// Search Section
.search-section {
  @include filter-section;

  .search-label {
    @include filter-label;

    // Screen reader only class
    &.sr-only {
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

  .search-helper-text {
    margin-top: $spacing-xs;
    font-size: 12px;
    color: $light-mode-secondary-text;

    @include dark-mode {
      color: $dark-mode-secondary-text;
    }
  }
}

// Filter Accordion Wrapper
.filter-accordion-wrapper {
  @include filter-section;
}

// Accordion Toggle Button (mobile only)
.accordion-toggle {
  @include btn-base;
  @include btn-ghost;

  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: $spacing-md $spacing-lg;
  margin-bottom: $spacing-md;

  .accordion-icon {
    transition: transform 0.2s ease;

    &.open {
      transform: rotate(180deg);
    }
  }

  // Hide on desktop
  @include medium-size-device {
    display: none;
  }
}

// Filter Accordion Content
.filter-accordion {
  display: none; // Hidden by default on mobile
  flex-direction: column;
  gap: $spacing-2xl;

  &.open {
    display: flex; // Show when accordion is open
  }

  // Always visible on desktop
  @include medium-size-device {
    display: flex;
    flex-direction: row;
    gap: $spacing-2xl;
  }
}

// Category Filter Section
.category-filter-section {
  @include filter-section;

  .filter-label {
    @include filter-label;

    margin-bottom: $spacing-md;
  }
}

// Date Range Section
.date-range-section {
  @include filter-section;

  .filter-label {
    @include filter-label;

    margin-bottom: $spacing-md;
  }

  // Segmented Control (Date Mode Selector)
  .date-mode-selector {
    display: inline-flex;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 10px;
    padding: 3px;
    gap: 2px;
    margin-bottom: $spacing-md;

    @include dark-mode {
      background: rgba(255, 255, 255, 0.08);
    }

    .mode-btn {
      @include btn-base;

      flex: 1;
      min-width: 90px;
      padding: $spacing-sm $spacing-md;
      font-size: 14px;
      font-weight: $font-medium;
      border-radius: 8px;
      background: transparent;
      color: $light-mode-secondary-text;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;

      @include dark-mode {
        color: $dark-mode-secondary-text;
      }

      &:hover:not(.active) {
        background: rgba(0, 0, 0, 0.03);
        color: $light-mode-text;

        @include dark-mode {
          background: rgba(255, 255, 255, 0.05);
          color: $dark-mode-text;
        }
      }

      &.active {
        background: white;
        color: $light-mode-text;
        box-shadow:
          0 1px 3px rgba(0, 0, 0, 0.1),
          0 1px 2px rgba(0, 0, 0, 0.06);
        font-weight: $font-bold;

        @include dark-mode {
          background: rgba(255, 255, 255, 0.12);
          color: $dark-mode-text;
          box-shadow:
            0 1px 3px rgba(0, 0, 0, 0.3),
            0 1px 2px rgba(0, 0, 0, 0.2);
        }
      }
    }
  }

  // Custom Date Inputs with Slide Transition
  .date-inputs {
    display: flex;
    gap: $spacing-md;
    flex-direction: column;
    overflow: hidden;

    @include medium-size-device {
      flex-direction: row;
    }

    .date-input-group {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: $spacing-xs;

      .date-label {
        font-size: 12px;
        font-weight: $font-medium;
        color: $light-mode-text;

        @include dark-mode {
          color: $dark-mode-text;
        }
      }

      .date-input {
        @include input-base;

        padding: $spacing-sm $spacing-md;
        font-size: 14px;
      }
    }
  }

  // Slide transition for date inputs
  .date-inputs-slide-enter-active,
  .date-inputs-slide-leave-active {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    transform-origin: top;
  }

  .date-inputs-slide-enter-from {
    opacity: 0;
    transform: translateY(-10px) scaleY(0.95);
    max-height: 0;
  }

  .date-inputs-slide-enter-to {
    opacity: 1;
    transform: translateY(0) scaleY(1);
    max-height: 200px;
  }

  .date-inputs-slide-leave-from {
    opacity: 1;
    transform: translateY(0) scaleY(1);
    max-height: 200px;
  }

  .date-inputs-slide-leave-to {
    opacity: 0;
    transform: translateY(-10px) scaleY(0.95);
    max-height: 0;
  }
}

// Clear All Filters Section
.clear-filters-section {
  @include clear-filters-section;

  .clear-all-filters {
    @include clear-all-filters-btn;
  }
}

// Responsive adjustments
@include mobile-only {
  .search-filter-public {
    gap: $spacing-md;
  }

  .date-range-section {
    .date-mode-selector {
      width: 100%;

      .mode-btn {
        min-width: auto;
        font-size: 13px;
        padding: $spacing-xs $spacing-sm;
      }
    }
  }
}
</style>
