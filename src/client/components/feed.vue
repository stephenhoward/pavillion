<script setup>
import { reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import FollowsView from './feed/follows.vue';
import FollowersView from './feed/followers.vue';
import FollowedEventsView from './feed/events.vue';

const { t } = useTranslation('feed');
const state = reactive({
  activeTab: 'events',
});
const activateTab = (tab) => {
  state.activeTab = tab;
  nextTick(() => {
    const panel = document.getElementById(`${tab}-panel`);
    if (panel) {
      panel.focus();
    }
  });
};

</script>

<template>
  <div role="tablist">
    <button
      type="button"
      role="tab"
      :aria-selected=" state.activeTab === 'events' ? 'true' : 'false'"
      aria-controls="events-panel"
      class="tab"
      @click="activateTab('events')"
    >
      {{ t('events_tab') }}
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected=" state.activeTab === 'follows' ? 'true' : 'false'"
      aria-controls="follows-panel"
      class="tab"
      @click="activateTab('follows')"
    >
      {{ t('follows_tab') }}
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected=" state.activeTab === 'followers' ? 'true' : 'false'"
      aria-controls="followers-panel"
      class="tab"
      @click="activateTab('followers')"
    >
      {{ t('followers_tab') }}
    </button>
  </div>
  <div id="events-panel"
       role="tabpanel"
       aria-labelledby="events-tab"
       :aria-hidden="state.activeTab == 'events' ? 'true' : 'false'"
       :hidden="state.activeTab !== 'events'"
       class="tab-panel"
  >
    <FollowedEventsView />
  </div>
  <div
    id="follows-panel"
    role="tabpanel"
    aria-labelledby="follows-tab"
    :aria-hidden="state.activeTab == 'follows' ? 'true' : 'false'"
    :hidden="state.activeTab !== 'follows'"
    class="tab-panel"
  >
    <FollowsView />
  </div>
  <div
    id="followers-panel"
    role="tabpanel"
    aria-labelledby="followers-tab"
    :aria-hidden="state.activeTab == 'followers' ? 'true' : 'false'"
    :hidden="state.activeTab !== 'followers'"
    class="tab-panel"
  >
    <FollowersView />
  </div>
</template>

<style scoped lang="scss">
h2 {
  font-weight: 300;
}
</style>
