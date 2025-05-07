<script setup>
import { reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import loggedInNavigation from './loggedInNavigation.vue';
import EditEventView from './calendar/edit_event.vue';

const { t } = useTranslation('system');
const state = reactive({
  userInfo: {
    currentEvent: null,
  },
});
</script>

<template>
  <div class="root">
    <a href="#main" class="skip-link">{{ t("navigation.skip_to_content") }}</a>
    <loggedInNavigation @open-event="(e) => state.currentEvent = e" />
    <div id="main">
      <RouterView @open-event="(e) => state.currentEvent = e"/>
    </div>
  </div>

  <div v-if="state.currentEvent != null">
    <EditEventView :event="state.currentEvent" @close="state.currentEvent=null" />
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
