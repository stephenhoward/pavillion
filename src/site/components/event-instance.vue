<script setup lang="ts">
import { reactive, onBeforeMount, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';

import CalendarService from '../service/calendar';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import NotFound from './not-found.vue';
import ReportEvent from './report-event.vue';
import EventDetailBody from '@/site/components/EventDetailBody.vue';
import { useLocale } from '@/site/composables/useLocale';
import { parseInstanceSlug } from '@/common/utils/instance-slug';
import type { EventCategory } from '@/common/model/event_category';

const { t } = useTranslation('system');
const route = useRoute();
const { localizedPath } = useLocale();
const calendarId = route.params.calendar;
const eventId = route.params.event as string;
const startTimeSlug = route.params.startTime as string;
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

/**
 * Builds a site-specific category filter href that links to the calendar
 * view filtered by category id. Locale-aware via `localizedPath`.
 */
function categoryHrefBuilder(category: EventCategory): string {
  return localizedPath('/view/' + state.calendar.urlName) + '?categories=' + category.id;
}

onBeforeMount(async () => {
  try {
    state.isLoading = true;

    // Validate the start-time slug before making any network calls.
    // A semantically-invalid slug (malformed, out-of-bounds, or impossible
    // date) short-circuits to the not-found state so we don't hit the API
    // with garbage input.
    const parsedStartTime = parseInstanceSlug(startTimeSlug);
    if (!parsedStartTime) {
      state.notFound = true;
      return;
    }

    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    state.instance = await calendarService.loadEventInstance(eventId, parsedStartTime);
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
  <div
    v-else-if="state.isLoading"
    role="status"
    class="loading"
  >
    {{ t('loading_events') }}
  </div>
  <div v-else-if="state.instance">
    <!-- Back link header -->
    <header v-if="state.calendar" class="instance-back-header">
      <p class="breadcrumb">
        <a :href="localizedPath('/view/' + state.calendar.urlName)"
           class="back-link"
        >
          <ArrowLeft :size="16" class="back-arrow" aria-hidden="true" />
          {{ t('back_to_calendar', { name: localizedContent(state.calendar).name || state.calendar.urlName }) }}
        </a>
      </p>
    </header>

    <main class="instance-main" :aria-busy="state.isLoading">
      <div v-if="state.err" role="alert" class="error">{{ state.err }}</div>

      <EventDetailBody
        :instance="state.instance"
        :calendar="state.calendar"
        :category-href-builder="categoryHrefBuilder"
      />
    </main>

    <!-- Footer: series link + report button -->
    <footer class="instance-footer">
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
// EVENT INSTANCE PAGE — SHELL
// ================================================================
// Thin shell that composes <EventDetailBody> inside a <main> element.
// Owns the breadcrumb back-link header, the page-level <main> wrapper,
// and the footer (series link + report button). Body content styles
// live in EventDetailBody.vue.
// ================================================================

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

  .breadcrumb {
    margin: 0;
    font-size: $public-font-size-base;
  }

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
    display: inline-block;
    transition: $public-transition-fast;
    flex-shrink: 0;
  }
}

// ================================================================
// MAIN CONTENT WRAPPER
// ================================================================

.instance-main {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0 $public-space-lg;

  @include public-tablet-up {
    padding: 0 $public-space-xl;
  }

  @include public-desktop-up {
    padding: 0 $public-space-2xl;
  }
}

// ================================================================
// FOOTER: SERIES LINK + REPORT BUTTON
// ================================================================

.instance-footer {
  max-width: 72rem;
  margin: $public-space-xl auto 0 auto;
  padding: $public-space-lg $public-space-lg 0 $public-space-lg;
  border-top: 1px solid $public-border-subtle-light;

  @include public-tablet-up {
    padding: $public-space-lg $public-space-xl 0 $public-space-xl;
  }

  @include public-desktop-up {
    padding: $public-space-lg $public-space-2xl 0 $public-space-2xl;
  }

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

.loading {
  @include public-loading-state;
}

.error {
  @include public-error-state;
  margin-bottom: $public-space-lg;
}

.report-link {
  background: none;
  border: none;
  padding: $public-space-sm $public-space-md;
  min-height: 44px;
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
