<script setup>
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import CalendarService from '../service/calendar';
import EventService from '../service/event';
import CalendarSelector from './calendar/calendar_selector.vue';

const route = useRoute();
const router = useRouter();
const emit = defineEmits(['openEvent']);
const calendarService = new CalendarService();
const eventService = new EventService();

const { t } = useTranslation('system',{
  keyPrefix: 'main_navigation',
});

const showCalendarSelector = ref(false);
const selectedCalendar = ref(null);

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
      emit('openEvent', event);
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
  emit('openEvent', event);
};

const onCalendarSelectionCanceled = () => {
  showCalendarSelector.value = false;
};

const isActive = (path) => {
  return route.path.startsWith(path);
};
</script>

<template>
  <nav>
    <li id="new-event-button"><a @click="newEvent()"><div :aria-label="t('new_event')" class="icon"/><label>{{ t("new_event") }}</label></a></li>
    <li id="calendar-button" :class="{ selected: isActive('/calendar') }"><RouterLink class="calendar" to="/calendar"><div class="icon"/> <label>{{ t("calendar_button") }}</label></RouterLink></li>
    <li id="feed-button" :class="{ selected: isActive('/feed') }"><RouterLink class="feed" to="/feed"><div class="icon"/> <label>{{ t("feed_button") }}</label></RouterLink></li>
    <li id="alerts-button" :class="{ selected: isActive('/inbox'), badged: true }"><RouterLink class="alerts" to="/inbox"><div class="icon"/> <label>{{ t("inbox_button") }}</label></RouterLink></li>
    <li id="profile-button" :class="{ selected: isActive('/profile') || isActive('/admin'), badged: true }"><RouterLink class="profile" to="/profile"><div class="icon"/> <label>{{ t("profile_button") }}</label></RouterLink></li>
  </nav>
  <!-- Calendar Selector Modal -->
  <CalendarSelector v-if="showCalendarSelector" @select="onCalendarSelected" @cancel="onCalendarSelectionCanceled" />
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;
@use '../assets/layout.scss' as *;

#calendar-button div.icon {
    -webkit-mask-image: url('../assets/calendar_icon.svg');
}
#feed-button div.icon {
    -webkit-mask-image: url('../assets/feed_icon.svg');
}
#alerts-button div.icon {
    -webkit-mask-image: url('../assets/inbox_icon.svg');
}
#profile-button div.icon {
    -webkit-mask-image: url('../assets/profile_icon.svg');
}
#new-event-button {
    order: 2;
    div.icon{
      -webkit-mask-image: url('../assets/add_icon.svg');
      width: 48px;
      height: 48px;
    }
    label {
      display: none;
    }
}
#alerts-button, #profile-button {
    order: 3;
}

@include medium-size-device {
  #new-event-button {
    order: 0;
    border-radius: 10px;
    background: $light-mode-button-background;
    width: 100%;
    a {
        display: block;
        width: 100%;
        text-align: center;
        label {
            display: inline-block;
        }
        div.icon {
            display: none;
        }
    }
  }
}

@include dark-mode {
    @include medium-size-device {
    #new-event-button {
      background: $dark-mode-button-background;
      a {
          color: $dark-mode-text;
      }
    }
  }
}
</style>
