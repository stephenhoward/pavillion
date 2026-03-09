<script setup lang="ts">
/**
 * LanguageTabSelector Component
 *
 * Inline tab selector for managing multilingual content in the event editor.
 * Replaces the dropdown language selector with horizontal tab chips.
 */

import { Plus } from 'lucide-vue-next';
import iso6391 from 'iso-639-1-dir';
import { useTranslation } from 'i18next-vue';
import { useTabScroll } from '@/client/composables/useTabScroll';

const { t } = useTranslation('system', {
  keyPrefix: 'language_tab_selector',
});

const props = withDefaults(defineProps<{
  modelValue: string;        // Currently selected language code
  languages: string[];       // Array of language codes
  erroredTabs?: string[];    // Language codes that have validation errors
  maxVisibleTabs?: number;   // Maximum tabs to show before "..."
}>(), {
  erroredTabs: () => [],
  maxVisibleTabs: 5,
});

const emit = defineEmits<{
  (e: 'update:modelValue', lang: string): void;
  (e: 'add-language'): void;
  (e: 'remove-language', lang: string): void;
}>();

const { tabsRef, canScrollLeft, canScrollRight } = useTabScroll();

const selectLanguage = (lang: string) => {
  emit('update:modelValue', lang);
};

const addLanguage = () => {
  emit('add-language');
};
</script>

<template>
  <div class="language-tab-selector">
    <nav
      ref="tabsRef"
      role="tablist"
      :aria-label="t('nav_label')"
      class="tabs-container"
      :class="{ 'can-scroll-left': canScrollLeft, 'can-scroll-right': canScrollRight }"
    >
      <button
        v-for="lang in languages"
        :key="lang"
        type="button"
        role="tab"
        :aria-selected="lang === modelValue ? 'true' : 'false'"
        :aria-controls="`content-${lang}`"
        class="language-tab"
        :class="{ 'has-error': erroredTabs.includes(lang) }"
        @click="selectLanguage(lang)"
        :aria-label="erroredTabs.includes(lang)
          ? t('edit_content_error', { language: iso6391.getName(lang) })
          : t('edit_content', { language: iso6391.getName(lang) })"
      >
        {{ iso6391.getName(lang) }}
        <span
          v-if="erroredTabs.includes(lang)"
          class="error-dot"
          aria-hidden="true"
        />
      </button>
    </nav>
    <!-- add button is a sibling of nav, outside the tablist -->
    <button
      type="button"
      class="add-tab-btn"
      @click="addLanguage"
      :aria-label="t('add_language')"
    >
      <Plus :size="16" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins' as *;
@use '@/client/assets/style/tokens/breakpoint-mixins' as *;

.language-tab-selector {
  display: flex;
  align-items: center;
  padding: 0;
  border-bottom: 1px solid var(--pav-color-stone-200);
  margin-bottom: 1.5rem;

  @media (prefers-color-scheme: dark) {
    border-bottom-color: var(--pav-color-stone-700);
  }
}

.tabs-container {
  display: flex;
  flex-direction: row; // Override Chrome UA stylesheet which sets column on <nav> flex containers
  gap: 1.5rem;
  align-items: center;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  width: 100%;

  &::-webkit-scrollbar {
    display: none;
  }

  // Bidirectional scroll-fade affordance on narrow screens.
  // 2rem stop: relative unit scales with font size, giving a proportionally
  // wider fade for tab labels vs. category pills.
  // Apply .can-scroll-right / .can-scroll-left via useTabScroll composable.
  @include pav-media-down(sm) {
    // Right fade: more tabs off-screen to the right
    &.can-scroll-right {
      -webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 2rem), transparent 100%);
      mask-image: linear-gradient(to right, black 0%, black calc(100% - 2rem), transparent 100%);
    }

    // Left fade: tabs off-screen to the left
    &.can-scroll-left {
      -webkit-mask-image: linear-gradient(to right, transparent 0%, black 2rem, black 100%);
      mask-image: linear-gradient(to right, transparent 0%, black 2rem, black 100%);
    }

    // Both fades simultaneously: tabs hidden on both sides
    &.can-scroll-left.can-scroll-right {
      -webkit-mask-image: linear-gradient(to right, transparent 0%, black 2rem, black calc(100% - 2rem), transparent 100%);
      mask-image: linear-gradient(to right, transparent 0%, black 2rem, black calc(100% - 2rem), transparent 100%);
    }
  }
}

.language-tab {
  @include tab-button;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;

  // Override default inactive color for consistency with the unique design
  &:not([aria-selected="true"]) {
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  // Error state: tint tab label red
  &.has-error {
    color: var(--pav-color-red-600);

    &[aria-selected="true"] {
      color: var(--pav-color-red-600);

      &::after {
        background: var(--pav-color-red-500);
      }
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);

      &[aria-selected="true"] {
        color: var(--pav-color-red-400);

        &::after {
          background: var(--pav-color-red-400);
        }
      }
    }
  }
}

.error-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--pav-color-red-500);
  flex-shrink: 0;

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-red-400);
  }
}

.add-tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border: none;
  background: none;
  color: var(--pav-color-stone-500);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--pav-color-orange-500);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-500);

    &:hover {
      color: var(--pav-color-orange-400);
    }
  }
}
</style>
