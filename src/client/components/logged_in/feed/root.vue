<script setup>
import { reactive, ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { calendarDisplayName } from '@/client/service/calendar-display';
import { useToast } from '@/client/composables/useToast';
import { useFeedEvents } from '@/client/composables/useFeedEvents';
import { useFeedFollows } from '@/client/composables/useFeedFollows';
import { useFeedFollowers } from '@/client/composables/useFeedFollowers';
import CalendarService from '@/client/service/calendar';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
import FollowsView from './follows.vue';
import FollowersView from './followers.vue';
import FollowedEventsView from './events.vue';
import AddCalendarModal from './add_calendar_modal.vue';

const { t } = useTranslation('feed');
const { t: tCalendar } = useTranslation('calendars', { keyPrefix: 'calendar' });
const { t: tSwitcher } = useTranslation('calendars', { keyPrefix: 'switcher' });
const route = useRoute();
const feedStore = useFeedStore();
const calendarStore = useCalendarStore();
const calendarService = new CalendarService();
const toast = useToast();

const { isLoading: isLoadingEvents, loadFeed } = useFeedEvents();
const { isLoading: isLoadingFollows, loadFollows } = useFeedFollows();
const { isLoading: isLoadingFollowers, loadFollowers } = useFeedFollowers();

const state = reactive({
  activeTab: 'events',
  isInitialized: false,
});

const showAddCalendarModal = ref(false);
const addCalendarTriggerRef = ref(null);

/**
 * The URL names the calendar. It is resolved against the account's own
 * calendars only: a name that is not one of them resolves to nothing, and
 * the page fetches nothing rather than falling back to the persisted
 * selection.
 */
const calendarUrlName = computed(() => (typeof route.params.calendar === 'string' ? route.params.calendar : ''));
const calendar = computed(() => calendarStore.getCalendarByUrlName(calendarUrlName.value));
const calendarName = computed(() => (calendar.value ? calendarDisplayName(calendar.value) : calendarUrlName.value));
const isLoadingAny = computed(() =>
  isLoadingEvents.value || isLoadingFollows.value || isLoadingFollowers.value,
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

/**
 * Load follows, followers and feed events for the route's calendar. With no
 * such calendar nothing is requested.
 *
 * The feed composables read the store's selection, so it is pointed at the
 * validated route calendar first. The route sync guard normally set it
 * already; this covers the case where the guard's own calendar load failed
 * and onMounted then loaded the calendars, leaving the selection unset or
 * stale. The feed service also drops any response whose calendar is no
 * longer the selection, so a slow load for a calendar switched away from
 * cannot land on this one.
 */
const loadFeedData = async () => {
  const calendarId = calendar.value?.id;
  if (!calendarId) {
    return;
  }
  if (calendarStore.selectedCalendarId !== calendarId) {
    calendarStore.setSelectedCalendar(calendarId);
  }

  try {
    await Promise.all([
      loadFollows(),
      loadFollowers(),
      loadFeed(),
    ]);
  }
  catch (error) {
    console.error('Error loading feed data:', error);
    toast.error(t('load_error'));
  }
};

/**
 * Handle request to follow a calendar from the Events tab.
 * Opens the follow dialog without switching tabs.
 */
const handleFollowCalendarRequest = (triggerEl) => {
  addCalendarTriggerRef.value = triggerEl ?? null;
  showAddCalendarModal.value = true;
};

/**
 * Handle successful follow from root-level modal.
 * Refreshes both the follows list and the feed events so that the Events tab
 * immediately shows events from the newly followed calendar.
 */
const handleFollowSuccess = async () => {
  try {
    await Promise.all([loadFollows(), loadFeed()]);
  }
  catch (error) {
    console.error('Error refreshing feed after follow:', error);
  }
};

/**
 * Close the root-level add calendar modal and restore focus to the trigger element.
 */
const handleCloseAddCalendarModal = () => {
  showAddCalendarModal.value = false;
  nextTick(() => { addCalendarTriggerRef.value?.focus(); });
};

onMounted(async () => {
  // The route sync guard normally loaded the calendars already; this is a
  // no-op then, and covers a guard whose load failed.
  try {
    await calendarService.ensureCalendarsLoaded();
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    toast.error(t('load_error'));
    state.isInitialized = true;
    return;
  }

  feedStore.clearFeedData();
  await loadFeedData();
  state.isInitialized = true;
});

// Switching calendars keeps this component mounted with a new param. The
// follow dialog belongs to the previous calendar, so it closes.
watch(calendarUrlName, async (next, prev) => {
  if (next && next !== prev) {
    showAddCalendarModal.value = false;
    feedStore.clearFeedData();
    await loadFeedData();
  }
});
</script>

<template>
  <div class="feed-root">
    <header class="feed-header">
      <h1>
        <CalendarSwitcher
          v-if="calendar"
          :label="calendarName"
          route-name="feed"
          :current-url-name="calendarUrlName"
          :aria-label="tSwitcher('aria_switch_calendar', { name: calendarName })"
        />
        <span v-else>{{ calendarUrlName }}</span>
      </h1>
    </header>

    <div
      v-if="state.isInitialized && calendarStore.loaded && !calendar"
      class="feed-not-found"
      role="alert"
    >
      <p>{{ tCalendar('not_found', { name: calendarUrlName }) }}</p>
      <p>
        <RouterLink :to="{ name: 'calendars' }" class="feed-not-found__link">{{ tCalendar('back_to_calendar') }}</RouterLink>
      </p>
    </div>

    <template v-else-if="calendar">
      <div
        class="tab-navigation"
        role="tablist"
        :aria-label="t('sections_label')"
      >
        <button
          id="events-tab"
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
          id="follows-tab"
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
          id="followers-tab"
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
        aria-live="polite"
        aria-atomic="true"
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

    <!-- Root-level modal: opened from Events tab empty state "Follow a Calendar" button -->
    <AddCalendarModal
      v-if="calendar && showAddCalendarModal"
      @close="handleCloseAddCalendarModal"
      @follow-success="handleFollowSuccess"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins/tabs' as *;
@use '@/client/assets/style/tokens/breakpoint-mixins' as *;

div.feed-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--pav-color-surface-secondary);

  header.feed-header {
    padding: var(--pav-space-6) var(--pav-space-4) var(--pav-space-4);

    h1 {
      max-width: 56rem;
      margin: 0 auto;
      font-size: var(--pav-font-size-xl);
      font-weight: var(--pav-font-weight-light);
      color: var(--pav-text-primary);

      @include pav-media('md') {
        font-size: var(--pav-font-size-4xl);
      }
    }
  }

  div.feed-not-found {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-2);
    align-items: center;
    text-align: center;
    padding: var(--pav-space-10) var(--pav-space-5);

    p {
      margin: 0;
      color: var(--pav-text-secondary);
    }

    .feed-not-found__link {
      color: currentColor;
      text-decoration: underline;
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

    @include pav-media-down(md) {
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
