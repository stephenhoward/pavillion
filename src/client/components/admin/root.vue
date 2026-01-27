<script setup>
import { inject, ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const site_config = inject('site_config');
const { t } = useTranslation('admin', {
  keyPrefix: 'menu',
});

/**
 * Reactive alert level for the General tab badge.
 * Can be 'ok', 'warning', or 'error'.
 */
const alertLevel = ref('ok');

const hasAlert = computed(() => alertLevel.value !== 'ok');

const navItems = [
  { id: 'general', routeName: 'admin_settings', path: '/admin/settings', labelKey: 'general_settings' },
  { id: 'accounts', routeName: 'accounts', path: '/admin/accounts', labelKey: 'accounts_link' },
  { id: 'federation', routeName: 'federation', path: '/admin/federation', labelKey: 'federation_settings' },
  { id: 'funding', routeName: 'funding', path: '/admin/funding', labelKey: 'payment_details' },
];

const isActive = (path) => {
  return route.path === path;
};
</script>

<template>
  <div class="admin-root">
    <a href="#main" class="sr-only">{{ t("navigation.skip_to_content") }}</a>

    <!-- Mobile Header -->
    <header class="admin-mobile-header">
      <router-link to="/profile" class="admin-back-link">
        <svg class="admin-back-icon"
             fill="none"
             viewBox="0 0 24 24"
             stroke="currentColor">
          <path stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7" />
        </svg>
        {{ t("back") }}
      </router-link>
    </header>

    <div class="admin-layout">
      <!-- Desktop Sidebar -->
      <aside class="admin-sidebar">
        <div class="admin-sidebar-header">
          <router-link to="/profile" class="admin-back-link">
            <svg class="admin-back-icon"
                 fill="none"
                 viewBox="0 0 24 24"
                 stroke="currentColor">
              <path stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 19l-7-7 7-7" />
            </svg>
            {{ t("back") }}
          </router-link>
        </div>

        <nav class="admin-sidebar-nav">
          <div class="admin-section-label">Administration</div>
          <ul class="admin-nav-list">
            <li v-for="item in navItems" :key="item.id">
              <router-link
                :to="{ name: item.routeName }"
                :class="['admin-nav-item', { active: isActive(item.path) }]"
                :aria-current="isActive(item.path) ? 'page' : undefined"
              >
                <!-- General / Gear icon -->
                <svg v-if="item.id === 'general'"
                     class="admin-nav-icon"
                     fill="none"
                     viewBox="0 0 24 24"
                     stroke="currentColor">
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>

                <!-- Accounts / People icon -->
                <svg v-if="item.id === 'accounts'"
                     class="admin-nav-icon"
                     fill="none"
                     viewBox="0 0 24 24"
                     stroke="currentColor">
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>

                <!-- Federation / Globe icon -->
                <svg v-if="item.id === 'federation'"
                     class="admin-nav-icon"
                     fill="none"
                     viewBox="0 0 24 24"
                     stroke="currentColor">
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>

                <!-- Funding / Seedling icon -->
                <svg v-if="item.id === 'funding'"
                     class="admin-nav-icon"
                     fill="none"
                     viewBox="0 0 24 24"
                     stroke="currentColor">
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 20V10" />
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M12 10c-1-4 2-7 7-7 1 5-2 8-7 7z" />
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M12 13c1-3-1.5-6-6-6-1 4 1.5 7 6 6z" />
                  <path stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M6 20h12" />
                </svg>

                <span class="admin-nav-label">{{ t(item.labelKey) }}</span>

                <span
                  v-if="item.id === 'general' && hasAlert"
                  :class="['admin-alert-badge', alertLevel]"
                >!</span>
              </router-link>
            </li>
          </ul>
        </nav>
      </aside>

      <!-- Main Content -->
      <main id="main" class="admin-main">
        <div class="admin-content-container">
          <RouterView />
        </div>
      </main>
    </div>

    <!-- Mobile Bottom Navigation -->
    <nav class="admin-bottom-nav" aria-label="Admin navigation">
      <router-link
        v-for="item in navItems"
        :key="item.id"
        :to="{ name: item.routeName }"
        :class="['admin-bottom-nav-item', { active: isActive(item.path) }]"
        :aria-current="isActive(item.path) ? 'page' : undefined"
      >
        <span class="admin-bottom-nav-icon-wrap">
          <!-- General / Gear icon -->
          <svg v-if="item.id === 'general'"
               class="admin-nav-icon"
               fill="none"
               viewBox="0 0 24 24"
               stroke="currentColor">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>

          <!-- Accounts / People icon -->
          <svg v-if="item.id === 'accounts'"
               class="admin-nav-icon"
               fill="none"
               viewBox="0 0 24 24"
               stroke="currentColor">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>

          <!-- Federation / Globe icon -->
          <svg v-if="item.id === 'federation'"
               class="admin-nav-icon"
               fill="none"
               viewBox="0 0 24 24"
               stroke="currentColor">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>

          <!-- Funding / Seedling icon -->
          <svg v-if="item.id === 'funding'"
               class="admin-nav-icon"
               fill="none"
               viewBox="0 0 24 24"
               stroke="currentColor">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 20V10" />
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M12 10c-1-4 2-7 7-7 1 5-2 8-7 7z" />
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M12 13c1-3-1.5-6-6-6-1 4 1.5 7 6 6z" />
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M6 20h12" />
          </svg>

          <span
            v-if="item.id === 'general' && hasAlert"
            :class="['admin-alert-badge', 'admin-alert-badge--mobile', alertLevel]"
          >!</span>
        </span>
        <span class="admin-bottom-nav-label">{{ t(item.labelKey) }}</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.admin-root {
  min-height: 100vh;
  background: var(--pav-color-surface-secondary);
}

/* Back link shared between mobile header and sidebar */
.admin-back-link {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-2);
  font-size: var(--pav-font-size-xs);
  color: var(--pav-color-stone-500);
  text-decoration: none;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-orange-600);
  }
}

.admin-back-icon {
  width: 1rem;
  height: 1rem;
}

/* Mobile Header - visible below md */
.admin-mobile-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--pav-color-surface-primary);
  border-bottom: var(--pav-border-width-1) solid var(--pav-color-border-secondary);
  padding: var(--pav-space-3) var(--pav-space-4);

  @include pav-media(md) {
    display: none;
  }
}

/* Layout container */
.admin-layout {
  display: flex;
}

/* Desktop Sidebar - hidden below md, fixed on md+ */
.admin-sidebar {
  display: none;

  @include pav-media(md) {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    width: 14rem;
    height: 100vh;
    background: var(--pav-color-surface-primary);
    border-right: var(--pav-border-width-1) solid var(--pav-color-border-secondary);
    overflow-y: auto;
    z-index: 10;
  }
}

.admin-sidebar-header {
  padding: var(--pav-space-4);
  border-bottom: var(--pav-border-width-1) solid var(--pav-color-border-secondary);
}

.admin-sidebar-nav {
  padding: var(--pav-space-3);
}

.admin-section-label {
  font-size: var(--pav-font-size-2xs);
  font-weight: var(--pav-font-weight-semibold);
  color: var(--pav-color-stone-400);
  text-transform: uppercase;
  letter-spacing: var(--pav-letter-spacing-wider);
  padding: var(--pav-space-2) var(--pav-space-3);
}

.admin-nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-1);
}

.admin-nav-item {
  display: flex;
  align-items: center;
  gap: var(--pav-space-3);
  padding: var(--pav-space-2_5) var(--pav-space-3);
  border-radius: var(--pav-border-radius-lg);
  text-decoration: none;
  font-size: var(--pav-font-size-xs);
  color: var(--pav-color-stone-600);
  transition: all 0.15s ease;
  width: 100%;

  &:hover {
    background: var(--pav-color-stone-100);
  }

  &.active {
    background: var(--pav-color-interactive-active-bg);
    color: var(--pav-color-interactive-active-text);
    font-weight: var(--pav-font-weight-medium);

    .admin-nav-icon {
      color: var(--pav-color-orange-500);
    }
  }
}

.admin-nav-icon {
  width: var(--pav-shell-nav-icon-size);
  height: var(--pav-shell-nav-icon-size);
  flex-shrink: 0;
}

.admin-nav-label {
  flex: 1;
}

/* Alert badge for the General tab */
.admin-alert-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border-radius: var(--pav-border-radius-full);
  color: var(--pav-color-text-inverse);
  font-size: 0.6rem;
  font-weight: var(--pav-font-weight-bold);
  flex-shrink: 0;

  &.warning {
    background: var(--pav-color-warning);
  }

  &.error {
    background: var(--pav-color-error);
  }
}

.admin-alert-badge--mobile {
  position: absolute;
  top: -2px;
  right: -4px;
  width: 0.875rem;
  height: 0.875rem;
  font-size: 0.5rem;
}

/* Main content area */
.admin-main {
  flex: 1;
  min-height: 100vh;
  padding-bottom: var(--pav-space-20);

  @include pav-media(md) {
    margin-left: 14rem;
    padding-bottom: 0;
  }
}

.admin-content-container {
  max-width: 64rem;
  margin-inline: auto;
  padding: var(--pav-space-4);

  @include pav-media(md) {
    padding: var(--pav-space-6);
  }

  @include pav-media(lg) {
    padding: var(--pav-space-8);
  }
}

/* Mobile Bottom Navigation - visible below md */
.admin-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: var(--pav-shell-bottom-nav-height);
  background: var(--pav-color-surface-primary);
  border-top: var(--pav-border-width-1) solid var(--pav-color-border-secondary);
  padding-bottom: var(--pav-shell-safe-area-bottom);
  z-index: 10;

  @include pav-media(md) {
    display: none;
  }
}

.admin-bottom-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: 100%;
  gap: var(--pav-space-1);
  text-decoration: none;
  color: var(--pav-color-stone-400);
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-stone-600);
  }

  &.active {
    color: var(--pav-color-orange-600);

    .admin-nav-icon {
      color: var(--pav-color-orange-500);
    }
  }
}

.admin-bottom-nav-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.admin-bottom-nav-label {
  font-size: var(--pav-font-size-2xs);
  font-weight: var(--pav-font-weight-medium);
}

/* Dark mode adjustments using existing token overrides */
@media (prefers-color-scheme: dark) {
  .admin-back-link:hover {
    color: var(--pav-color-orange-400);
  }

  .admin-nav-item {
    color: var(--pav-color-stone-400);

    &:hover {
      background: var(--pav-color-stone-800);
    }

    &.active {
      .admin-nav-icon {
        color: var(--pav-color-orange-400);
      }
    }
  }

  .admin-bottom-nav-item {
    color: var(--pav-color-stone-500);

    &:hover {
      color: var(--pav-color-stone-300);
    }

    &.active {
      color: var(--pav-color-orange-400);

      .admin-nav-icon {
        color: var(--pav-color-orange-400);
      }
    }
  }
}
</style>
