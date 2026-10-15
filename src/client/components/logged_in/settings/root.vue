<script setup lang="ts">
/**
 * Settings shell: hosts calendar management, the account pages and instance
 * admin under /settings. The page heading is the switcher in settings mode:
 * its sheet lists the calendars (picking one opens its management pane)
 * followed by the Account row and, for admins, the Instance administration
 * row.
 */
import { computed, inject } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
import { useCalendarStore } from '@/client/stores/calendarStore';

type Pane = 'calendar' | 'account' | 'admin';

const route = useRoute();
const store = useCalendarStore();
const authn = inject<{ isAdmin?: () => boolean }>('authn');
const { t } = useTranslation('calendars', { keyPrefix: 'switcher' });

// Every instance-admin page is nested under the route named 'admin', so the
// matched chain identifies the pane without listing each admin route name.
const pane = computed<Pane>(() => {
  if (route.name === 'calendar_management') {
    return 'calendar';
  }
  if (route.matched.some((record) => record.name === 'admin')) {
    return 'admin';
  }
  return 'account';
});

const currentUrlName = computed(() => {
  const param = route.params.calendar;
  return pane.value === 'calendar' && typeof param === 'string' ? param : null;
});

const label = computed(() => {
  if (pane.value === 'account') {
    return t('account_row');
  }
  if (pane.value === 'admin') {
    return t('admin_row');
  }
  const urlName = currentUrlName.value ?? '';
  return store.getCalendarByUrlName(urlName)?.content('en').name || urlName;
});

const isAdmin = computed(() => authn?.isAdmin?.() ?? false);

// The management view reads its calendar once on mount, so each calendar
// gets its own key and picking another one mounts the pane afresh. The
// prefixes keep a calendar named like a pane from sharing that pane's key.
const paneKey = computed(() => currentUrlName.value ? `calendar:${currentUrlName.value}` : `pane:${pane.value}`);
</script>

<template>
  <div class="settings-root">
    <header class="settings-root__header">
      <div class="settings-root__header-inner">
        <h1>
          <CalendarSwitcher
            :label="label"
            route-name="calendar_management"
            :current-url-name="currentUrlName"
            :aria-label="t('aria_switch_settings', { name: label })"
          >
            <li
              class="calendar-switcher-sheet__row"
              data-testid="switcher-account"
              :aria-current="pane === 'account' ? 'true' : undefined"
            >
              <span v-if="pane === 'account'" class="calendar-switcher-sheet__target">
                <span class="calendar-switcher-sheet__name">
                  {{ t('account_row') }}
                  <span class="sr-only">{{ t('current_label') }}</span>
                </span>
              </span>
              <RouterLink v-else :to="{ name: 'profile' }" class="calendar-switcher-sheet__target">
                <span class="calendar-switcher-sheet__name">{{ t('account_row') }}</span>
              </RouterLink>
            </li>
            <li
              v-if="isAdmin"
              class="calendar-switcher-sheet__row"
              data-testid="switcher-admin"
              :aria-current="pane === 'admin' ? 'true' : undefined"
            >
              <span v-if="pane === 'admin'" class="calendar-switcher-sheet__target">
                <span class="calendar-switcher-sheet__name">
                  {{ t('admin_row') }}
                  <span class="sr-only">{{ t('current_label') }}</span>
                </span>
              </span>
              <RouterLink v-else :to="{ name: 'admin_settings' }" class="calendar-switcher-sheet__target">
                <span class="calendar-switcher-sheet__name">{{ t('admin_row') }}</span>
              </RouterLink>
            </li>
          </CalendarSwitcher>
        </h1>
      </div>
    </header>
    <RouterView :key="paneKey" />
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/tokens/breakpoint-mixins' as *;

.settings-root {
  &__header {
    padding-block: var(--pav-space-6) var(--pav-space-4);
  }

  /* Matches the calendar management pane's content column. */
  &__header-inner {
    max-width: 56rem;
    margin-inline: auto;
    padding-inline: var(--pav-space-4);

    h1 {
      margin: 0;
      font-size: var(--pav-font-size-xl);
      font-weight: var(--pav-font-weight-light);
      color: var(--pav-text-primary);

      @include pav-media('md') {
        font-size: var(--pav-font-size-4xl);
      }
    }
  }
}
</style>
