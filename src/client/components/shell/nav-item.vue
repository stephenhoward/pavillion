<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next';
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
      { 'shell-nav-item--active': props.item.isActive },
    ]"
    :aria-current="props.item.isActive ? 'page' : undefined"
  >
    <component
      :is="props.item.icon"
      class="shell-nav-item__icon"
      :stroke-width="2"
      aria-hidden="true"
    />
    <!-- The badge count joins the link's name here; the visible digits are hidden -->
    <span class="shell-nav-item__label">{{ props.item.label }} <span
      v-if="props.item.badge && props.item.badge > 0"
      class="sr-only"
    >{{ props.item.badgeLabel }}</span></span>
    <span
      v-if="props.item.badge && props.item.badge > 0"
      class="shell-nav-item__badge"
      aria-hidden="true"
    >
      {{ props.item.badge > 99 ? '99+' : props.item.badge }}
    </span>
    <ChevronRight
      v-if="props.variant === 'list'"
      class="shell-nav-item__chevron"
      :stroke-width="2"
      aria-hidden="true"
    />
  </RouterLink>
</template>
