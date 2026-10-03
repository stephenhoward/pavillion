<template>
  <div v-if="props.availableViews.length > 1" class="ui-view-toolbar">
    <div
      class="ui-view-toolbar__views"
      role="radiogroup"
      :aria-label="t('view_switcher_label')"
    >
      <button
        v-for="(view, index) in props.availableViews"
        :key="view"
        :ref="(el) => setRadio(view, el)"
        type="button"
        role="radio"
        class="ui-view-toolbar__view"
        :aria-checked="view === props.viewMode"
        :tabindex="view === props.viewMode ? 0 : -1"
        @click="select(view)"
        @keydown="onKeydown($event, index)"
      >
        {{ t(VIEW_LABEL_KEYS[view]) }}
      </button>
    </div>

    <div v-if="hasPeriod" class="ui-view-toolbar__period">
      <button
        type="button"
        class="ui-view-toolbar__step ui-view-toolbar__step--prev"
        :aria-label="t('previous_period')"
        @click="emit('prev')"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 5L7 10L12 15"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="ui-view-toolbar__today"
        @click="emit('today')"
      >
        {{ t('today') }}
      </button>
      <button
        type="button"
        class="ui-view-toolbar__step ui-view-toolbar__step--next"
        :aria-label="t('next_period')"
        @click="emit('next')"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 5L13 10L8 15"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <p class="ui-view-toolbar__label" aria-live="polite">
        {{ props.periodLabel }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The calendar view switcher: a segmented control over the views the
 * container can show, plus previous / today / next and the period label in
 * the week and month views.
 *
 * Presentational only. The container owns the view state and passes the
 * effective view; this component emits what the visitor asked for and moves
 * focus only once the parent has applied it.
 *
 * The segmented control follows the WAI-ARIA APG radio-group pattern: one tab
 * stop on the checked option, and the arrow keys move selection and focus
 * together, wrapping at either end. Home and End jump to the first and last.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { DateTime } from 'luxon';

import type { CalendarViewMode } from '@/common/model/calendar_view';

const props = defineProps<{
  viewMode: CalendarViewMode;
  availableViews: readonly CalendarViewMode[];
  /** The period the label describes; kept for the container's contract, not rendered. */
  anchorDate: DateTime;
  periodLabel: string;
}>();

const emit = defineEmits<{
  'update:viewMode': [view: CalendarViewMode];
  prev: [];
  next: [];
  today: [];
}>();

const { t } = useTranslation('ui');

const VIEW_LABEL_KEYS: Record<CalendarViewMode, string> = {
  list: 'view_list',
  week: 'view_week',
  month: 'view_month',
};

/** Keyed by view: Vue does not keep a v-for ref array in source order. */
const radioButtons = new Map<CalendarViewMode, HTMLButtonElement>();

function setRadio(view: CalendarViewMode, el: unknown): void {
  if (el instanceof HTMLButtonElement) {
    radioButtons.set(view, el);
  }
  else {
    radioButtons.delete(view);
  }
}

/** Set when a key press selected a view, so focus follows once the parent applies it. */
const focusPending = ref(false);

const hasPeriod = computed(() => props.viewMode === 'week' || props.viewMode === 'month');

function select(view: CalendarViewMode): void {
  if (view !== props.viewMode) {
    emit('update:viewMode', view);
  }
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const count = props.availableViews.length;
  let target: number;

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      target = (index + 1) % count;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      target = (index - 1 + count) % count;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = count - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  focusPending.value = true;
  select(props.availableViews[target]);
}

watch(() => props.viewMode, (view) => {
  if (!focusPending.value) {
    return;
  }
  focusPending.value = false;
  radioButtons.get(view)?.focus();
}, { flush: 'post' });
</script>

<style scoped lang="scss">
// Spacing and type sizes are plain rem values: the shared runtime token set
// (TOKENS.md) carries colours and shadows only. Every control is at least
// 2.75rem (44px) tall for touch.
.ui-view-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.ui-view-toolbar__views {
  display: inline-flex;
  padding: 0.25rem;
  gap: 0.25rem;
  border-radius: 1rem;
  background-color: var(--pav-surface-tertiary);
}

.ui-view-toolbar__view,
.ui-view-toolbar__step,
.ui-view-toolbar__today {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.75rem;
  border: none;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:focus-visible {
    outline: 2px solid var(--pav-accent);
    outline-offset: 2px;
  }
}

.ui-view-toolbar__view {
  padding-inline: 1rem;
  border-radius: 0.75rem;
  background-color: transparent;
  color: var(--pav-text-secondary);

  &:hover {
    background-color: var(--pav-interactive-hover);
    color: var(--pav-text-primary);
  }

  // The checked segment takes the accent fill and the white ink every
  // accent-filled public control uses.
  &[aria-checked="true"] {
    background-color: var(--pav-accent);
    color: white;
    font-weight: 500;
    box-shadow: var(--pav-shadow-sm);

    &:hover {
      background-color: var(--pav-accent-hover);
    }
  }
}

.ui-view-toolbar__period {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.ui-view-toolbar__step,
.ui-view-toolbar__today {
  border: 1px solid var(--pav-border-medium);
  border-radius: 0.5rem;
  background-color: transparent;
  color: var(--pav-text-primary);

  &:hover {
    background-color: var(--pav-interactive-hover);
    border-color: var(--pav-border-strong);
  }
}

.ui-view-toolbar__step {
  min-inline-size: 2.75rem;
  padding: 0;

  // The chevrons point along the reading direction.
  &:dir(rtl) svg {
    transform: scaleX(-1);
  }
}

.ui-view-toolbar__today {
  padding-inline: 1rem;
}

.ui-view-toolbar__label {
  margin: 0;
  margin-inline-start: 0.25rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--pav-text-primary);
}
</style>
