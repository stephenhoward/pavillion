<script setup lang="ts">
/**
 * The settings tree: the persistent secondary sidebar at md+. Below md it is
 * display: none (CSS only; this component has no viewport logic) and the
 * list pages carry the same rows.
 *
 * - The Calendar group addresses the viewer's *current* calendar from the
 *   store, never the route's `:calendar` param, so an unresolvable param is
 *   neither listed nor echoed. Its heading is the static group title; the
 *   calendar name and switcher live in the page header.
 * - The context comes from buildSettingsNavContext over
 *   readSettingsNavSources, the one derivation the guards share, so the tree
 *   never lists a leaf a redirect rejects.
 * - The skip control is a button that moves focus to the page h1 without
 *   navigating.
 */
import { computed, inject, onMounted, useId } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { buildSettingsNavContext, readSettingsNavSources } from '@/client/service/settings-guards';
import PolicyLink from '@/client/components/common/PolicyLink.vue';
import NavList from './nav-list.vue';
import { focusSettingsHeading } from './heading-focus';
import {
  accountItems,
  adminItems,
  calendarItems,
  rootItems,
  SETTINGS_GROUP_TITLE_KEYS,
  type SettingsLeafGroup,
  type SettingsNavItem,
} from './nav-items';

const { t } = useTranslation('settings');
const authn = inject<{ isAdmin?: () => boolean }>('authn');
const isAdmin = () => authn?.isAdmin?.() ?? false;

// The root group never resolves a param, so the context is always built.
const ctx = computed(() => buildSettingsNavContext('root', undefined, readSettingsNavSources(isAdmin))!);

const headingIdPrefix = useId();

const groups = computed<Array<{ group: SettingsLeafGroup; items: SettingsNavItem[] }>>(() => {
  const all: Array<{ group: SettingsLeafGroup; items: SettingsNavItem[] }> = [
    { group: 'calendar', items: calendarItems(ctx.value) },
    { group: 'account', items: accountItems(ctx.value) },
    { group: 'admin', items: ctx.value.isAdmin ? adminItems() : [] },
  ];
  return all.filter((entry) => entry.items.length > 0);
});

const logoutItems = computed(() => rootItems(ctx.value).filter((item) => item.action === 'logout'));

// A cold load of an account leaf runs no calendar guard, so the tree loads
// what it reads. Both loaders are cached and log their own failures; a failed
// calendar load leaves the Calendar group out.
onMounted(() => {
  new CalendarService().ensureCalendarsLoaded().catch(() => {});
  new FundingService().ensureInstanceFundingLoaded().catch(() => {});
});
</script>

<template>
  <nav class="settings-tree" :aria-label="t('tree_label')">
    <button
      type="button"
      class="settings-tree__skip"
      @click="focusSettingsHeading()"
    >
      {{ t('skip_to_content') }}
    </button>
    <section
      v-for="entry in groups"
      :key="entry.group"
      class="settings-tree__group"
      :aria-labelledby="`${headingIdPrefix}-${entry.group}`"
    >
      <h2 :id="`${headingIdPrefix}-${entry.group}`" class="settings-tree__heading">
        {{ t(SETTINGS_GROUP_TITLE_KEYS[entry.group]) }}
      </h2>
      <NavList :items="entry.items" mode="sidebar" />
    </section>
    <div class="settings-tree__footer">
      <NavList :items="logoutItems" mode="sidebar" />
      <PolicyLink source="settings" />
    </div>
  </nav>
</template>
