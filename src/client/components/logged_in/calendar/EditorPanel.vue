<script setup lang="ts">
/**
 * EditorPanel Component
 *
 * Reusable container for sidebar sections in the event editor.
 * Provides consistent styling with icon, title, and content area.
 */

import type { Component } from 'vue';

const props = withDefaults(defineProps<{
  title: string;
  icon?: Component;
  collapsible?: boolean;
  defaultOpen?: boolean;
}>(), {
  collapsible: false,
  defaultOpen: true,
});

// Future: Add collapse/expand functionality if needed
</script>

<template>
  <div class="editor-panel">
    <div class="panel-header">
      <component
        v-if="icon"
        :is="icon"
        :size="18"
        class="panel-icon"
        aria-hidden="true"
      />
      <h3 class="panel-title">{{ title }}</h3>
    </div>
    <div class="panel-content">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/components/event-management' as *;

.editor-panel {
  @include section-card;
  margin-bottom: 1rem;

  &:last-child {
    margin-bottom: 0;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-bottom-color: var(--pav-color-stone-700);
  }
}

.panel-icon {
  flex-shrink: 0;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.panel-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pav-color-stone-700);
  text-transform: uppercase;
  letter-spacing: 0.05em;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
