<script setup>
    import { useTranslation } from 'i18next-vue';
    import { useRoute } from 'vue-router';
    import { CalendarEvent } from '../../common/model/events';
    import { EventLocation } from '../../common/model/location';

    const route = useRoute();

    const { t } = useTranslation('system',{
        keyPrefix: 'main_navigation'
    });
    const newEvent = () => {
        let event = new CalendarEvent();
        event.location = new EventLocation();
        event.addSchedule();
        return event;
    };

    const isActive = (path) => {
        return route.path === path;
    };
</script>

<template>
    <nav>
    <li id="new-event-button"><a @click="$emit('openEvent',newEvent())"><div :aria-label="t('new_event')" class="icon"></div><label>{{ t("new_event") }}</label></a></li>
    <li id="calendar-button" :class="{ selected: isActive('/calendar') }"><RouterLink class="calendar" to="/calendar"><div class="icon"></div> <label>{{ t("calendar_button") }}</label></RouterLink></li>
    <li id="feed-button" :class="{ selected: isActive('/feed') }"><RouterLink class="feed" to="/feed"><div class="icon"></div> <label>{{ t("feed_button") }}</label></RouterLink></li>
    <li id="alerts-button" :class="{ selected: isActive('/inbox'), badged: true }"><RouterLink class="alerts" to="/inbox"><div class="icon"></div> <label>{{ t("inbox_button") }}</label></RouterLink></li>
    <li id="profile-button" :class="{ selected: isActive('/profile') || isActive('/admin'), badged: true }"><RouterLink class="profile" to="/profile"><div class="icon"></div> <label>{{ t("profile_button") }}</label></RouterLink></li>
  </nav>
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
