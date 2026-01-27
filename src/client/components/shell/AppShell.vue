<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './Sidebar.vue';
import BottomNav from './BottomNav.vue';
import type { NavigationItem, NavigationItemWithState } from './types';

const props = defineProps<{
  navigationItems: NavigationItem[];
}>();

const route = useRoute();

/**
 * Compute active state for each navigation item based on current route
 */
const itemsWithActiveState = computed<NavigationItemWithState[]>(() =>
  props.navigationItems.map(item => ({
    ...item,
    isActive: isRouteActive(item.to),
  })),
);

/**
 * Check if a route destination matches the current route
 */
function isRouteActive(to: NavigationItem['to']): boolean {
  const path = typeof to === 'string' ? to : to.path || '';
  return route.path.startsWith(path);
}
</script>

<template>
  <div class="app-shell">
    <a href="#main" class="app-shell__skip-link sr-only">
      Skip to main content
    </a>
    <Sidebar :items="itemsWithActiveState" />
    <main id="main" class="app-shell__main">
      <slot />
    </main>
    <BottomNav :items="itemsWithActiveState" />
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins/breakpoints' as *;

.app-shell {
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  background-color: var(--pav-surface-primary);

  &__skip-link {
    &:focus {
      position: fixed;
      top: var(--pav-space-2);
      left: var(--pav-space-2);
      z-index: 9999;
      padding: var(--pav-space-2) var(--pav-space-4);
      background-color: var(--pav-surface-primary);
      color: var(--pav-text-primary);
      border: 2px solid var(--pav-border-color-focus);
      border-radius: var(--pav-border-radius-md);
      clip: auto;
      width: auto;
      height: auto;
    }
  }

  &__main {
    flex: 1;
    width: 100%;
    padding-block-end: calc(var(--pav-shell-bottom-nav-height) + var(--pav-shell-safe-area-bottom));

    @include pav-media(md) {
      padding-block-end: 0;
      margin-inline-start: var(--pav-shell-sidebar-width);
      width: calc(100% - var(--pav-shell-sidebar-width));
    }
  }
}
</style>
