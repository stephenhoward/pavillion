<script setup>
import { reactive, inject, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import loggedInNavigation from './loggedInNavigation.vue'
import EditEventView from './edit_event.vue';

const authn = inject('authn');

const state = reactive({
    userInfo: {
        isAdmin: authn.isAdmin(),
        currentEvent: null
    }
});

const { t } = useI18n({
        messages: {
            "en": {
                "skip_to_content": "Skip to main content",
                "admin_link": "Admin"
            },
            "es": {
              "skip_to_content": "Skip to main content",
                "admin_link": "Admin"
            }
        }
    });
</script>

<template>
  <div class="root">
      <a href="#main" class="skip-link">{{ t("skip_to_content") }}</a>
      <router-link v-if="state.userInfo.isAdmin" to="/admin" class="button">{{ t("admin_link") }}</router-link>
      <loggedInNavigation @open-event="(e) => state.currentEvent = e" />
      <div id="main">
      <RouterView @open-event="(e) => state.currentEvent = e"/>
      </div>
  </div>

    <div v-if="state.currentEvent != null">
    <edit-event-view :event="state.currentEvent" @close="state.currentEvent=null" />
    </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

div.root {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  height: 100%;

  a.skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: #555;
    color: white;
    padding: 10px;
    z-index: 1000;
    &:focus {
      top: 0;
    } 
  }

  nav {
    order: 1;
  }
}
#main {
  flex: 1;
}
@include medium-size-device {
  div.root {
    flex-direction: row;

    nav {
      order: 0;
    }
  }
}
</style>
