<script setup lang="ts">
/**
 * The one settings list: a drill-down page below md (mode="page") and a
 * sidebar group at md+ (mode="sidebar"). The mode is a static prop; this
 * component has no viewport logic. Two instances can share a page, so the
 * template carries no id attributes.
 *
 * Rows match on resolved path at a segment boundary, longest match winning,
 * rather than on route name. Root rows need it: the root list's Calendar row
 * must stay current on every calendar leaf, and none of those leaves shares
 * its route name. The same rule keeps Reports current on report detail and
 * Moderation current on its sub-pages.
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import NavItem from '@/client/components/shell/nav-item.vue';
import type { NavigationItemWithState } from '@/client/components/shell/types';
import type {
  SettingsNavActionItem,
  SettingsNavItem,
  SettingsNavLinkItem,
} from './nav-items';

const props = defineProps<{
  items: SettingsNavItem[];
  mode: 'page' | 'sidebar';
}>();

const { t } = useTranslation('settings');
const route = useRoute();
const router = useRouter();

const links = computed(() => props.items.filter(
  (item): item is SettingsNavLinkItem => !item.action,
));

const logoutItem = computed(() => props.items.find(
  (item): item is SettingsNavActionItem => item.action === 'logout',
));

/**
 * A row is current when the route is its path or lies beneath it at a
 * segment boundary. Only the longest such path is marked, so a list holds
 * at most one current row.
 */
const linkStates = computed<NavigationItemWithState[]>(() => {
  const paths = links.value.map((item) => router.resolve(item.to).path);
  let currentIndex = -1;
  paths.forEach((path, index) => {
    const matches = route.path === path || route.path.startsWith(path + '/');
    if (matches && (currentIndex === -1 || path.length > paths[currentIndex].length)) {
      currentIndex = index;
    }
  });

  return links.value.map((item, index) => ({
    id: item.id,
    label: t(item.labelKey),
    icon: item.icon,
    to: item.to,
    isActive: index === currentIndex,
  }));
});

function logOut() {
  router.push({ name: 'logout' });
}
</script>

<template>
  <ul :class="['settings-nav', `settings-nav--${props.mode}`]">
    <li v-for="item in linkStates" :key="item.id">
      <NavItem :item="item" variant="list" />
    </li>
    <li v-if="logoutItem" class="settings-nav__logout">
      <button
        type="button"
        :class="['shell-nav-item', 'shell-nav-item--list', { 'shell-nav-item--danger': logoutItem.danger }]"
        @click="logOut"
      >
        <component
          :is="logoutItem.icon"
          class="shell-nav-item__icon"
          :stroke-width="2"
          aria-hidden="true"
        />
        <span class="shell-nav-item__label">{{ t(logoutItem.labelKey) }}</span>
      </button>
    </li>
  </ul>
</template>
