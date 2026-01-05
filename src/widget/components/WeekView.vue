<script setup lang="ts">
import { reactive, computed, ref, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useRouter } from 'vue-router';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { useWidgetStore } from '../stores/widgetStore';
import { useSwipeGesture } from '../composables/useSwipeGesture';
import EventImage from '@/site/components/EventImage.vue';

const { t } = useTranslation('system');
const router = useRouter();
const publicStore = usePublicCalendarStore();
const widgetStore = useWidgetStore();

const weekContainerRef = ref<HTMLElement | null>(null);

// Use store to persist current week across navigation
const currentWeekStart = computed(() => widgetStore.getCurrentWeekStart());

// Generate array of 7 days for current week
const weekDays = computed(() => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(currentWeekStart.value.plus({ days: i }));
  }
  return days;
});

// Group events by day for current week
const eventsByDay = computed(() => {
  const grouped: Record<string, any[]> = {};

  weekDays.value.forEach((day) => {
    grouped[day.toISODate()!] = [];
  });

  // Safety check: ensure events array exists before iterating
  if (publicStore.allEvents && Array.isArray(publicStore.allEvents)) {
    publicStore.allEvents.forEach((instance) => {
      const dayKey = instance.start.toISODate();
      if (dayKey && grouped[dayKey]) {
        grouped[dayKey].push(instance);
      }
    });
  }

  return grouped;
});

// Navigation functions
const goToPreviousWeek = () => {
  const newWeekStart = currentWeekStart.value.minus({ weeks: 1 });
  widgetStore.setCurrentWeekStart(newWeekStart);
  loadWeekEvents();
};

const goToNextWeek = () => {
  const newWeekStart = currentWeekStart.value.plus({ weeks: 1 });
  widgetStore.setCurrentWeekStart(newWeekStart);
  loadWeekEvents();
};

// Swipe gesture support
useSwipeGesture(weekContainerRef, {
  onSwipeLeft: goToNextWeek,
  onSwipeRight: goToPreviousWeek,
});

// Event limit per day
const MAX_VISIBLE_EVENTS = 3;

const getVisibleEvents = (events: any[]) => {
  return events.slice(0, MAX_VISIBLE_EVENTS);
};

const getOverflowCount = (events: any[]) => {
  return Math.max(0, events.length - MAX_VISIBLE_EVENTS);
};

const openEvent = (instance: any) => {
  router.push({
    name: 'widget-event-detail',
    params: {
      urlName: widgetStore.calendarUrlName!,
      eventId: instance.event.id,
    },
  });
};

const loadWeekEvents = () => {
  const startDate = currentWeekStart.value.toISODate()!;
  const endDate = currentWeekStart.value.plus({ days: 6 }).toISODate()!;
  publicStore.setDateRange(startDate, endDate);
  publicStore.reloadWithFilters();
};

onMounted(() => {
  // Load events for current week
  loadWeekEvents();
});
</script>

<template>
  <div class="week-view" ref="weekContainerRef">
    <!-- Week Navigation Header -->
    <header class="week-header">
      <button
        type="button"
        class="nav-button nav-prev"
        @click="goToPreviousWeek"
        :aria-label="t('previous_week')"
      >
        <svg width="20"
             height="20"
             viewBox="0 0 20 20"
             fill="none">
          <path
            d="M12 5L7 10L12 15"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <h2 class="week-title">
        {{ currentWeekStart.toFormat('MMMM d') }} -
        {{ currentWeekStart.plus({ days: 6 }).toFormat('MMMM d, yyyy') }}
      </h2>

      <button
        type="button"
        class="nav-button nav-next"
        @click="goToNextWeek"
        :aria-label="t('next_week')"
      >
        <svg width="20"
             height="20"
             viewBox="0 0 20 20"
             fill="none">
          <path
            d="M8 5L13 10L8 15"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </header>

    <!-- Week Grid -->
    <div class="week-grid">
      <div
        v-for="day in weekDays"
        :key="day.toISODate()"
        class="week-day-column"
        :class="{ 'is-today': day.hasSame(DateTime.now(), 'day') }"
      >
        <!-- Day Header -->
        <div class="day-header">
          <div class="day-name">{{ day.toFormat('EEE') }}</div>
          <div class="day-number">{{ day.day }}</div>
        </div>

        <!-- Events for this day -->
        <div class="day-events">
          <div
            v-for="instance in getVisibleEvents(eventsByDay[day.toISODate()!])"
            :key="instance.id"
            class="event-item"
            @click="openEvent(instance)"
          >
            <EventImage
              v-if="instance.event.media"
              :media="instance.event.media"
              context="card"
              :lazy="true"
            />
            <div class="event-details">
              <div class="event-time">
                {{ instance.start.toLocaleString(DateTime.TIME_SIMPLE) }}
              </div>
              <div class="event-name">
                {{ instance.event.content('en').name }}
              </div>
            </div>
          </div>

          <!-- Overflow indicator -->
          <div
            v-if="getOverflowCount(eventsByDay[day.toISODate()!]) > 0"
            class="event-overflow"
          >
            +{{ getOverflowCount(eventsByDay[day.toISODate()!]) }} more
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

.week-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

// ================================================================
// WEEK NAVIGATION HEADER
// ================================================================

.week-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $public-space-md;
  border-bottom: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-bottom-color: $public-border-subtle-dark;
  }

  .week-title {
    flex: 1;
    text-align: center;
    margin: 0;
    font-size: $public-font-size-md;
    font-weight: $public-font-weight-semibold;
    color: $public-text-primary-light;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }

    @include public-mobile-only {
      font-size: $public-font-size-base;
    }
  }

  .nav-button {
    @include public-button-base;

    padding: $public-space-sm;
    background: transparent;
    border: 1px solid $public-border-medium-light;
    border-radius: $public-radius-sm;
    color: $public-text-primary-light;
    transition: $public-transition-fast;

    &:hover:not(:disabled) {
      background: $public-hover-overlay-light;
      border-color: $public-border-strong-light;
    }

    @include public-dark-mode {
      border-color: $public-border-medium-dark;
      color: $public-text-primary-dark;

      &:hover:not(:disabled) {
        background: $public-hover-overlay-dark;
        border-color: $public-border-strong-dark;
      }
    }
  }
}

// ================================================================
// WEEK GRID (DESKTOP/TABLET)
// ================================================================

.week-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  flex: 1;
  overflow: hidden;
  background: $public-border-subtle-light;

  @include public-dark-mode {
    background: $public-border-subtle-dark;
  }

  // Tablet: horizontal scroll if needed
  @media (min-width: 600px) and (max-width: 1023px) {
    overflow-x: auto;
    grid-template-columns: repeat(7, minmax(150px, 1fr));
  }

  // Mobile: vertical stack
  @include public-mobile-only {
    grid-template-columns: 1fr;
    gap: $public-space-md;
    background: transparent;
    padding: $public-space-md;
    overflow-y: auto;
  }
}

// ================================================================
// DAY COLUMN
// ================================================================

.week-day-column {
  display: flex;
  flex-direction: column;
  background: $public-bg-primary-light;
  overflow: hidden;

  @include public-dark-mode {
    background: $public-bg-primary-dark;
  }

  &.is-today {
    .day-header {
      background: $public-accent-light;
      color: white;

      @include public-dark-mode {
        background: $public-accent-dark;
      }
    }
  }

  @include public-mobile-only {
    border-radius: $public-radius-md;
    box-shadow: $public-shadow-sm-light;

    @include public-dark-mode {
      box-shadow: $public-shadow-sm-dark;
    }
  }
}

.day-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $public-space-sm;
  background: $public-bg-secondary-light;
  border-bottom: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    background: $public-bg-secondary-dark;
    border-bottom-color: $public-border-subtle-dark;
  }

  .day-name {
    font-size: $public-font-size-xs;
    font-weight: $public-font-weight-semibold;
    text-transform: uppercase;
    letter-spacing: $public-letter-spacing-wide;
    color: $public-text-secondary-light;

    @include public-dark-mode {
      color: $public-text-secondary-dark;
    }
  }

  .day-number {
    font-size: $public-font-size-lg;
    font-weight: $public-font-weight-bold;
    color: $public-text-primary-light;
    margin-top: $public-space-xs;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }
}

.day-events {
  flex: 1;
  overflow-y: auto;
  padding: $public-space-sm;
  display: flex;
  flex-direction: column;
  gap: $public-space-sm;

  @include public-mobile-only {
    overflow-y: visible;
    padding: $public-space-md;
  }
}

// ================================================================
// EVENT ITEMS
// ================================================================

.event-item {
  display: flex;
  flex-direction: column;
  padding: $public-space-sm;
  background: $public-bg-secondary-light;
  border-radius: $public-radius-sm;
  cursor: pointer;
  transition: $public-transition-fast;
  border: 1px solid transparent;

  &:hover {
    background: $public-bg-tertiary-light;
    border-color: $public-accent-light;
    transform: translateY(-1px);
    box-shadow: $public-shadow-sm-light;
  }

  @include public-dark-mode {
    background: $public-bg-secondary-dark;

    &:hover {
      background: $public-bg-tertiary-dark;
      border-color: $public-accent-dark;
      box-shadow: $public-shadow-sm-dark;
    }
  }

  .event-details {
    display: flex;
    flex-direction: column;
    gap: $public-space-xs;
    margin-top: $public-space-xs;
  }

  .event-time {
    font-size: $public-font-size-xs;
    font-weight: $public-font-weight-medium;
    color: $public-accent-light;

    @include public-dark-mode {
      color: $public-accent-dark;
    }
  }

  .event-name {
    font-size: $public-font-size-sm;
    font-weight: $public-font-weight-medium;
    color: $public-text-primary-light;
    line-height: $public-line-height-tight;

    // Truncate to 2 lines
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }
}

// ================================================================
// OVERFLOW INDICATOR
// ================================================================

.event-overflow {
  padding: $public-space-xs $public-space-sm;
  text-align: center;
  font-size: $public-font-size-xs;
  font-weight: $public-font-weight-medium;
  color: $public-text-secondary-light;
  background: $public-bg-tertiary-light;
  border-radius: $public-radius-sm;
  cursor: pointer;
  transition: $public-transition-fast;

  &:hover {
    color: $public-accent-light;
    background: rgba($public-accent-light, 0.1);
  }

  @include public-dark-mode {
    color: $public-text-secondary-dark;
    background: $public-bg-tertiary-dark;

    &:hover {
      color: $public-accent-dark;
      background: rgba($public-accent-dark, 0.1);
    }
  }
}
</style>
