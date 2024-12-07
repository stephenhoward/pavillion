<script setup>
    import EditEventView from './edit_event.vue';
    import { reactive } from 'vue';
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
    const state = reactive({
        currentEvent: null
    });

    const newEvent = () => {
        let event = new CalendarEvent();
        event.location = new EventLocation();
        event.addSchedule();
        state.currentEvent = event;
    };

</script>

<template>
<div>
    <nav>
    <RouterLink to="/calendar"><li class="selected"><img src="../assets/calendar_icon.svg" alt="My Calendar" /><label>{{ t("calendar") }}</label></li></RouterLink>
    <RouterLink to="/inbox"><li><img src="../assets/inbox_icon.svg" alt="Inbox"/><label>{{ t("inbox") }}</label></li></RouterLink>
    <li><img class="new-event" src="../assets/add_icon.svg" alt="Add Event" @click="newEvent()" /><label>{{ t("new_event") }}</label></li>
    <RouterLink to="/feed"><li><img src="../assets/feed_icon.svg" alt="Events from Followees"><label>Event Feed</label></li></RouterLink>
    <RouterLink to="/profile"><li><img src="../assets/profile_icon.svg" alt="Profile and Settings" /><label>Profile and Settings</label></li></RouterLink>
  </nav>

  <div v-if="state.currentEvent != null">
    <edit-event-view :event="state.currentEvent" @close="state.currentEvent=null" />
  </div>
</div>
</template>
    
<style scoped lang="scss">
nav {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  padding: 1em;
  background: #555;
  li {
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
</style>