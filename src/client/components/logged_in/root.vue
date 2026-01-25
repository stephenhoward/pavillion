<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import CalendarSelector from '@/client/components/logged_in/calendar/calendar_selector.vue';
import AppShell from '@/client/components/shell/AppShell.vue';
import type { NavigationItem } from '@/client/components/shell/types';

// Lucide icons - same as reference design (strokeWidth 1.5)
import { Calendar, Rss, Bell, Settings } from 'lucide-vue-next';

const router = useRouter();
const showCalendarSelector = ref(false);
const { t } = useTranslation('system');
const calendarService = new CalendarService();
const calendarStore = useCalendarStore();

/**
 * Navigation items for the app shell.
 * Note: "New Event" is intentionally removed from main nav.
 * Event creation will be accessible from calendar/event list headers.
 */
const navigationItems = computed<NavigationItem[]>(() => [
  {
    id: 'calendars',
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
    // TODO: Add unread notification count when available
    // badge: unreadCount.value,
  },
  {
    id: 'settings',
    label: t('main_navigation.profile_button'),
    icon: Settings,
    to: '/profile',
  },
]);

/**
 * Handle new event creation via route-based navigation.
 * If user has one calendar, navigate directly to /event.
 * If user has multiple calendars, show calendar selector first.
 */
const newEvent = async () => {
  try {
    const calendars = await calendarService.loadCalendars();

    if (calendars.length === 0) {
      router.push({ name: 'calendars' });
      return;
    }
    else if (calendars.length === 1) {
      calendarStore.setLastInteractedCalendar(calendars[0].id);
      router.push({ name: 'event_new' });
    }
    else {
      showCalendarSelector.value = true;
    }
  }
  catch (error) {
    console.error('Error checking calendars:', error);
  }
};

/**
 * Handle calendar selection from selector modal.
 */
const onCalendarSelected = (calendar: { id: string }) => {
  showCalendarSelector.value = false;
  calendarStore.setLastInteractedCalendar(calendar.id);
  router.push({ name: 'event_new' });
};

const onCalendarSelectionCanceled = () => {
  showCalendarSelector.value = false;
};

// Expose newEvent for child components that need to trigger event creation
defineExpose({ newEvent });
</script>

<template>
  <AppShell :navigation-items="navigationItems">
    <RouterView />
  </AppShell>

  <!-- Calendar Selector Modal for New Event creation -->
  <CalendarSelector
    v-if="showCalendarSelector"
    @select="onCalendarSelected"
    @cancel="onCalendarSelectionCanceled"
  />
</template>

<style lang="scss">
/* Styles now handled by AppShell and shell-nav components */
</style>
