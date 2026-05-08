<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { EventCategory } from '@/common/model/event_category';
import { useLocalizedContent } from '../composables/useLocalizedContent';

export interface CategoryPillSelectorProps {
  categories: EventCategory[];
  selectedCategories: string[];
  disabled?: boolean;
  maxDisplayRows?: number;
  presentCategoryIds?: string[];
  absentTooltip?: string;
}

export interface CategoryPillSelectorEmits {
  (e: 'update:selectedCategories', value: string[]): void;
}

const props = withDefaults(defineProps<CategoryPillSelectorProps>(), {
  disabled: false,
  maxDisplayRows: 3,
});

const emit = defineEmits<CategoryPillSelectorEmits>();

const scrollContainer = ref<HTMLElement | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

// useTranslation subscribes to i18next language change events so this
// component re-renders when the UI locale is switched, ensuring
// localizedContent resolves the updated language.
const { t } = useTranslation('system');

const { localizedContent } = useLocalizedContent();

/**
 * Set of category IDs known to be present in the current result window.
 * Resolves to null when presentCategoryIds is undefined (presence gating
 * is opt-in: callers that don't pass this prop get no absent state).
 */
const presentSet = computed(() => {
  return props.presentCategoryIds ? new Set(props.presentCategoryIds) : null;
});

/**
 * Check if a category is currently selected by ID (per DEC-005)
 */
const isCategorySelected = (category: EventCategory): boolean => {
  return props.selectedCategories.includes(category.id);
};

/**
 * A category is absent when presence data is provided, the category is not
 * in the present set, and it is not currently selected. Selected always
 * wins so the user can still see what they have filtered to.
 */
const isCategoryAbsent = (category: EventCategory): boolean => {
  const set = presentSet.value;
  if (set === null) return false;
  if (isCategorySelected(category)) return false;
  return !set.has(category.id);
};

/**
 * Toggle category selection state using category ID
 */
const toggleCategory = (category: EventCategory): void => {
  if (props.disabled) return;
  if (isCategoryAbsent(category)) return;

  const currentSelection = [...props.selectedCategories];
  const index = currentSelection.indexOf(category.id);

  if (index > -1) {
    currentSelection.splice(index, 1);
  }
  else {
    currentSelection.push(category.id);
  }

  emit('update:selectedCategories', currentSelection);
};

/**
 * Get the display name for a category in the current language
 */
const getCategoryDisplayName = (category: EventCategory): string => {
  try {
    const content = localizedContent(category);
    return content?.name || 'Unnamed Category';
  }
  catch {
    return 'Unnamed Category';
  }
};

/**
 * Generate ARIA label for accessibility, translated to the current locale.
 * State precedence: selected wins, then absent, otherwise not_selected.
 */
const getCategoryAriaLabel = (category: EventCategory): string => {
  const name = getCategoryDisplayName(category);
  let stateKey: 'selected' | 'category_absent' | 'not_selected';
  if (isCategorySelected(category)) {
    stateKey = 'selected';
  }
  else if (isCategoryAbsent(category)) {
    stateKey = 'category_absent';
  }
  else {
    stateKey = 'not_selected';
  }
  return t('category_filter_aria_label', {
    name,
    state: t(stateKey),
  });
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
 * Returns 'smooth' unless the user has opted out of motion (prefers-reduced-motion).
 */
const getScrollBehavior = (): ScrollBehavior => {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
};

/**
 * Scroll left by a reasonable amount
 */
const scrollLeft = (): void => {
  if (!scrollContainer.value) return;
  scrollContainer.value.scrollBy({ left: -200, behavior: getScrollBehavior() });
};

/**
 * Scroll right by a reasonable amount
 */
const scrollRight = (): void => {
  if (!scrollContainer.value) return;
  scrollContainer.value.scrollBy({ left: 200, behavior: getScrollBehavior() });
};

/**
 * Scroll the container to bring the first selected category pill into view
 */
const scrollToSelectedCategory = (): void => {
  if (!scrollContainer.value) return;
  const selectedPill = scrollContainer.value.querySelector('.category-pill.selected');
  if (selectedPill) {
    selectedPill.scrollIntoView({ behavior: getScrollBehavior(), inline: 'nearest', block: 'nearest' });
  }
};

// Run after DOM update so the .selected class is already applied when we query.
// When all filters are cleared, reset the scroll position to the start.
watch(() => props.selectedCategories, (newVal) => {
  if (newVal.length === 0 && scrollContainer.value) {
    scrollContainer.value.scrollTo({ left: 0, behavior: getScrollBehavior() });
    updateScrollButtons();
  }
  else {
    scrollToSelectedCategory();
  }
}, { flush: 'post' });

onMounted(() => {
  if (scrollContainer.value) {
    updateScrollButtons();
    scrollContainer.value.addEventListener('scroll', updateScrollButtons);
    window.addEventListener('resize', updateScrollButtons);
  }
  scrollToSelectedCategory();
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
      :aria-label="t('scroll_categories_left')"
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
        type="button"
        class="category-pill"
        :class="{
          selected: isCategorySelected(category),
          absent: isCategoryAbsent(category),
        }"
        :disabled="disabled"
        :aria-pressed="isCategorySelected(category)"
        :aria-disabled="isCategoryAbsent(category) || null"
        :aria-label="getCategoryAriaLabel(category)"
        :title="isCategoryAbsent(category) ? absentTooltip : undefined"
        @click="toggleCategory(category)"
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
      :aria-label="t('scroll_categories_right')"
      type="button"
    >
      ›
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.category-pill-selector-wrapper {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: $public-space-sm;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
}

// Scroll arrow buttons
.scroll-arrow {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: $public-radius-full;
  background-color: $public-bg-tertiary-light;
  color: $public-text-secondary-light;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: $public-transition-fast;
  padding: 0;
  z-index: 2;

  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
    color: $public-text-primary-light;
  }

  &:active {
    transform: scale(0.95);
  }

  @include public-dark-mode {
    background-color: $public-bg-tertiary-dark;
    color: $public-text-secondary-dark;

    &:hover {
      background-color: rgba(255, 255, 255, 0.14);
      color: $public-text-primary-dark;
    }
  }
}

// Scrollable container with conditional fade effects
.category-pill-selector {
  @include public-horizontal-scroll;

  position: relative;
  flex: 1;
  display: flex;
  flex-wrap: nowrap;
  gap: $public-space-sm;
  padding: $public-space-xs $public-space-sm;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  // Conditional fade-out gradients based on scroll position
  &.fade-left.fade-right {
    @include public-scroll-fade-both;
  }

  &.fade-left:not(.fade-right) {
    @include public-scroll-fade-left;
  }

  &.fade-right:not(.fade-left) {
    @include public-scroll-fade-right;
  }
}

.category-pill {
  @include public-filter-pill;

  flex-shrink: 0;
  gap: $public-space-xs;

  &:focus:not(:disabled) {
    outline: 2px solid rgba(0, 0, 0, 0.4);
    outline-offset: 1px;
    z-index: 1;
  }

  &:focus-visible:not(:disabled) {
    @include public-focus-visible;

    z-index: 1;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .category-name {
    line-height: $public-line-height-tight;
  }

  .checkmark {
    font-size: $public-font-size-xs;
    font-weight: $public-font-weight-bold;
    line-height: 1;
    opacity: 0.9;
  }

  @include public-dark-mode {
    &:focus:not(:disabled) {
      outline-color: rgba(255, 255, 255, 0.4);
    }
  }
}

// Responsive adjustments - maintain single row on all screen sizes
@include public-mobile-only {
  .category-pill {
    padding: 5px 10px;
    font-size: $public-font-size-xs;
    min-height: 44px; // Minimum touch target size per WCAG 2.5.8
  }
}
</style>
