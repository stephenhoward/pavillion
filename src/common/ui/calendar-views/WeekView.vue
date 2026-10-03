<template>
  <div class="week-view">
    <div class="week-grid" :aria-busy="props.isLoading">
      <div
        v-for="(day, index) in days"
        :key="day.dateKey"
        class="week-day-column"
        :class="{ 'is-today': day.isToday }"
        role="group"
        :aria-labelledby="`${idPrefix}-${day.dateKey}`"
      >
        <div class="day-header">
          <span class="day-name" aria-hidden="true">{{ weekdays[index] }}</span>
          <RouterLink
            :id="`${idPrefix}-${day.dateKey}`"
            class="day-number"
            :to="props.dayRoute(day.dateKey)"
            :aria-label="fullDate(day.date)"
            :aria-current="day.isToday ? 'date' : undefined"
          >
            {{ day.dayNumber }}
          </RouterLink>
        </div>

        <ul class="day-events">
          <li v-for="instance in visibleEvents(day.dateKey)" :key="instance.id">
            <RouterLink class="event-item" :to="props.eventRoute(instance)">
              <span class="event-time">{{ eventTime(instance) }}</span>
              <span class="event-name">{{ localizedContent(instance.event).name }}</span>
            </RouterLink>
          </li>
          <li v-if="overflowCount(day.dateKey) > 0">
            <RouterLink class="event-overflow" :to="props.dayRoute(day.dateKey)">
              {{ t('more_events', { count: overflowCount(day.dateKey) }) }}
            </RouterLink>
          </li>
        </ul>
      </div>
    </div>

    <p v-if="props.isLoading" class="view-status" role="status">{{ t('loading') }}</p>
    <EmptyState v-else-if="isEmpty">
      <p>{{ t('no_events_this_week') }}</p>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
/**
 * Seven-column week grid, Sunday first.
 *
 * Presentational: the caller supplies the events already bucketed by local ISO
 * date and builds every link, so the grid never reads a store, a route param
 * or the window width. Navigation between weeks belongs to the toolbar.
 */
import { computed, useId } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';

import type CalendarEventInstance from '@/common/model/event_instance';
import EmptyState from '@/common/ui/components/EmptyState.vue';
import { useLocale } from '@/common/ui/composables/useLocale';
import { useLocalizedContent } from '@/common/ui/composables/useLocalizedContent';
import { MAX_VISIBLE_EVENTS, weekDays, weekdayLabels } from './calendar-grid';

const props = defineProps<{
  anchorDate: DateTime;
  eventsByDay: Record<string, CalendarEventInstance[]>;
  isLoading: boolean;
  eventRoute: (instance: CalendarEventInstance) => RouteLocationRaw;
  dayRoute: (isoDate: string) => RouteLocationRaw;
}>();

const { t } = useTranslation('ui');
const { currentLocale } = useLocale();
const { localizedContent } = useLocalizedContent();
const idPrefix = useId();

const days = computed(() => weekDays(props.anchorDate, DateTime.now()));
const weekdays = computed(() => weekdayLabels(currentLocale.value));

const eventsFor = (dateKey: string) => props.eventsByDay[dateKey] ?? [];
const visibleEvents = (dateKey: string) => eventsFor(dateKey).slice(0, MAX_VISIBLE_EVENTS);
const overflowCount = (dateKey: string) => Math.max(0, eventsFor(dateKey).length - MAX_VISIBLE_EVENTS);

const isEmpty = computed(() => days.value.every(day => eventsFor(day.dateKey).length === 0));

const fullDate = (date: DateTime) => date.toLocaleString(DateTime.DATE_HUGE, { locale: currentLocale.value });
const eventTime = (instance: CalendarEventInstance) =>
  instance.start.toLocal().toLocaleString(DateTime.TIME_SIMPLE, { locale: currentLocale.value });
</script>

<style scoped lang="scss">
// Colours come from the shared --pav-* tokens (TOKENS.md), so each app's theme
// decides how the grid looks; spacing and type are plain rem values.
.week-view {
  display: flex;
  flex-direction: column;
  inline-size: 100%;
}

.week-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 1px;
  background: var(--pav-border-subtle);
  border: 1px solid var(--pav-border-subtle);
}

.week-day-column {
  display: flex;
  flex-direction: column;
  min-block-size: 10rem;
  background: var(--pav-surface-primary);

  .day-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem;
    background: var(--pav-surface-secondary);
    border-block-end: 1px solid var(--pav-border-subtle);
  }

  .day-name {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--pav-text-secondary);
  }

  .day-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: 2rem;
    min-block-size: 2rem;
    border-radius: 999px;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--pav-text-primary);
    text-decoration: none;

    &:hover {
      background: var(--pav-interactive-hover);
    }
  }

  &.is-today .day-number {
    background: var(--pav-accent);
    color: var(--pav-surface-primary);

    &:hover {
      background: var(--pav-accent-hover);
    }
  }

  .day-events {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0.5rem;
    list-style: none;
  }

  .event-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    background: var(--pav-surface-secondary);
    border-inline-start: 3px solid var(--pav-accent);
    border-radius: 0.25rem;
    text-decoration: none;

    &:hover {
      background: var(--pav-surface-tertiary);
    }
  }

  .event-time {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--pav-text-secondary);
  }

  .event-name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25;
    color: var(--pav-text-primary);
    overflow-wrap: anywhere;
  }

  .event-overflow {
    display: block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    text-align: center;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--pav-text-secondary);
    background: var(--pav-surface-tertiary);
    text-decoration: none;

    &:hover {
      color: var(--pav-text-primary);
      background: var(--pav-interactive-hover);
    }
  }

  .day-number,
  .event-item,
  .event-overflow {
    &:focus-visible {
      outline: 2px solid var(--pav-accent);
      outline-offset: 2px;
    }
  }
}

.view-status {
  margin: 0;
  padding: 1.5rem;
  text-align: center;
  color: var(--pav-text-secondary);
}
</style>
