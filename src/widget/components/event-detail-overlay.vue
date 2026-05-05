<script setup lang="ts">
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';

import CalendarService from '@/site/service/calendar';
import { useWidgetStore } from '../stores/widgetStore';
import NotFound from '@/site/components/not-found.vue';
import EventDetailBody from '@/site/components/EventDetailBody.vue';
import { parseInstanceSlug } from '@/common/utils/instance-slug';
import type { EventCategory } from '@/common/model/event_category';

const { t } = useTranslation('system');
const route = useRoute();
const router = useRouter();
const widgetStore = useWidgetStore();

const calendarId = route.params.urlName;
const eventId = route.params.eventId;
const startTimeSlug = route.params.startTime as string | undefined;

const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  instance: null,
  isLoading: false,
});

const calendarService = new CalendarService();

const goBack = () => {
  router.push({
    name: 'widget-calendar',
    params: { urlName: widgetStore.calendarUrlName! },
  });
};

/**
 * Builds a widget-scoped category filter href that returns to the widget
 * calendar list pre-filtered by the chosen category. Uses the resolved
 * router URL so the iframe-aware base path is preserved.
 */
function categoryHrefBuilder(category: EventCategory): string {
  return router.resolve({
    name: 'widget-calendar',
    params: { urlName: widgetStore.calendarUrlName! },
    query: { categories: category.id },
  }).href;
}

onBeforeMount(async () => {
  try {
    state.isLoading = true;

    // Slug-first short-circuit: if the route carries a startTime slug,
    // validate it before any network call. This mirrors the site
    // event-instance.vue order so both surfaces share identical flow.
    let parsedStartTime = null;
    if (startTimeSlug) {
      parsedStartTime = parseInstanceSlug(startTimeSlug);
      if (!parsedStartTime) {
        state.notFound = true;
        return;
      }
    }

    state.calendar = await calendarService.getCalendarByUrlName(calendarId as string);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    if (parsedStartTime) {
      // Fetch the occurrence directly by (eventId, startTime) via the site
      // service — a single request that returns the full detail shape the
      // template expects and updates the event-instance store.
      const instance = await calendarService.loadEventInstance(
        eventId as string,
        parsedStartTime,
        calendarId as string,
      );
      if (!instance) {
        state.notFound = true;
        return;
      }
      state.instance = instance;
    }
    else {
      // Fallback path (legacy embeds without a slug): list calendar events
      // and pick the first one whose event id matches. The list response
      // already carries the fields the overlay needs, so no second detail
      // fetch is required here.
      const events = await calendarService.loadCalendarEvents(calendarId as string);
      const match = events.find((e: any) => e.event.id === eventId);

      if (!match) {
        state.notFound = true;
        return;
      }
      state.instance = match;
    }
  }
  catch (error) {
    console.error('Error loading event data:', error);
    state.err = t('error_load_event');
  }
  finally {
    state.isLoading = false;
  }
});
</script>

<template>
  <div class="event-detail-overlay">
    <!-- Loading State -->
    <div v-if="state.isLoading" role="status" class="loading">
      {{ t('loading_event') }}
    </div>

    <!-- Not Found State -->
    <div v-else-if="state.notFound">
      <NotFound />
    </div>

    <!-- Error State -->
    <div v-else-if="state.err" class="error-container">
      <div class="error" role="alert">{{ state.err }}</div>
      <button type="button" class="back-button" @click="goBack">
        {{ t('back_to_calendar', { name: widgetStore.calendarUrlName || '' }) }}
      </button>
    </div>

    <!-- Event Detail Content -->
    <div v-else-if="state.instance && state.calendar" class="event-detail-content">
      <!-- Back link header -->
      <header class="instance-back-header">
        <button type="button"
                class="back-link"
                @click="goBack"
                :aria-label="t('back_to_calendar', { name: widgetStore.calendarUrlName || '' })">
          <ArrowLeft :size="16" class="back-arrow" aria-hidden="true" />
          <span>{{ t('back_to_calendar', { name: widgetStore.calendarUrlName || '' }) }}</span>
        </button>
      </header>

      <main class="instance-main">
        <EventDetailBody
          :instance="state.instance"
          :calendar="state.calendar"
          :category-href-builder="categoryHrefBuilder"
        />
      </main>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

.event-detail-overlay {
  background: $public-bg-primary-light;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;

  @include public-dark-mode {
    background: $public-bg-primary-dark;
  }

  @include public-light-mode-override {
    background: $public-bg-primary-light;
  }
}

.event-detail-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

// ================================================================
// BACK HEADER
// ================================================================

.instance-back-header {
  padding: $public-space-md $public-space-lg;
  border-bottom: 1px solid $public-border-subtle-light;
  margin-bottom: $public-space-2xl;

  @include public-dark-mode {
    border-bottom-color: $public-border-subtle-dark;
  }

  @include public-light-mode-override {
    border-bottom-color: $public-border-subtle-light;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: $public-space-sm;
    padding: 0;
    background: transparent;
    border: 0;
    font-family: $public-font-family;
    font-size: $public-font-size-base;
    font-weight: $public-font-weight-medium;
    color: $public-text-secondary-light;
    cursor: pointer;
    transition: $public-transition-fast;

    &:hover {
      color: var(--pav-accent-light);

      .back-arrow {
        transform: translateX(-3px);
      }
    }

    &:focus-visible {
      @include public-focus-visible;
    }

    @include public-dark-mode {
      color: $public-text-secondary-dark;

      &:hover {
        color: var(--pav-accent-dark);
      }
    }

    @include public-light-mode-override {
      color: $public-text-secondary-light;

      &:hover {
        color: var(--pav-accent-light);
      }
    }
  }

  .back-arrow {
    display: inline-block;
    transition: $public-transition-fast;
    flex-shrink: 0;
  }
}

// ================================================================
// MAIN CONTENT
// ================================================================

.instance-main {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0 $public-space-lg $public-space-2xl;
  width: 100%;

  @include public-tablet-up {
    padding: 0 $public-space-xl $public-space-2xl;
  }

  @include public-desktop-up {
    padding: 0 $public-space-2xl $public-space-2xl;
  }
}

// ================================================================
// LOADING / ERROR STATES
// ================================================================

.loading {
  @include public-loading-state;
}

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: $public-space-2xl;
  gap: $public-space-lg;
  min-height: 400px;

  .error {
    @include public-error-state;
    margin: 0;
  }

  .back-button {
    @include public-button-base;

    padding: $public-space-sm $public-space-lg;
    background: transparent;
    border: 1px solid $public-border-medium-light;
    border-radius: $public-radius-sm;
    color: $public-text-primary-light;
    font-size: $public-font-size-base;
    transition: $public-transition-fast;

    &:hover {
      background: $public-hover-overlay-light;
      border-color: $public-border-strong-light;
    }

    @include public-dark-mode {
      border-color: $public-border-medium-dark;
      color: $public-text-primary-dark;

      &:hover {
        background: $public-hover-overlay-dark;
        border-color: $public-border-strong-dark;
      }
    }

    @include public-light-mode-override {
      border-color: $public-border-medium-light;
      color: $public-text-primary-light;

      &:hover {
        background: $public-hover-overlay-light;
        border-color: $public-border-strong-light;
      }
    }
  }
}

.error {
  @include public-error-state;

  margin: $public-space-md 0;
}
</style>
