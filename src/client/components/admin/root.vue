<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Component } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import { Settings, Users, Calendar, ShieldCheck, Globe, Sprout } from 'lucide-vue-next';

/**
 * Instance administration pane under the settings shell. The shell supplies
 * the page heading, the main landmark and the skip link; this pane adds the
 * admin page navigation beside (md+) or above (below md) the page content.
 */

const route = useRoute();
const { t } = useTranslation('admin', {
  keyPrefix: 'menu',
});

/**
 * Reactive alert level for the General tab badge.
 * Can be 'ok', 'warning', or 'error'.
 */
const alertLevel = ref('ok');

const hasAlert = computed(() => alertLevel.value !== 'ok');

interface NavItem {
  id: string;
  routeName: string;
  labelKey: string;
  icon: Component;
  /** Further route names under this item, which mark it current too. */
  subRoutes?: string[];
}

const navItems: NavItem[] = [
  { id: 'general', routeName: 'admin_settings', labelKey: 'general_settings', icon: Settings },
  { id: 'accounts', routeName: 'accounts', labelKey: 'accounts_link', icon: Users },
  { id: 'calendars', routeName: 'admin_calendars', labelKey: 'calendars_link', icon: Calendar },
  {
    id: 'moderation',
    routeName: 'moderation',
    labelKey: 'moderation',
    icon: ShieldCheck,
    subRoutes: ['moderation_report_detail', 'moderation_settings', 'blocked_instances'],
  },
  { id: 'federation', routeName: 'federation', labelKey: 'federation_settings', icon: Globe },
  { id: 'funding', routeName: 'funding', labelKey: 'payment_details', icon: Sprout },
];

const isActive = (item: NavItem) => {
  const name = String(route.name ?? '');
  return name === item.routeName || (item.subRoutes ?? []).includes(name);
};
</script>

<template>
  <div class="admin-root">
    <nav class="admin-nav" :aria-label="t('navigation_label')">
      <ul class="admin-nav__list">
        <li v-for="item in navItems" :key="item.id">
          <RouterLink
            :to="{ name: item.routeName }"
            :class="['admin-nav__link', { 'admin-nav__link--active': isActive(item) }]"
            :aria-current="isActive(item) ? 'page' : undefined"
          >
            <component
              :is="item.icon"
              :size="18"
              class="admin-nav__icon"
              aria-hidden="true"
            />
            <span class="admin-nav__label">{{ t(item.labelKey) }}</span>
            <span
              v-if="item.id === 'general' && hasAlert"
              :class="['admin-nav__badge', `admin-nav__badge--${alertLevel}`]"
            >
              <span aria-hidden="true">!</span>
              <!-- Leading space keeps the link's accessible name "General Needs attention". -->
              <span class="sr-only">{{ ` ${t('needs_attention')}` }}</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <div class="admin-main">
      <RouterView />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/tokens/breakpoint-mixins' as *;

.admin-root {
  display: flex;
  flex-direction: column;
  max-width: 78rem;
  margin-inline: auto;

  @include pav-media(md) {
    flex-direction: row;
    align-items: flex-start;
  }
}

/* Below md: a horizontally scrollable strip above the page content.
   md+: a vertical list in a left column. */
.admin-nav {
  overflow-x: auto;
  scrollbar-width: none;
  border-block-end: var(--pav-border-width-1) solid var(--pav-border-subtle);

  &::-webkit-scrollbar {
    display: none;
  }

  @include pav-media(md) {
    flex-shrink: 0;
    inline-size: 14rem;
    overflow-x: visible;
    border-block-end: 0;
    border-inline-end: var(--pav-border-width-1) solid var(--pav-border-subtle);
    padding-block: var(--pav-space-3);
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: var(--pav-space-2) var(--pav-space-3);
    display: flex;
    flex-direction: row;
    gap: var(--pav-space-1);

    @include pav-media(md) {
      flex-direction: column;
      padding-block: 0;
    }
  }

  &__link {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
    padding: var(--pav-space-2) var(--pav-space-3);
    border-radius: var(--pav-border-radius-lg);
    font-size: var(--pav-font-size-xs);
    color: var(--pav-text-secondary);
    text-decoration: none;
    white-space: nowrap;

    @include pav-media(md) {
      gap: var(--pav-space-3);
      padding-block: var(--pav-space-2_5);
    }

    &:hover {
      background: var(--pav-interactive-hover);
      color: var(--pav-text-primary);
    }

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
      outline-offset: -2px;
    }

    &--active,
    &--active:hover {
      background: var(--pav-color-interactive-active-bg);
      color: var(--pav-color-interactive-active-text);
      font-weight: var(--pav-font-weight-medium);
    }
  }

  &__icon {
    flex-shrink: 0;
  }

  &__label {
    flex: 1;
  }

  /* Alert badge for the General item */
  &__badge {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1rem;
    block-size: 1rem;
    border-radius: var(--pav-border-radius-full);
    color: var(--pav-color-text-inverse);
    font-size: var(--pav-font-size-2xs);
    font-weight: var(--pav-font-weight-bold);
    flex-shrink: 0;

    &--warning {
      background: var(--pav-color-warning);
    }

    &--error {
      background: var(--pav-color-error);
    }
  }
}

.admin-main {
  flex: 1;
  min-inline-size: 0;
  padding: var(--pav-space-4);

  @include pav-media(md) {
    padding: var(--pav-space-6);
  }

  @include pav-media(lg) {
    padding: var(--pav-space-8);
  }
}
</style>
