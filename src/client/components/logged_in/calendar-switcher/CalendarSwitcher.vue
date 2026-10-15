<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import CalendarSwitcherSheet from './CalendarSwitcherSheet.vue';
import CreateCalendarSheet from '@/client/components/logged_in/calendar/create-calendar-sheet.vue';

defineProps<{
  /** Text shown on the trigger: the calendar name, or the settings pane name. */
  label: string;
  /** Named route the sheet navigates to with `{ calendar }` on pick. */
  routeName: string;
  /** Calendar the host page shows, or null. */
  currentUrlName: string | null;
  /** Accessible name for the trigger, pre-translated by the host. */
  ariaLabel: string;
}>();

const triggerEl = ref<HTMLButtonElement | null>(null);
const sheetOpen = ref(false);
const createOpen = ref(false);

/**
 * Put focus back on the trigger once the closed sheet has unmounted. The
 * sheets restore focus themselves only when dismissed through their own
 * close (Escape, backdrop, close button); picking a calendar or creating
 * one unmounts them without it, which would drop focus to the body.
 */
async function focusTrigger() {
  await nextTick();
  triggerEl.value?.focus();
}

function closeSheet() {
  sheetOpen.value = false;
  focusTrigger();
}

/**
 * The sheet's create row hands over to the create-calendar sheet. The
 * trigger is refocused first so the create sheet captures it as the
 * element to return focus to.
 */
async function onCreate() {
  sheetOpen.value = false;
  await focusTrigger();
  createOpen.value = true;
}

function closeCreate() {
  createOpen.value = false;
  focusTrigger();
}
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="calendar-switcher"
    aria-haspopup="dialog"
    :aria-expanded="sheetOpen ? 'true' : 'false'"
    :aria-label="ariaLabel"
    @click="sheetOpen = true"
  >
    <span class="calendar-switcher__label">{{ label }}</span>
    <ChevronDown :size="18" aria-hidden="true" />
  </button>

  <CalendarSwitcherSheet
    v-if="sheetOpen"
    :route-name="routeName"
    :current-url-name="currentUrlName"
    @close="closeSheet"
    @create="onCreate"
  >
    <slot />
  </CalendarSwitcherSheet>

  <CreateCalendarSheet v-if="createOpen" @close="closeCreate" />
</template>

<style scoped lang="scss">
.calendar-switcher {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
  max-width: 100%;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
  border-radius: var(--pav-border-radius-sm);

  &__label {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  svg {
    flex-shrink: 0;
  }

  &:focus-visible {
    outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
    outline-offset: 2px;
  }
}
</style>
