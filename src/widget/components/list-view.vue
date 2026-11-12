<script setup lang="ts">
import { computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { DateTime } from 'luxon';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import EventCard from '@/site/components/event-card.vue';
import { formatInstanceSlug } from '@/common/utils/instance-slug';
import type CalendarEventInstance from '@/common/model/event_instance';
import EmptyState from '@/common/ui/components/EmptyState.vue';
import { useLocale } from '@/common/ui/composables/useLocale';
import { getDefaultDateRange } from '@/common/utils/datePresets';
import { stickyQuery } from '../sticky-query';

const props = defineProps<{
  /** Widget-router location for a single day's list, supplied by the container. */
  dayRoute: (isoDate: string) => RouteLocationRaw;
}>();

const { t } = useTranslation('system');
const route = useRoute();
const router = useRouter();
const publicStore = usePublicCalendarStore();
const { currentLocale } = useLocale();

// Events are loaded by WidgetContainer/SearchFilterPublic; this component
// just displays them via the day-grouped EventCard list pattern shared
// with the site (src/site/components/calendar.vue).
const filteredEventsByDay = computed(() => publicStore.getFilteredEventsByDay);
const defaultEventImage = computed(() => publicStore.defaultEventImage);

// The calendar this list is rendered for. Read from the route rather than the
// widget store: the router guard switches the store's calendar before a
// cross-calendar navigation resolves, while this list still shows the old one.
const calendarUrlName = computed(() => route.params.urlName as string);

// The end of the window an unfiltered list searched, named in the empty state
const defaultRangeEndLabel = computed(() => {
  const { endDate } = getDefaultDateRange(publicStore.calendarDefaultDateRange);
  return formatDate(endDate);
});
const nextEventLabel = computed(() =>
  publicStore.nextEventDate ? formatDate(publicStore.nextEventDate) : '');

function formatDate(isoDate: string): string {
  return DateTime.fromISO(isoDate).setLocale(currentLocale.value).toLocaleString(DateTime.DATE_FULL);
}

// An unfiltered list whose default window is empty may still have a later
// event; look it up once per such load so the empty state can offer it.
watch(
  () => publicStore.hasLoadedEvents
    && !publicStore.isLoadingEvents
    && publicStore.allEvents.length === 0
    && !publicStore.hasActiveFilters
    && !publicStore.isSearchPending
    && !publicStore.eventError,
  (shouldLookUp) => {
    if (shouldLookUp) {
      publicStore.loadNextEventDate();
    }
  },
  { immediate: true },
);

/**
 * Builds the widget-router-resolved href for an event instance.
 * EventCard receives this via its detailHref prop, renders it as the title
 * anchor's href, and intercepts a plain click on that anchor to push it
 * through the router it is mounted under — here, the widget router — so the
 * list view needs no openEvent handler of its own.
 *
 * The href carries the sticky display keys (see ../sticky-query), so the
 * detail opened in a new tab or reloaded keeps the list's theme and language.
 */
const buildDetailHref = (instance: CalendarEventInstance): string => {
  return router.resolve({
    name: 'widget-event-detail',
    params: {
      urlName: calendarUrlName.value,
      eventId: instance.event.id,
      startTime: formatInstanceSlug(instance.start),
    },
    query: stickyQuery(route.query),
  }).href;
};
</script>

<template>
  <div class="list-view">
    <!-- Events Display -->
    <!-- Busy while a refresh replaces these results; the status below stays
         outside so the busy region cannot silence it. -->
    <div
      v-if="Object.keys(filteredEventsByDay).length > 0"
      class="events-container"
      :aria-busy="publicStore.isLoadingEvents"
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
              :calendar-url-name="calendarUrlName"
              :calendar="publicStore.currentCalendar"
              :default-image="defaultEventImage"
              :detail-href="buildDetailHref(instance)"
            />
          </li>
        </ul>
      </section>
    </div>

    <!-- Empty State: suppress when search is pending (1-2 chars typed) to avoid conflicting messages -->
    <EmptyState
      v-else-if="!publicStore.isLoadingEvents && !publicStore.isSearchPending"
    >
      <p v-if="publicStore.hasActiveFilters">
        {{ t('no_events_with_filters') }}
      </p>
      <template v-else>
        <p>{{ t('no_events_available') }}</p>
        <p>{{ t('no_events_in_default_range_hint', { date: defaultRangeEndLabel }) }}</p>
        <p v-if="publicStore.nextEventDate">
          <RouterLink
            class="next-event-link"
            :to="props.dayRoute(publicStore.nextEventDate)"
          >
            {{ t('next_event_link', { date: nextEventLabel }) }}
          </RouterLink>
        </p>
      </template>
    </EmptyState>

    <!-- Loading State: always in the DOM so assistive tech has a live region
         to watch before loading begins. -->
    <div
      class="loading"
      :class="{ 'is-idle': !publicStore.isLoadingEvents }"
      role="status"
    >
      {{ publicStore.isLoadingEvents ? t('loading_events') : '' }}
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/common/ui/assets/mixins' as *;

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
// fallback) and reads the same --pav-* tokens, which .widget-root
// declares with the owner's configured accent.
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
  color: var(--pav-text-secondary);
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

.next-event-link {
  color: var(--pav-accent);

  &:focus-visible {
    @include public-focus-visible;
  }
}

// Loading and error states
.loading {
  @include public-loading-state;

  &.is-idle {
    padding: 0;
  }
}
</style>
