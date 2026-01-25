<script setup lang="ts">
import NavItem from './NavItem.vue';
import type { NavigationItemWithState } from './types';

defineProps<{
  items: NavigationItemWithState[];
}>();
</script>

<template>
  <aside class="sidebar" role="navigation" aria-label="Main navigation">
    <nav class="sidebar__nav">
      <ul class="sidebar__list">
        <li v-for="item in items" :key="item.id">
          <NavItem :item="item" variant="sidebar" />
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins/breakpoints' as *;

.sidebar {
  display: none;
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  width: var(--pav-shell-sidebar-width);
  background-color: var(--pav-surface-secondary);
  border-inline-end: 1px solid var(--pav-border-subtle);
  z-index: 100;
  flex-direction: column;

  @include pav-media(md) {
    display: flex;
  }

  &__nav {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  &__list {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: var(--pav-space-4);
    gap: var(--pav-space-1);
  }
}
</style>
