<script setup lang="ts">
/**
 * LanguageTabSelector Component
 *
 * Inline tab selector for managing multilingual content in the event editor.
 * Replaces the dropdown language selector with horizontal tab chips.
 */

import { Plus, X } from 'lucide-vue-next';
import iso6391 from 'iso-639-1-dir';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('system', {
  keyPrefix: 'language_tab_selector',
});

const props = withDefaults(defineProps<{
  modelValue: string;        // Currently selected language code
  languages: string[];       // Array of language codes
  maxVisibleTabs?: number;   // Maximum tabs to show before "..."
}>(), {
  maxVisibleTabs: 5,
});

const emit = defineEmits<{
  (e: 'update:modelValue', lang: string): void;
  (e: 'add-language'): void;
  (e: 'remove-language', lang: string): void;
}>();

const selectLanguage = (lang: string) => {
  emit('update:modelValue', lang);
};

const removeLanguage = (lang: string, event: Event) => {
  event.stopPropagation();
  emit('remove-language', lang);
};

const addLanguage = () => {
  emit('add-language');
};
</script>

<template>
  <div class="language-tab-selector">
    <nav
      role="tablist"
      aria-label="Language selection"
      class="tabs-container"
    >
      <button
        v-for="lang in languages"
        :key="lang"
        type="button"
        role="tab"
        :aria-selected="lang === modelValue ? 'true' : 'false'"
        :aria-controls="`content-${lang}`"
        class="language-tab"
        @click="selectLanguage(lang)"
        :aria-label="t('edit_content', { language: iso6391.getName(lang) })"
      >
        {{ iso6391.getName(lang) }}
      </button>

      <button
        type="button"
        class="add-tab-btn"
        @click="addLanguage"
        :aria-label="t('add_language')"
      >
        <Plus :size="16" aria-hidden="true" />
      </button>
    </nav>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins' as *;

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
  gap: 1.5rem;
  align-items: center;
  flex-wrap: wrap;
  width: 100%;
}

.language-tab {
  @include tab-button;
  white-space: nowrap;

  // Override default inactive color for consistency with the unique design
  &:not([aria-selected="true"]) {
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
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
