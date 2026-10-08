<script setup lang="ts">
import { reactive, computed, ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';

import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { useLocale } from '@/site/composables/useLocale';

const { t } = useTranslation('system', {
  keyPrefix: 'language_switcher',
});

const { currentLocale, switchLocale } = useLocale();

const state = reactive({
  isOpen: false,
  focusedIndex: -1,
});

const containerRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);

/**
 * All available languages shown in the switcher.
 */
const allVisibleLanguages = computed(() => AVAILABLE_LANGUAGES);

/**
 * The native name of the currently selected language for display in the trigger button.
 * Falls back to matching the base language code (e.g. 'en' from 'en-US').
 */
const currentLanguageNativeName = computed(() => {
  const locale = currentLocale.value;
  const lang = AVAILABLE_LANGUAGES.find(l => l.code === locale)
    ?? AVAILABLE_LANGUAGES.find(l => l.code === locale.split('-')[0]);
  return lang?.nativeName ?? locale;
});

function openDropdown() {
  state.isOpen = true;
  state.focusedIndex = allVisibleLanguages.value.findIndex(
    l => l.code === currentLocale.value,
  );
  nextTick(() => focusOption(state.focusedIndex));
}

function closeDropdown() {
  state.isOpen = false;
  state.focusedIndex = -1;
  triggerRef.value?.focus();
}

function toggleDropdown() {
  if (state.isOpen) {
    closeDropdown();
  }
  else {
    openDropdown();
  }
}

function selectLanguage(code: string) {
  switchLocale(code);
  closeDropdown();
}

/**
 * Close when a click is detected outside the component.
 * Guard against the dropdown being already closed to avoid stealing focus
 * from whatever the user actually clicked.
 */
function handleClickOutside(event: MouseEvent) {
  if (!state.isOpen) return;
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    closeDropdown();
  }
}

/**
 * Keyboard navigation for the listbox:
 * - ArrowDown / ArrowUp — move focus
 * - Enter / Space — select the focused option
 * - Escape — close without selecting
 * - Home / End — jump to first / last option
 */
function handleKeydown(event: KeyboardEvent) {
  if (!state.isOpen) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      openDropdown();
    }
    return;
  }

  const total = allVisibleLanguages.value.length;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      state.focusedIndex = (state.focusedIndex + 1) % total;
      focusOption(state.focusedIndex);
      break;

    case 'ArrowUp':
      event.preventDefault();
      state.focusedIndex = (state.focusedIndex - 1 + total) % total;
      focusOption(state.focusedIndex);
      break;

    case 'Home':
      event.preventDefault();
      state.focusedIndex = 0;
      focusOption(0);
      break;

    case 'End':
      event.preventDefault();
      state.focusedIndex = total - 1;
      focusOption(total - 1);
      break;

    case 'Enter':
    case ' ':
      event.preventDefault();
      if (state.focusedIndex >= 0) {
        selectLanguage(allVisibleLanguages.value[state.focusedIndex].code);
      }
      break;

    case 'Escape':
      closeDropdown();
      break;

    case 'Tab':
      state.isOpen = false;
      state.focusedIndex = -1;
      // Let Tab proceed naturally — do not steal focus back to trigger
      break;
  }
}

function focusOption(index: number) {
  // Allow the DOM to update before moving focus
  setTimeout(() => {
    if (!listRef.value) return;
    const options = listRef.value.querySelectorAll<HTMLElement>('[role="option"]');
    options[index]?.focus();
  }, 0);
}

/**
 * Compute the listbox id for aria-owns / aria-controls.
 */
const listboxId = 'language-switcher-listbox';
const triggerId = 'language-switcher-trigger';

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div
    ref="containerRef"
    class="language-switcher"
    @keydown="handleKeydown"
  >
    <!-- Trigger button -->
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="language-switcher__trigger"
      :aria-haspopup="'listbox'"
      :aria-expanded="state.isOpen"
      :aria-controls="listboxId"
      :aria-label="t('change_language', { current: currentLanguageNativeName })"
      @click="toggleDropdown"
    >
      <!-- Globe icon (no country flags) -->
      <svg
        class="language-switcher__globe"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r="6.5"
          stroke="currentColor"
          stroke-width="1.2"
        />
        <ellipse
          cx="8"
          cy="8"
          rx="2.5"
          ry="6.5"
          stroke="currentColor"
          stroke-width="1.2"
        />
        <path
          d="M1.5 5.5h13M1.5 10.5h13"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
        />
      </svg>

      <span class="language-switcher__label">{{ currentLanguageNativeName }}</span>

      <!-- Chevron -->
      <svg
        class="language-switcher__chevron"
        :class="{ 'language-switcher__chevron--open': state.isOpen }"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 3.5L5 6.5L8 3.5"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- Dropdown listbox -->
    <transition name="language-dropdown">
      <div
        v-if="state.isOpen"
        :id="listboxId"
        ref="listRef"
        class="language-switcher__dropdown"
        role="listbox"
        :aria-label="t('available_languages')"
        tabindex="-1"
      >
        <div
          v-for="lang in allVisibleLanguages"
          :id="`lang-option-${lang.code}`"
          :key="lang.code"
          role="option"
          :aria-selected="lang.code === currentLocale"
          tabindex="0"
          class="language-switcher__option"
          :class="{ 'language-switcher__option--selected': lang.code === currentLocale }"
          :lang="lang.code"
          :dir="lang.direction"
          @click="selectLanguage(lang.code)"
          @keydown.enter.prevent="selectLanguage(lang.code)"
          @keydown.space.prevent="selectLanguage(lang.code)"
        >
          <span class="language-switcher__native-name">{{ lang.nativeName }}</span>
          <svg
            v-if="lang.code === currentLocale"
            class="language-switcher__checkmark"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.5 7L5.5 10L11.5 4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/common/ui/assets/mixins' as *;

.language-switcher {
  position: relative;
  display: inline-flex;
  align-items: center;
}

// ===== Trigger button =====

.language-switcher__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  min-height: 44px;
  background: transparent;
  border: 1px solid var(--pav-border-medium);
  border-radius: $public-radius-full;
  font-family: $public-font-family;
  font-size: $public-font-size-sm;
  font-weight: $public-font-weight-regular;
  color: var(--pav-text-secondary);
  cursor: pointer;
  transition: $public-transition-fast;
  user-select: none;
  white-space: nowrap;

  &:hover {
    border-color: var(--pav-border-strong);
    color: var(--pav-text-primary);
    background: var(--pav-interactive-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-accent);
    outline-offset: 2px;
  }
}

.language-switcher__globe {
  flex-shrink: 0;
  opacity: 0.75;

  .language-switcher__trigger:hover & {
    opacity: 1;
  }
}

.language-switcher__label {
  // truncate very long native names gracefully
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.language-switcher__chevron {
  flex-shrink: 0;
  transition: transform $public-duration-fast $public-ease-out;

  &--open {
    transform: rotate(180deg);
  }
}

// ===== Dropdown =====

.language-switcher__dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 50;
  min-width: 180px;
  padding: 6px;
  background: var(--pav-surface-popover);
  border-radius: $public-radius-md;
  box-shadow: var(--pav-shadow-lg);
  backdrop-filter: var(--pav-popover-backdrop-filter);
  outline: none;
}

// ===== Option =====

.language-switcher__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  min-height: 44px;
  border-radius: $public-radius-sm;
  cursor: pointer;
  transition: background $public-duration-fast $public-ease-out;
  outline: none;

  &:hover {
    background: var(--pav-surface-tertiary);
  }

  &:focus-visible {
    background: var(--pav-surface-tertiary);
    outline: 2px solid var(--pav-accent);
    outline-offset: -2px;
  }
}

.language-switcher__option--selected {
  background: var(--pav-surface-secondary);

  .language-switcher__native-name {
    font-weight: $public-font-weight-medium;
  }
}

.language-switcher__native-name {
  flex: 1;
  font-family: $public-font-family;
  font-size: $public-font-size-sm;
  color: var(--pav-text-primary);
}

.language-switcher__checkmark {
  flex-shrink: 0;
  color: var(--pav-accent);
}

// ===== Dropdown animation =====

.language-dropdown-enter-active {
  transition: all $public-duration-slow $public-ease-spring;
}

.language-dropdown-leave-active {
  transition: all $public-duration-normal $public-ease-in;
}

.language-dropdown-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.language-dropdown-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.language-dropdown-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.language-dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}
</style>
