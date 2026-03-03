<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { MapPin, Repeat } from 'lucide-vue-next';
import EventImage from './EventImage.vue';
import { useLocalizedContent } from '@/site/composables/useLocalizedContent';
import { useLocale } from '@/site/composables/useLocale';
import type CalendarEventInstance from '@/common/model/event_instance';

const props = defineProps<{
  instance: CalendarEventInstance;
  calendarUrlName: string;
}>();

const { t } = useTranslation('system');
const { localizedContent } = useLocalizedContent();
const { localizedPath } = useLocale();

/**
 * Returns the localized event title.
 */
const title = computed(() => {
  return localizedContent(props.instance.event).name;
});

/**
 * Returns the formatted time range string (e.g., "7:00 PM – 10:00 PM").
 * Uses Luxon DateTime.TIME_SIMPLE format.
 */
const timeRange = computed(() => {
  const start = props.instance.start;
  const end = props.instance.end;

  const startStr = start.toLocaleString(DateTime.TIME_SIMPLE);

  if (!end) {
    return startStr;
  }

  const endStr = end.toLocaleString(DateTime.TIME_SIMPLE);
  return `${startStr} – ${endStr}`;
});

/**
 * Returns the event location or null if none is set.
 */
const location = computed(() => {
  return props.instance.event.location ?? null;
});

/**
 * Returns the event description from localized content.
 */
const description = computed(() => {
  return localizedContent(props.instance.event).description ?? '';
});

/**
 * Returns the list of categories assigned to the event.
 */
const categories = computed(() => {
  return props.instance.event.categories ?? [];
});

/**
 * Returns true when the event is recurring (isRecurring set on the API response).
 */
const isRecurring = computed(() => {
  return (props.instance.event as any).isRecurring === true;
});

/**
 * Returns the event media object or null.
 */
const media = computed(() => {
  return props.instance.event.media ?? null;
});

/**
 * Returns the router-link href for the event detail page.
 */
const detailPath = computed(() => {
  const eventId = props.instance.event.id;
  const instanceId = props.instance.id;
  return localizedPath(
    `/view/${props.calendarUrlName}/events/${eventId}/${instanceId}`,
  );
});
</script>

<template>
  <article class="event-card">
    <div class="card-image">
      <EventImage
        :media="media"
        context="card"
        :alt="title"
      />
      <div
        v-if="!media"
        class="no-image-fallback"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          class="fallback-icon"
          aria-hidden="true"
        >
          <rect
            x="3"
            y="4"
            width="18"
            height="18"
            rx="2"
            ry="2"
          />
          <line
            x1="16"
            y1="2"
            x2="16"
            y2="6"
          />
          <line
            x1="8"
            y1="2"
            x2="8"
            y2="6"
          />
          <line
            x1="3"
            y1="10"
            x2="21"
            y2="10"
          />
        </svg>
      </div>
      <span
        v-if="isRecurring"
        class="recurrence-badge"
      >
        <Repeat
          :size="14"
          aria-hidden="true"
        />
        {{ t('event_recurring') }}
      </span>
    </div>

    <div class="event-card-content">
      <p class="event-time">{{ timeRange }}</p>
      <h3>
        <a
          :href="detailPath"
          class="event-title-link"
        >{{ title }}</a>
      </h3>
      <p
        v-if="location"
        class="event-location"
      >
        <MapPin
          :size="16"
          aria-hidden="true"
        />
        {{ location.name }}
      </p>
      <p
        v-if="description"
        class="event-description"
      >{{ description }}</p>
      <div
        v-if="categories.length > 0"
        class="event-categories"
      >
        <span
          v-for="cat in categories"
          :key="cat.id"
          class="category-badge"
        >{{ localizedContent(cat).name }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.event-card {
  @include public-event-card-stacked;

  position: relative;
  background: $public-bg-primary-light;
  border-radius: $public-radius-md;
  box-shadow: $public-shadow-sm-light;
  overflow: hidden;
  text-decoration: none;

  @include public-dark-mode {
    background: $public-bg-primary-dark;
    box-shadow: $public-shadow-sm-dark;
  }
}

// ================================================================
// IMAGE AREA
// ================================================================

.card-image {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  background: $public-bg-tertiary-light;

  @include public-dark-mode {
    background: $public-bg-tertiary-dark;
  }
}

.no-image-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, $public-bg-secondary-light 0%, $public-bg-tertiary-light 100%);

  @include public-dark-mode {
    background: linear-gradient(135deg, $public-bg-secondary-dark 0%, $public-bg-tertiary-dark 100%);
  }
}

.fallback-icon {
  width: 2.5rem;
  height: 2.5rem;
  color: $public-text-tertiary-light;

  @include public-dark-mode {
    color: $public-text-tertiary-dark;
  }
}

// ================================================================
// RECURRENCE BADGE
// ================================================================

.recurrence-badge {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.625rem;
  border-radius: $public-radius-full;
  font-size: $public-font-size-xs;
  font-weight: $public-font-weight-medium;
  background: rgba(255, 255, 255, 0.9);
  color: $public-text-primary-light;
  backdrop-filter: blur(4px);
  white-space: nowrap;

  @include public-dark-mode {
    background: rgba(30, 30, 35, 0.85);
    color: $public-text-primary-dark;
  }
}

// ================================================================
// CONTENT AREA
// ================================================================

.event-card-content {
  flex: 1;
  padding: $public-space-lg;
  display: flex;
  flex-direction: column;
  gap: $public-space-sm;
  min-width: 0;
}

.event-time {
  font-size: $public-font-size-sm;
  font-weight: $public-font-weight-medium;
  color: $public-accent-light;
  margin: 0;

  @include public-dark-mode {
    color: $public-accent-dark;
  }
}

h3 {
  margin: 0;
  font-size: $public-font-size-md;
  font-weight: $public-font-weight-semibold;
  line-height: $public-line-height-tight;
}

.event-title-link {
  color: $public-text-primary-light;
  text-decoration: none;
  transition: color $public-duration-fast $public-ease-out;

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

.event-location {
  display: flex;
  align-items: center;
  gap: $public-space-1;
  font-size: $public-font-size-sm;
  color: $public-text-secondary-light;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.event-description {
  font-size: $public-font-size-base;
  color: $public-text-secondary-light;
  margin: 0;
  line-height: $public-line-height-normal;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: pre-wrap;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

// ================================================================
// CATEGORY BADGES
// ================================================================

.event-categories {
  display: flex;
  flex-wrap: wrap;
  gap: $public-space-sm;
}

.category-badge {
  @include public-category-badge;
}
</style>
