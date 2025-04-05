<script setup>
    import { useI18n } from 'vue-i18n';
    import { CalendarEvent } from '../../common/model/events';
    import { EventLocation } from '../../common/model/location';
    const { t } = useI18n({
        messages: {
            "en": {
                "calendar_button": "Calendar",
                "inbox_button": "Inbox",
                "new_event": "New Event",
                "profile_button": "Settings",
                "feed_button": "Feed",
            },
            "es": {
                "calendar": "Mi Calendar",
            }
        }
    });

    const newEvent = () => {
        let event = new CalendarEvent();
        event.location = new EventLocation();
        event.addSchedule();
        return event;
    };

</script>

<template>
    <nav>
    <li class="new-event" @click="$emit('openEvent',newEvent())"><div :aria-label="t('new_event')" class="icon" id="new-event-button" ></div><label>{{ t("new_event") }}</label></li>
    <RouterLink class="calendar" to="/calendar" ><li class="selected"><div class="icon" id="calendar-button"></div> <label>{{ t("calendar_button") }}</label></li></RouterLink>
    <RouterLink class="feed" to="/feed"><li><div class="icon" id="feed-button"></div> <label>{{ t("feed_button") }}</label></li></RouterLink>
    <RouterLink class="alerts" to="/inbox"><li><div class="icon" id="alerts-button"></div> <label>{{ t("inbox_button") }}</label></li></RouterLink>
    <RouterLink class="profile" to="/profile"><li><div class="icon" id="profile-button"></div> <label>{{ t("profile_button") }}</label></li></RouterLink>
  </nav>
</template>
    
<style scoped lang="scss">
@use '../assets/mixins' as *;

nav {
  display: flex;
  background-color: rgba(0,0,0,0.2);
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  padding: 1em;

  a {
    color: $light-mode-text;
    text-decoration: none;
    &.calendar, &.feed {
        order: 1;
    }
    &.alerts, &.profile {
        order: 3;
    }
  }
  li {
    padding: 10px;
    list-style-type: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 10pt;
    &.selected {
        color: $light-mode-button-background;
        div.icon {
            background-color: $light-mode-button-background;
        }
    }
    &.new-event {
        order: 2;
        label {
            display: none;
        }
    }
    label {
        display: block;
        text-align: center;
    }
    div.icon {
        width: 24px;
        height: 24px;
        background-color: #000;
        -webkit-mask-size: contain;
        -webkit-mask-repeat: no-repeat;
        mask-size: contain;
        mask-repeat: no-repeat;
    }
  }
}

#calendar-button {
    -webkit-mask-image: url('../assets/calendar_icon.svg');
}
#feed-button {
    -webkit-mask-image: url('../assets/feed_icon.svg');
}
#alerts-button {
    -webkit-mask-image: url('../assets/inbox_icon.svg');
}
#profile-button {
    -webkit-mask-image: url('../assets/profile_icon.svg');
}
#new-event-button {
    -webkit-mask-image: url('../assets/add_icon.svg');
    width: 48px;
    height: 48px;
}

@include dark-mode {
    nav {
        background: $dark-mode-background;
        a {
            color: $dark-mode-text;
        }
        li {
            color: #ccc;
            &.selected {
                color: $dark-mode-button-background;
                div.icon {
                    background-color: $dark-mode-button-background;
                }
            }
            div.icon {
                background-color: #ccc;
            }
        }
    }
}

@include medium-size-device {
  nav {
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    li {
        div.icon {
            margin-right: 5px;
        }
        &.new-event {
            order: 0;
            label {
                display: block;
            }
        }
        padding: 10px;
    }
  }
  #new-event-button {
    width: 24px;
    height: 24px;
  }
}

@include large-size-device {
  nav {
    li {
        justify-content: flex-start;
        flex-direction: row;
    }
  }
}
</style>