<script setup>
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CalendarService from '../service/calendar';
import { useEventStore } from '../../client/stores/eventStore';
import NotFound from './notFound.vue';
import EventImage from './EventImage.vue';

const { t } = useTranslation('system');
const route = useRoute();
const calendarId = route.params.calendar;
const eventId = route.params.event;
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  event: null,
  isLoading: false,
});
const calendarService = new CalendarService();
const store = useEventStore();

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }
    else {
      // Load events for this calendar
      state.event = await calendarService.loadEvent(eventId);
      if (!state.event) {
        state.notFound = true;
        return;
      }
    }
  }
  catch (error) {
    console.error('Error loading event data:', error);
    state.err = 'Failed to load event data';
  }
  finally {
    state.isLoading = false;
  }
});

</script>

<template>
  <div v-if="state.notFound">
    <NotFound />
  </div>
  <div v-else-if="state.event" class="event-detail">
    <header v-if="state.calendar" class="event-header">
      <!-- TODO: respect the user's language prefernces instead of using 'en' -->
      <p class="breadcrumb">
        <router-link :to="{ name: 'calendar', params: { calendar: state.calendar.urlName } }">
          {{ state.calendar.content("en").name || state.calendar.urlName }}
        </router-link>
      </p>
      <EventImage :media="state.event.media" context="feature" />
      <h1>{{ state.event.content("en").name }}</h1>
    </header>
    <main class="event-content">
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <div class="description">
        <p>{{ state.event.content("en").description }}</p>
      </div>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

// ================================================================
// EVENT DETAIL PAGE
// ================================================================
// Displays the full event details with an optional dramatic feature image.
// The layout adapts gracefully whether there's an image or not.
// ================================================================

.event-detail {
  max-width: 960px;
  margin: 0 auto;
}

.event-header {
  display: flex;
  flex-direction: column;
  gap: $public-space-lg;
  margin-bottom: $public-space-2xl;

  .breadcrumb {
    margin: 0;
    font-size: $public-font-size-sm;

    a {
      color: $public-text-secondary-light;
      text-decoration: none;
      transition: $public-transition-fast;

      &:hover {
        color: $public-accent-light;
      }

      @include public-dark-mode {
        color: $public-text-secondary-dark;

        &:hover {
          color: $public-accent-dark;
        }
      }
    }
  }

  // ============================================================
  // HEADER WITHOUT IMAGE
  // ============================================================
  // When no image is present, the title becomes the hero element.
  // Add visual weight through typography and subtle accent.
  // ============================================================

  &:not(:has(.event-image)) {
    h1 {
      font-size: 40px;
      font-weight: $public-font-weight-bold;
      letter-spacing: $public-letter-spacing-tight;
      padding-top: $public-space-lg;
      border-top: 4px solid $public-accent-light;
      max-width: 80%;

      @include public-dark-mode {
        border-top-color: $public-accent-dark;
      }

      @include public-mobile-only {
        font-size: $public-font-size-2xl;
        max-width: 100%;
      }
    }
  }

  // ============================================================
  // HEADER WITH IMAGE
  // ============================================================
  // Standard layout with feature image taking visual priority.
  // ============================================================

  &:has(.event-image) h1 {
    font-size: $public-font-size-2xl;
    font-weight: $public-font-weight-semibold;

    @include public-mobile-only {
      font-size: $public-font-size-xl;
    }
  }

  h1 {
    margin: 0;
    line-height: $public-line-height-tight;
    color: $public-text-primary-light;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }
}

.event-content {
  .description {
    p {
      font-size: $public-font-size-md;
      line-height: $public-line-height-relaxed;
      color: $public-text-primary-light;
      margin: 0 0 $public-space-lg 0;
      white-space: pre-wrap;

      @include public-dark-mode {
        color: $public-text-primary-dark;
      }
    }
  }

  .error {
    @include public-error-state;
    margin-bottom: $public-space-lg;
  }
}

.event-category-badge {
  @include public-category-badge;
}
</style>
