<script setup lang="ts">
import { reactive, onBeforeMount, ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, Calendar, MapPin, Accessibility } from 'lucide-vue-next';

import CalendarService from '../service/calendar';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import NotFound from './not-found.vue';
import EventImage from './event-image.vue';
import ReportEvent from './report-event.vue';
import { useLocale } from '@/site/composables/useLocale';
import AddToCalendar from './add-to-calendar.vue';
import { URL_PROMPT_VALUES, type UrlPrompt } from '@/common/model/events';

const { t } = useTranslation('system');
const route = useRoute();
const { localizedPath } = useLocale();
const calendarId = route.params.calendar;
const eventId = route.params.event;
const showReportModal = ref(false);
const { localizedContent, spaceDisplayName, spaceAccessibilityInfo: spaceAccessibilityInfoFor } = useLocalizedContent();
const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  event: null,
  isLoading: false,
});
const calendarService = new CalendarService();

/**
 * Computed event-level accessibility info from event content.
 */
const eventAccessibilityInfo = computed(() => {
  if (!state.event) return '';
  const content = localizedContent(state.event);
  return content?.accessibilityInfo ?? '';
});

/**
 * Computed localized accessibility info for the venue (Place).
 * Handles both EventLocation models (TranslatedModel) and plain objects.
 */
const venueAccessibilityInfo = computed(() => {
  const location = state.event?.location;
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

/**
 * Computed localized accessibility info for the Space (sub-area within a Place).
 * Returns empty string when no Space is attached to the event.
 */
const spaceAccessibilityInfo = computed(() => spaceAccessibilityInfoFor(state.event?.space));

/**
 * Computed display label for the location header line. When a Space is set
 * with a non-empty name, returns "Place — Space" via the i18n format key;
 * otherwise returns the Place name alone.
 */
const locationDisplayName = computed(() => {
  const placeName = state.event?.location?.name ?? '';
  const space = spaceDisplayName(state.event?.space);
  if (space) {
    return t('place.format.with_space', { place: placeName, space });
  }
  return placeName;
});

/**
 * Whether to show the accessibility card. Visible when the event, venue, or
 * Space has localized accessibility content; hidden when all three are empty.
 */
const hasAccessibilityInfo = computed(() => {
  return !!(eventAccessibilityInfo.value || venueAccessibilityInfo.value || spaceAccessibilityInfo.value);
});

/**
 * Returns the source calendar metadata for reposted events, or null.
 */
const sourceCalendar = computed(() => {
  return state.event?.sourceCalendar ?? null;
});

/**
 * Returns the display label for the source calendar pill (urlName@host).
 */
const sourceCalendarLabel = computed(() => {
  if (!sourceCalendar.value) return '';
  return `${sourceCalendar.value.urlName}@${sourceCalendar.value.host}`;
});

/**
 * Returns true when the source calendar URL is a remote (external) link.
 */
const isRemoteSourceCalendar = computed(() => {
  if (!sourceCalendar.value) return false;
  return sourceCalendar.value.url.startsWith('http');
});

/**
 * Defense-in-depth safe external URL computed.
 * Returns the URL only if its protocol is http: or https:, else null.
 * Guards against javascript:, data:, and other unsafe schemes even if
 * the service-layer validator is bypassed or misconfigured.
 */
const safeExternalUrl = computed<string | null>(() => {
  const raw = state.event?.externalUrl;
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
  const raw = state.event?.urlPrompt;
  if (raw == null) return null;
  return URL_PROMPT_VALUES.includes(raw as UrlPrompt) ? (raw as UrlPrompt) : null;
});

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
      state.event = await calendarService.loadEvent(eventId, state.calendar.urlName);
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
  <div
    v-else-if="state.isLoading"
    role="status"
    class="loading"
  >
    {{ t('loading_events') }}
  </div>
  <div v-else-if="state.event">
    <!-- Back link header -->
    <header v-if="state.calendar" class="event-back-header">
      <p class="breadcrumb">
        <a :href="localizedPath('/view/' + state.calendar.urlName)"
           class="back-link"
        >
          <ArrowLeft :size="16" class="back-arrow" aria-hidden="true" />
          {{ t('back_to_calendar', { name: localizedContent(state.calendar).name || state.calendar.urlName }) }}
        </a>
      </p>
    </header>

    <main class="event-main" :aria-busy="state.isLoading">
      <div v-if="state.err" role="alert" class="error">{{ state.err }}</div>

      <!-- Hero image -->
      <div v-if="state.event.media" class="hero-image-wrapper">
        <EventImage
          :media="state.event.media"
          context="feature"
          :alt="localizedContent(state.event).name"
          :focal-point-x="state.event.mediaFocalPointX"
          :focal-point-y="state.event.mediaFocalPointY"
          :zoom="state.event.mediaZoom"
        />
      </div>

      <!-- Source calendar pill -->
      <a
        v-if="sourceCalendar"
        :href="sourceCalendar.url"
        class="source-calendar-pill"
        :aria-label="t('event_source_calendar_label', { name: sourceCalendarLabel })"
        :target="isRemoteSourceCalendar ? '_blank' : undefined"
        :rel="isRemoteSourceCalendar ? 'noopener noreferrer' : undefined"
      >
        <Calendar :size="14" aria-hidden="true" />
        <span>{{ sourceCalendarLabel }}</span>
      </a>

      <!-- Event title -->
      <h1 class="event-title">{{ localizedContent(state.event).name }}</h1>

      <!-- Two-column content grid -->
      <div class="detail-grid">
        <!-- Left column: description + categories -->
        <div class="detail-main">
          <h2 class="about-heading">{{ t('about_this_event') }}</h2>
          <p class="event-description">{{ localizedContent(state.event).description }}</p>

          <!-- Categories section -->
          <div v-if="state.event.categories && state.event.categories.length" class="categories-section">
            <h3 class="section-heading">{{ t('event_categories') }}</h3>
            <div class="category-badges">
              <a v-for="category in state.event.categories"
                 :key="category.id"
                 class="event-category-badge"
                 :href="localizedPath('/view/' + state.calendar.urlName) + '?categories=' + category.id"
              >
                {{ localizedContent(category).name }}
              </a>
            </div>
          </div>
        </div>

        <!-- Right sidebar: location and accessibility cards -->
        <aside class="detail-sidebar">
          <!-- Location card -->
          <div v-if="state.event.location" class="sidebar-card event-location">
            <div class="card-header">
              <MapPin :size="16" class="card-icon" aria-hidden="true" />
              <h3 class="card-heading">{{ t('event_location') }}</h3>
            </div>
            <p class="location-name">{{ locationDisplayName }}</p>
            <p v-if="state.event.location.address" class="location-address">
              <a :href="'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([state.event.location.address, state.event.location.city, state.event.location.state].filter(Boolean).join(', '))"
                 target="_blank"
                 rel="noopener"
                 :aria-label="t('get_directions')"
              >
                {{ state.event.location.address }}
                <template v-if="state.event.location.city">
                  <br />{{ state.event.location.city }}<template v-if="state.event.location.state">, {{ state.event.location.state }}</template>
                  <template v-if="state.event.location.postalCode">{{ ' ' + state.event.location.postalCode }}</template>
                </template>
              </a>
            </p>
          </div>

          <!-- Accessibility card: layered Event + Venue (Place) + Space subsections.
               Whole card hidden when all three subsections are empty; each subsection
               hidden independently when its source has no localized content. -->
          <div v-if="hasAccessibilityInfo" class="sidebar-card accessibility-card">
            <div class="card-header">
              <Accessibility :size="16" class="card-icon" aria-hidden="true" />
              <h3 class="card-heading">{{ t('accessibility.section_heading') }}</h3>
            </div>
            <div v-if="eventAccessibilityInfo" class="accessibility-section accessibility-section--event">
              <h4 class="accessibility-subheading">{{ t('accessibility.event_label') }}</h4>
              <p class="accessibility-info">{{ eventAccessibilityInfo }}</p>
            </div>
            <div v-if="venueAccessibilityInfo" class="accessibility-section accessibility-section--venue">
              <h4 class="accessibility-subheading">{{ t('accessibility.venue_label') }}</h4>
              <p class="accessibility-info">{{ venueAccessibilityInfo }}</p>
            </div>
            <div v-if="spaceAccessibilityInfo" class="accessibility-section accessibility-section--space">
              <h4 class="accessibility-subheading">{{ t('accessibility.space_label') }}</h4>
              <p class="accessibility-info">{{ spaceAccessibilityInfo }}</p>
            </div>
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
          <AddToCalendar v-if="state.event.schedules?.length" :event="state.event" />
        </aside>
      </div>

      <!-- Footer: series link + report button -->
      <footer>
        <div
          v-if="state.event.series"
          class="series-link-wrapper"
        >
          <span class="series-label">{{ t('series.label') }}</span>
          <a
            :href="localizedPath('/view/' + state.calendar.urlName + '/series/' + state.event.series.urlName)"
            class="event-series-link"
            :aria-label="t('series.part_of', { name: localizedContent(state.event.series).name })"
          >{{ localizedContent(state.event.series).name }}</a>
        </div>
        <button
          type="button"
          class="report-link"
          @click="openReportModal"
        >{{ t('report.link_text') }}</button>
      </footer>
    </main>

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
// Two-column layout with sidebar info cards for location and
// accessibility. Responsive: single column on mobile/tablet,
// two-column grid on desktop (>= 1024px).
// No date/time section — non-instance events have no specific dates.
// ================================================================

// ================================================================
// BACK HEADER
// ================================================================

.event-back-header {
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
// MAIN CONTENT
// ================================================================

.event-main {
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
// HERO IMAGE
// ================================================================

.hero-image-wrapper {
  @include public-hero-image;
  margin-bottom: $public-space-2xl;

  // Override to let EventImage fill container
  :deep(.event-image) {
    width: 100%;
    height: 100%;
    border-radius: 0;
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

.event-title {
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
  min-width: 0; // Prevent grid blowout
}

.sr-only {
  @include public-sr-only;
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
  transition: $public-transition-fast;

  &:hover {
    background-color: $public-accent-hover-light;
    transform: translateY(-1px);

    @include public-dark-mode {
      background-color: $public-accent-hover-dark;
    }
  }

  &:focus-visible {
    @include public-focus-visible;
  }
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

// Accessibility card — layered Venue (Place) + Space subsections.
// Each `.accessibility-section` is an independently hidden labeled block;
// adjacent sections are spaced via the sibling combinator so the spacing
// rule survives any combination of present/absent subsections.
.accessibility-section + .accessibility-section {
  margin-top: $public-space-md;
}

.accessibility-subheading {
  font-size: $public-font-size-sm;
  font-weight: $public-font-weight-semibold;
  color: $public-text-secondary-light;
  margin: 0 0 $public-space-xs 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

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
// FOOTER: SERIES LINK + REPORT BUTTON
// ================================================================

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

.loading {
  @include public-loading-state;
}

.error {
  @include public-error-state;
  margin-bottom: $public-space-lg;
}
</style>
