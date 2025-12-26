<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import CalendarSelector from '@/client/components/logged_in/calendar/calendar_selector.vue';

const route = useRoute();
const router = useRouter();
const showCalendarSelector = ref(false);
const { t } = useTranslation('system');
const calendarService = new CalendarService();
const calendarStore = useCalendarStore();

/**
 * Handle new event creation via route-based navigation.
 * If user has one calendar, navigate directly to /event.
 * If user has multiple calendars, show calendar selector first.
 */
const newEvent = async () => {
  try {
    // Check if the user has any calendars
    const calendars = await calendarService.loadCalendars();

    if (calendars.length === 0) {
      // User has no calendars, redirect to calendar creation page
      router.push({ name: 'calendars' });
      return;
    }
    else if (calendars.length === 1) {
      // User has one calendar - set it as last interacted and navigate
      calendarStore.setLastInteractedCalendar(calendars[0].id);
      router.push({ name: 'event_new' });
    }
    else {
      // User has multiple calendars, show selector
      showCalendarSelector.value = true;
    }
  }
  catch (error) {
    console.error('Error checking calendars:', error);
  }
};

/**
 * Handle calendar selection from selector modal.
 * Updates last interacted calendar and navigates to event creation.
 */
const onCalendarSelected = (calendar) => {
  showCalendarSelector.value = false;
  // Update the last interacted calendar for pre-selection
  calendarStore.setLastInteractedCalendar(calendar.id);
  // Navigate to event creation route
  router.push({ name: 'event_new' });
};

const onCalendarSelectionCanceled = () => {
  showCalendarSelector.value = false;
};

const isActive = (path) => {
  return route.path.startsWith(path);
};
</script>

<template>
  <div class="root logged-in">
    <a href="#main" class="sr-only">{{ t("navigation.skip_to_content") }}</a>
    <nav class="primary">
      <li id="new-event-button">
        <button @click="newEvent()" :aria-label="t('main_navigation.new_event')">
          <div class="icon"/>
          <label>{{ t("main_navigation.new_event") }}</label>
        </button>
      </li>
      <li id="calendar-button" :class="{ selected: isActive('/calendar') }">
        <RouterLink to="/calendar" :aria-current="isActive('/calendar') ? 'page' : undefined">
          <div class="icon"/>
          <label>{{ t("main_navigation.calendar_button") }}</label>
        </RouterLink>
      </li>
      <li id="feed-button" :class="{ selected: isActive('/feed') }">
        <RouterLink to="/feed" :aria-current="isActive('/feed') ? 'page' : undefined">
          <div class="icon"/>
          <label>{{ t("main_navigation.feed_button") }}</label>
        </RouterLink>
      </li>
      <li id="alerts-button" :class="{ selected: isActive('/inbox'), badged: true }">
        <RouterLink to="/inbox" :aria-current="isActive('/inbox') ? 'page' : undefined">
          <div class="icon"/>
          <label>{{ t("main_navigation.inbox_button") }}</label>
        </RouterLink>
      </li>
      <li id="profile-button" :class="{ selected: isActive('/profile') || isActive('/admin'), badged: true }">
        <RouterLink to="/profile" :aria-current="(isActive('/profile') || isActive('/admin')) ? 'page' : undefined">
          <div class="icon"/>
          <label>{{ t("main_navigation.profile_button") }}</label>
        </RouterLink>
      </li>
    </nav>
    <main id="main">
      <RouterView />
    </main>
  </div>

  <!-- Calendar Selector Modal for New Event creation -->
  <CalendarSelector v-if="showCalendarSelector" @select="onCalendarSelected" @cancel="onCalendarSelectionCanceled" />
</template>

<style lang="scss">
@use '@/client/assets/style/mixins/breakpoints' as *;

#calendar-button {
  order: 1;
  div.icon {
    mask-image: url('@/client/assets/calendar_icon.svg');
  }
}
#feed-button {
  order: 1;
  div.icon {
    mask-image: url('@/client/assets/feed_icon.svg');
  }
}
#alerts-button {
  order: 1;
  div.icon {
    mask-image: url('@/client/assets/inbox_icon.svg');
  }
}
#profile-button {
  order: 1;
  div.icon {
    mask-image: url('@/client/assets/profile_icon.svg');
  }
}
#new-event-button {
    order: 2;
    div.icon{
      mask-image: url('@/client/assets/add_icon.svg');
      width: 48px;
      height: 48px;
    }
    label {
      display: none;
    }
    @include pav-media(md) {
      order: 0;
      div.icon{
        width: 24px;
        height: 24px;
      }
      label {
        display: inline;
      }
    }
}
#alerts-button, #profile-button {
    order: 3;
}

</style>
