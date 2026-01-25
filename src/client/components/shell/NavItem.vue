<script setup lang="ts">
import type { NavigationItemWithState, NavItemVariant } from './types';

const props = withDefaults(defineProps<{
  item: NavigationItemWithState;
  variant: NavItemVariant;
}>(), {
  variant: 'sidebar',
});
</script>

<template>
  <RouterLink
    :to="props.item.to"
    class="shell-nav-item"
    :class="[
      `shell-nav-item--${props.variant}`,
      { 'shell-nav-item--active': props.item.isActive }
    ]"
    :aria-current="props.item.isActive ? 'page' : undefined"
  >
    <component
      :is="props.item.icon"
      class="shell-nav-item__icon"
      :stroke-width="2"
      aria-hidden="true"
    />
    <span class="shell-nav-item__label">{{ props.item.label }}</span>
    <span
      v-if="props.item.badge && props.item.badge > 0"
      class="shell-nav-item__badge"
      :aria-label="`${props.item.badge} notifications`"
    >
      {{ props.item.badge > 99 ? '99+' : props.item.badge }}
    </span>
  </RouterLink>
</template>
