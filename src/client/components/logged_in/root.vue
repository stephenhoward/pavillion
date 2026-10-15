<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { resolveCurrentCalendar } from '@/client/service/current-calendar';
import AppShell from '@/client/components/shell/app-shell.vue';
import type { NavigationItem } from '@/client/components/shell/types';

// Lucide icons - same as reference design (strokeWidth 1.5)
import { Calendar, Rss, Bell, Settings } from 'lucide-vue-next';

const router = useRouter();
const { t } = useTranslation('system');
const calendarService = new CalendarService();
const calendarStore = useCalendarStore();
const notificationStore = useNotificationStore();

/**
 * Navigation items for the app shell.
 * Note: "New Event" is intentionally removed from main nav.
 * Event creation will be accessible from calendar/event list headers.
 */
const navigationItems = computed<NavigationItem[]>(() => [
  {
    id: 'calendar',
    label: t('main_navigation.calendar_button'),
    icon: Calendar,
    to: '/calendar',
  },
  {
    id: 'feed',
    label: t('main_navigation.feed_button'),
    icon: Rss,
    to: '/feed',
  },
  {
    id: 'inbox',
    label: t('main_navigation.inbox_button'),
    icon: Bell,
    to: '/inbox',
    badge: notificationStore.unreadCount,
    badgeLabel: t('main_navigation.inbox_badge_label', { count: notificationStore.unreadCount }),
  },
  {
    id: 'settings',
    label: t('main_navigation.settings_button'),
    icon: Settings,
    to: '/settings',
  },
]);

/**
 * New Event always targets the current calendar. With none, go to the
 * zero-calendar page so the user creates one first.
 */
const newEvent = async () => {
  try {
    const infos = await calendarService.ensureCalendarsLoaded();
    const target = resolveCurrentCalendar(calendarStore.selectedCalendarId, infos);
    if (!target) {
      router.push({ name: 'calendars' });
      return;
    }
    calendarStore.setSelectedCalendar(target.calendar.id);
    router.push({ name: 'event_new' });
  }
  catch (error) {
    console.error('Error checking calendars:', error);
  }
};

// Expose newEvent for child components that need to trigger event creation
defineExpose({ newEvent });

// Polling for notification count updates
let pollInterval: ReturnType<typeof setInterval> | null = null;

const startPolling = () => {
  pollInterval = setInterval(() => {
    notificationStore.fetchNotifications().catch(() => {
      // Silently ignore errors; retry at next normal interval
    });
  }, 30000);
};

const handleVisibilityChange = () => {
  if (document.hidden) {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }
  else {
    notificationStore.fetchNotifications().catch(() => {
      // Silently ignore errors on tab focus restore
    });
    startPolling();
  }
};

onMounted(() => {
  notificationStore.fetchNotifications().catch(() => {
    // Silently ignore initial fetch error
  });
  startPolling();
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<template>
  <AppShell :navigation-items="navigationItems">
    <RouterView />
  </AppShell>
</template>

<style lang="scss">
/* Styles now handled by AppShell and shell-nav components */
</style>
