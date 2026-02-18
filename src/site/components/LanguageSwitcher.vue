<script setup lang="ts">
import { reactive, computed, ref, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';

import { AVAILABLE_LANGUAGES, PRIMARY_THRESHOLD, BETA_THRESHOLD } from '@/common/i18n/languages';
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

/**
 * Languages filtered into completeness tiers, excluding incomplete languages.
 */
const primaryLanguages = computed(() =>
  AVAILABLE_LANGUAGES.filter(lang => lang.completeness >= PRIMARY_THRESHOLD),
);

const betaLanguages = computed(() =>
  AVAILABLE_LANGUAGES.filter(
    lang => lang.completeness >= BETA_THRESHOLD && lang.completeness < PRIMARY_THRESHOLD,
  ),
);

const allVisibleLanguages = computed(() => [
  ...primaryLanguages.value,
  ...betaLanguages.value,
]);

/**
 * The native name of the currently selected language for display in the trigger button.
 */
const currentLanguageNativeName = computed(() => {
  const lang = AVAILABLE_LANGUAGES.find(l => l.code === currentLocale.value);
  return lang?.nativeName ?? currentLocale.value;
});

function openDropdown() {
  state.isOpen = true;
  state.focusedIndex = allVisibleLanguages.value.findIndex(
    l => l.code === currentLocale.value,
  );
}

function closeDropdown() {
  state.isOpen = false;
  state.focusedIndex = -1;
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
 */
function handleClickOutside(event: MouseEvent) {
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
    case 'Tab':
      closeDropdown();
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

/**
 * The index of the currently selected language inside allVisibleLanguages.
 */
const selectedIndex = computed(() =>
  allVisibleLanguages.value.findIndex(l => l.code === currentLocale.value),
);

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
        :aria-activedescendant="selectedIndex >= 0 ? `lang-option-${allVisibleLanguages[selectedIndex].code}` : undefined"
        tabindex="-1"
      >
        <!-- Primary languages section -->
        <div
          v-if="primaryLanguages.length > 0"
          class="language-switcher__section"
        >
          <div
            v-for="lang in primaryLanguages"
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

        <!-- Beta languages section (shown with label if present) -->
        <div
          v-if="betaLanguages.length > 0"
          class="language-switcher__section language-switcher__section--beta"
        >
          <div
            v-if="primaryLanguages.length > 0"
            class="language-switcher__section-label"
            aria-hidden="true"
          >
            {{ t('beta_languages') }}
          </div>
          <div
            v-for="lang in betaLanguages"
            :id="`lang-option-${lang.code}`"
            :key="lang.code"
            role="option"
            :aria-selected="lang.code === currentLocale"
            tabindex="0"
            class="language-switcher__option language-switcher__option--beta"
            :class="{ 'language-switcher__option--selected': lang.code === currentLocale }"
            :lang="lang.code"
            :dir="lang.direction"
            @click="selectLanguage(lang.code)"
            @keydown.enter.prevent="selectLanguage(lang.code)"
            @keydown.space.prevent="selectLanguage(lang.code)"
          >
            <span class="language-switcher__native-name">{{ lang.nativeName }}</span>
            <span
              class="language-switcher__beta-badge"
              :aria-label="t('beta_label')"
            >
              {{ t('beta_label') }}
            </span>
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
      </div>
    </transition>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

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
  background: transparent;
  border: 1px solid $public-border-medium-light;
  border-radius: $public-radius-full;
  font-family: $public-font-family;
  font-size: $public-font-size-sm;
  font-weight: $public-font-weight-regular;
  color: $public-text-secondary-light;
  cursor: pointer;
  transition: $public-transition-fast;
  user-select: none;
  white-space: nowrap;

  &:hover {
    border-color: $public-border-strong-light;
    color: $public-text-primary-light;
    background: $public-hover-overlay-light;
  }

  &:focus-visible {
    outline: 2px solid $public-accent-light;
    outline-offset: 2px;
  }

  @include dark-mode {
    border-color: $public-border-medium-dark;
    color: $public-text-secondary-dark;

    &:hover {
      border-color: $public-border-strong-dark;
      color: $public-text-primary-dark;
      background: $public-hover-overlay-dark;
    }

    &:focus-visible {
      outline-color: $public-accent-dark;
    }
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
  right: 0;
  z-index: 50;
  min-width: 180px;
  padding: 6px;
  background: $public-bg-primary-light;
  border-radius: $public-radius-md;
  box-shadow: $public-shadow-lg-light;
  outline: none;

  @include dark-mode {
    background: rgba(30, 30, 35, 0.98);
    box-shadow: $public-shadow-lg-dark;
    backdrop-filter: blur(20px);
  }
}

// ===== Section =====

.language-switcher__section {
  // no separator on the first section
}

.language-switcher__section--beta {
  border-top: 1px solid $public-border-subtle-light;
  margin-top: 4px;
  padding-top: 4px;

  @include dark-mode {
    border-top-color: $public-border-subtle-dark;
  }
}

.language-switcher__section-label {
  padding: 4px 10px 2px;
  font-size: $public-font-size-xs;
  font-weight: $public-font-weight-medium;
  text-transform: uppercase;
  letter-spacing: $public-letter-spacing-wide;
  color: $public-text-tertiary-light;

  @include dark-mode {
    color: $public-text-tertiary-dark;
  }
}

// ===== Option =====

.language-switcher__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: $public-radius-sm;
  cursor: pointer;
  transition: background $public-duration-fast $public-ease-out;
  outline: none;

  &:hover {
    background: $public-bg-tertiary-light;
  }

  &:focus-visible {
    background: $public-bg-tertiary-light;
    outline: 2px solid $public-accent-light;
    outline-offset: -2px;
  }

  @include dark-mode {
    &:hover {
      background: $public-bg-tertiary-dark;
    }

    &:focus-visible {
      background: $public-bg-tertiary-dark;
      outline-color: $public-accent-dark;
    }
  }
}

.language-switcher__option--selected {
  background: $public-bg-secondary-light;

  .language-switcher__native-name {
    font-weight: $public-font-weight-medium;
  }

  @include dark-mode {
    background: $public-bg-secondary-dark;
  }
}

.language-switcher__native-name {
  flex: 1;
  font-family: $public-font-family;
  font-size: $public-font-size-sm;
  color: $public-text-primary-light;

  @include dark-mode {
    color: $public-text-primary-dark;
  }
}

.language-switcher__checkmark {
  flex-shrink: 0;
  color: $public-accent-light;

  @include dark-mode {
    color: $public-accent-dark;
  }
}

.language-switcher__beta-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: $public-radius-full;
  font-size: $public-font-size-xs;
  font-weight: $public-font-weight-medium;
  background: $public-bg-tertiary-light;
  color: $public-text-tertiary-light;

  @include dark-mode {
    background: $public-bg-tertiary-dark;
    color: $public-text-tertiary-dark;
  }
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
