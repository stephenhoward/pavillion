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
 * - Crossing up with focus in the page, which is about to be display: none,
 *   moves focus to the page h1 rather than letting it fall to the body.
 * - Crossing down does nothing here: this page is never mounted on a leaf.
 *   Focus leaving the hidden tree is the tree's to handle.
 * - An unresolved calendar renders no list, and nothing is built from the
 *   bare route param.
 */
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue';
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
import { focusSettingsHeading, useFocusWithin } from './heading-focus';
import { groupItems, matchedSettingsGroup } from './nav-items';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation('settings');
const authn = inject<{ isAdmin?: () => boolean }>('authn');
const isAdmin = () => authn?.isAdmin?.() ?? false;

const group = computed(() => matchedSettingsGroup(route));

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

const navEl = ref<HTMLElement | null>(null);
const focusIsInPage = useFocusWithin(navEl);

// Kept apart from the async forward below, which would run after the
// browser has settled focus. Chromium may already have dropped focus from
// the now-hidden page to the body when the matchMedia change fires;
// useFocusWithin remembers it was here. pv-ms7c may replace this with a
// general focus rule.
watch(treeIsSidebar, (isSidebar) => {
  if (isSidebar && focusIsInPage()) {
    focusSettingsHeading();
  }
}, { flush: 'sync' });

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
  <nav
    v-if="items.length > 0"
    ref="navEl"
    class="settings-list-page"
    :aria-label="t('tree_label')"
  >
    <NavList :items="items" mode="page" />
    <div v-if="group === 'root'" class="settings-list-page__footer">
      <PolicyLink source="settings" />
    </div>
  </nav>
</template>
