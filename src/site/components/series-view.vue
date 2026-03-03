<script setup>
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';

import CalendarService from '../service/calendar';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import NotFound from './notFound.vue';
import EventImage from './EventImage.vue';
import { useLocale } from '@/site/composables/useLocale';

const { t } = useTranslation('system');
const route = useRoute();
const { localizedPath } = useLocale();
const calendarId = route.params.calendar;
const seriesId = route.params.series;
const { localizedContent } = useLocalizedContent();
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  series: null,
  events: [],
  pagination: { total: 0, limit: 20, offset: 0 },
  isLoading: false,
});
const calendarService = new CalendarService();

const PAGE_SIZE = 20;

/**
 * Returns the current page number (1-based) derived from pagination offset.
 */
function currentPage() {
  return Math.floor(state.pagination.offset / PAGE_SIZE) + 1;
}

/**
 * Returns the total number of pages.
 */
function totalPages() {
  return Math.ceil(state.pagination.total / PAGE_SIZE);
}

/**
 * Returns true when more than one page of events exists.
 */
function hasPagination() {
  return state.pagination.total > PAGE_SIZE;
}

/**
 * Load series events for the given offset, updating state in place.
 */
async function loadPage(offset) {
  try {
    state.isLoading = true;
    const result = await calendarService.loadSeriesDetail(calendarId, seriesId, PAGE_SIZE, offset);
    if (!result) {
      state.notFound = true;
      return;
    }
    state.series = result.series;
    state.events = result.events;
    state.pagination = result.pagination;
    const seriesName = localizedContent(state.series).name;
    document.title = `${seriesName} | Pavillion`;
  }
  catch (error) {
    console.error('Error loading series data:', error);
    state.err = t('series_load_error');
  }
  finally {
    state.isLoading = false;
  }
}

/**
 * Navigate to the previous page of events.
 */
async function prevPage() {
  const newOffset = Math.max(0, state.pagination.offset - PAGE_SIZE);
  await loadPage(newOffset);
}

/**
 * Navigate to the next page of events.
 */
async function nextPage() {
  const newOffset = state.pagination.offset + PAGE_SIZE;
  if (newOffset < state.pagination.total) {
    await loadPage(newOffset);
  }
}

onBeforeMount(async () => {
  try {
    state.isLoading = true;
    state.calendar = await calendarService.getCalendarByUrlName(calendarId);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    const result = await calendarService.loadSeriesDetail(calendarId, seriesId, PAGE_SIZE, 0);
    if (!result) {
      state.notFound = true;
      return;
    }

    state.series = result.series;
    state.events = result.events;
    state.pagination = result.pagination;

    const seriesName = localizedContent(state.series).name;
    document.title = `${seriesName} | Pavillion`;
  }
  catch (error) {
    console.error('Error loading series data:', error);
    state.err = t('series_load_error');
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
    v-else-if="state.series"
    class="series-detail"
  >
    <header
      v-if="state.calendar"
      class="series-header"
    >
      <p class="breadcrumb">
        <a
          :href="localizedPath('/view/' + state.calendar.urlName)"
          class="back-link"
        >
          <span
            class="back-arrow"
            aria-hidden="true"
          >&#8592;</span>
          {{ t('back_to_calendar', { name: localizedContent(state.calendar).name || state.calendar.urlName }) }}
        </a>
      </p>
      <EventImage
        :media="state.series.mediaId ? { id: state.series.mediaId } : null"
        context="feature"
      />
      <div class="series-meta">
        <h1>{{ localizedContent(state.series).name }}</h1>
      </div>
    </header>

    <main class="series-content">
      <div
        v-if="state.isLoading"
        class="loading"
        role="status"
      >{{ t('series_loading') }}</div>

      <div
        v-if="state.err"
        class="error"
        role="alert"
      >{{ state.err }}</div>

      <p
        v-if="localizedContent(state.series).description"
        class="series-description"
      >
        {{ localizedContent(state.series).description }}
      </p>

      <section
        class="series-events"
        aria-labelledby="series-events-heading"
      >
        <h2 id="series-events-heading">{{ t('series_events') }}</h2>

        <ul
          v-if="state.events.length > 0"
          class="series-event-list"
          role="list"
        >
          <li
            v-for="event in state.events"
            :key="event.id"
            class="series-event-item"
          >
            <a
              :href="localizedPath('/view/' + state.calendar.urlName + '/events/' + event.id)"
              class="series-event-link"
            >
              {{ localizedContent(event).name }}
            </a>
          </li>
        </ul>

        <p
          v-else
          class="series-no-events"
        >
          {{ t('series_no_events') }}
        </p>

        <nav
          v-if="hasPagination()"
          class="series-pagination"
          :aria-label="t('series_pagination')"
        >
          <button
            type="button"
            class="prev-page"
            :disabled="state.pagination.offset === 0 || undefined"
            :aria-disabled="state.pagination.offset === 0 || undefined"
            @click="prevPage"
          >
            {{ t('series_previous_page') }}
          </button>
          <span class="page-info">
            {{ t('series_page_info', { current: currentPage(), total: totalPages() }) }}
          </span>
          <button
            type="button"
            class="next-page"
            :disabled="state.pagination.offset + PAGE_SIZE >= state.pagination.total || undefined"
            :aria-disabled="state.pagination.offset + PAGE_SIZE >= state.pagination.total || undefined"
            @click="nextPage"
          >
            {{ t('series_next_page') }}
          </button>
        </nav>
      </section>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

// ================================================================
// SERIES DETAIL PAGE
// ================================================================
// Displays a series (a named grouping of related events) with
// its name, description, optional hero image, and a chronological
// paginated event list.
// ================================================================

.series-detail {
  max-width: 960px;
  margin: 0 auto;
}

.series-header {
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

  .series-meta {
    display: flex;
    flex-direction: column;
    gap: $public-space-sm;

    h1 {
      margin: 0;
      line-height: $public-line-height-tight;
      color: $public-text-primary-light;
      font-size: $public-font-size-2xl;
      font-weight: $public-font-weight-bold;
      letter-spacing: $public-letter-spacing-tight;

      @include public-dark-mode {
        color: $public-text-primary-dark;
      }

      @include public-mobile-only {
        font-size: $public-font-size-xl;
      }
    }
  }

  // No-image variant: stronger typographic header
  &:not(:has(.event-image)) .series-meta {
    padding-top: $public-space-lg;
    border-top: 4px solid $public-accent-light;
    max-width: 80%;

    @include public-dark-mode {
      border-top-color: $public-accent-dark;
    }

    @include public-mobile-only {
      max-width: 100%;
    }
  }
}

.series-content {
  .error {
    @include public-error-state;
    margin-bottom: $public-space-lg;
  }

  .series-description {
    font-size: $public-font-size-md;
    line-height: $public-line-height-relaxed;
    color: $public-text-primary-light;
    margin: 0 0 $public-space-xl 0;
    white-space: pre-wrap;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }
}

.series-events {
  h2 {
    font-size: $public-font-size-lg;
    font-weight: $public-font-weight-semibold;
    color: $public-text-secondary-light;
    margin: 0 0 $public-space-md 0;
    padding-top: $public-space-lg;
    border-top: 1px solid $public-border-subtle-light;

    @include public-dark-mode {
      color: $public-text-secondary-dark;
      border-top-color: $public-border-subtle-dark;
    }
  }
}

.series-event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: $public-space-sm;
}

.series-event-item {
  padding: $public-space-sm 0;
  border-bottom: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-bottom-color: $public-border-subtle-dark;
  }

  &:last-child {
    border-bottom: none;
  }
}

.series-event-link {
  display: block;
  color: $public-text-primary-light;
  text-decoration: none;
  font-size: $public-font-size-md;
  font-weight: $public-font-weight-medium;
  padding: $public-space-xs 0;
  transition: $public-transition-fast;

  &:hover {
    color: $public-accent-light;
  }

  &:focus-visible {
    @include public-focus-visible;
  }

  @include public-dark-mode {
    color: $public-text-primary-dark;

    &:hover {
      color: $public-accent-dark;
    }
  }
}

.series-no-events {
  color: $public-text-secondary-light;
  font-size: $public-font-size-md;
  font-style: italic;
  margin: $public-space-md 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.series-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $public-space-md;
  margin-top: $public-space-xl;
  padding-top: $public-space-lg;
  border-top: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-top-color: $public-border-subtle-dark;
  }

  .prev-page,
  .next-page {
    background: none;
    border: 1px solid $public-border-medium-light;
    border-radius: $public-radius-sm;
    padding: $public-space-xs $public-space-md;
    font-family: $public-font-family;
    font-size: $public-font-size-sm;
    font-weight: $public-font-weight-medium;
    color: $public-text-primary-light;
    cursor: pointer;
    transition: $public-transition-fast;

    &:hover:not(:disabled) {
      border-color: $public-accent-light;
      color: $public-accent-light;
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &:focus-visible {
      @include public-focus-visible;
    }

    @include public-dark-mode {
      border-color: $public-border-medium-dark;
      color: $public-text-primary-dark;

      &:hover:not(:disabled) {
        border-color: $public-accent-dark;
        color: $public-accent-dark;
      }
    }
  }

  .page-info {
    font-size: $public-font-size-sm;
    color: $public-text-secondary-light;

    @include public-dark-mode {
      color: $public-text-secondary-dark;
    }
  }
}
</style>
