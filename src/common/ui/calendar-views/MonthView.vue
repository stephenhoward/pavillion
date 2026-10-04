<template>
  <div class="month-view">
    <div class="month-grid" :aria-busy="props.isLoading">
      <span
        v-for="label in weekdays"
        :key="label"
        class="weekday-header"
        aria-hidden="true"
      >{{ label }}</span>

      <template v-for="cell in cells" :key="cell.dateKey">
        <!-- Padding days from the neighbouring months are visual context only. -->
        <div
          v-if="!cell.isCurrentMonth"
          class="month-day-cell is-other-month"
          aria-hidden="true"
        >
          <span class="day-number">{{ cell.dayNumber }}</span>
        </div>

        <div
          v-else
          class="month-day-cell"
          :class="{ 'is-today': cell.isToday, 'has-events': eventsFor(cell.dateKey).length > 0 }"
          role="group"
          :aria-labelledby="`${idPrefix}-${cell.dateKey}`"
        >
          <RouterLink
            :id="`${idPrefix}-${cell.dateKey}`"
            class="day-number"
            :to="props.dayRoute(cell.dateKey)"
            :aria-label="fullDate(cell.date)"
            :aria-current="cell.isToday ? 'date' : undefined"
          >
            {{ cell.dayNumber }}
          </RouterLink>

          <ul v-if="eventsFor(cell.dateKey).length > 0" class="cell-events">
            <li v-for="instance in visibleEvents(cell.dateKey)" :key="instance.id">
              <RouterLink class="event-item" :to="props.eventRoute(instance)">
                <span class="event-time">{{ eventTime(instance) }}</span>
                <span class="event-name">{{ localizedContent(instance.event).name }}</span>
              </RouterLink>
            </li>
            <li v-if="overflowCount(cell.dateKey) > 0">
              <RouterLink class="event-overflow" :to="props.dayRoute(cell.dateKey)">
                {{ t('more_events', { count: overflowCount(cell.dateKey) }) }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <!-- Always in the DOM so assistive tech has a live region to watch before loading begins. -->
    <p class="view-status" :class="{ 'is-idle': !props.isLoading }" role="status">
      {{ props.isLoading ? t('loading') : '' }}
    </p>
    <EmptyState v-if="!props.isLoading && isEmpty">
      <p>{{ t('no_events_this_month') }}</p>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
/**
 * Six-week month grid, Sunday first, padded with the neighbouring months' days.
 *
 * Presentational: the caller supplies the events already bucketed by local ISO
 * date and builds every link, so the grid never reads a store, a route param
 * or the window width. Navigation between months belongs to the toolbar.
 * Padding days show their number only; their events belong to the adjacent
 * month's grid.
 */
import { computed, useId } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';

import type CalendarEventInstance from '@/common/model/event_instance';
import EmptyState from '@/common/ui/components/EmptyState.vue';
import { useLocale } from '@/common/ui/composables/useLocale';
import { useLocalizedContent } from '@/common/ui/composables/useLocalizedContent';
import { MAX_VISIBLE_EVENTS, monthCells, weekdayLabels } from './calendar-grid';

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

const cells = computed(() => monthCells(props.anchorDate, DateTime.now()));
const weekdays = computed(() => weekdayLabels(currentLocale.value));

const eventsFor = (dateKey: string) => props.eventsByDay[dateKey] ?? [];
const visibleEvents = (dateKey: string) => eventsFor(dateKey).slice(0, MAX_VISIBLE_EVENTS);
const overflowCount = (dateKey: string) => Math.max(0, eventsFor(dateKey).length - MAX_VISIBLE_EVENTS);

const isEmpty = computed(() => cells.value
  .filter(cell => cell.isCurrentMonth)
  .every(cell => eventsFor(cell.dateKey).length === 0));

const fullDate = (date: DateTime) => date.toLocaleString(DateTime.DATE_HUGE, { locale: currentLocale.value });
const eventTime = (instance: CalendarEventInstance) =>
  instance.start.toLocal().toLocaleString(DateTime.TIME_SIMPLE, { locale: currentLocale.value });
</script>

<style scoped lang="scss">
// Colours come from the shared --pav-* tokens (TOKENS.md), so each app's theme
// decides how the grid looks; spacing and type are plain rem values.
.month-view {
  display: flex;
  flex-direction: column;
  inline-size: 100%;
}

.month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  // The weekday header is the one explicit row, sized to its labels; the six
  // week rows are implicit and get the cell height.
  grid-template-rows: auto;
  grid-auto-rows: minmax(5rem, auto);
  gap: 1px;
  background: var(--pav-border-subtle);
  border: 1px solid var(--pav-border-subtle);

  .weekday-header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 0.25rem;
    background: var(--pav-surface-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--pav-text-secondary);
  }
}

.month-day-cell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.25rem;
  min-inline-size: 0;
  background: var(--pav-surface-primary);

  .day-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: flex-end;
    min-inline-size: 1.75rem;
    min-block-size: 1.75rem;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--pav-text-primary);
    text-decoration: none;
  }

  a.day-number:hover {
    background: var(--pav-interactive-hover);
  }

  &.is-other-month {
    background: var(--pav-surface-secondary);

    .day-number {
      color: var(--pav-text-muted);
    }
  }

  // An accent ring rather than an accent fill: the accent is owner-configurable
  // in the widget, so no ink colour is guaranteed to contrast with it.
  &.is-today .day-number {
    background: var(--pav-surface-primary);
    color: var(--pav-text-primary);
    font-weight: 700;
    box-shadow: inset 0 0 0 2px var(--pav-accent);

    &:hover {
      background: var(--pav-interactive-hover);
    }
  }

  .cell-events {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .event-item {
    display: flex;
    flex-direction: column;
    padding: 0.125rem 0.25rem;
    background: var(--pav-surface-secondary);
    border-inline-start: 3px solid var(--pav-accent);
    border-radius: 0.1875rem;
    font-size: 0.75rem;
    text-decoration: none;

    &:hover {
      background: var(--pav-surface-tertiary);
    }
  }

  .event-time {
    font-weight: 500;
    color: var(--pav-text-secondary);
  }

  .event-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--pav-text-primary);
  }

  .event-overflow {
    display: block;
    padding: 0.125rem 0.25rem;
    border-radius: 0.1875rem;
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
      outline: 2px solid var(--pav-text-primary);
      outline-offset: 2px;
    }
  }
}

.view-status {
  margin: 0;
  padding: 1.5rem;
  text-align: center;
  color: var(--pav-text-secondary);

  &.is-idle {
    padding: 0;
  }
}
</style>
