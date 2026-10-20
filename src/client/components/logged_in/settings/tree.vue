<script setup lang="ts">
/**
 * The settings tree: the persistent secondary sidebar at md+. Below md it is
 * display: none, by CSS alone, and the list pages carry the same rows.
 *
 * - The Calendar group addresses the viewer's *current* calendar from the
 *   store, never the route's `:calendar` param, so an unresolvable param is
 *   neither listed nor echoed. Its heading is the static group title; the
 *   calendar name and switcher live in the page header.
 * - The context comes from buildSettingsNavContext over
 *   readSettingsNavSources, the one derivation the guards share, so the tree
 *   never lists a leaf a redirect rejects.
 * - Each group is a role="group" named by its label, so tests and assistive
 *   tech can tell the Calendar group's General from the Instance group's.
 * - The skip control is a button that moves focus to the page h1 without
 *   navigating.
 * - Its one viewport watch moves focus and never navigates: crossing below
 *   md while focus is in the tree, which is about to be display: none, moves
 *   focus to the page h1 rather than letting it fall to the body.
 */
import { computed, inject, onMounted, ref, useId, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { useShellLayout } from '@/client/composables/useShellLayout';
import { buildSettingsNavContext, readSettingsNavSources } from '@/client/service/settings-guards';
import PolicyLink from '@/client/components/common/PolicyLink.vue';
import NavList from './nav-list.vue';
import { focusSettingsHeading, useFocusWithin } from './heading-focus';
import {
  groupItems,
  SETTINGS_GROUP_TITLE_KEYS,
  type SettingsLeafGroup,
  type SettingsNavItem,
} from './nav-items';

const { t } = useTranslation('settings');
const authn = inject<{ isAdmin?: () => boolean }>('authn');
const isAdmin = () => authn?.isAdmin?.() ?? false;

// The root group never resolves a param, so the context is always built.
const ctx = computed(() => buildSettingsNavContext('root', undefined, readSettingsNavSources(isAdmin))!);

// Each group is a named group, not a section: a named section is a region
// landmark, and the page's h1 comes after the tree, so a heading here would
// precede it.
const labelIdPrefix = useId();

const TREE_GROUPS: readonly SettingsLeafGroup[] = ['calendar', 'account', 'admin'];

const groups = computed<Array<{ group: SettingsLeafGroup; items: SettingsNavItem[] }>>(() => TREE_GROUPS
  .map((group) => ({ group, items: groupItems(group, ctx.value) }))
  .filter((entry) => entry.items.length > 0));

const logoutItems = computed(() => groupItems('root', ctx.value).filter((item) => item.action === 'logout'));

const navEl = ref<HTMLElement | null>(null);
const focusIsInTree = useFocusWithin(navEl);

// Settings borrows the shell breakpoint for its tree; the alias names that.
const { mainNavIsSidebar: treeIsSidebar } = useShellLayout();

// Chromium may already have dropped focus from the now-hidden tree to the
// body when the matchMedia change fires; useFocusWithin remembers it was
// here. pv-ms7c may replace this with a general focus rule.
watch(treeIsSidebar, (isSidebar) => {
  if (!isSidebar && focusIsInTree()) {
    focusSettingsHeading();
  }
}, { flush: 'sync' });

// A cold load of an account leaf runs no calendar guard, so the tree loads
// what it reads. Both loaders are cached and log their own failures; a failed
// calendar load leaves the Calendar group out.
onMounted(() => {
  new CalendarService().ensureCalendarsLoaded().catch(() => {});
  new FundingService().ensureInstanceFundingLoaded().catch(() => {});
});
</script>

<template>
  <nav ref="navEl" class="settings-tree" :aria-label="t('tree_label')">
    <button
      type="button"
      class="settings-tree__skip"
      @click="focusSettingsHeading()"
    >
      {{ t('skip_to_content') }}
    </button>
    <div
      v-for="entry in groups"
      :key="entry.group"
      role="group"
      class="settings-tree__group"
      :aria-labelledby="`${labelIdPrefix}-${entry.group}`"
    >
      <p :id="`${labelIdPrefix}-${entry.group}`" class="settings-tree__heading">
        {{ t(SETTINGS_GROUP_TITLE_KEYS[entry.group]) }}
      </p>
      <NavList :items="entry.items" mode="sidebar" />
    </div>
    <div class="settings-tree__footer">
      <NavList :items="logoutItems" mode="sidebar" />
      <PolicyLink source="settings" />
    </div>
  </nav>
</template>
