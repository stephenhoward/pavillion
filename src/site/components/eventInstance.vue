<script setup>
import { reactive, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import { DateTime } from 'luxon';

import CalendarService from '../service/calendar';
import NotFound from './notFound.vue';
import EventImage from './EventImage.vue';
import ReportEvent from './ReportEvent.vue';

const { t } = useTranslation('system');
const route = useRoute();
const calendarId = route.params.calendar;
const eventId = route.params.event;
const instanceId = route.params.instance;
const showReportModal = ref(false);
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  instance: null,
  isLoading: false,
});
const calendarService = new CalendarService();

/**
 * Opens the report event modal dialog.
 */
function openReportModal() {
  showReportModal.value = true;
}

/**
 * Closes the report event modal dialog.
 */
function closeReportModal() {
  showReportModal.value = false;
}

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    state.instance = await calendarService.loadEventInstance(instanceId);
    if (!state.instance) {
      state.notFound = true;
      return;
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
  <div v-else-if="state.instance">
    <header v-if="state.calendar" class="instance-header">
      <!-- TODO: respect the user's language prefernces instead of using 'en' -->
      <p class="breadcrumb">
        <router-link :to="{ name: 'calendar', params: { calendar: state.calendar.urlName } }">
          {{ state.calendar.content("en").name || state.calendar.urlName }}
        </router-link>
      </p>
      <EventImage :media="state.instance.event.media" context="hero" />
      <div class="instance-meta">
        <h1>{{ state.instance.event.content("en").name }}</h1>
        <time :datetime="state.instance.start.toISO()" class="event-datetime">
          {{ state.instance.start.toLocaleString(DateTime.DATETIME_MED) }}
        </time>
      </div>
    </header>
    <main>
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <p>{{ state.instance.event.content("en").description }}</p>
    </main>
    <footer>
      <div class="category-badges">
        <a v-for="category in state.instance.event.categories"
           class="event-category-badge"
           :href="'/@'+ state.calendar.urlName + '?category='+category.content('en').name"
        >
          {{ category.content("en").name }}
        </a>
      </div>
      <button
        type="button"
        class="report-link"
        @click="openReportModal"
      >{{ t('report.link_text') }}</button>
    </footer>

    <ReportEvent
      v-if="showReportModal"
      :event-id="eventId"
      @close="closeReportModal"
    />
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

// ================================================================
// EVENT INSTANCE PAGE
// ================================================================
// Displays a specific occurrence of an event with optional hero image,
// date/time, and full event details. Adapts gracefully without images.
// ================================================================

.instance-header {
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
  // When no image is present, elevate the title and datetime
  // to create a strong typographic header.
  // ============================================================

  &:not(:has(.event-image)) .instance-meta {
    padding-top: $public-space-lg;
    border-top: 4px solid $public-accent-light;
    max-width: 80%;

    @include public-dark-mode {
      border-top-color: $public-accent-dark;
    }

    @include public-mobile-only {
      max-width: 100%;
    }

    h1 {
      font-size: 40px;
      font-weight: $public-font-weight-bold;
      letter-spacing: $public-letter-spacing-tight;

      @include public-mobile-only {
        font-size: $public-font-size-2xl;
      }
    }

    .event-datetime {
      font-size: $public-font-size-lg;
    }
  }

  // ============================================================
  // HEADER WITH IMAGE
  // ============================================================
  // Standard layout with hero image taking visual priority.
  // ============================================================

  &:has(.event-image) .instance-meta {
    h1 {
      font-size: $public-font-size-2xl;
      font-weight: $public-font-weight-semibold;

      @include public-mobile-only {
        font-size: $public-font-size-xl;
      }
    }
  }

  .instance-meta {
    display: flex;
    flex-direction: column;
    gap: $public-space-sm;

    h1 {
      margin: 0;
      line-height: $public-line-height-tight;
      color: $public-text-primary-light;

      @include public-dark-mode {
        color: $public-text-primary-dark;
      }
    }

    .event-datetime {
      display: inline-flex;
      align-items: center;
      gap: $public-space-sm;
      font-size: $public-font-size-md;
      font-weight: $public-font-weight-medium;
      color: $public-accent-light;

      @include public-dark-mode {
        color: $public-accent-dark;
      }
    }
  }
}

main {
  p {
    font-size: $public-font-size-md;
    line-height: $public-line-height-relaxed;
    color: $public-text-primary-light;
    margin: 0 0 $public-space-lg 0;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }
}

footer {
  margin-top: $public-space-xl;
  padding-top: $public-space-lg;
  border-top: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-top-color: $public-border-subtle-dark;
  }

  .category-badges {
    display: flex;
    flex-wrap: wrap;
    gap: $public-space-sm;
    margin-bottom: $public-space-lg;
  }
}

.event-category-badge {
  @include public-category-badge;

  text-decoration: none;
  transition: $public-transition-fast;

  &:hover {
    background-color: $public-accent-hover-light;
    transform: translateY(-1px);

    @include public-dark-mode {
      background-color: $public-accent-hover-dark;
    }
  }
}

.report-link {
  background: none;
  border: none;
  padding: 0;
  font-family: $public-font-family;
  font-size: $public-font-size-sm;
  color: $public-text-tertiary-light;
  cursor: pointer;
  transition: $public-transition-fast;
  text-decoration: underline;
  text-underline-offset: 2px;

  &:hover {
    color: $public-text-secondary-light;
  }

  &:focus-visible {
    @include public-focus-visible;
  }

  @include public-dark-mode {
    color: $public-text-tertiary-dark;

    &:hover {
      color: $public-text-secondary-dark;
    }
  }
}
</style>
