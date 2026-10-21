<script setup lang="ts">
import { onBeforeMount, reactive, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useTabNavigation } from '@/client/composables/useTabNavigation';
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { calendarDisplayName } from '@/client/service/calendar-display';
import { ExternalLink, BookOpenText, Settings } from 'lucide-vue-next';
import ActionsMenu from '@/client/components/common/actions-menu.vue';
import ActionsMenuItem from '@/client/components/common/actions-menu-item.vue';
import HelpPanel from '@/client/components/common/help-panel.vue';
import { guidesForRoute, audienceForRoute } from '@/client/service/docs';
import EventsTab from '@/client/components/logged_in/calendar-content/events-tab.vue';
import CategoriesTab from '@/client/components/logged_in/calendar-content/categories.vue';
import SeriesTab from '@/client/components/logged_in/calendar-content/series.vue';
import PlacesTab from '@/client/components/logged_in/calendar-content/places-tab.vue';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';

const { t } = useTranslation('calendars',{
  keyPrefix: 'calendar',
});

const { t: tSwitcher } = useTranslation('calendars', {
  keyPrefix: 'switcher',
});

const eventService = new EventService();

const route = useRoute();
const router = useRouter();
const state = reactive({
  err: '',
  calendar: null,
  isLoading: false,
});
const calendarUrlName = computed(() => route.params.calendar);
const calendarStore = useCalendarStore();
// Read the name through the store so a rename elsewhere updates the heading;
// the loaded snapshot covers a calendar the store does not hold.
const calendarName = computed(() => {
  const calendar = calendarStore.getCalendarByUrlName(String(calendarUrlName.value ?? '')) ?? state.calendar;
  return calendar ? calendarDisplayName(calendar) : '';
});
const calendarService = new CalendarService();

// Tab state
const ORDERED_TABS = ['events', 'places', 'categories', 'series'];

/**
 * Resolves the active tab from the URL query parameter.
 * Falls back to 'events' if the tab parameter is missing or invalid.
 */
const resolveActiveTab = () => {
  const tabParam = route.query.tab;
  if (typeof tabParam === 'string' && ORDERED_TABS.includes(tabParam)) {
    return tabParam;
  }
  return 'events';
};

const activeTab = ref(resolveActiveTab());

/**
 * Activates a tab and syncs the state to the URL query parameter.
 * Preserves all existing query parameters (search, categories, etc.).
 *
 * @param tab - The tab identifier to activate
 */
const activateTab = (tab: string) => {
  activeTab.value = tab;

  const query = { ...route.query };

  if (tab === 'events') {
    delete query.tab;
  }
  else {
    query.tab = tab;
  }

  router.replace({
    name: route.name,
    params: route.params,
    query,
  });
};

const { handleTabKeydown } = useTabNavigation(ORDERED_TABS, activeTab, activateTab);

// Help panel state — hosted directly on this page so the actions menu can open it
const showHelpPanel = ref(false);
const guides = computed(() => guidesForRoute(route?.name));
const audience = computed(() => audienceForRoute(route?.name));

onBeforeMount(async () => {
  await loadCalendarData();
});

// Function to load calendar data
const loadCalendarData = async () => {
  if (!calendarUrlName.value) return;

  try {
    state.isLoading = true;
    state.err = '';

    // Load calendar by URL name — only returns calendars the current user can edit
    state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName.value);

    // Not one of the user's calendars: say so in place, with a way back to the current one
    if (!state.calendar) {
      state.err = t('not_found', { name: calendarUrlName.value });
      return;
    }

    // Read initial filters directly from URL query parameters
    const filters = {};
    const searchParam = route.query.search;
    const categoriesParam = route.query.categories;
    if (typeof searchParam === 'string' && searchParam.trim()) {
      filters.search = searchParam.trim();
    }
    if (typeof categoriesParam === 'string' && categoriesParam) {
      filters.categories = categoriesParam.split(',');
    }

    await eventService.loadCalendarEvents(calendarUrlName.value, Object.keys(filters).length > 0 ? filters : undefined, state.calendar?.id);
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = t('load_error');
  }
  finally {
    state.isLoading = false;
  }
};

// Watch for calendar ID changes and reload data
watch(calendarUrlName, (newUrlName, oldUrlName) => {
  if (newUrlName && newUrlName !== oldUrlName) {
    loadCalendarData();
  }
});

/**
 * Handles the loadEvents event from EventsTab when filters change.
 */
const handleLoadEvents = async (filters) => {
  state.isLoading = true;
  try {
    await eventService.loadCalendarEvents(calendarUrlName.value, filters, state.calendar?.id);
  }
  catch (error) {
    console.error('Error loading filtered events:', error);
    state.err = t('load_events_error');
  }
  finally {
    state.isLoading = false;
  }
};
</script>

<template>
  <div>
    <div v-if="state.err"
         class="error alert calendar-error"
         role="alert"
         aria-live="polite">
      <p>{{ state.err }}</p>
      <p>
        <RouterLink :to="{ name: 'calendars' }" class="calendar-error__link">{{ t('back_to_calendar') }}</RouterLink>
      </p>
    </div>
    <div v-else>
      <header class="calendar-header">
        <div class="header-content">
          <div class="header-title-section">
            <div class="header-title-group">
              <h1>
                <CalendarSwitcher
                  v-if="state.calendar"
                  :label="calendarName"
                  route-name="calendar"
                  :current-url-name="state.calendar.urlName"
                  :aria-label="tSwitcher('aria_switch_calendar', { name: calendarName })"
                />
                <span v-else>{{ calendarUrlName }}</span>
              </h1>
              <!--
                The organizer's shareable address: the string they copy out of
                this page and hand to other people. Both the destination and the
                text are the server's `publicUrl` so they cannot disagree — this
                link used to template its own href, which is how it kept sending
                people to `/view/...` after DEC-018 moved the page to the root.
                A plain href, not a RouterLink: the public page belongs to the
                site SPA, so this has to be a full-page navigation. Guarded on
                the address itself: an unstamped `publicUrl` is '', and an empty
                href is a dead link to this page, so render nothing instead.
              -->
              <a
                v-if="state.calendar?.publicUrl"
                :href="state.calendar.publicUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="calendar-public-link"
                :aria-label="t('view_public_calendar_label', { name: calendarName })"
              >
                {{ state.calendar.publicUrl }}
                <ExternalLink :size="14" aria-hidden="true" />
              </a>
            </div>
            <div class="header-actions">
              <ActionsMenu :trigger-label="t('menu_label')">
                <ActionsMenuItem :icon="BookOpenText" @click="showHelpPanel = true">
                  {{ t('documentation') }}
                </ActionsMenuItem>
                <ActionsMenuItem
                  v-if="state.calendar"
                  :icon="Settings"
                  :to="{ name: 'calendar_management', params: { calendar: state.calendar.urlName } }"
                  :aria-label="t('manage_calendar_label', { name: state.calendar.urlName })"
                >
                  {{ t('manage_calendar') }}
                </ActionsMenuItem>
              </ActionsMenu>
            </div>
          </div>

          <!-- Tab Navigation -->
          <nav
            role="tablist"
            :aria-label="t('tabs_label')"
            class="calendar-tabs"
            @keydown="handleTabKeydown"
          >
            <button
              id="events-tab"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'events'"
              aria-controls="events-panel"
              :tabindex="activeTab === 'events' ? 0 : -1"
              class="calendar-tab"
              @click="activateTab('events')"
            >
              {{ t('tab_events') }}
            </button>
            <button
              id="places-tab"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'places'"
              aria-controls="places-panel"
              :tabindex="activeTab === 'places' ? 0 : -1"
              class="calendar-tab"
              @click="activateTab('places')"
            >
              {{ t('tab_places') }}
            </button>
            <button
              id="categories-tab"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'categories'"
              aria-controls="categories-panel"
              :tabindex="activeTab === 'categories' ? 0 : -1"
              class="calendar-tab"
              @click="activateTab('categories')"
            >
              {{ t('tab_categories') }}
            </button>
            <button
              id="series-tab"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'series'"
              aria-controls="series-panel"
              :tabindex="activeTab === 'series' ? 0 : -1"
              class="calendar-tab"
              @click="activateTab('series')"
            >
              {{ t('tab_series') }}
            </button>
          </nav>
        </div>
      </header>

      <!-- Tab Panels -->

      <!-- Events Tab Panel -->
      <div
        id="events-panel"
        role="tabpanel"
        aria-labelledby="events-tab"
        :aria-hidden="activeTab !== 'events'"
        v-show="activeTab === 'events'"
        class="calendar-panel"
        tabindex="-1"
      >
        <EventsTab
          v-if="state.calendar"
          :calendar="state.calendar"
          :is-loading="state.isLoading"
          @load-events="handleLoadEvents"
        />
      </div>

      <!-- Places Tab Panel -->
      <div
        id="places-panel"
        role="tabpanel"
        aria-labelledby="places-tab"
        :aria-hidden="activeTab !== 'places'"
        v-show="activeTab === 'places'"
        class="calendar-panel"
        tabindex="-1"
      >
        <PlacesTab
          v-if="state.calendar"
          :calendar-id="state.calendar.id"
          :calendar-url-name="state.calendar.urlName"
        />
      </div>

      <!-- Categories Tab Panel -->
      <div
        id="categories-panel"
        role="tabpanel"
        aria-labelledby="categories-tab"
        :aria-hidden="activeTab !== 'categories'"
        v-show="activeTab === 'categories'"
        class="calendar-panel"
        tabindex="-1"
      >
        <CategoriesTab
          v-if="state.calendar"
          :calendar-id="state.calendar.id"
        />
      </div>

      <!-- Series Tab Panel -->
      <div
        id="series-panel"
        role="tabpanel"
        aria-labelledby="series-tab"
        :aria-hidden="activeTab !== 'series'"
        v-show="activeTab === 'series'"
        class="calendar-panel"
        tabindex="-1"
      >
        <SeriesTab
          v-if="state.calendar"
          :calendar-id="state.calendar.id"
          :calendar-url-name="state.calendar.urlName"
        />
      </div>
    </div>

    <!-- Help Panel (triggered from the actions menu's Documentation item) -->
    <HelpPanel
      v-if="showHelpPanel"
      :guides="guides"
      :audience="audience"
      @close="showHelpPanel = false"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins/tabs' as *;
@use '../../../assets/style/components/calendar-admin' as *;
@use '@/client/assets/style/tokens/breakpoint-mixins' as *;

/* Message and recovery link stacked; the link takes the alert's text colour
   and an underline so it reads as a link without relying on colour. */
.calendar-error {
  flex-direction: column;
  gap: var(--pav-space-2);

  p {
    margin: 0;
  }

  &__link {
    color: currentColor;
    text-decoration: underline;
  }
}

/* Calendar header with sticky blur effect */
.calendar-header {
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(8px);
  background: rgba(255, 255, 255, 0.8);

  @media (prefers-color-scheme: dark) {
    background: rgba(28, 25, 23, 0.8);
  }

  padding: 1.5rem 1rem 0;
  border-bottom: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-bottom-color: var(--pav-color-stone-700);
  }

  .header-content {
    max-width: 56rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .header-title-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;

    .header-title-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    h1 {
      font-size: 2.25rem;
      font-weight: 300;
      margin: 0;
      color: var(--pav-color-stone-800);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-100);
      }
    }

    .calendar-public-link {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: var(--pav-font-size-body-small);
      color: var(--pav-color-text-secondary);
      text-decoration: none;

      &:hover,
      &:focus-visible {
        color: var(--pav-color-accent);
        text-decoration: underline;
      }

      &:focus-visible {
        outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
        outline-offset: 2px;
        text-decoration: none;
      }
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
      flex-shrink: 0;
    }
  }

  .calendar-tabs {
    @include tab-navigation;
    margin-bottom: 0;
  }

  .calendar-tab {
    @include tab-button;
  }

  @include pav-media-down(md) {
    .header-title-section {
      align-items: flex-start;

      h1 {
        font-size: 1.5rem;
      }

      .header-title-group {
        min-width: 0;
      }
    }
  }
}

/* Tab panel content area */
.calendar-panel {
  max-width: 56rem;
  margin: 0 auto;
  padding: 0 1rem;

  &:focus {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: -2px;
  }
}

.error {
  max-width: 56rem;
  margin: 2rem auto;
  padding: 1rem 1.5rem;
  background: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);
  border-radius: 0.75rem;
  color: var(--pav-color-red-700);
  text-align: center;

  @media (prefers-color-scheme: dark) {
    background: rgba(220, 53, 69, 0.1);
    border-color: var(--pav-color-red-900);
    color: var(--pav-color-red-300);
  }
}
</style>
