<script setup>
import { reactive, ref, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useToast } from '@/client/composables/useToast';
import CalendarService from '@/client/service/calendar';
import CalendarSelector from './calendar_selector.vue';
import FollowsView from './follows.vue';
import FollowersView from './followers.vue';
import FollowedEventsView from './events.vue';

const { t } = useTranslation('feed');
const feedStore = useFeedStore();
const calendarStore = useCalendarStore();
const calendarService = new CalendarService();
const toast = useToast();

const state = reactive({
  activeTab: 'events',
  isInitialized: false,
});

const openAddCalendarModal = ref(false);

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
  calendarStore.setSelectedCalendar(calendarId);
  feedStore.clearFeedData();
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
    toast.error(t('load_error'));
  }
};

/**
 * Handle request to follow a calendar from the Events tab.
 * Switches to the Following tab and signals follows.vue to open its modal.
 */
const handleFollowCalendarRequest = () => {
  openAddCalendarModal.value = true;
  activateTab('follows');
};

/**
 * Reset the modal trigger flag after follows.vue has acknowledged it.
 */
const handleAddCalendarModalOpened = () => {
  openAddCalendarModal.value = false;
};

onMounted(async () => {
  // Ensure calendars are loaded from the server before proceeding.
  // This handles direct navigation to the feed URL where the store may be empty.
  if (!calendarStore.loaded) {
    try {
      await calendarService.loadCalendars();
    }
    catch (error) {
      console.error('Error loading calendars:', error);
      toast.error(t('load_error'));
      state.isInitialized = true;
      return;
    }
  }

  // Auto-select first calendar if only one exists
  if (calendarStore.calendars.length === 1) {
    calendarStore.setSelectedCalendar(calendarStore.calendars[0].id);
    feedStore.clearFeedData();
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
        aria-label="Feed sections"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="state.activeTab === 'events' ? 'true' : 'false'"
          aria-controls="events-panel"
          class="tab"
          @click="activateTab('events')"
        >
          {{ t('events_tab') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="state.activeTab === 'follows' ? 'true' : 'false'"
          aria-controls="follows-panel"
          class="tab"
          @click="activateTab('follows')"
        >
          {{ t('follows_tab') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="state.activeTab === 'followers' ? 'true' : 'false'"
          aria-controls="followers-panel"
          class="tab"
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
        <FollowsView
          :open-add-calendar-modal="openAddCalendarModal"
          @add-calendar-modal-opened="handleAddCalendarModalOpened"
        />
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
@use '@/client/assets/style/mixins/tabs' as *;

div.feed-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--pav-color-surface-secondary);

  div.no-calendar-selected {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--pav-space-10) var(--pav-space-5);
    min-height: 250px;

    p {
      font-size: var(--pav-font-size-sm);
      color: var(--pav-color-text-secondary);
    }
  }

  div.loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--pav-space-10) var(--pav-space-5);
    min-height: 250px;

    p {
      font-size: var(--pav-font-size-sm);
      color: var(--pav-color-text-secondary);
    }
  }

  div.tab-navigation {
    @include tab-navigation;
    background: var(--pav-color-surface-secondary);

    button.tab {
      @include tab-button;
    }

    @media (max-width: 768px) {
      button.tab {
        flex: 1 1 0;
        padding: var(--pav-space-3) var(--pav-space-4);
        font-size: var(--pav-font-size-xs);
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
