<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import Sidebar from './sidebar.vue';
import BottomNav from './bottom-nav.vue';
import type { NavigationItem, NavigationItemWithState } from './types';

const props = defineProps<{
  navigationItems: NavigationItem[];
}>();

const route = useRoute();
const { t } = useTranslation('system');

/**
 * Compute active state for each navigation item based on current route
 */
const itemsWithActiveState = computed<NavigationItemWithState[]>(() =>
  props.navigationItems.map(item => ({
    ...item,
    isActive: isRouteActive(item),
  })),
);

/**
 * Rail mode: any matched record carrying meta.shellRail collapses the sidebar
 * to an icon rail. Script decides only the class; the effect is gated to md+
 * in _shell-nav.scss, so there is no viewport branch here.
 */
const isRail = computed(() => route.matched.some(r => r.meta.shellRail === true));

/**
 * Check if a navigation item is active for the current route: the route's
 * path starts with the item's path.
 */
function isRouteActive(item: NavigationItem): boolean {
  const path = typeof item.to === 'string' ? item.to : (item.to as { path?: string }).path || '';
  return route.path.startsWith(path);
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--rail': isRail }">
    <a href="#main" class="app-shell__skip-link sr-only">
      {{ t('navigation.skip_to_content') }}
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
      margin-inline-start: var(--pav-shell-nav-width);
      width: calc(100% - var(--pav-shell-nav-width));
    }
  }
}
</style>
