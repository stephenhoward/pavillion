<script setup lang="ts">
/**
 * The calendar switcher: the current calendar's name followed by a chevron,
 * opening a sheet of the viewer's calendars. Every host (the calendar view,
 * the feed, the settings page header) renders this one control, so it takes
 * the calendar name rather than free text.
 *
 * Its accessible name is the calendar name alone, so a host h1 that holds it
 * reads as the calendar. When the viewer has more than one calendar, a
 * description says that it switches calendars. The description is a `hidden`
 * element teleported to the body: aria-describedby still reads it, and it
 * stays out of the text of a heading the switcher sits in.
 */
import { computed, nextTick, ref, useId } from 'vue';
import { useTranslation } from 'i18next-vue';
import { ChevronDown } from 'lucide-vue-next';
import CalendarSwitcherSheet from './CalendarSwitcherSheet.vue';
import CreateCalendarSheet from '@/client/components/logged_in/calendar/create-calendar-sheet.vue';
import { useCalendarStore } from '@/client/stores/calendarStore';

defineProps<{
  /** The current calendar's display name, shown on the trigger. */
  calendarName: string;
  /** Named route the sheet navigates to with `{ calendar }` on pick, and a created calendar opens on. */
  routeName: string;
  /** Calendar the host page shows, or null. */
  currentUrlName: string | null;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'switcher' });
const store = useCalendarStore();

const descriptionId = useId();
// The same calendars the sheet lists.
const hasOtherCalendars = computed(() => store.ownedCalendars.length + store.editedCalendars.length > 1);

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
    :aria-describedby="hasOtherCalendars ? descriptionId : undefined"
    @click="sheetOpen = true"
  >
    <span class="calendar-switcher__label">{{ calendarName }}</span>
    <ChevronDown :size="18" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <span v-if="hasOtherCalendars" :id="descriptionId" hidden>{{ t('trigger_description') }}</span>
  </Teleport>

  <CalendarSwitcherSheet
    v-if="sheetOpen"
    :route-name="routeName"
    :current-url-name="currentUrlName"
    @close="closeSheet"
    @create="onCreate"
  />

  <CreateCalendarSheet v-if="createOpen" :route-name="routeName" @close="closeCreate" />
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
