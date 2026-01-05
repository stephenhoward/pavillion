<script setup lang="ts">
import { computed, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRouter } from 'vue-router';
import { DateTime } from 'luxon';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { useWidgetStore } from '../stores/widgetStore';
import EventImage from '@/site/components/EventImage.vue';

const { t } = useTranslation('system');
const router = useRouter();
const publicStore = usePublicCalendarStore();
const widgetStore = useWidgetStore();

// Computed properties for store data
const filteredEventsByDay = computed(() => publicStore.getFilteredEventsByDay);

const openEvent = (instance: any) => {
  router.push({
    name: 'widget-event-detail',
    params: {
      urlName: widgetStore.calendarUrlName!,
      eventId: instance.event.id,
    },
  });
};

onBeforeMount(() => {
  // Events are loaded by WidgetContainer/SearchFilterPublic
  // This component just displays them
});
</script>

<template>
  <div class="list-view">
    <!-- Events Display -->
    <div v-if="Object.keys(filteredEventsByDay).length > 0">
      <section class="day" v-for="day in Object.keys(filteredEventsByDay).sort()" :key="day">
        <h2>{{ DateTime.fromISO(day).toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' }) }}</h2>
        <ul class="events">
          <li class="event"
              v-for="instance in filteredEventsByDay[day]"
              :key="instance.id"
              @click="openEvent(instance)">
            <EventImage :media="instance.event.media" context="card" :lazy="true" />
            <h3>{{ instance.event.content("en").name }}</h3>
            <div class="event-time">{{ instance.start.toLocaleString(DateTime.TIME_SIMPLE) }}</div>
          </li>
        </ul>
      </section>
    </div>

    <!-- Empty State -->
    <div v-else-if="!publicStore.isLoadingEvents" class="empty-state">
      <p v-if="publicStore.hasActiveFilters">
        {{ t('no_events_with_filters') }}
      </p>
      <p v-else>
        {{ t('no_events_available') }}
      </p>
    </div>

    <!-- Loading State -->
    <div v-if="publicStore.isLoadingEvents" class="loading">
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
// EVENTS DISPLAY (adapted from site calendar.vue)
// ================================================================
// A horizontally scrollable list of event cards.
// Cards adapt gracefully whether they have images or not.
// Optimized for iframe context.
// ================================================================

section.day {
  margin: $public-space-lg 0;

  h2 {
    font-size: $public-font-size-sm;
    margin: 0;
    padding: 0;
    font-weight: $public-font-weight-semibold;
    text-transform: uppercase;
    letter-spacing: $public-letter-spacing-wide;
    color: $public-text-secondary-light;

    @include public-dark-mode {
      color: $public-text-secondary-dark;
    }
  }

  ul.events {
    @include public-horizontal-scroll;

    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: stretch;
    padding: $public-space-md 0 $public-space-xl 0;
    gap: $public-space-md;

    li.event {
      @include public-event-card-compact;

      list-style-type: none;
      margin-right: 0;
      position: relative;
      cursor: pointer;

      // ============================================================
      // CONTENT-FIRST CARD DESIGN
      // ============================================================
      // When no image is present, the card becomes a refined
      // text-focused card with a subtle accent treatment.
      // ============================================================

      // Check if card has no image (EventImage renders nothing)
      &:not(:has(.event-image)) {
        // Add a warm accent bar at top for visual weight
        &::before {
          content: '';
          position: absolute;
          top: 0;
          left: $public-space-md;
          right: $public-space-md;
          height: 3px;
          background: linear-gradient(
            90deg,
            $public-accent-light 0%,
            rgba($public-accent-light, 0.4) 100%
          );
          border-radius: 0 0 2px 2px;
          opacity: 0.7;

          @include public-dark-mode {
            background: linear-gradient(
              90deg,
              $public-accent-dark 0%,
              rgba($public-accent-dark, 0.4) 100%
            );
          }
        }

        // Adjust padding to account for accent bar
        padding-top: $public-space-lg;

        // Title gets more visual prominence
        h3 {
          font-size: $public-font-size-lg;
          font-weight: $public-font-weight-medium;
          margin-top: 0;
        }
      }

      // ============================================================
      // CARD WITH IMAGE
      // ============================================================
      // Standard card with image thumbnail above text.
      // ============================================================

      &:has(.event-image) {
        h3 {
          margin-top: $public-space-sm;
        }
      }

      h3 {
        order: 1;
        font-size: $public-font-size-md;
        font-weight: $public-font-weight-regular;
        line-height: $public-line-height-tight;
        margin: 0;
        color: $public-text-primary-light;
        text-decoration: none;
        transition: $public-transition-fast;

        @include public-dark-mode {
          color: $public-text-primary-dark;
        }
      }

      &:hover h3 {
        color: $public-accent-light;

        @include public-dark-mode {
          color: $public-accent-dark;
        }
      }

      .event-time {
        order: 2;
        font-size: $public-font-size-sm;
        font-weight: $public-font-weight-medium;
        color: $public-text-secondary-light;
        margin-top: $public-space-xs;

        @include public-dark-mode {
          color: $public-text-secondary-dark;
        }
      }
    }
  }
}

// Loading and error states
.loading {
  @include public-loading-state;
}

.empty-state {
  @include public-empty-state;
}

// Responsive design
@include public-mobile-only {
  section.day ul.events {
    li.event {
      width: 120px;
    }
  }
}
</style>
