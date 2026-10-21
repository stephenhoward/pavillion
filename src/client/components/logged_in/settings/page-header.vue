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
 * - A sub-route (report detail, Moderation's settings and blocked instances)
 *   is titled from its record's `settingsTitleKey`, never its parent leaf's
 *   label. The parent leaf follows the group in the eyebrow as a link back to
 *   it, and is the back link's target below md. Following that link moves
 *   focus to the h1, because the link is gone once the leaf renders.
 * - A calendar section puts the switcher beside the h1, never inside it.
 * - The help button ends the title row on every level whose route has
 *   guides, so no settings pane renders one of its own.
 * - A calendar the viewer cannot resolve (nonexistent, not a member, or not
 *   loaded) renders the same header at the index and every leaf, titled
 *   with the group, and never echoes the route param.
 */
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRoute, type RouteLocationNamedRaw } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { calendarDisplayName } from '@/client/service/calendar-display';
import { findViewerCalendar } from '@/client/service/settings-guards';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
import HelpButton from '@/client/components/common/help-button.vue';
import { focusSettingsHeading } from '@/client/components/logged_in/settings/heading-focus';
import {
  findLeafByRouteName,
  isSettingsLeafGroup,
  matchedSettingsGroup,
  SETTINGS_GROUP_INDEX_ROUTES,
  SETTINGS_GROUP_TITLE_KEYS,
  type SettingsLeafGroup,
  type SettingsLeafRef,
} from '@/client/components/logged_in/settings/nav-items';

type HeaderLevel =
  | { kind: 'root' }
  | { kind: 'section'; group: SettingsLeafGroup }
  | { kind: 'leaf'; group: SettingsLeafGroup; leaf: SettingsLeafRef; subTitleKey: string | null };

const route = useRoute();
const calendarStore = useCalendarStore();
const { t } = useTranslation('settings');
const { t: tCal } = useTranslation('calendars');

const level = computed<HeaderLevel>(() => {
  const group = matchedSettingsGroup(route);
  if (isSettingsLeafGroup(group)) {
    return { kind: 'section', group };
  }
  const leaf = typeof route.name === 'string' ? findLeafByRouteName(route.name) : null;
  if (!leaf) {
    // The settings root, and any route outside the tree, title as Settings.
    return { kind: 'root' };
  }
  // A sub-route has no tree row to title it; its own record names it.
  const subTitleKey = leaf.routeName === route.name
    ? null
    : route.matched[route.matched.length - 1]?.meta.settingsTitleKey ?? null;
  return { kind: 'leaf', group: leaf.group, leaf, subTitleKey };
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
    return t(SETTINGS_GROUP_TITLE_KEYS.calendar);
  }
  if (current.kind === 'leaf') {
    return t(current.subTitleKey ?? current.leaf.labelKey);
  }
  return current.group === 'calendar' ? calendarName.value : t(SETTINGS_GROUP_TITLE_KEYS[current.group]);
});

/** On a sub-route, the leaf it belongs to: the eyebrow's link and the back link's target. */
const parentLeaf = computed<{ to: RouteLocationNamedRaw; label: string } | null>(() => {
  const current = level.value;
  if (current.kind !== 'leaf' || !current.subTitleKey || unresolved.value) {
    return null;
  }
  const to: RouteLocationNamedRaw = current.group === 'calendar'
    ? { name: current.leaf.routeName, params: { calendar: calendarUrlName.value ?? '' } }
    : { name: current.leaf.routeName };
  return { to, label: t(current.leaf.labelKey) };
});

const backLink = computed<{ to: RouteLocationNamedRaw; label: string } | null>(() => {
  const current = level.value;
  if (current.kind === 'root') {
    return null;
  }
  if (current.kind === 'section' || unresolved.value) {
    return { to: { name: 'settings' }, label: t('titles.settings') };
  }
  if (parentLeaf.value) {
    return parentLeaf.value;
  }
  if (current.group === 'calendar') {
    return {
      to: { name: SETTINGS_GROUP_INDEX_ROUTES.calendar, params: { calendar: calendarUrlName.value ?? '' } },
      label: calendarName.value,
    };
  }
  return { to: { name: SETTINGS_GROUP_INDEX_ROUTES[current.group] }, label: t(SETTINGS_GROUP_TITLE_KEYS[current.group]) };
});

/** Route the switcher keeps on a pick: the current calendar leaf, else the calendar section. */
const switcherRouteName = computed(() => {
  const current = level.value;
  return current.kind === 'leaf' ? current.leaf.routeName : SETTINGS_GROUP_INDEX_ROUTES.calendar;
});

const showSectionSwitcher = computed(
  () => level.value.kind === 'section' && group.value === 'calendar' && !unresolved.value,
);

const eyebrowText = computed(() => {
  const current = level.value;
  if (current.kind !== 'leaf' || current.group === 'calendar') {
    return null;
  }
  return t(SETTINGS_GROUP_TITLE_KEYS[current.group]);
});

// The eyebrow switcher's label is the calendar name as the owner typed it;
// _settings.scss exempts it from the eyebrow's uppercase.
const showEyebrowSwitcher = computed(
  () => level.value.kind === 'leaf' && group.value === 'calendar' && !unresolved.value,
);

/**
 * Follows the eyebrow's parent link, then focuses the h1: the link the
 * viewer activated is removed once the leaf renders, which would otherwise
 * drop focus to the body.
 */
async function followParentLeaf(event: MouseEvent, navigate: (event?: MouseEvent) => Promise<unknown>): Promise<void> {
  await navigate(event);
  if (event.defaultPrevented) {
    focusSettingsHeading();
  }
}

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
    <div v-if="showEyebrowSwitcher || eyebrowText" class="settings-page-header__eyebrow">
      <CalendarSwitcher
        v-if="showEyebrowSwitcher"
        :label="calendarName"
        :route-name="switcherRouteName"
        :current-url-name="calendarUrlName"
        :aria-label="switcherAriaLabel"
      />
      <span v-else>{{ eyebrowText }}</span>
      <template v-if="parentLeaf">
        <ChevronRight class="settings-page-header__separator" aria-hidden="true" :stroke-width="2" />
        <RouterLink v-slot="{ href, navigate }" :to="parentLeaf.to" custom>
          <a :href="href" class="settings-page-header__parent" @click="followParentLeaf($event, navigate)">{{ parentLeaf.label }}</a>
        </RouterLink>
      </template>
    </div>
    <div class="settings-page-header__title-row">
      <h1 class="settings-page-header__title" tabindex="-1">{{ heading }}</h1>
      <CalendarSwitcher
        v-if="showSectionSwitcher"
        :label="tCal('switcher.title')"
        :route-name="SETTINGS_GROUP_INDEX_ROUTES.calendar"
        :current-url-name="calendarUrlName"
        :aria-label="switcherAriaLabel"
      />
      <HelpButton v-if="!unresolved" />
    </div>
  </header>
</template>
