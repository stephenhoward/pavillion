<script setup>
    import { useI18n } from 'vue-i18n';
    import { CalendarEvent } from '../../common/model/events';
    import { EventLocation } from '../../common/model/location';
    const { t } = useI18n({
        messages: {
            "en": {
                "calendar": "My Calendar",
                "inbox": "Inbox",
                "new_event": "New Event"
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
    <li class="new-event"><img class="new-event" src="../assets/add_icon.svg" alt="Add Event" @click="$emit('openEvent',newEvent())" /><label>{{ t("new_event") }}</label></li>
    <RouterLink class="calendar" to="/calendar" ><li class="selected"><img src="../assets/calendar_icon.svg" alt="My Calendar" /><label>{{ t("calendar") }}</label></li></RouterLink>
    <RouterLink class="feed" to="/feed"><li><img src="../assets/feed_icon.svg" alt="Events from Followees"><label>Event Feed</label></li></RouterLink>
    <RouterLink class="alerts" to="/inbox"><li><img src="../assets/inbox_icon.svg" alt="Inbox"/><label>{{ t("inbox") }}</label></li></RouterLink>
    <RouterLink class="profile" to="/profile"><li><img src="../assets/profile_icon.svg" alt="Profile and Settings" /><label>Profile and Settings</label></li></RouterLink>
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
  background: #555;
  a {
    text-decoration: none;
    &.calendar, &.feed {
        order: 1;
    }
    &.alerts, &.profile {
        order: 3;
    }
  }
  li {
    &.new-event {
    order: 2;
  }
    padding: 10px;
    list-style-type: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    img, label {
        display: block;
    }
    img {
        width: 24px;
        &.new-event {
            width: 48px;
        }
    }
    &.selected {
        color: #4f4;
        img {
            filter: invert(48%) sepia(79%) saturate(2476%) hue-rotate(86deg) brightness(118%) contrast(119%);
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
        img {
            margin-right: 5px;
        }
        &.new-event {
            order: 0;
            img {
                width: 24px;
            }
        }
        padding: 10px;
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
</style>