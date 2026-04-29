<script setup lang="ts">
import { reactive, computed, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import { DateTime } from 'luxon';
import i18next from 'i18next';
import { ArrowLeft, Calendar, Clock, Repeat, MapPin, Accessibility } from 'lucide-vue-next';

import CalendarService from '@/site/service/calendar';
import { useWidgetStore } from '../stores/widgetStore';
import { useLocalizedContent } from '@/site/composables/useLocalizedContent';
import NotFound from '@/site/components/not-found.vue';
import EventImage from '@/site/components/event-image.vue';
import AddToCalendar from '@/site/components/add-to-calendar.vue';
import { useRecurrenceText } from '@/site/composables/useRecurrenceText';
import { URL_PROMPT_VALUES, type UrlPrompt } from '@/common/model/events';
import { parseInstanceSlug } from '@/common/utils/instance-slug';

const { t } = useTranslation('system');
const route = useRoute();
const router = useRouter();
const widgetStore = useWidgetStore();
const { localizedContent } = useLocalizedContent();

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

/**
 * Returns true when start and end fall on the same calendar day.
 */
function isSameDay(start: DateTime, end: DateTime): boolean {
  return start.hasSame(end, 'day');
}

/**
 * Computed human-readable recurrence text derived from the public API's
 * `recurrenceSummary: { key, params }` intent shape. Day codes, ordinals,
 * and multi-day list joining are resolved in the active locale.
 */
const recurrenceText = useRecurrenceText(
  () => state.instance?.event?.recurrenceSummary ?? null,
);

const locationAccessibilityInfo = computed(() => {
  const location = state.instance?.event?.location;
  if (!location || typeof location.hasContent !== 'function') {
    return '';
  }
  try {
    const content = localizedContent(location);
    return content?.accessibilityInfo ?? '';
  }
  catch {
    return '';
  }
});

const sourceCalendar = computed(() => {
  return state.instance?.event?.sourceCalendar ?? null;
});

const sourceCalendarLabel = computed(() => {
  if (!sourceCalendar.value) return '';
  return `${sourceCalendar.value.urlName}@${sourceCalendar.value.host}`;
});

/**
 * Defense-in-depth safe external URL computed.
 * Returns the URL only if its protocol is http: or https:, else null.
 * Guards against javascript:, data:, and other unsafe schemes even if
 * the service-layer validator is bypassed or misconfigured.
 */
const safeExternalUrl = computed<string | null>(() => {
  const raw = state.instance?.event?.externalUrl;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  }
  catch {
    return null;
  }
});

/**
 * Defense-in-depth safe URL prompt computed.
 * Returns the prompt value only if it is in URL_PROMPT_VALUES, else null.
 * Prevents template-key injection via arbitrary strings.
 */
const safePrompt = computed<UrlPrompt | null>(() => {
  const raw = state.instance?.event?.urlPrompt;
  if (raw == null) return null;
  return URL_PROMPT_VALUES.includes(raw as UrlPrompt) ? (raw as UrlPrompt) : null;
});

const goBack = () => {
  router.push({
    name: 'widget-calendar',
    params: { urlName: widgetStore.calendarUrlName! },
  });
};

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
    <div v-if="state.isLoading" class="loading">
      {{ t('loading_event') }}
    </div>

    <!-- Not Found State -->
    <div v-else-if="state.notFound">
      <NotFound />
    </div>

    <!-- Error State -->
    <div v-else-if="state.err" class="error-container">
      <div class="error">{{ state.err }}</div>
      <button type="button" class="back-button" @click="goBack">
        {{ t('back_to_calendar', { name: widgetStore.calendarUrlName || '' }) }}
      </button>
    </div>

    <!-- Event Detail Content -->
    <div v-else-if="state.instance" class="event-detail-content">
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
        <!-- Hero image -->
        <div class="hero-image-wrapper">
          <EventImage
            :media="state.instance.event.media"
            context="feature"
            :alt="localizedContent(state.instance.event).name"
            :focal-point-x="state.instance.event.mediaFocalPointX"
            :focal-point-y="state.instance.event.mediaFocalPointY"
            :zoom="state.instance.event.mediaZoom"
          />
        </div>

        <!-- Recurrence badge -->
        <div v-if="recurrenceText" class="recurrence-badge">
          <Repeat :size="14" aria-hidden="true" />
          <span>{{ recurrenceText }}</span>
        </div>

        <!-- Source calendar pill -->
        <a
          v-if="sourceCalendar"
          :href="sourceCalendar.url"
          class="source-calendar-pill"
          :aria-label="t('event_source_calendar_label', { name: sourceCalendarLabel })"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Calendar :size="14" aria-hidden="true" />
          <span>{{ sourceCalendarLabel }}</span>
        </a>

        <!-- Event title -->
        <h1 class="instance-title">{{ localizedContent(state.instance.event).name }}</h1>

        <!-- Date + time row -->
        <div class="datetime-row">
          <div class="event-date">
            <Calendar :size="16" class="datetime-icon datetime-icon--date" aria-hidden="true" />
            <span>{{ state.instance.start.toLocal().setLocale(i18next.language).toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY) }}</span>
          </div>
          <time :datetime="state.instance.start.toISO()" class="event-datetime">
            <Clock :size="16" class="datetime-icon datetime-icon--time" aria-hidden="true" />
            <span class="event-time-text">
              {{ state.instance.start.toLocal().setLocale(i18next.language).toLocaleString(DateTime.TIME_SIMPLE) }}<template v-if="state.instance.end">
                – {{ state.instance.end.toLocal().setLocale(i18next.language).toLocaleString(
                  isSameDay(state.instance.start, state.instance.end) ? DateTime.TIME_SIMPLE : DateTime.DATETIME_MED
                ) }}</template>
            </span>
          </time>
        </div>

        <!-- Two-column content grid -->
        <div class="detail-grid">
          <!-- Left column: description + categories -->
          <div class="detail-main">
            <h2 class="about-heading">{{ t('about_this_event') }}</h2>
            <p class="event-description">{{ localizedContent(state.instance.event).description }}</p>

            <div v-if="state.instance.event.categories && state.instance.event.categories.length" class="categories-section">
              <h3 class="section-heading">{{ t('event_categories') }}</h3>
              <div class="category-badges">
                <span v-for="category in state.instance.event.categories"
                      :key="category.id"
                      class="event-category-badge"
                >
                  {{ localizedContent(category).name }}
                </span>
              </div>
            </div>
          </div>

          <!-- Right sidebar: location, accessibility, recurrence cards -->
          <aside class="detail-sidebar">
            <!-- Location card -->
            <div v-if="state.instance.event.location" class="sidebar-card event-location">
              <div class="card-header">
                <MapPin :size="16" class="card-icon" aria-hidden="true" />
                <h3 class="card-heading">{{ t('event_location') }}</h3>
              </div>
              <p class="location-name">{{ state.instance.event.location.name }}</p>
              <p v-if="state.instance.event.location.address" class="location-address">
                <a :href="'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([state.instance.event.location.address, state.instance.event.location.city, state.instance.event.location.state].filter(Boolean).join(', '))"
                   target="_blank"
                   rel="noopener"
                   :aria-label="t('get_directions')"
                >
                  {{ state.instance.event.location.address }}
                  <template v-if="state.instance.event.location.city">
                    <br />{{ state.instance.event.location.city }}<template v-if="state.instance.event.location.state">, {{ state.instance.event.location.state }}</template>
                    <template v-if="state.instance.event.location.postalCode">{{ ' ' + state.instance.event.location.postalCode }}</template>
                  </template>
                </a>
              </p>
            </div>

            <!-- Accessibility card -->
            <div v-if="locationAccessibilityInfo" class="sidebar-card accessibility-card">
              <div class="card-header">
                <Accessibility :size="16" class="card-icon" aria-hidden="true" />
                <h3 class="card-heading">{{ t('event_accessibility') }}</h3>
              </div>
              <p class="accessibility-info">{{ locationAccessibilityInfo }}</p>
            </div>

            <!-- Recurrence details card -->
            <div v-if="recurrenceText" class="sidebar-card recurrence-card">
              <div class="card-header">
                <Repeat :size="16" class="card-icon" aria-hidden="true" />
                <h3 class="card-heading">{{ t('event_recurring') }}</h3>
              </div>
              <p class="recurrence-text">{{ recurrenceText }}</p>
            </div>

            <!-- External link CTA -->
            <a
              v-if="safeExternalUrl && safePrompt"
              :href="safeExternalUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="external-link-button"
            >
              {{ t('url_prompt.' + safePrompt) }}
            </a>

            <!-- Add to Calendar -->
            <AddToCalendar :event="state.instance.event" :instance="state.instance" />
          </aside>
        </div>
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
// HERO IMAGE
// ================================================================

.hero-image-wrapper {
  @include public-hero-image;
  margin-bottom: $public-space-2xl;

  :deep(.event-image) {
    width: 100%;
    height: 100%;
    border-radius: 0;
  }
}

// ================================================================
// RECURRENCE BADGE
// ================================================================

.recurrence-badge {
  display: inline-flex;
  align-items: center;
  gap: $public-space-sm;
  padding: $public-space-xs $public-space-md;
  border-radius: $public-radius-full;
  background-color: rgba(255, 255, 255, 0.9);
  color: $public-text-primary-light;
  font-size: $public-font-size-sm;
  font-weight: $public-font-weight-medium;
  margin-bottom: $public-space-md;

  @include public-dark-mode {
    background-color: rgba(30, 30, 35, 0.85);
    color: $public-text-primary-dark;
  }
}

// ================================================================
// SOURCE CALENDAR PILL
// ================================================================

.source-calendar-pill {
  @include public-source-calendar-pill;
  margin-bottom: $public-space-md;
}

// ================================================================
// TITLE
// ================================================================

.instance-title {
  font-size: $public-font-size-2xl;
  font-weight: $public-font-weight-bold;
  letter-spacing: $public-letter-spacing-tight;
  line-height: $public-line-height-tight;
  color: $public-text-primary-light;
  margin: 0 0 $public-space-lg 0;

  @include public-tablet-up {
    font-size: 40px;
  }

  @include public-desktop-up {
    font-size: 48px;
  }

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

// ================================================================
// DATE + TIME ROW
// ================================================================

.datetime-row {
  display: flex;
  flex-wrap: wrap;
  gap: $public-space-sm $public-space-xl;
  margin-bottom: $public-space-2xl;
}

.event-date,
.event-datetime {
  display: inline-flex;
  align-items: center;
  gap: $public-space-sm;
  font-size: $public-font-size-base;
  font-weight: $public-font-weight-medium;
  color: $public-text-secondary-light;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.datetime-icon {
  flex-shrink: 0;

  &--date {
    color: $public-accent-light;

    @include public-dark-mode {
      color: $public-accent-dark;
    }
  }

  &--time {
    color: $public-text-secondary-light;

    @include public-dark-mode {
      color: $public-text-secondary-dark;
    }
  }
}

// ================================================================
// TWO-COLUMN DETAIL GRID
// ================================================================

.detail-grid {
  @include public-detail-grid;
  margin-bottom: $public-space-2xl;
}

// ================================================================
// LEFT COLUMN: DESCRIPTION + CATEGORIES
// ================================================================

.detail-main {
  min-width: 0;
}

.about-heading {
  font-size: $public-font-size-md;
  font-weight: $public-font-weight-semibold;
  color: $public-text-secondary-light;
  margin: 0 0 $public-space-md 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.event-description {
  font-size: $public-font-size-md;
  line-height: $public-line-height-relaxed;
  color: $public-text-primary-light;
  margin: 0 0 $public-space-xl 0;
  white-space: pre-line;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.categories-section {
  margin-top: $public-space-lg;
}

.section-heading {
  font-size: $public-font-size-xs;
  font-weight: $public-font-weight-semibold;
  text-transform: uppercase;
  letter-spacing: $public-letter-spacing-wide;
  color: $public-text-secondary-light;
  margin: 0 0 $public-space-sm 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.category-badges {
  display: flex;
  flex-wrap: wrap;
  gap: $public-space-sm;
}

.event-category-badge {
  @include public-category-badge;

  text-decoration: none;
  cursor: default;
}

// ================================================================
// RIGHT SIDEBAR: INFO CARDS
// ================================================================

.detail-sidebar {
  display: flex;
  flex-direction: column;
  gap: $public-space-lg;
}

.sidebar-card {
  @include public-sidebar-card;
}

.card-header {
  display: flex;
  align-items: center;
  gap: $public-space-sm;
  margin-bottom: $public-space-md;
}

.card-icon {
  color: $public-text-secondary-light;
  flex-shrink: 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.card-heading {
  font-size: $public-font-size-xs;
  font-weight: $public-font-weight-semibold;
  text-transform: uppercase;
  letter-spacing: $public-letter-spacing-wide;
  color: $public-text-secondary-light;
  margin: 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

// Location card
.location-name {
  font-size: $public-font-size-base;
  font-weight: $public-font-weight-medium;
  color: $public-text-primary-light;
  margin: 0 0 $public-space-xs 0;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.location-address {
  font-size: $public-font-size-sm;
  color: $public-text-secondary-light;
  margin: 0;
  line-height: $public-line-height-relaxed;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

// Accessibility card
.accessibility-info {
  font-size: $public-font-size-base;
  color: $public-text-primary-light;
  margin: 0;
  white-space: pre-line;
  line-height: $public-line-height-relaxed;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

// Recurrence card
.recurrence-text {
  font-size: $public-font-size-base;
  color: $public-text-primary-light;
  margin: 0;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

// ================================================================
// EXTERNAL LINK CTA BUTTON
// ================================================================

.external-link-button {
  @include public-button-primary;

  min-height: 44px;
  text-decoration: none;
  text-align: center;

  &:focus-visible {
    @include public-focus-visible;
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
  }
}

.error {
  @include public-error-state;

  margin: $public-space-md 0;
}
</style>
