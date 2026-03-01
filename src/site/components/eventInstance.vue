<script setup>
import { reactive, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import { DateTime } from 'luxon';
import i18next from 'i18next';

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
const instanceId = route.params.instance;
const showReportModal = ref(false);
const { localizedContent } = useLocalizedContent();
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  instance: null,
  isLoading: false,
});
const calendarService = new CalendarService();

/**
 * Returns true when start and end fall on the same calendar day.
 *
 * @param start - The event start DateTime
 * @param end - The event end DateTime
 * @returns true if both DateTimes share the same local day
 */
function isSameDay(start, end) {
  return start.hasSame(end, 'day');
}

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

    // Set page title to event name
    const eventName = localizedContent(state.instance.event).name;
    document.title = `${eventName} | Pavillion`;

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
  <div v-if="state.notFound">
    <NotFound />
  </div>
  <div v-else-if="state.instance">
    <header v-if="state.calendar" class="instance-header">
      <p class="breadcrumb">
        <a :href="localizedPath('/view/' + state.calendar.urlName)"
           class="back-link"
        >
          <span class="back-arrow" aria-hidden="true">&#8592;</span>
          {{ t('back_to_calendar', { name: localizedContent(state.calendar).name || state.calendar.urlName }) }}
        </a>
      </p>
      <EventImage :media="state.instance.event.media" context="hero" />
      <div class="instance-meta">
        <h1>{{ localizedContent(state.instance.event).name }}</h1>
        <time :datetime="state.instance.start.toISO()" class="event-datetime">
          {{ state.instance.start.toLocal().setLocale(i18next.language).toLocaleString(DateTime.DATETIME_MED) }}<template v-if="state.instance.end">
            – {{ state.instance.end.toLocal().setLocale(i18next.language).toLocaleString(
              isSameDay(state.instance.start, state.instance.end) ? DateTime.TIME_SIMPLE : DateTime.DATETIME_MED
            ) }}</template>
        </time>
      </div>
    </header>
    <main>
      <div v-if="state.err" class="error">{{ state.err }}</div>
      <p>{{ localizedContent(state.instance.event).description }}</p>
      <section v-if="state.instance.event.location" class="event-location">
        <h2>{{ t('event_location') }}</h2>
        <p class="location-name">{{ state.instance.event.location.name }}</p>
        <p v-if="state.instance.event.location.address" class="location-address">
          {{ state.instance.event.location.address }}
          <template v-if="state.instance.event.location.city">
            <br />{{ state.instance.event.location.city }}<template v-if="state.instance.event.location.state">, {{ state.instance.event.location.state }}</template>
            <template v-if="state.instance.event.location.postalCode"> {{ state.instance.event.location.postalCode }}</template>
          </template>
        </p>
      </section>
    </main>
    <footer>
      <div
        v-if="state.instance.event.series"
        class="series-link-wrapper"
      >
        <span class="series-label">{{ t('series.label') }}</span>
        <a
          :href="localizedPath('/view/' + state.calendar.urlName + '/series/' + state.instance.event.series.urlName)"
          class="event-series-link"
          :aria-label="t('series.part_of', { name: localizedContent(state.instance.event.series).name })"
        >{{ localizedContent(state.instance.event.series).name }}</a>
      </div>
      <div class="category-badges">
        <a v-for="category in state.instance.event.categories"
           :key="category.id"
           class="event-category-badge"
           :href="localizedPath('/view/' + state.calendar.urlName) + '?category=' + category.id"
        >
          {{ localizedContent(category).name }}
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

  .event-location {
    margin-top: $public-space-lg;
    padding-top: $public-space-lg;
    border-top: 1px solid $public-border-subtle-light;

    @include public-dark-mode {
      border-top-color: $public-border-subtle-dark;
    }

    h2 {
      font-size: $public-font-size-md;
      font-weight: $public-font-weight-semibold;
      color: $public-text-secondary-light;
      margin: 0 0 $public-space-sm 0;

      @include public-dark-mode {
        color: $public-text-secondary-dark;
      }
    }

    .location-name {
      font-weight: $public-font-weight-medium;
      margin-bottom: $public-space-xs;
    }

    .location-address {
      color: $public-text-secondary-light;
      font-size: $public-font-size-sm;

      @include public-dark-mode {
        color: $public-text-secondary-dark;
      }
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

  .category-badges {
    display: flex;
    flex-wrap: wrap;
    gap: $public-space-sm;
    margin-bottom: $public-space-lg;
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
