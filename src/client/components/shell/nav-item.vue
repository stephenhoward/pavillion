<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronRight } from 'lucide-vue-next';
import { filledIconFor } from './filled-icons';
import type { NavigationItemWithState, NavItemVariant } from './types';

const props = withDefaults(defineProps<{
  item: NavigationItemWithState;
  variant: NavItemVariant;
}>(), {
  variant: 'sidebar',
});

/** The current item draws its icon filled; any other draws the outline. */
const filledIcon = computed(() => (props.item.isActive ? filledIconFor(props.item.icon) : undefined));

/*
 * In rail mode CSS reveals the label as a tooltip on hover and focus. WCAG
 * 1.4.13 needs Escape to hide it without moving focus or the pointer, and the
 * pointer may hover while focus is elsewhere, so the listener is on the
 * document. The next hover or focus of the item shows it again.
 */
const tooltipDismissed = ref(false);

function dismissTooltip(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    tooltipDismissed.value = true;
  }
}

function restoreTooltip() {
  tooltipDismissed.value = false;
}

onMounted(() => {
  if (props.variant === 'sidebar') {
    document.addEventListener('keydown', dismissTooltip);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', dismissTooltip);
});
</script>

<template>
  <RouterLink
    :to="props.item.to"
    class="shell-nav-item"
    :class="[
      `shell-nav-item--${props.variant}`,
      {
        'shell-nav-item--active': props.item.isActive,
        'shell-nav-item--tooltip-dismissed': tooltipDismissed,
      },
    ]"
    :aria-current="props.item.isActive ? 'page' : undefined"
    @mouseenter="restoreTooltip"
    @focus="restoreTooltip"
  >
    <component
      :is="filledIcon"
      v-if="filledIcon"
      class="shell-nav-item__icon shell-nav-item__icon--filled"
      aria-hidden="true"
    />
    <component
      :is="props.item.icon"
      v-else
      class="shell-nav-item__icon"
      :stroke-width="2"
      aria-hidden="true"
    />
    <!-- The badge count joins the link's name here; the visible digits are hidden.
         In rail mode this label is also the tooltip, so the name never doubles -->
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
