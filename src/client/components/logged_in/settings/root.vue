<script setup lang="ts">
/**
 * Settings layout: the settings tree beside a content column that holds the
 * one page header and the routed pane, for every route under /settings.
 *
 * - The page header is the single h1 owner in every state (root, section,
 *   leaf, unresolved calendar). It sits outside the keyed RouterView and is
 *   never swapped by v-if, so the same h1 element survives a route change,
 *   which the resize-up focus restore depends on.
 * - The pane is keyed by the calendar param alone, so switching calendars
 *   remounts calendar management (it resolves ownership once per calendar)
 *   while moving between leaves of one calendar does not. Off a calendar the
 *   key is the group; the prefixes keep a calendar named like a group from
 *   sharing that group's key.
 * - In page mode (below md) a path change moves focus to the h1; see the
 *   focus rule below.
 */
import { computed, nextTick, watch } from 'vue';
import { useRoute, type RouteParamsGeneric } from 'vue-router';
import { useShellLayout } from '@/client/composables/useShellLayout';
import SettingsTree from './tree.vue';
import SettingsPageHeader from './page-header.vue';
import { focusSettingsHeading } from './heading-focus';

const route = useRoute();

// The literals are the real table's record paths, pinned by the "group
// record paths" case in test/routing/settings-guards.test.ts.
const pathGroup = computed<'admin' | 'account' | 'root'>(() => {
  const paths = route.matched.map((record) => record.path);
  if (paths.includes('/settings/admin')) {
    return 'admin';
  }
  if (paths.some((path) => path === '/settings/account' || path.startsWith('/settings/account/'))) {
    return 'account';
  }
  return 'root';
});

const paneKey = computed(() => {
  const calendar = route.params.calendar;
  return typeof calendar === 'string' ? `calendar:${calendar}` : `pane:${pathGroup.value}`;
});

// Settings borrows the shell breakpoint for its tree; the alias names that.
const { mainNavIsSidebar: treeIsSidebar } = useShellLayout();

interface RouteSnapshot {
  path: string;
  name: unknown;
  params: RouteParamsGeneric;
}

/** The same leaf on another calendar: the switcher restores its own focus. */
function onlyCalendarChanged(to: RouteSnapshot, from: RouteSnapshot): boolean {
  if (to.name !== from.name || to.params.calendar === from.params.calendar) {
    return false;
  }
  const keys = new Set([...Object.keys(to.params), ...Object.keys(from.params)]);
  return [...keys].every((key) => key === 'calendar' || to.params[key] === from.params[key]);
}

// Focus rule for the page-mode drill-down: each level replaces the whole page,
// so after a path change focus moves to the new page's h1. Nothing moves at
// md+ (the tree's skip control serves keyboard users there), on initial load
// (the watch is not immediate), on a query-only change, on a calendar-only
// change, or onto the calendar report detail, the one leaf that owns its own
// focus (its gate failure replaces to the list, which retriggers this rule).
// Watching the route sees only the final route of a guard redirect chain, so
// a chain moves focus once. History traversal (Back/Forward) is a path change
// like any other and moves focus too, by design, with one exception: Back or
// Forward between the same leaf on two calendars is a calendar-only change,
// so it is skipped. pv-ms7c (app-wide SPA focus and title) may replace this.
watch(
  () => ({ path: route.path, name: route.name, params: { ...route.params } }),
  async (to, from) => {
    if (treeIsSidebar.value || to.path === from.path || to.name === 'calendar_report_detail') {
      return;
    }
    if (onlyCalendarChanged(to, from)) {
      return;
    }
    await nextTick();
    focusSettingsHeading();
  },
);
</script>

<template>
  <div class="settings-layout">
    <SettingsTree />
    <div class="settings-layout__content">
      <SettingsPageHeader />
      <RouterView :key="paneKey" />
    </div>
  </div>
</template>
