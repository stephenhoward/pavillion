<script setup lang="ts">
import { reactive, onBeforeMount, onMounted, onUnmounted, inject } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useWidgetStore } from '../stores/widgetStore';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import CalendarService from '@/site/service/calendar';
import SearchFilterPublic from '@/site/components/search-filter-public.vue';
import WeekView from './week-view.vue';
import MonthView from './month-view.vue';
import ListView from './list-view.vue';
import NotFound from '@/site/components/not-found.vue';
import {
  isValidWidgetView,
  isValidWidgetColorMode,
  isValidWidgetAccentColor,
} from '@/common/model/widget_config';
import type Config from '@/client/service/config';

const { t } = useTranslation('system');
const route = useRoute();
const widgetStore = useWidgetStore();
const publicCalendarStore = usePublicCalendarStore();
const siteConfig = inject<Config>('site_config');

const calendarUrlName = route.params.urlName as string;

const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  isLoading: false,
});

const calendarService = new CalendarService();

// Handle postMessage updates from parent window (for preview)
const handleMessage = (event: MessageEvent) => {
  // Only accept messages from same origin
  if (event.origin !== window.location.origin) {
    return;
  }

  if (event.data.type === 'pavillion:updateConfig') {
    const { config } = event.data;

    // Update widget store with new configuration. Values are re-validated
    // before being assigned; invalid values are silently ignored so a
    // malformed postMessage cannot corrupt store state or (for accentColor)
    // the CSS custom property the value ultimately reaches.
    // The app.vue component watches these values and will apply them automatically.
    if (config && typeof config === 'object') {
      if (isValidWidgetView(config.view)) {
        widgetStore.viewMode = config.view;
      }
      if (isValidWidgetAccentColor(config.accentColor)) {
        widgetStore.accentColor = config.accentColor;
      }
      if (isValidWidgetColorMode(config.colorMode)) {
        widgetStore.colorMode = config.colorMode;
      }
    }
  }
};

onBeforeMount(async () => {
  try {
    state.isLoading = true;

    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarUrlName);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    // Fetch widget display config from the widget-facing calendar endpoint.
    // This endpoint returns calendar metadata merged with a `widgetConfig`
    // property containing the authoritative server-stored view/accentColor/colorMode.
    try {
      const widgetApiResponse = await fetch(`/api/widget/v1/calendars/${encodeURIComponent(calendarUrlName)}`, {
        credentials: 'omit',
        headers: { 'Accept': 'application/json' },
      });
      if (widgetApiResponse.ok) {
        const data = await widgetApiResponse.json();
        widgetStore.applyServerConfig(data.widgetConfig);
      }
      else {
        // Fall back to defaults if the widget endpoint is unavailable.
        widgetStore.applyServerConfig(null);
      }
    }
    catch (err) {
      console.warn('[widget-container] Failed to load widget config from server, using defaults.', err);
      widgetStore.applyServerConfig(null);
    }

    // Admin-preview override path: after the authoritative server config has
    // been applied, any URL params present (view/accentColor/colorMode) take
    // precedence. See `widgetStore.parseConfig` for the accepted-risk comment.
    const urlParams = new URLSearchParams(window.location.search);
    widgetStore.parseConfig(urlParams);

    // Set server-level default date range from site config before loading calendar
    if (siteConfig) {
      const serverDefault = siteConfig.settings().defaultDateRange;
      if (serverDefault) {
        publicCalendarStore.setServerDefaultDateRange(serverDefault);
      }
    }

    // Set current calendar in store
    publicCalendarStore.setCurrentCalendar(calendarUrlName);

    // Load calendar settings (including defaultDateRange) before loading events
    await publicCalendarStore.loadCalendar(calendarUrlName);

    // Load categories - SearchFilterPublic will handle URL params and event loading
    await publicCalendarStore.loadCategories(calendarUrlName);
  }
  catch (error) {
    console.error('Error loading calendar data:', error);
    state.err = t('error_load_calendar');
  }
  finally {
    state.isLoading = false;
  }
});

onMounted(() => {
  // Listen for configuration updates from parent window
  window.addEventListener('message', handleMessage);
});

onUnmounted(() => {
  // Clean up event listener
  window.removeEventListener('message', handleMessage);
});
</script>

<template>
  <div v-if="state.notFound" class="widget-container">
    <NotFound />
  </div>
  <div v-else class="widget-container">
    <header v-if="state.calendar">
      <!-- Search and Filter Component -->
      <SearchFilterPublic :widget-view-mode="widgetStore.viewMode" />
    </header>

    <main class="widget-main">
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <div v-if="publicCalendarStore.eventError" class="error">{{ publicCalendarStore.eventError }}</div>
      <div v-if="publicCalendarStore.categoryError" class="error">{{ publicCalendarStore.categoryError }}</div>

      <!-- View Mode Switcher -->
      <WeekView v-if="widgetStore.viewMode === 'week'" />
      <MonthView v-else-if="widgetStore.viewMode === 'month'" />
      <ListView v-else />

      <!-- Loading State -->
      <div v-if="state.isLoading" class="loading">
        {{ t('loading_events') }}
      </div>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

.widget-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  background: $public-bg-primary-light;

  @include public-dark-mode {
    background: $public-bg-primary-dark;
  }

  // Widget theme overrides (forced light/dark mode)
  :global(.widget-theme-light) & {
    background: $public-bg-primary-light;
    color: $public-text-primary-light;
  }

  :global(.widget-theme-dark) & {
    background: $public-bg-primary-dark;
    color: $public-text-primary-dark;
  }
}

header {
  padding: $public-space-md;
  border-bottom: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-bottom-color: $public-border-subtle-dark;
  }

  .calendar-title {
    font-size: $public-font-size-lg;
    font-weight: $public-font-weight-light;
    margin: 0 0 $public-space-md 0;
    color: $public-text-primary-light;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }

    @include public-mobile-only {
      font-size: $public-font-size-md;
    }
  }
}

.widget-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.error {
  @include public-error-state;

  margin: $public-space-md;
}

.loading {
  @include public-loading-state;
}
</style>
