<script setup>
import { reactive, inject } from 'vue';
import loggedInNavigation from './loggedInNavigation.vue'
import EditEventView from './edit_event.vue';

const authn = inject('authn');

const state = reactive({
    userInfo: {
        isAdmin: authn.isAdmin(),
        currentEvent: null
    }
});
</script>

<template>
    <router-link v-if="state.userInfo.isAdmin" to="/admin" class="button">Admin</router-link>
    <RouterView @open-event="(e) => state.currentEvent = e"/>
    <loggedInNavigation @open-event="(e) => state.currentEvent = e" />

    <div v-if="state.currentEvent != null">
    <edit-event-view :event="state.currentEvent" @close="state.currentEvent=null" />
    </div>
</template>

<style scoped lang="scss">
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>