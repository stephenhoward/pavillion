<script setup lang="ts">
/**
 * ToggleSwitch Component
 *
 * A reusable toggle switch component for binary on/off selections.
 * Supports accessible keyboard navigation and screen reader announcements.
 */

const props = defineProps<{
  modelValue: boolean;
  label: string;
  id: string;
  disabled?: boolean;
  helpText?: string;
}>();

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
  <div class="toggle-switch-container">
    <div class="toggle-switch-row">
      <label :for="id" class="toggle-label">
        {{ label }}
      </label>
      <button
        :id="id"
        type="button"
        role="switch"
        :aria-checked="modelValue"
        :aria-disabled="disabled"
        :disabled="disabled"
        :class="['toggle-switch', { active: modelValue, disabled: disabled }]"
        @click="handleToggle"
        @keydown="handleKeydown"
      >
        <span class="toggle-slider" />
      </button>
    </div>
    <p v-if="helpText" class="toggle-help-text">
      {{ helpText }}
    </p>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

div.toggle-switch-container {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;

  div.toggle-switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $spacing-md;

    label.toggle-label {
      font-size: 0.875rem;
      font-weight: $font-medium;
      color: $light-mode-text;
      flex: 1;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-text;
      }
    }

    button.toggle-switch {
      position: relative;
      width: 44px;
      height: 24px;
      min-height: 24px;
      background: #ccc;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: background-color 0.2s ease;
      flex-shrink: 0;

      @media (prefers-color-scheme: dark) {
        background: #555;
      }

      &:focus {
        outline: 2px solid $light-mode-button-background;
        outline-offset: 2px;

        @media (prefers-color-scheme: dark) {
          outline-color: $dark-mode-button-background;
        }
      }

      &.active {
        background: $light-mode-button-background;

        @media (prefers-color-scheme: dark) {
          background: $dark-mode-button-background;
        }

        span.toggle-slider {
          transform: translateX(20px);
        }
      }

      &.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      span.toggle-slider {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }
    }
  }

  p.toggle-help-text {
    font-size: 0.75rem;
    color: rgba(0, 0, 0, 0.6);
    margin: 0;
    padding-left: 0;

    @media (prefers-color-scheme: dark) {
      color: rgba(255, 255, 255, 0.6);
    }
  }
}
</style>
