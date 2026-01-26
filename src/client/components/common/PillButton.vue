<script setup lang="ts">
/**
 * PillButton Component
 *
 * A reusable pill-shaped button with multiple visual variants matching the design system.
 * Supports primary (Orange), secondary (outlined), ghost (transparent), and danger (Red) styles.
 */

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}>(), {
  variant: 'primary',
  type: 'button',
  disabled: false,
  size: 'md',
});

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();

const handleClick = (event: MouseEvent) => {
  if (!props.disabled) {
    emit('click', event);
  }
};
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="[
      'pill-button',
      `pill-button--${variant}`,
      `pill-button--${size}`,
      { 'pill-button--disabled': disabled }
    ]"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
@use '../../assets/style/mixins' as *;

.pill-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 9999px; // pill shape
  font-weight: 500;
  transition: all 0.15s ease;
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  &:active:not(.pill-button--disabled) {
    transform: scale(0.98);
  }

  // Size variants
  &--sm {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
  }

  &--md {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
  }

  &--lg {
    padding: 1rem 2rem;
    font-size: 1.125rem;
  }

  // Style variants
  &--primary {
    background: var(--pav-color-orange-500);
    color: white;

    &:hover:not(.pill-button--disabled) {
      opacity: 0.9;
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-orange-500);
    }
  }

  &--secondary {
    background: white;
    border-color: var(--pav-color-stone-300);
    color: var(--pav-color-stone-700);

    &:hover:not(.pill-button--disabled) {
      background: var(--pav-color-stone-50);
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-700);
      border-color: var(--pav-color-stone-600);
      color: var(--pav-color-stone-200);

      &:hover:not(.pill-button--disabled) {
        background: var(--pav-color-stone-600);
      }
    }
  }

  &--ghost {
    background: transparent;
    color: var(--pav-color-stone-700);

    &:hover:not(.pill-button--disabled) {
      background: var(--pav-color-stone-100);
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-200);

      &:hover:not(.pill-button--disabled) {
        background: var(--pav-color-stone-800);
      }
    }
  }

  &--danger {
    background: var(--pav-color-red-600);
    color: white;

    &:hover:not(.pill-button--disabled) {
      opacity: 0.9;
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-red-600);
    }
  }

  &--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
