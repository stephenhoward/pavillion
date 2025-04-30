<script setup>
    import { useI18n } from 'vue-i18n';
    import { useRoute } from 'vue-router';
    import { CalendarEvent } from '../../common/model/events';
    import { EventLocation } from '../../common/model/location';

    const route = useRoute();

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

nav {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  padding: 1em;

  li {
    padding: 10px;
    list-style-type: none;
    position: relative;
    font-size: 10pt;
    &.selected {
        a {
            color: #fff;
            div.icon {
                background-color: #fff;
            }
        }
    }
    &.badged {
      &::after {
          content: "●";
          position: absolute;
          top: 2px;
          right: 4px;
          color: $light-mode-button-background;
          font-size: 16pt;
        }
    }
    a {
      color: $light-mode-text;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-decoration: none;
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
}

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
  nav {
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    li {
        &.badged {
          &::after {
              left: 28px;
            }
        }
        a {
            flex-direction: row;
            label {
                text-align: left;
            }
        }
        div.icon {
            display: inline-block;
            margin-right: 10px;
        }
        padding: 10px;
    }
  }
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

@include large-size-device {
  nav {
    li {
        justify-content: flex-start;
        flex-direction: row;
    }
  }
}

@include dark-mode {
    nav {
        li {
            color: #999;
            a {
                color: #999;
                div.icon {
                    background-color: #999;
                }
            }
        }
    }
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
