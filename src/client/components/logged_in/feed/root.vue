<script setup>
import { reactive, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import CalendarSelector from './calendar_selector.vue';
import FollowsView from './follows.vue';
import FollowersView from './followers.vue';
import FollowedEventsView from './events.vue';

const { t } = useTranslation('feed');
const feedStore = useFeedStore();
const calendarStore = useCalendarStore();

const state = reactive({
  activeTab: 'events',
  isInitialized: false,
});

const hasMultipleCalendars = computed(() => calendarStore.hasMultipleCalendars);
const selectedCalendarId = computed(() => calendarStore.selectedCalendarId);
const isLoadingAny = computed(() =>
  feedStore.isLoadingEvents || feedStore.isLoadingFollows || feedStore.isLoadingFollowers,
);

const activateTab = (tab) => {
  state.activeTab = tab;
  nextTick(() => {
    const panel = document.getElementById(`${tab}-panel`);
    if (panel) {
      panel.focus();
    }
  });
};

const handleCalendarChange = async (calendarId) => {
  feedStore.setSelectedCalendar(calendarId);
  await loadFeedData();
};

const loadFeedData = async () => {
  if (!calendarStore.selectedCalendarId) {
    return;
  }

  try {
    await Promise.all([
      feedStore.loadFollows(),
      feedStore.loadFollowers(),
      feedStore.loadFeed(),
    ]);
  }
  catch (error) {
    console.error('Error loading feed data:', error);
  }
};

/**
 * Handle request to follow a calendar from the Events tab
 * This switches to the Following tab, which will then open the Add Calendar modal
 */
const handleFollowCalendarRequest = () => {
  activateTab('follows');
  // The Following tab component will handle opening the modal
  // We'll use an event or a shared state to trigger this
  nextTick(() => {
    // Emit a custom event that the Following tab can listen for
    window.dispatchEvent(new CustomEvent('openAddCalendarModal'));
  });
};

onMounted(async () => {
  // Auto-select first calendar if only one exists
  if (calendarStore.calendars.length === 1) {
    feedStore.setSelectedCalendar(calendarStore.calendars[0].id);
    await loadFeedData();
  }
  else if (calendarStore.calendars.length > 1 && !calendarStore.selectedCalendarId) {
    // If multiple calendars and none selected, wait for user selection
    // Don't auto-select to give user control
  }
  else if (calendarStore.selectedCalendarId) {
    // Calendar already selected, load data
    await loadFeedData();
  }

  state.isInitialized = true;
});
</script>

<template>
  <div class="feed-root">
    <CalendarSelector
      v-if="hasMultipleCalendars"
      :selected-calendar-id="selectedCalendarId"
      data-testid="calendar-selector"
      @change="handleCalendarChange"
    />

    <div
      v-if="!selectedCalendarId && hasMultipleCalendars"
      class="no-calendar-selected"
    >
      <p>{{ t('select_calendar_prompt') }}</p>
    </div>

    <template v-else-if="selectedCalendarId">
      <div
        class="tab-navigation"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="state.activeTab === 'events' ? 'true' : 'false'"
          aria-controls="events-panel"
          :class="['tab', { active: state.activeTab === 'events' }]"
          @click="activateTab('events')"
        >
          {{ t('events_tab') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="state.activeTab === 'follows' ? 'true' : 'false'"
          aria-controls="follows-panel"
          :class="['tab', { active: state.activeTab === 'follows' }]"
          @click="activateTab('follows')"
        >
          {{ t('follows_tab') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="state.activeTab === 'followers' ? 'true' : 'false'"
          aria-controls="followers-panel"
          :class="['tab', { active: state.activeTab === 'followers' }]"
          @click="activateTab('followers')"
        >
          {{ t('followers_tab') }}
        </button>
      </div>

      <div
        v-if="isLoadingAny && !state.isInitialized"
        class="loading-state"
      >
        <p>{{ t('loading') }}</p>
      </div>

      <div
        id="events-panel"
        role="tabpanel"
        aria-labelledby="events-tab"
        :aria-hidden="state.activeTab !== 'events'"
        :hidden="state.activeTab !== 'events'"
        class="tab-panel"
        tabindex="0"
      >
        <FollowedEventsView @follow-calendar="handleFollowCalendarRequest" />
      </div>
      <div
        id="follows-panel"
        role="tabpanel"
        aria-labelledby="follows-tab"
        :aria-hidden="state.activeTab !== 'follows'"
        :hidden="state.activeTab !== 'follows'"
        class="tab-panel"
        tabindex="0"
      >
        <FollowsView />
      </div>
      <div
        id="followers-panel"
        role="tabpanel"
        aria-labelledby="followers-tab"
        :aria-hidden="state.activeTab !== 'followers'"
        :hidden="state.activeTab !== 'followers'"
        class="tab-panel"
        tabindex="0"
      >
        <FollowersView />
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

div.feed-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: $light-mode-panel-background;

  @media (prefers-color-scheme: dark) {
    background: $dark-mode-background;
  }

  div.no-calendar-selected {
    @include empty-state;

    p {
      font-size: 16px;
      color: $light-mode-secondary-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-secondary-text;
      }
    }
  }

  div.loading-state {
    @include empty-state;

    p {
      font-size: 16px;
      color: $light-mode-secondary-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-secondary-text;
      }
    }
  }

  div.tab-navigation {
    display: flex;
    border-bottom: 2px solid $light-mode-border;
    background: $light-mode-panel-background;

    @media (prefers-color-scheme: dark) {
      border-bottom-color: $dark-mode-border;
      background: $dark-mode-panel-background;
    }

    button.tab {
      flex: 0 0 auto;
      padding: $spacing-lg $spacing-2xl;
      border: none;
      background: transparent;
      color: $light-mode-secondary-text;
      font-size: 16px;
      font-weight: $font-regular;
      cursor: pointer;
      position: relative;
      transition: color 0.2s ease;

      &:hover {
        color: $light-mode-text;

        @media (prefers-color-scheme: dark) {
          color: $dark-mode-text;
        }
      }

      &.active {
        color: #f97316;
        font-weight: $font-medium;

        &::after {
          content: '';
          position: absolute;
          bottom: -2px;
          left: 0;
          right: 0;
          height: 3px;
          background: #f97316;
        }
      }

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-secondary-text;
      }
    }

    @media (max-width: 768px) {
      button.tab {
        flex: 1 1 0;
        padding: $spacing-md $spacing-lg;
        font-size: 14px;
      }
    }
  }

  div.tab-panel {
    flex: 1;
    overflow-y: auto;
    padding: 0;

    &:focus {
      outline: none;
    }
  }
}
</style>
