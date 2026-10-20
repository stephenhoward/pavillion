<script setup lang="ts">
/**
 * The one header of every settings page: the root, the three sections
 * (calendar, account, instance) and every leaf. It takes no props; the
 * state comes from the route and the viewer's loaded calendars alone.
 *
 * - Below md a section or leaf shows a visible "Back to {parent}" link. Its
 *   target is derived from the route, never from history, so a cold-loaded
 *   leaf still goes to its section.
 * - At md+ the back link is hidden by CSS and a leaf shows an eyebrow above
 *   its h1: the group name, or the calendar switcher on a calendar leaf.
 * - A calendar section puts the switcher beside the h1, never inside it.
 * - A calendar the viewer cannot resolve (nonexistent, not a member, or not
 *   loaded) renders the same header at the index and every leaf, titled
 *   with the group, and never echoes the route param.
 */
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRoute, type RouteLocationNamedRaw } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { ChevronLeft } from 'lucide-vue-next';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { calendarDisplayName } from '@/client/service/calendar-display';
import { findViewerCalendar } from '@/client/service/settings-guards';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
import {
  findLeafByRouteName,
  type SettingsLeafGroup,
  type SettingsLeafRef,
} from '@/client/components/logged_in/settings/nav-items';

type HeaderLevel =
  | { kind: 'root' }
  | { kind: 'section'; group: SettingsLeafGroup }
  | { kind: 'leaf'; group: SettingsLeafGroup; leaf: SettingsLeafRef };

const GROUP_TITLE_KEYS: Record<SettingsLeafGroup, string> = {
  calendar: 'titles.calendar',
  account: 'titles.account',
  admin: 'titles.instance',
};

function isSection(value: unknown): value is SettingsLeafGroup {
  return value === 'calendar' || value === 'account' || value === 'admin';
}

const route = useRoute();
const calendarStore = useCalendarStore();
const { t } = useTranslation('settings');
const { t: tCal } = useTranslation('calendars');

const level = computed<HeaderLevel>(() => {
  // Read the matched record's own meta, not the merged route.meta, so a
  // group set on a parent record never turns its leaves into sections.
  const record = route.matched[route.matched.length - 1];
  const group = record?.meta.settingsGroup;
  if (isSection(group)) {
    return { kind: 'section', group };
  }
  const leaf = typeof route.name === 'string' ? findLeafByRouteName(route.name) : null;
  // The settings root, and any route outside the tree, title as Settings.
  return leaf ? { kind: 'leaf', group: leaf.group, leaf } : { kind: 'root' };
});

const group = computed<SettingsLeafGroup | null>(() => (level.value.kind === 'root' ? null : level.value.group));

// The same lookup the guards use: only the viewer's own loaded list resolves
// a calendar, and null is the unresolved calendar.
const calendarInfo = computed(() => findViewerCalendar(route.params.calendar, calendarStore.calendarInfos));

const calendarName = computed(() => (calendarInfo.value ? calendarDisplayName(calendarInfo.value.calendar) : ''));
const calendarUrlName = computed(() => calendarInfo.value?.calendar.urlName ?? null);

const unresolved = computed(() => group.value === 'calendar' && !calendarInfo.value);

const heading = computed<string>(() => {
  const current = level.value;
  if (current.kind === 'root') {
    return t('titles.settings');
  }
  if (unresolved.value) {
    return t('titles.calendar');
  }
  if (current.kind === 'leaf') {
    return t(current.leaf.labelKey);
  }
  return current.group === 'calendar' ? calendarName.value : t(GROUP_TITLE_KEYS[current.group]);
});

const backLink = computed<{ to: RouteLocationNamedRaw; label: string } | null>(() => {
  const current = level.value;
  if (current.kind === 'root') {
    return null;
  }
  if (current.kind === 'section' || unresolved.value) {
    return { to: { name: 'settings' }, label: t('titles.settings') };
  }
  if (current.group === 'calendar') {
    return {
      to: { name: 'calendar_management', params: { calendar: calendarUrlName.value ?? '' } },
      label: calendarName.value,
    };
  }
  return { to: { name: current.group }, label: t(GROUP_TITLE_KEYS[current.group]) };
});

/** Route the switcher keeps on a pick: the current calendar leaf, else the calendar section. */
const switcherRouteName = computed(() => {
  const current = level.value;
  return current.kind === 'leaf' ? current.leaf.routeName : 'calendar_management';
});

const showSectionSwitcher = computed(
  () => level.value.kind === 'section' && group.value === 'calendar' && !unresolved.value,
);

const eyebrowText = computed(() => {
  const current = level.value;
  if (current.kind !== 'leaf' || current.group === 'calendar') {
    return null;
  }
  return t(GROUP_TITLE_KEYS[current.group]);
});

// The eyebrow switcher's label is the calendar name as the owner typed it;
// _settings.scss exempts it from the eyebrow's uppercase.
const showEyebrowSwitcher = computed(
  () => level.value.kind === 'leaf' && group.value === 'calendar' && !unresolved.value,
);

const switcherAriaLabel = computed(() => tCal('switcher.aria_switch_calendar', { name: calendarName.value }));

// The header owns document.title while it is mounted and hands the previous
// title back when settings is left.
const previousTitle = document.title;
watch(heading, (value) => {
  document.title = value;
}, { immediate: true });
onBeforeUnmount(() => {
  document.title = previousTitle;
});
</script>

<template>
  <header class="settings-page-header">
    <RouterLink
      v-if="backLink"
      :to="backLink.to"
      class="settings-back-link settings-page-header__back"
    >
      <ChevronLeft aria-hidden="true" :stroke-width="2" />
      {{ t('back_to', { name: backLink.label }) }}
    </RouterLink>
    <div v-if="showEyebrowSwitcher" class="settings-page-header__eyebrow">
      <CalendarSwitcher
        :label="calendarName"
        :route-name="switcherRouteName"
        :current-url-name="calendarUrlName"
        :aria-label="switcherAriaLabel"
      />
    </div>
    <p v-else-if="eyebrowText" class="settings-page-header__eyebrow">{{ eyebrowText }}</p>
    <div class="settings-page-header__title-row">
      <h1 class="settings-page-header__title" tabindex="-1">{{ heading }}</h1>
      <CalendarSwitcher
        v-if="showSectionSwitcher"
        :label="tCal('switcher.title')"
        route-name="calendar_management"
        :current-url-name="calendarUrlName"
        :aria-label="switcherAriaLabel"
      />
    </div>
  </header>
</template>
