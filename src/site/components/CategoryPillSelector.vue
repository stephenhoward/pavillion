<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
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

const scrollContainer = ref<HTMLElement | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

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

/**
 * Update scroll button visibility based on scroll position
 */
const updateScrollButtons = (): void => {
  if (!scrollContainer.value) return;

  const { scrollLeft, scrollWidth, clientWidth } = scrollContainer.value;

  canScrollLeft.value = scrollLeft > 0;
  canScrollRight.value = scrollLeft < scrollWidth - clientWidth - 1; // -1 for rounding
};

/**
 * Scroll left by a reasonable amount
 */
const scrollLeft = (): void => {
  if (!scrollContainer.value) return;
  scrollContainer.value.scrollBy({ left: -200, behavior: 'smooth' });
};

/**
 * Scroll right by a reasonable amount
 */
const scrollRight = (): void => {
  if (!scrollContainer.value) return;
  scrollContainer.value.scrollBy({ left: 200, behavior: 'smooth' });
};

onMounted(() => {
  if (scrollContainer.value) {
    updateScrollButtons();
    scrollContainer.value.addEventListener('scroll', updateScrollButtons);
    window.addEventListener('resize', updateScrollButtons);
  }
});

onUnmounted(() => {
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('scroll', updateScrollButtons);
  }
  window.removeEventListener('resize', updateScrollButtons);
});
</script>

<template>
  <div class="category-pill-selector-wrapper" :class="{ disabled: disabled }">
    <!-- Left scroll arrow -->
    <button
      v-if="canScrollLeft"
      class="scroll-arrow scroll-arrow-left"
      @click="scrollLeft"
      aria-label="Scroll categories left"
      type="button"
    >
      ‹
    </button>

    <!-- Scrollable category container -->
    <div
      ref="scrollContainer"
      class="category-pill-selector"
      :class="{
        disabled: disabled,
        'fade-left': canScrollLeft,
        'fade-right': canScrollRight
      }"
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

    <!-- Right scroll arrow -->
    <button
      v-if="canScrollRight"
      class="scroll-arrow scroll-arrow-right"
      @click="scrollRight"
      aria-label="Scroll categories right"
      type="button"
    >
      ›
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../client/assets/mixins' as *;

.category-pill-selector-wrapper {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
}

// Scroll arrow buttons
.scroll-arrow {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.7);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  padding: 0;
  z-index: 2;

  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.9);
  }

  &:active {
    transform: scale(0.95);
  }

  @media (prefers-color-scheme: dark) {
    background-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);

    &:hover {
      background-color: rgba(255, 255, 255, 0.14);
      color: rgba(255, 255, 255, 0.95);
    }
  }
}

// Scrollable container with conditional fade effects
.category-pill-selector {
  position: relative;
  flex: 1;

  // Hide scrollbar but keep functionality
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none; // Firefox

  &::-webkit-scrollbar {
    display: none; // Chrome, Safari, Edge
  }

  // Container for pills
  display: flex;
  flex-wrap: nowrap; // Single row
  gap: 8px;
  padding: 4px 0;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  // Conditional fade-out gradients based on scroll position
  &.fade-left.fade-right {
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 20px,
      black calc(100% - 20px),
      transparent 100%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 20px,
      black calc(100% - 20px),
      transparent 100%
    );
  }

  &.fade-left:not(.fade-right) {
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 20px,
      black 100%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      black 20px,
      black 100%
    );
  }

  &.fade-right:not(.fade-left) {
    -webkit-mask-image: linear-gradient(
      to right,
      black 0%,
      black calc(100% - 20px),
      transparent 100%
    );
    mask-image: linear-gradient(
      to right,
      black 0%,
      black calc(100% - 20px),
      transparent 100%
    );
  }
}

.category-pill {
  // Compact, refined styling
  display: inline-flex;
  align-items: center;
  flex-shrink: 0; // Prevent shrinking in scroll container
  gap: 4px;
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
  text-decoration: none;
  white-space: nowrap;
  user-select: none;

  // Unselected state - subtle and refined
  background-color: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);

  &:hover:not(:disabled) {
    background-color: rgba(0, 0, 0, 0.08);
    color: rgba(0, 0, 0, 0.75);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  &:focus:not(:disabled) {
    outline: 2px solid rgba(0, 0, 0, 0.4);
    outline-offset: 1px;
    z-index: 1;
  }

  &:focus-visible:not(:disabled) {
    outline: 2px solid rgba(0, 0, 0, 0.5);
    outline-offset: 1px;
    box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.08);
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  // Selected state - uses design system tokens
  &.selected {
    background-color: $light-mode-button-background;
    color: white;
    font-weight: $font-medium;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);

    &:hover:not(:disabled) {
      background-color: darken($light-mode-button-background, 5%);
    }

    @media (prefers-color-scheme: dark) {
      background-color: $dark-mode-button-background;
      color: white;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);

      &:hover:not(:disabled) {
        background-color: lighten($dark-mode-button-background, 5%);
      }
    }
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .category-name {
    line-height: 1.3;
  }

  .checkmark {
    font-size: 10px;
    font-weight: $font-bold;
    line-height: 1;
    opacity: 0.9;
  }

  // Dark mode styles
  @media (prefers-color-scheme: dark) {
    // Unselected state in dark mode
    background-color: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.6);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);

    &:hover:not(:disabled) {
      background-color: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.8);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    &:focus:not(:disabled) {
      outline-color: rgba(255, 255, 255, 0.4);
    }

    &:focus-visible:not(:disabled) {
      outline-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
    }
  }
}

// Responsive adjustments - maintain single row on all screen sizes
@media (max-width: 768px) {
  .category-pill {
    padding: 6px 12px;
    font-size: 12px;
    min-height: 34px;
  }
}

@media (max-width: 480px) {
  .category-pill {
    padding: 5px 10px;
    font-size: 11.5px;
    min-height: 36px; // Slightly larger for better touch targets
  }
}
</style>
