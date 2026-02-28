<script setup lang="ts">
import { reactive, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import CalendarService from '../service/calendar';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import NotFound from './notFound.vue';
import EventImage from './EventImage.vue';
import ReportEvent from './report-event.vue';
import { useLocale } from '@/site/composables/useLocale';

const { t } = useTranslation('system');
const route = useRoute();
const { localizedPath } = useLocale();
const calendarId = route.params.calendar;
const eventId = route.params.event;
const showReportModal = ref(false);
const { localizedContent } = useLocalizedContent();
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  event: null,
  isLoading: false,
});
const calendarService = new CalendarService();

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
    state.err = t('error_load_event');
  }
  finally {
    state.isLoading = false;
  }
});

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

</script>

<template>
  <div v-if="state.notFound">
    <NotFound />
  </div>
  <div v-else-if="state.event" class="event-detail">
    <header v-if="state.calendar" class="event-header">
      <p class="breadcrumb">
        <router-link
          :to="{ name: 'calendar', params: { calendar: state.calendar.urlName } }"
          class="back-link"
        >
          <span class="back-arrow" aria-hidden="true">&#8592;</span>
          {{ t('back_to_calendar', { name: localizedContent(state.calendar).name || state.calendar.urlName }) }}
        </router-link>
      </p>
      <EventImage :media="state.event.media" context="feature" />
      <h1>{{ localizedContent(state.event).name }}</h1>
    </header>
    <main class="event-content">
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <div v-if="localizedContent(state.event).description" class="description">
        <p>{{ localizedContent(state.event).description }}</p>
      </div>
    </main>
    <footer class="event-footer">
      <div
        v-if="state.event.series"
        class="series-link-wrapper"
      >
        <span class="series-label">{{ t('series.label') }}</span>
        <router-link
          :to="localizedPath('/view/' + state.calendar.urlName + '/series/' + state.event.series.urlName)"
          class="event-series-link"
          :aria-label="t('series.part_of', { name: localizedContent(state.event.series).name })"
        >{{ localizedContent(state.event.series).name }}</router-link>
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
  margin-bottom: $public-space-lg;

  .breadcrumb {
    margin: 0;
    font-size: $public-font-size-base;

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: $public-space-sm;
      color: $public-text-secondary-light;
      text-decoration: none;
      font-weight: $public-font-weight-medium;
      transition: $public-transition-fast;

      &:hover {
        color: $public-accent-light;

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
          color: $public-accent-dark;
        }
      }
    }

    .back-arrow {
      font-size: $public-font-size-md;
      line-height: 1;
      display: inline-block;
      transition: $public-transition-fast;
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

.event-footer {
  margin-top: $public-space-lg;
  padding-top: $public-space-lg;
  border-top: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-top-color: $public-border-subtle-dark;
  }

  .series-link-wrapper {
    display: flex;
    align-items: center;
    gap: $public-space-sm;
    margin-bottom: $public-space-md;
    font-size: $public-font-size-sm;

    .series-label {
      color: $public-text-secondary-light;
      font-weight: $public-font-weight-medium;

      @include public-dark-mode {
        color: $public-text-secondary-dark;
      }
    }
  }
}

.event-series-link {
  color: $public-accent-light;
  text-decoration: none;
  font-weight: $public-font-weight-medium;
  transition: $public-transition-fast;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    @include public-focus-visible;
  }

  @include public-dark-mode {
    color: $public-accent-dark;
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

.event-category-badge {
  @include public-category-badge;
}
</style>
