<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import CalendarSelector from '@/client/components/logged_in/calendar/calendar_selector.vue';

const route = useRoute();
const router = useRouter();
const showCalendarSelector = ref(false);
const selectedCalendar = ref(null);
const { t } = useTranslation('system');
const calendarService = new CalendarService();
const eventService = new EventService();
const state = reactive({
  currentEvent: null,
});
const newEvent = async () => {
  try {
    // Check if the user has any calendars
    const calendars = await calendarService.loadCalendars();

    if (calendars.length === 0) {
      // User has no calendars, redirect to calendar creation page
      router.push('/calendar');
      return null;
    }
    else if (calendars.length === 1) {
      // User has one calendar, use it directly
      selectedCalendar.value = calendars[0];
      const event = eventService.initEvent(selectedCalendar.value);
      state.currentEvent = event;
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

const onCalendarSelected = (calendar) => {
  selectedCalendar.value = calendar;
  showCalendarSelector.value = false;
  const event = eventService.initEvent(calendar);
  state.currentEvent = event;
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
      <RouterView @open-event="(e) => state.currentEvent = e"/>
    </main>
  </div>

  <div v-if="state.currentEvent != null">
    <EditEventView :event="state.currentEvent" @close="state.currentEvent=null" />
  </div>
  <!-- Calendar Selector Modal -->
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
