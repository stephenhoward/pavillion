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
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SettingsTree from './tree.vue';
import SettingsPageHeader from './page-header.vue';

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
