<template>
  <li role="none" class="actions-menu-item">
    <RouterLink
      v-if="to"
      :to="to"
      role="menuitem"
      class="actions-menu-item__action"
      :aria-label="ariaLabel"
      @click="handleActivate"
    >
      <component :is="icon"
                 :size="16"
                 :stroke-width="1.5"
                 aria-hidden="true"
                 class="actions-menu-item__icon" />
      <span class="actions-menu-item__label"><slot /></span>
    </RouterLink>

    <button
      v-else
      type="button"
      role="menuitem"
      class="actions-menu-item__action"
      :aria-label="ariaLabel"
      @click="handleActivate"
    >
      <component :is="icon"
                 :size="16"
                 :stroke-width="1.5"
                 aria-hidden="true"
                 class="actions-menu-item__icon" />
      <span class="actions-menu-item__label"><slot /></span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { inject, type Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

defineProps<{
  icon: Component;
  to?: RouteLocationRaw;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const closeMenu = inject<() => void>('actions-menu-close', () => {});

function handleActivate(event: MouseEvent) {
  emit('click', event);
  closeMenu();
}
</script>

<style scoped lang="scss">
.actions-menu-item {
  list-style: none;
}

.actions-menu-item__action {
  display: flex;
  align-items: center;
  gap: var(--pav-space-2);
  width: 100%;
  padding: var(--pav-space-2) var(--pav-space-3);
  background: transparent;
  border: none;
  border-radius: var(--pav-border-radius-sm);
  font: inherit;
  color: var(--pav-text-primary, var(--pav-color-text-primary));
  text-align: start;
  text-decoration: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--pav-interactive-hover, var(--pav-color-surface-secondary));
  }

  &:focus-visible {
    outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
    outline-offset: -2px;
  }
}

.actions-menu-item__icon {
  flex-shrink: 0;
  color: var(--pav-text-secondary, var(--pav-color-text-secondary));
}

.actions-menu-item__label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}
</style>
