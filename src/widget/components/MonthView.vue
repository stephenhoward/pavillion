<script setup lang="ts">
import { reactive, computed, ref, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useRouter } from 'vue-router';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { useWidgetStore } from '../stores/widgetStore';
import { useSwipeGesture } from '../composables/useSwipeGesture';

const { t } = useTranslation('system');
const router = useRouter();
const publicStore = usePublicCalendarStore();
const widgetStore = useWidgetStore();

const monthContainerRef = ref<HTMLElement | null>(null);

// Use store to persist current month across navigation
const currentMonth = computed(() => widgetStore.getCurrentMonthStart());

const state = reactive({
  isMobile: false,
});

// Check viewport width for responsive rendering
const checkMobile = () => {
  state.isMobile = window.innerWidth < 600;
};

// Generate calendar grid cells (including leading/trailing days from other months)
const calendarCells = computed(() => {
  const firstDay = currentMonth.value.startOf('month');
  const lastDay = currentMonth.value.endOf('month');

  // Start from the Sunday before or on the first day of month
  let currentDate = firstDay.startOf('week');

  const cells = [];

  // Generate 6 weeks of cells (42 days) to fill a complete month grid
  for (let i = 0; i < 42; i++) {
    const isCurrentMonth = currentDate.month === currentMonth.value.month;
    const isToday = currentDate.hasSame(DateTime.now(), 'day');

    cells.push({
      date: currentDate,
      dateKey: currentDate.toISODate()!,
      isCurrentMonth,
      isToday,
      dayNumber: currentDate.day,
    });

    currentDate = currentDate.plus({ days: 1 });
  }

  return cells;
});

// Days with events (for condensed mobile view)
const daysWithEvents = computed(() => {
  if (!state.isMobile) return [];

  const eventDays: Record<string, any[]> = {};

  // Safety check: ensure events array exists before iterating
  if (publicStore.allEvents && Array.isArray(publicStore.allEvents)) {
    publicStore.allEvents.forEach((instance) => {
      const dayKey = instance.start.toISODate();
      if (dayKey) {
        if (!eventDays[dayKey]) {
          eventDays[dayKey] = [];
        }
        eventDays[dayKey].push(instance);
      }
    });
  }

  // Convert to array and sort by date
  return Object.entries(eventDays)
    .map(([dateKey, events]) => ({
      date: DateTime.fromISO(dateKey),
      dateKey,
      events,
    }))
    .sort((a, b) => a.date.toMillis() - b.date.toMillis())
    .filter((day) => day.date.month === currentMonth.value.month);
});

// Group events by day for desktop grid
const eventsByDay = computed(() => {
  const grouped: Record<string, any[]> = {};

  // Safety check: ensure events array exists before iterating
  if (publicStore.allEvents && Array.isArray(publicStore.allEvents)) {
    publicStore.allEvents.forEach((instance) => {
      const dayKey = instance.start.toISODate();
      if (dayKey) {
        if (!grouped[dayKey]) {
          grouped[dayKey] = [];
        }
        grouped[dayKey].push(instance);
      }
    });
  }

  return grouped;
});

// Navigation functions
const goToPreviousMonth = () => {
  const newMonth = currentMonth.value.minus({ months: 1 });
  widgetStore.setCurrentMonthStart(newMonth);
  loadMonthEvents();
};

const goToNextMonth = () => {
  const newMonth = currentMonth.value.plus({ months: 1 });
  widgetStore.setCurrentMonthStart(newMonth);
  loadMonthEvents();
};

// Swipe gesture support
useSwipeGesture(monthContainerRef, {
  onSwipeLeft: goToNextMonth,
  onSwipeRight: goToPreviousMonth,
});

// Event limit per cell
const MAX_VISIBLE_EVENTS = 3;

const getVisibleEvents = (events: any[] = []) => {
  return events.slice(0, MAX_VISIBLE_EVENTS);
};

const getOverflowCount = (events: any[] = []) => {
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

const loadMonthEvents = () => {
  const startDate = currentMonth.value.startOf('month').toISODate()!;
  const endDate = currentMonth.value.endOf('month').toISODate()!;
  publicStore.setDateRange(startDate, endDate);
  publicStore.reloadWithFilters();
};

onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
  loadMonthEvents();
});
</script>

<template>
  <div class="month-view" ref="monthContainerRef">
    <!-- Month Navigation Header -->
    <header class="month-header">
      <button
        type="button"
        class="nav-button nav-prev"
        @click="goToPreviousMonth"
        :aria-label="t('previous_month')"
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

      <h2 class="month-title">
        {{ currentMonth.toFormat('MMMM yyyy') }}
      </h2>

      <button
        type="button"
        class="nav-button nav-next"
        @click="goToNextMonth"
        :aria-label="t('next_month')"
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

    <!-- Desktop: Traditional Calendar Grid -->
    <div v-if="!state.isMobile" class="month-grid">
      <!-- Weekday Headers -->
      <div class="weekday-header" v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day">
        {{ day }}
      </div>

      <!-- Calendar Cells -->
      <div
        v-for="cell in calendarCells"
        :key="cell.dateKey"
        class="month-day-cell"
        :class="{
          'is-other-month': !cell.isCurrentMonth,
          'is-today': cell.isToday,
          'has-events': eventsByDay[cell.dateKey]?.length > 0,
        }"
      >
        <div class="cell-header">
          <span class="day-number">{{ cell.dayNumber }}</span>
        </div>

        <div v-if="cell.isCurrentMonth" class="cell-events">
          <div
            v-for="instance in getVisibleEvents(eventsByDay[cell.dateKey])"
            :key="instance.id"
            class="event-preview"
            @click="openEvent(instance)"
          >
            <span class="event-time">{{ instance.start.toLocaleString(DateTime.TIME_SIMPLE) }}</span>
            <span class="event-name">{{ instance.event.content('en').name }}</span>
          </div>

          <div
            v-if="getOverflowCount(eventsByDay[cell.dateKey]) > 0"
            class="event-overflow"
          >
            +{{ getOverflowCount(eventsByDay[cell.dateKey]) }}
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile: Condensed List View -->
    <div v-else class="month-condensed-list">
      <div
        v-for="day in daysWithEvents"
        :key="day.dateKey"
        class="condensed-day"
      >
        <div class="day-header">
          <div class="day-name">{{ day.date.toFormat('EEE') }}</div>
          <div class="day-number">{{ day.date.day }}</div>
        </div>

        <div class="day-events">
          <div
            v-for="instance in day.events"
            :key="instance.id"
            class="event-item"
            @click="openEvent(instance)"
          >
            <div class="event-time">
              {{ instance.start.toLocaleString(DateTime.TIME_SIMPLE) }}
            </div>
            <div class="event-name">
              {{ instance.event.content('en').name }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="daysWithEvents.length === 0" class="empty-state">
        <p>{{ t('no_events_this_month') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

.month-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

// ================================================================
// MONTH NAVIGATION HEADER
// ================================================================

.month-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $public-space-md;
  border-bottom: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-bottom-color: $public-border-subtle-dark;
  }

  .month-title {
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
// DESKTOP: TRADITIONAL CALENDAR GRID
// ================================================================

.month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: minmax(80px, 1fr);
  gap: 1px;
  flex: 1;
  overflow: auto;
  background: $public-border-subtle-light;

  @include public-dark-mode {
    background: $public-border-subtle-dark;
  }
}

.weekday-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: $public-space-sm;
  background: $public-bg-secondary-light;
  font-size: $public-font-size-xs;
  font-weight: $public-font-weight-semibold;
  text-transform: uppercase;
  letter-spacing: $public-letter-spacing-wide;
  color: $public-text-secondary-light;

  @include public-dark-mode {
    background: $public-bg-secondary-dark;
    color: $public-text-secondary-dark;
  }
}

.month-day-cell {
  display: flex;
  flex-direction: column;
  background: $public-bg-primary-light;
  padding: $public-space-xs;
  overflow: hidden;

  @include public-dark-mode {
    background: $public-bg-primary-dark;
  }

  &.is-other-month {
    opacity: 0.3;
    pointer-events: none;
  }

  &.is-today {
    .cell-header {
      .day-number {
        background: $public-accent-light;
        color: white;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;

        @include public-dark-mode {
          background: $public-accent-dark;
        }
      }
    }
  }

  .cell-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-bottom: $public-space-xs;

    .day-number {
      font-size: $public-font-size-sm;
      font-weight: $public-font-weight-semibold;
      color: $public-text-primary-light;

      @include public-dark-mode {
        color: $public-text-primary-dark;
      }
    }
  }

  .cell-events {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }
}

.event-preview {
  display: flex;
  flex-direction: column;
  padding: 2px 4px;
  background: $public-accent-light;
  color: white;
  border-radius: 3px;
  font-size: 10px;
  cursor: pointer;
  transition: $public-transition-fast;
  overflow: hidden;

  &:hover {
    background: $public-accent-hover-light;
    transform: translateY(-1px);
  }

  @include public-dark-mode {
    background: $public-accent-dark;

    &:hover {
      background: $public-accent-hover-dark;
    }
  }

  .event-time {
    font-weight: $public-font-weight-medium;
    opacity: 0.9;
  }

  .event-name {
    font-weight: $public-font-weight-regular;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.event-overflow {
  padding: 2px 4px;
  text-align: center;
  font-size: 10px;
  font-weight: $public-font-weight-medium;
  color: $public-text-secondary-light;
  background: $public-bg-tertiary-light;
  border-radius: 3px;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
    background: $public-bg-tertiary-dark;
  }
}

// ================================================================
// MOBILE: CONDENSED LIST VIEW
// ================================================================

.month-condensed-list {
  flex: 1;
  overflow-y: auto;
  padding: $public-space-md;
  display: flex;
  flex-direction: column;
  gap: $public-space-md;
}

.condensed-day {
  display: flex;
  gap: $public-space-md;
  padding: $public-space-md;
  background: $public-bg-secondary-light;
  border-radius: $public-radius-md;
  box-shadow: $public-shadow-sm-light;

  @include public-dark-mode {
    background: $public-bg-secondary-dark;
    box-shadow: $public-shadow-sm-dark;
  }

  .day-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 60px;
    padding: $public-space-sm;
    background: $public-accent-light;
    color: white;
    border-radius: $public-radius-sm;

    @include public-dark-mode {
      background: $public-accent-dark;
    }

    .day-name {
      font-size: $public-font-size-xs;
      font-weight: $public-font-weight-semibold;
      text-transform: uppercase;
      letter-spacing: $public-letter-spacing-wide;
    }

    .day-number {
      font-size: $public-font-size-lg;
      font-weight: $public-font-weight-bold;
      margin-top: $public-space-xs;
    }
  }

  .day-events {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: $public-space-sm;
  }

  .event-item {
    padding: $public-space-sm;
    background: $public-bg-primary-light;
    border-radius: $public-radius-sm;
    cursor: pointer;
    transition: $public-transition-fast;

    &:hover {
      background: $public-bg-tertiary-light;
      transform: translateX(4px);
    }

    @include public-dark-mode {
      background: $public-bg-primary-dark;

      &:hover {
        background: $public-bg-tertiary-dark;
      }
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
      margin-top: $public-space-xs;

      @include public-dark-mode {
        color: $public-text-primary-dark;
      }
    }
  }
}

.empty-state {
  @include public-empty-state;
}
</style>
