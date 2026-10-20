<script setup lang="ts">
/**
 * The list page of a settings index route (the root, a calendar, the
 * account, the instance): the group's rows in page mode, plus the policy
 * link on the root. The matched record's own meta.settingsGroup picks the
 * group. The page header belongs to the settings layout, not to this page.
 *
 * - Below md this is the page; at md+ it is display: none (CSS) and the
 *   index route's guard forwards to the group's first visible leaf.
 * - Crossing up to md+ while mounted, the page forwards with
 *   settingsIndexTarget, the target the guard computes, and always replaces
 *   so browser Back leaves settings. An unresolved calendar, or a failed
 *   load, has no target and stays put. The watch is not immediate: the
 *   guard owns the forward on navigation, so mounting at md+ never forwards
 *   a second time.
 * - Crossing down does nothing here: this page is never mounted on a leaf.
 *   Focus leaving the hidden tree is the tree's to handle.
 * - An unresolved calendar renders no list, and nothing is built from the
 *   bare route param.
 */
import { computed, inject, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { useShellLayout } from '@/client/composables/useShellLayout';
import {
  buildSettingsNavContext,
  readSettingsNavSources,
  settingsIndexTarget,
  type SettingsForwardDeps,
} from '@/client/service/settings-guards';
import PolicyLink from '@/client/components/common/PolicyLink.vue';
import NavList from './nav-list.vue';
import { groupItems, type SettingsGroup } from './nav-items';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation('settings');
const authn = inject<{ isAdmin?: () => boolean }>('authn');
const isAdmin = () => authn?.isAdmin?.() ?? false;

// The matched record's own meta, not the merged route.meta, so a group set
// on a parent record never applies to its children.
const group = computed<SettingsGroup | null>(
  () => route.matched[route.matched.length - 1]?.meta.settingsGroup ?? null,
);

const items = computed(() => {
  if (!group.value) {
    return [];
  }
  const ctx = buildSettingsNavContext(group.value, route.params.calendar, readSettingsNavSources(isAdmin));
  return ctx ? groupItems(group.value, ctx) : [];
});

const forwardDeps: SettingsForwardDeps = {
  loadCalendars: () => new CalendarService().ensureCalendarsLoaded(),
  isAdmin,
  loadInstanceFunding: () => new FundingService().ensureInstanceFundingLoaded(),
};

// Settings borrows the shell breakpoint for its tree; the alias names that.
const { mainNavIsSidebar: treeIsSidebar } = useShellLayout();

// The watcher is disposed with the component; the shared matchMedia listener
// belongs to the useShellLayout singleton. This flag drops a forward whose
// load resolves after the page has gone.
let unmounted = false;
onUnmounted(() => {
  unmounted = true;
});

watch(treeIsSidebar, async (isSidebar) => {
  if (!isSidebar || !group.value) {
    return;
  }
  const target = await settingsIndexTarget(group.value, route.params.calendar, forwardDeps);
  if (target && !unmounted) {
    router.replace(target);
  }
});

// Below md the guard loads nothing, so the page loads what it reads. Both
// loaders are cached and log their own failures.
onMounted(() => {
  new CalendarService().ensureCalendarsLoaded().catch(() => {});
  new FundingService().ensureInstanceFundingLoaded().catch(() => {});
});
</script>

<template>
  <nav v-if="items.length > 0" class="settings-list-page" :aria-label="t('tree_label')">
    <NavList :items="items" mode="page" />
    <div v-if="group === 'root'" class="settings-list-page__footer">
      <PolicyLink source="settings" />
    </div>
  </nav>
</template>
