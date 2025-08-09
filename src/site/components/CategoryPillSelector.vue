<script setup lang="ts">
import { EventCategory } from '@/common/model/event_category';

export interface CategoryPillSelectorProps {
  categories: EventCategory[];
  selectedCategories: string[]; // Now expects category names instead of IDs
  disabled?: boolean;
  maxDisplayRows?: number;
}

export interface CategoryPillSelectorEmits {
  (e: 'update:selectedCategories', value: string[]): void; // Now emits category names instead of IDs
}

const props = withDefaults(defineProps<CategoryPillSelectorProps>(), {
  disabled: false,
  maxDisplayRows: 3,
});

const emit = defineEmits<CategoryPillSelectorEmits>();

/**
 * Check if a category is currently selected by name
 */
const isCategorySelected = (category: EventCategory): boolean => {
  const categoryName = getCategoryDisplayName(category);
  return props.selectedCategories.includes(categoryName);
};

/**
 * Toggle category selection state using category name
 */
const toggleCategory = (category: EventCategory): void => {
  if (props.disabled) return;

  const categoryName = getCategoryDisplayName(category);
  const currentSelection = [...props.selectedCategories];
  const index = currentSelection.indexOf(categoryName);

  if (index > -1) {
    // Remove category from selection
    currentSelection.splice(index, 1);
  }
  else {
    // Add category to selection
    currentSelection.push(categoryName);
  }

  emit('update:selectedCategories', currentSelection);
};

/**
 * Handle keyboard interactions
 */
const handleKeydown = (event: KeyboardEvent, category: EventCategory): void => {
  if (props.disabled) return;

  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    toggleCategory(category);
  }
};

/**
 * Get the display name for a category in the current language
 */
const getCategoryDisplayName = (category: EventCategory): string => {
  // Default to English, or first available language
  try {
    const content = category.content('en') || category.content(category.getLanguages()[0]);
    return content?.name || 'Unnamed Category';
  }
  catch {
    return 'Unnamed Category';
  }
};

/**
 * Generate ARIA label for accessibility
 */
const getCategoryAriaLabel = (category: EventCategory): string => {
  const name = getCategoryDisplayName(category);
  const isSelected = isCategorySelected(category);
  return `${name} category filter, ${isSelected ? 'selected' : 'not selected'}`;
};
</script>

<template>
  <div
    class="category-pill-selector"
    :class="{ disabled: disabled }"
  >
    <button
      v-for="category in categories"
      :key="category.id"
      class="category-pill"
      :class="{ selected: isCategorySelected(category) }"
      :disabled="disabled"
      :aria-pressed="isCategorySelected(category)"
      :aria-label="getCategoryAriaLabel(category)"
      role="button"
      tabindex="0"
      @click="toggleCategory(category)"
      @keydown="handleKeydown($event, category)"
    >
      <span class="category-name">{{ getCategoryDisplayName(category) }}</span>
      <span
        v-if="isCategorySelected(category)"
        class="checkmark"
        aria-hidden="true"
      >
        ✓
      </span>
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../client/assets/mixins' as *;

.category-pill-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
  justify-content: flex-start;

  &.disabled {
    opacity: 0.6;
    pointer-events: none;
  }
}

.category-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  min-height: 44px; // Minimum touch target size
  border: none;
  border-radius: 25px;
  font-family: 'Creato Display', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  font-weight: $font-medium;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
  white-space: nowrap;

  // Unselected state
  background-color: transparent;
  color: #374151;
  border: 1px solid #d1d5db;

  &:hover:not(:disabled) {
    opacity: 0.8;
    transform: scale(1.02);
  }

  &:focus:not(:disabled) {
    outline: 2px solid #ff9131;
    outline-offset: 2px;
    box-shadow: 0 0 0 4px rgba(255, 145, 49, 0.2);
    z-index: 1; // Ensure focus ring is visible above other elements
  }

  // Enhanced focus for keyboard navigation
  &:focus-visible:not(:disabled) {
    outline: 3px solid #ff9131;
    outline-offset: 2px;
    box-shadow: 0 0 0 6px rgba(255, 145, 49, 0.25);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  // Selected state
  &.selected {
    background-color: #ff9131;
    color: white;

    @media (prefers-color-scheme: dark) {
      background-color: #C86002;
    }
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .category-name {
    line-height: 1.2;
  }

  .checkmark {
    font-size: 12px;
    font-weight: $font-bold;
    line-height: 1;
  }

  // Dark mode styles
  @media (prefers-color-scheme: dark) {
    // Unselected state in dark mode
    background-color: transparent;
    color: #e5e7eb;
    border-color: #4b5563;

    &:focus:not(:disabled) {
      outline-color: #C86002;
      box-shadow: 0 0 0 4px rgba(200, 96, 2, 0.2);
    }

    &:focus-visible:not(:disabled) {
      outline: 3px solid #C86002;
      box-shadow: 0 0 0 6px rgba(200, 96, 2, 0.25);
    }
  }
}

// Responsive adjustments for mobile devices
@media (max-width: 768px) {
  .category-pill-selector {
    gap: 8px; // Maintain adequate spacing for touch interactions
  }

  .category-pill {
    padding: 8px 14px; // Slightly more padding for better touch targets
    font-size: 14px; // Maintain readable font size
    min-height: 44px; // Meet accessibility guidelines for touch targets

    // Ensure adequate spacing between text and borders
    line-height: 1.3;
  }
}

// Additional responsive adjustments for smaller screens
@media (max-width: 480px) {
  .category-pill-selector {
    gap: 6px; // Tighter spacing on very small screens
  }

  .category-pill {
    padding: 8px 12px;
    font-size: 13px;
    min-height: 44px; // Still maintain 44px minimum

    // Handle long category names better on small screens
    max-width: calc(50% - 3px); // Allow max 2 pills per row
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &.selected {
      // Give selected pills a bit more space for the checkmark
      max-width: calc(50% - 3px);
    }
  }

  .category-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

// Ensure pills wrap properly with many categories
.category-pill-selector {
  max-width: 100%;

  // Limit to maxDisplayRows if specified
  // This is handled by the parent container's max-height
  overflow-y: auto;
}
</style>
