<script setup lang="ts">
/**
 * ToggleChip Component
 *
 * A reusable toggle chip for filters and categories.
 * Uses Sky-500 background when selected, Stone-100 when unselected.
 */

const props = withDefaults(defineProps<{
  modelValue: boolean;
  label: string;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const handleToggle = () => {
  if (!props.disabled) {
    emit('update:modelValue', !props.modelValue);
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    handleToggle();
  }
};
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    :class="[
      'toggle-chip',
      {
        'toggle-chip--selected': modelValue,
        'toggle-chip--disabled': disabled
      }
    ]"
    @click="handleToggle"
    @keydown="handleKeydown"
  >
    {{ label }}
  </button>
</template>

<style scoped lang="scss">
@use '../../assets/style/mixins' as *;

.toggle-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1.25rem;
  min-width: fit-content;
  border-radius: 9999px; // pill shape
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;

  // Unselected state
  background: var(--pav-color-stone-100);
  color: var(--pav-color-stone-600);

  &:hover:not(.toggle-chip--disabled) {
    background: var(--pav-color-stone-200);
  }

  // Selected state
  &--selected {
    background: var(--pav-color-sky-500);
    color: white;

    &:hover:not(.toggle-chip--disabled) {
      background: var(--pav-color-sky-600);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  &--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    // Unselected dark mode
    background: var(--pav-color-stone-800);
    color: var(--pav-color-stone-300);

    &:hover:not(.toggle-chip--disabled) {
      background: var(--pav-color-stone-700);
    }

    // Selected stays the same in dark mode
    &--selected {
      background: var(--pav-color-sky-500);
      color: white;

      &:hover:not(.toggle-chip--disabled) {
        background: var(--pav-color-sky-600);
      }
    }
  }
}
</style>
