<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import i18next from 'i18next';
import { Calendar, CalendarX, Clock, Repeat, MapPin, Accessibility } from 'lucide-vue-next';

import { useLocalizedContent } from '@/site/composables/useLocalizedContent';
import { useRecurrenceText } from '@/site/composables/useRecurrenceText';
import EventImage from '@/site/components/event-image.vue';
import AddToCalendar from '@/site/components/add-to-calendar.vue';
import { URL_PROMPT_VALUES, type UrlPrompt } from '@/common/model/events';
import type CalendarEventInstance from '@/common/model/event_instance';
import type { Calendar as CalendarModel } from '@/common/model/calendar';
import type { EventCategory } from '@/common/model/event_category';

const props = defineProps<{
  instance: CalendarEventInstance;
  calendar: CalendarModel;
  categoryHrefBuilder?: (category: EventCategory) => string;
}>();

const { t } = useTranslation('system');
const { localizedContent, spaceDisplayName, spaceAccessibilityInfo: spaceAccessibilityInfoFor } = useLocalizedContent();

/**
 * Returns true when start and end fall on the same calendar day.
 */
function isSameDay(start: DateTime, end: DateTime): boolean {
  return start.hasSame(end, 'day');
}

/**
 * Computed human-readable recurrence text derived from the public API's
 * `recurrenceSummary: { key, params }` intent shape.
 */
const recurrenceText = useRecurrenceText(
  () => props.instance?.event?.recurrenceSummary ?? null,
);

/**
 * Computed event-level accessibility info from event content.
 */
const eventAccessibilityInfo = computed(() => {
  if (!props.instance?.event) return '';
  const content = localizedContent(props.instance.event);
  return content?.accessibilityInfo ?? '';
});

/**
 * Computed localized accessibility info for the venue (Place).
 * Handles both EventLocation models (TranslatedModel) and plain objects.
 */
const venueAccessibilityInfo = computed(() => {
  const location = props.instance?.event?.location;
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
const spaceAccessibilityInfo = computed(() => spaceAccessibilityInfoFor(props.instance?.event?.space));

/**
 * Computed display label for the location header line. When a Space is set
 * with a non-empty name, returns "Place — Space" via the i18n format key;
 * otherwise returns the Place name alone.
 */
const locationDisplayName = computed(() => {
  const placeName = props.instance?.event?.location?.name ?? '';
  const space = spaceDisplayName(props.instance?.event?.space);
  if (space) {
    return t('place.format.with_space', { place: placeName, space });
  }
  return placeName;
});

/**
 * Whether to show the accessibility card. Visible when either the venue or
 * Space has localized accessibility content; hidden when both are empty.
 */
const hasAccessibilityInfo = computed(() => {
  return !!(venueAccessibilityInfo.value || spaceAccessibilityInfo.value);
});

/**
 * Returns the source calendar metadata for reposted events, or null.
 */
const sourceCalendar = computed(() => {
  return props.instance?.event?.sourceCalendar ?? null;
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
 * Returns true when this specific occurrence has been cancelled by the calendar owner.
 */
const isCancelled = computed(() => {
  return props.instance?.isCancelled === true;
});

/**
 * Defense-in-depth safe external URL computed.
 * Returns the URL only if its protocol is http: or https:, else null.
 * Guards against javascript:, data:, and other unsafe schemes even if
 * the service-layer validator is bypassed or misconfigured.
 */
const safeExternalUrl = computed<string | null>(() => {
  const raw = props.instance?.event?.externalUrl;
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
  const raw = props.instance?.event?.urlPrompt;
  if (raw == null) return null;
  return URL_PROMPT_VALUES.includes(raw as UrlPrompt) ? (raw as UrlPrompt) : null;
});
</script>

<template>
  <!-- Hero image -->
  <div v-if="instance.event.media" class="hero-image-wrapper">
    <EventImage
      :media="instance.event.media"
      context="feature"
      :alt="localizedContent(instance.event).name"
      :focal-point-x="instance.event.mediaFocalPointX"
      :focal-point-y="instance.event.mediaFocalPointY"
      :zoom="instance.event.mediaZoom"
    />
  </div>

  <!-- Cancelled badge -->
  <div v-if="isCancelled" class="cancelled-badge" role="status">
    <CalendarX :size="14" aria-hidden="true" />
    <span>{{ t('event_cancelled') }}</span>
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
    :target="isRemoteSourceCalendar ? '_blank' : undefined"
    :rel="isRemoteSourceCalendar ? 'noopener noreferrer' : undefined"
  >
    <Calendar :size="14" aria-hidden="true" />
    <span>{{ sourceCalendarLabel }}</span>
  </a>

  <!-- Event title -->
  <h1 class="instance-title">{{ localizedContent(instance.event).name }}</h1>

  <!-- Date + time row -->
  <div class="datetime-row">
    <time :datetime="instance.start.toISODate()" class="event-date">
      <Calendar :size="16" class="datetime-icon datetime-icon--date" aria-hidden="true" />
      <span>{{ instance.start.toLocal().setLocale(i18next.language).toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY) }}</span>
    </time>
    <time :datetime="instance.start.toISO()" class="event-datetime">
      <Clock :size="16" class="datetime-icon datetime-icon--time" aria-hidden="true" />
      <span class="event-time-text">
        {{ instance.start.toLocal().setLocale(i18next.language).toLocaleString(DateTime.TIME_SIMPLE) }}<template v-if="instance.end">
          – {{ instance.end.toLocal().setLocale(i18next.language).toLocaleString(
            isSameDay(instance.start, instance.end) ? DateTime.TIME_SIMPLE : DateTime.DATETIME_MED
          ) }}</template>
      </span>
    </time>
  </div>

  <!-- Two-column content grid -->
  <div class="detail-grid">
    <!-- Left column: description + categories -->
    <div class="detail-main">
      <h2 class="about-heading">{{ t('about_this_event') }}</h2>
      <p class="event-description">{{ localizedContent(instance.event).description }}</p>

      <!-- Categories section -->
      <div v-if="instance.event.categories && instance.event.categories.length" class="categories-section">
        <h3 class="section-heading">{{ t('event_categories') }}</h3>
        <div class="category-badges">
          <template v-for="category in instance.event.categories" :key="category.id">
            <a
              v-if="categoryHrefBuilder"
              :href="categoryHrefBuilder(category)"
              class="event-category-badge"
            >
              {{ localizedContent(category).name }}
            </a>
            <span
              v-else
              class="event-category-badge"
            >
              {{ localizedContent(category).name }}
            </span>
          </template>
        </div>
      </div>
    </div>

    <!-- Right sidebar: location, accessibility, recurrence cards -->
    <aside class="detail-sidebar" :aria-label="t('event_details_sidebar')">
      <!-- Location card -->
      <div v-if="instance.event.location" class="sidebar-card event-location">
        <div class="card-header">
          <MapPin :size="16" class="card-icon" aria-hidden="true" />
          <h3 class="card-heading">{{ t('event_location') }}</h3>
        </div>
        <p class="location-name">{{ locationDisplayName }}</p>
        <p v-if="instance.event.location.address" class="location-address">
          <a :href="'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([instance.event.location.address, instance.event.location.city, instance.event.location.state].filter(Boolean).join(', '))"
             target="_blank"
             rel="noopener"
             :aria-label="t('get_directions')"
          >
            {{ instance.event.location.address }}
            <template v-if="instance.event.location.city">
              <br />{{ instance.event.location.city }}<template v-if="instance.event.location.state">, {{ instance.event.location.state }}</template>
              <template v-if="instance.event.location.postalCode">{{ ' ' + instance.event.location.postalCode }}</template>
            </template>
          </a>
        </p>
      </div>

      <!-- Accessibility card: layered Venue (Place) + Space subsections.
           Whole card hidden when both subsections are empty; each subsection
           hidden independently when its source has no localized content. -->
      <div v-if="hasAccessibilityInfo" class="sidebar-card accessibility-card">
        <div class="card-header">
          <Accessibility :size="16" class="card-icon" aria-hidden="true" />
          <h3 class="card-heading">{{ t('event_accessibility') }}</h3>
        </div>
        <div v-if="venueAccessibilityInfo" class="accessibility-section accessibility-section--venue">
          <h4 class="accessibility-subheading">{{ t('place.space.venue_accessibility_label') }}</h4>
          <p class="accessibility-info">{{ venueAccessibilityInfo }}</p>
        </div>
        <div v-if="spaceAccessibilityInfo" class="accessibility-section accessibility-section--space">
          <h4 class="accessibility-subheading">{{ t('place.space.space_accessibility_label') }}</h4>
          <p class="accessibility-info">{{ spaceAccessibilityInfo }}</p>
        </div>
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
        {{ t('url_prompt.' + safePrompt) }}<span class="sr-only">, {{ t('opens_in_new_tab') }}</span>
      </a>

      <!-- Add to Calendar -->
      <AddToCalendar :event="instance.event" :instance="instance" />
    </aside>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

// ================================================================
// EVENT DETAIL BODY
// ================================================================
// Shared body content for site event-instance and widget overlay.
// Two-column layout with sidebar info cards for location,
// accessibility, and recurrence. Responsive: single column on
// mobile/tablet, two-column grid on desktop (>= 1024px).
// ================================================================

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

  @include public-light-mode-override {
    background-color: rgba(255, 255, 255, 0.9);
    color: $public-text-primary-light;
  }
}

// ================================================================
// CANCELLED BADGE
// ================================================================

.cancelled-badge {
  display: inline-flex;
  align-items: center;
  gap: $public-space-sm;
  padding: $public-space-xs $public-space-md;
  border-radius: $public-radius-full;
  background-color: $public-error-light;
  color: #fff;
  font-size: $public-font-size-sm;
  font-weight: $public-font-weight-semibold;
  text-transform: uppercase;
  letter-spacing: $public-letter-spacing-wide;
  margin-bottom: $public-space-md;
  margin-right: $public-space-sm;

  @include public-dark-mode {
    background-color: $public-error-dark;
    color: $public-bg-primary-dark;
  }

  @include public-light-mode-override {
    background-color: $public-error-light;
    color: #fff;
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

  @include public-light-mode-override {
    color: $public-text-primary-light;
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

  @include public-light-mode-override {
    color: $public-text-secondary-light;
  }
}

.datetime-icon {
  flex-shrink: 0;

  &--date {
    color: var(--pav-accent-light);

    @include public-dark-mode {
      color: var(--pav-accent-dark);
    }

    @include public-light-mode-override {
      color: var(--pav-accent-light);
    }
  }

  &--time {
    color: $public-text-secondary-light;

    @include public-dark-mode {
      color: $public-text-secondary-dark;
    }

    @include public-light-mode-override {
      color: $public-text-secondary-light;
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
  min-width: 0; // Prevent grid blowout
}

.about-heading {
  font-size: $public-font-size-md;
  font-weight: $public-font-weight-semibold;
  color: $public-text-secondary-light;
  margin: 0 0 $public-space-md 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }

  @include public-light-mode-override {
    color: $public-text-secondary-light;
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

  @include public-light-mode-override {
    color: $public-text-primary-light;
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

  @include public-light-mode-override {
    color: $public-text-secondary-light;
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

  // When rendered as <a> (categoryHrefBuilder provided), enable hover affordances.
  // When rendered as <span> (no builder), hover styles still apply but cursor stays default.
  &:is(a):hover {
    background-color: $public-accent-hover-light;
    transform: translateY(-1px);

    @include public-dark-mode {
      background-color: $public-accent-hover-dark;
    }

    @include public-light-mode-override {
      background-color: $public-accent-hover-light;
    }
  }

  &:is(span) {
    cursor: default;
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

  @include public-light-mode-override {
    color: $public-text-secondary-light;
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

  @include public-light-mode-override {
    color: $public-text-secondary-light;
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

  @include public-light-mode-override {
    color: $public-text-primary-light;
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

  @include public-light-mode-override {
    color: $public-text-secondary-light;
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

  @include public-light-mode-override {
    color: $public-text-secondary-light;
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

  @include public-light-mode-override {
    color: $public-text-primary-light;
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

  @include public-light-mode-override {
    color: $public-text-primary-light;
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
// SCREEN READER ONLY UTILITY
// ================================================================

.sr-only {
  @include public-sr-only;
}
</style>
