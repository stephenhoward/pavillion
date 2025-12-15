<template>
  <div class="search-filter-public">
    <!-- Date Range Filter Section (Collapsible Button) -->
    <div class="date-range-section" role="group" :aria-label="t('filter_by_date_range')">
      <div class="date-filter-wrapper" ref="dateFilterRef">
        <!-- Date Filter Button -->
        <button
          type="button"
          class="date-filter-button"
          :class="{
            active: state.isDateFilterOpen,
            'has-filter': state.dateFilterMode !== null
          }"
          :aria-expanded="state.isDateFilterOpen"
          :aria-label="t('filter_by_date_range')"
          @click="toggleDateFilter"
        >
          <span class="button-text">{{ dateFilterButtonText }}</span>
          <svg
            class="dropdown-icon"
            :class="{ rotated: state.isDateFilterOpen }"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- Dropdown with Filter Options -->
        <transition name="dropdown-fade">
          <div v-if="state.isDateFilterOpen" class="date-dropdown">
            <!-- Date Filter Pills -->
            <div class="date-mode-pills" role="radiogroup" :aria-label="t('date_range_options')">
              <button
                type="button"
                role="radio"
                :aria-checked="state.dateFilterMode === 'thisWeek'"
                :aria-label="t('this_week_filter')"
                :class="['date-pill', { active: state.dateFilterMode === 'thisWeek' }]"
                @click="setThisWeek"
              >
                {{ t('this_week') }}
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="state.dateFilterMode === 'nextWeek'"
                :aria-label="t('next_week_filter')"
                :class="['date-pill', { active: state.dateFilterMode === 'nextWeek' }]"
                @click="setNextWeek"
              >
                {{ t('next_week') }}
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="state.dateFilterMode === 'custom'"
                :aria-label="t('choose_custom_dates')"
                :class="['date-pill calendar-pill', { active: state.dateFilterMode === 'custom' }]"
                @click="setCustomMode"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M2 6H14" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M5 1.5V4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  <path d="M11 1.5V4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
                <span class="sr-only">{{ t('choose_custom_dates') }}</span>
              </button>
            </div>

            <!-- Custom Date Inputs (shown when custom mode active) -->
            <transition name="slide-fade">
              <div v-if="state.dateFilterMode === 'custom'" class="custom-dates-section">
                <div class="date-inputs-grid">
                  <div class="date-input-group">
                    <label for="start-date" class="date-input-label">{{ t('start_date') }}</label>
                    <input
                      id="start-date"
                      v-model="state.startDate"
                      type="date"
                      class="date-input"
                      :aria-label="t('start_date')"
                      @change="onDateChange"
                    />
                  </div>
                  <div class="date-input-group">
                    <label for="end-date" class="date-input-label">{{ t('end_date') }}</label>
                    <input
                      id="end-date"
                      v-model="state.endDate"
                      type="date"
                      class="date-input"
                      :aria-label="t('end_date')"
                      @change="onDateChange"
                    />
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </transition>
      </div>
    </div>

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

    <!-- Category Filter Section (full width) -->
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
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted, onUnmounted, watch } from 'vue';
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
const dateFilterRef = ref<HTMLElement | null>(null);

const state = reactive({
  searchQuery: '',
  startDate: null as string | null,
  endDate: null as string | null,
  isAccordionOpen: false,
  isDateFilterOpen: false,
  searchTimeout: null as ReturnType<typeof setTimeout> | null,
  dateFilterMode: null as 'thisWeek' | 'nextWeek' | 'custom' | null,
});

// Computed property for button text
const dateFilterButtonText = computed(() => {
  if (state.dateFilterMode === 'thisWeek') {
    return t('this_week');
  } else if (state.dateFilterMode === 'nextWeek') {
    return t('next_week');
  } else if (state.dateFilterMode === 'custom' && state.startDate && state.endDate) {
    return formatDateRange(state.startDate, state.endDate);
  } else if (state.dateFilterMode === 'custom' && (state.startDate || state.endDate)) {
    // Partial date selection
    if (state.startDate) return `From ${formatDate(state.startDate)}`;
    if (state.endDate) return `Until ${formatDate(state.endDate)}`;
  }
  return t('custom'); // "Select Dates"
});

// Format a date nicely
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00'); // Prevent timezone issues
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${month} ${day}`;
};

// Format date range
const formatDateRange = (start: string, end: string): string => {
  const startDate = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');

  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
  const startDay = startDate.getDate();
  const endDay = endDate.getDate();

  // Same month: "Jan 5-12"
  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }

  // Different months: "Jan 28 - Feb 3"
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
};

// Toggle date filter dropdown
const toggleDateFilter = () => {
  state.isDateFilterOpen = !state.isDateFilterOpen;
};

// Close date filter dropdown
const closeDateFilter = () => {
  state.isDateFilterOpen = false;
};

// Handle click outside to close dropdown
const handleClickOutside = (event: MouseEvent) => {
  if (dateFilterRef.value && !dateFilterRef.value.contains(event.target as Node)) {
    closeDateFilter();
  }
};

// Expose isAccordionOpen for testing
defineExpose({
  isAccordionOpen: state.isAccordionOpen,
  isDateFilterOpen: state.isDateFilterOpen,
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
    closeDateFilter();
  } else {
    // Activate This Week
    state.dateFilterMode = 'thisWeek';
    const { startDate, endDate } = getThisWeek();
    state.startDate = startDate;
    state.endDate = endDate;
    publicStore.setDateRange(startDate, endDate);
    publicStore.reloadWithFilters();
    updateURL();
    closeDateFilter();
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
    closeDateFilter();
  } else {
    // Activate Next Week
    state.dateFilterMode = 'nextWeek';
    const { startDate, endDate } = getNextWeek();
    state.startDate = startDate;
    state.endDate = endDate;
    publicStore.setDateRange(startDate, endDate);
    publicStore.reloadWithFilters();
    updateURL();
    closeDateFilter();
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
    closeDateFilter();
  } else {
    // Activate Custom mode - show date inputs
    state.dateFilterMode = 'custom';
    // Don't close dropdown - let user pick dates
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

// Watch for store date range changes to sync local state
// This handles external clearAllFilters() calls from calendar.vue
watch(() => [publicStore.startDate, publicStore.endDate], ([newStart, newEnd]) => {
  // If store dates are cleared, reset local dateFilterMode
  if (newStart === null && newEnd === null) {
    state.dateFilterMode = null;
    state.startDate = null;
    state.endDate = null;
  }
});

onMounted(() => {
  initializeFromURL();
  // Load events with current filter state (including no filters for initial load)
  publicStore.reloadWithFilters();
  // Add click outside listener for date filter dropdown
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  // Remove click outside listener
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.search-filter-public {
  @include filter-container;
  // All layout styles provided by mixin
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

// Category Filter Section (full width)
.category-filter-section {
  @include filter-section;

  width: 100%;

  .filter-label {
    @include filter-label;
    // Override font-size for better readability
    font-size: 12px;
    opacity: 0.6;
  }
}

// Date Range Section - Collapsible Button
.date-range-section {
  display: flex;
  justify-content: flex-end;
  width: 100%;

  .date-filter-wrapper {
    position: relative;
    display: inline-flex;
    flex-direction: column;
  }

  // Date Filter Button (Main Collapsible Button)
  .date-filter-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    min-height: 38px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 20px;
    background: white;
    font-family: 'Creato Display', 'Helvetica Neue', sans-serif;
    font-size: 14px;
    font-weight: $font-regular;
    color: rgba(0, 0, 0, 0.85);
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    user-select: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);

    &:hover {
      border-color: rgba(0, 0, 0, 0.2);
      background: rgba(0, 0, 0, 0.02);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
    }

    &:focus-visible {
      outline: 2px solid $light-mode-button-background;
      outline-offset: 1px;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
    }

    &.active {
      border-color: $light-mode-button-background;
      background: rgba(0, 0, 0, 0.02);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);

      @include dark-mode {
        border-color: $dark-mode-button-background;
        background: rgba(255, 255, 255, 0.05);
      }
    }

    // Active filter state - match category pill styling
    &.has-filter {
      background-color: $light-mode-button-background;
      color: white;
      font-weight: $font-medium;
      border-color: $light-mode-button-background;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);

      &:hover {
        background-color: darken($light-mode-button-background, 5%);
        border-color: darken($light-mode-button-background, 5%);
      }

      @include dark-mode {
        background-color: $dark-mode-button-background;
        border-color: $dark-mode-button-background;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);

        &:hover {
          background-color: lighten($dark-mode-button-background, 5%);
          border-color: lighten($dark-mode-button-background, 5%);
        }
      }

      .dropdown-icon {
        color: white;
      }
    }

    @include dark-mode {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.9);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);

      &:hover {
        border-color: rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      &:focus-visible {
        outline-color: $dark-mode-button-background;
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
      }
    }

    .button-text {
      flex: 1;
      white-space: nowrap;
    }

    .dropdown-icon {
      flex-shrink: 0;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);

      &.rotated {
        transform: rotate(180deg);
      }
    }
  }

  // Dropdown Container
  .date-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 20;
    min-width: 320px;
    padding: $spacing-md;
    background: white;
    border-radius: 16px;
    box-shadow:
      0 4px 6px rgba(0, 0, 0, 0.05),
      0 10px 24px rgba(0, 0, 0, 0.1),
      0 0 0 1px rgba(0, 0, 0, 0.04);

    @include dark-mode {
      background: rgba(30, 30, 35, 0.98);
      box-shadow:
        0 4px 6px rgba(0, 0, 0, 0.3),
        0 10px 24px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(20px);
    }

    @include mobile-only {
      left: 0;
      right: 0;
      min-width: auto;
    }
  }

  // Date Mode Pills (inside dropdown)
  .date-mode-pills {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;

    @include medium-size-device {
      flex-wrap: nowrap;
    }

    .date-pill {
      // Match category pill styling exactly
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      flex-shrink: 0;
      padding: 6px 14px;
      min-height: 32px;
      border: none;
      border-radius: 16px;
      font-family: 'Creato Display', 'Helvetica Neue', sans-serif;
      font-size: 13px;
      font-weight: $font-regular;
      letter-spacing: 0.01em;
      cursor: pointer;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      user-select: none;

      // Unselected state - subtle and refined
      background-color: rgba(0, 0, 0, 0.04);
      color: rgba(0, 0, 0, 0.6);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);

      &:hover:not(.active) {
        background-color: rgba(0, 0, 0, 0.08);
        color: rgba(0, 0, 0, 0.75);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      &:focus-visible {
        outline: 2px solid rgba(0, 0, 0, 0.5);
        outline-offset: 1px;
        box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.08);
      }

      &:active:not(.active) {
        transform: scale(0.97);
      }

      // Selected state - uses design system tokens
      &.active {
        background-color: $light-mode-button-background;
        color: white;
        font-weight: $font-medium;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);

        &:hover {
          background-color: darken($light-mode-button-background, 5%);
        }

        @include dark-mode {
          background-color: $dark-mode-button-background;
          color: white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);

          &:hover {
            background-color: lighten($dark-mode-button-background, 5%);
          }
        }
      }

      // Dark mode unselected state
      @include dark-mode {
        background-color: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.6);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);

        &:hover:not(.active) {
          background-color: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.8);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }

        &:focus-visible {
          outline-color: rgba(255, 255, 255, 0.5);
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
        }
      }

      // Calendar icon pill
      &.calendar-pill {
        padding: 6px 10px;

        svg {
          display: block;
        }

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
      }
    }
  }

  // Custom Dates Section (shown when custom mode is active)
  .custom-dates-section {
    margin-top: $spacing-md;
    padding-top: $spacing-md;
    border-top: 1px solid rgba(0, 0, 0, 0.08);

    @include dark-mode {
      border-top-color: rgba(255, 255, 255, 0.1);
    }

    .date-inputs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: $spacing-md;

      @include mobile-only {
        grid-template-columns: 1fr;
        gap: $spacing-sm;
      }

      .date-input-group {
        display: flex;
        flex-direction: column;
        gap: 6px;

        .date-input-label {
          font-size: 11px;
          font-weight: $font-medium;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: rgba(0, 0, 0, 0.5);

          @include dark-mode {
            color: rgba(255, 255, 255, 0.5);
          }
        }

        .date-input {
          @include input-base;

          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          min-height: 36px;
          border-radius: 8px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background-color: rgba(0, 0, 0, 0.02);
          color: rgba(0, 0, 0, 0.85);
          font-family: 'Creato Display', 'Helvetica Neue', sans-serif;
          font-weight: $font-regular;
          transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);

          &:hover {
            border-color: rgba(0, 0, 0, 0.2);
            background-color: rgba(0, 0, 0, 0.04);
          }

          &:focus {
            outline: 2px solid $light-mode-button-background;
            outline-offset: 0;
            border-color: transparent;
            background-color: white;
          }

          @include dark-mode {
            border-color: rgba(255, 255, 255, 0.15);
            background-color: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.9);

            &:hover {
              border-color: rgba(255, 255, 255, 0.25);
              background-color: rgba(255, 255, 255, 0.08);
            }

            &:focus {
              outline-color: $dark-mode-button-background;
              background-color: rgba(255, 255, 255, 0.1);
            }
          }

          // Style the calendar picker icon
          &::-webkit-calendar-picker-indicator {
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.15s ease;

            &:hover {
              opacity: 0.8;
            }

            @include dark-mode {
              filter: invert(1);
            }
          }
        }
      }
    }
  }

  // Smooth dropdown animation with spring easing
  .dropdown-fade-enter-active {
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .dropdown-fade-leave-active {
    transition: all 0.2s cubic-bezier(0.4, 0, 1, 1);
  }

  .dropdown-fade-enter-from {
    opacity: 0;
    transform: translateY(-12px) scale(0.95);
  }

  .dropdown-fade-enter-to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .dropdown-fade-leave-from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .dropdown-fade-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.96);
  }

  // Slide fade animation for custom dates section
  .slide-fade-enter-active {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .slide-fade-leave-active {
    transition: all 0.2s cubic-bezier(0.4, 0, 1, 1);
  }

  .slide-fade-enter-from {
    opacity: 0;
    max-height: 0;
    transform: translateY(-8px);
  }

  .slide-fade-enter-to {
    opacity: 1;
    max-height: 200px;
    transform: translateY(0);
  }

  .slide-fade-leave-from {
    opacity: 1;
    max-height: 200px;
    transform: translateY(0);
  }

  .slide-fade-leave-to {
    opacity: 0;
    max-height: 0;
    transform: translateY(-4px);
  }
}

// Responsive adjustments
@include mobile-only {
  .search-filter-public {
    gap: $spacing-md;
  }

  .date-range-section {
    .date-mode-pills {
      width: 100%;

      .date-pill {
        flex: 1;
        font-size: 12px;
        padding: 5px 10px;
        min-height: 34px;
        justify-content: center;
      }
    }

    .date-inputs-inline {
      .date-input-compact {
        .date-input {
          font-size: 12px;
          padding: 5px 10px;
          min-height: 34px;
        }
      }
    }
  }
}
</style>
