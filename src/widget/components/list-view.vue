<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRouter } from 'vue-router';
import { DateTime } from 'luxon';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { useWidgetStore } from '../stores/widgetStore';
import EventCard from '@/site/components/event-card.vue';
import { formatInstanceSlug } from '@/common/utils/instance-slug';
import type CalendarEventInstance from '@/common/model/event_instance';

const { t } = useTranslation('system');
const router = useRouter();
const publicStore = usePublicCalendarStore();
const widgetStore = useWidgetStore();

// Events are loaded by WidgetContainer/SearchFilterPublic; this component
// just displays them via the day-grouped EventCard list pattern shared
// with the site (src/site/components/calendar.vue).
const filteredEventsByDay = computed(() => publicStore.getFilteredEventsByDay);
const defaultEventImage = computed(() => publicStore.defaultEventImage);

/**
 * Builds the widget-router-resolved href for an event instance.
 * EventCard receives this via its detailHref prop and renders it
 * as an anchor href, so navigation flows through the widget router
 * (no openEvent click handler needed on the list view).
 */
const buildDetailHref = (instance: CalendarEventInstance): string => {
  return router.resolve({
    name: 'widget-event-detail',
    params: {
      urlName: widgetStore.calendarUrlName!,
      eventId: instance.event.id,
      startTime: formatInstanceSlug(instance.start),
    },
  }).href;
};
</script>

<template>
  <div class="list-view">
    <!-- Events Display -->
    <div
      v-if="Object.keys(filteredEventsByDay).length > 0"
      class="events-container"
    >
      <section
        v-for="day in Object.keys(filteredEventsByDay).sort()"
        :key="day"
        class="day"
      >
        <h2 class="day-heading">
          {{ DateTime.fromISO(day).toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' }) }}
        </h2>
        <ul class="day-events">
          <li
            v-for="instance in filteredEventsByDay[day]"
            :key="instance.id"
            class="day-event-item"
          >
            <EventCard
              :instance="instance"
              :calendar-url-name="widgetStore.calendarUrlName!"
              :default-image="defaultEventImage"
              :detail-href="buildDetailHref(instance)"
            />
          </li>
        </ul>
      </section>
    </div>

    <!-- Empty State: suppress when search is pending (1-2 chars typed) to avoid conflicting messages -->
    <div
      v-else-if="!publicStore.isLoadingEvents && !publicStore.isSearchPending"
      class="empty-state"
    >
      <p v-if="publicStore.hasActiveFilters">
        {{ t('no_events_with_filters') }}
      </p>
      <p v-else>
        {{ t('no_events_available') }}
      </p>
    </div>

    <!-- Loading State -->
    <div
      v-if="publicStore.isLoadingEvents"
      class="loading"
      role="status"
      aria-live="polite"
    >
      {{ t('loading_events') }}
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

.list-view {
  flex: 1;
  overflow-y: auto;
  padding: $public-space-md;
}

// ================================================================
// EVENTS DISPLAY (mirrors site/components/calendar.vue)
// ================================================================
// Day-grouped vertical list of EventCards. The widget reuses the
// site's EventCard component directly so it shares all card content
// (image, title, time, location, description, categories,
// source-calendar pill, recurrence/cancelled badges, no-image
// fallback) and benefits from the same dark/light pairing audit.
// ================================================================

.events-container {
  display: flex;
  flex-direction: column;
  gap: $public-space-2xl;
}

.day {
  // No extra margin needed; events-container gap handles spacing
}

.day-heading {
  @include public-sticky-date-heading;

  padding: $public-space-sm 0;
  margin: 0 0 $public-space-lg 0;
  color: $public-text-secondary-light;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }

  @include public-light-mode-override {
    color: $public-text-secondary-light;
  }
}

.day-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: $public-space-lg;
}

.day-event-item {
  // No extra styles needed; EventCard handles its own layout
}

// Loading and error states
.loading {
  @include public-loading-state;
}

.empty-state {
  @include public-empty-state;
}
</style>
