<template>
  <div v-if="props.availableViews.length > 1" class="ui-view-toolbar">
    <div v-if="hasPeriod" class="ui-view-toolbar__period">
      <h2 class="ui-view-toolbar__label" aria-live="polite">
        {{ props.periodLabel }}
      </h2>
      <button
        type="button"
        class="ui-view-toolbar__step ui-view-toolbar__step--prev"
        :aria-label="t('previous_period')"
        @click="emit('prev')"
      >
        <svg
          width="18"
          height="18"
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
          width="18"
          height="18"
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
    </div>

    <div
      class="ui-view-toolbar__views"
      role="radiogroup"
      :aria-label="t('view_switcher_label')"
      @focusout="onFocusout"
    >
      <button
        v-for="(view, index) in props.availableViews"
        :key="view"
        :ref="(el) => setRadio(view, el)"
        type="button"
        role="radio"
        class="ui-view-toolbar__view"
        :aria-checked="view === props.viewMode"
        :tabindex="view === tabStop ? 0 : -1"
        :aria-label="t(VIEW_LABEL_KEYS[view])"
        :title="t(VIEW_LABEL_KEYS[view])"
        @click="select(view)"
        @keydown="onKeydown($event, index)"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            v-for="d in VIEW_ICON_PATHS[view]"
            :key="d"
            :d="d"
          />
        </svg>
      </button>
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

/**
 * Each view's icon as stroke paths on a 24-unit grid, drawn in the same
 * weight as the site's Lucide icons. They are inline because this module's
 * package allowlist (README.md, enforced by test/boundary.test.ts) does not
 * include lucide-vue-next. The buttons are icon-only; the translated label
 * is the accessible name.
 */
const VIEW_ICON_PATHS: Record<CalendarViewMode, readonly string[]> = {
  // Three bulleted rows.
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  // Day columns side by side.
  week: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 4v16', 'M15 4v16'],
  // A calendar page with its grid of weeks.
  month: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 2v4', 'M16 2v4', 'M9 10v12', 'M15 10v12', 'M3 16h18'],
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

/**
 * The radio holding the group's one tab stop: the checked view, or the first
 * available view when the checked one is not offered, so the group is never
 * unreachable by keyboard.
 */
const tabStop = computed<CalendarViewMode>(() =>
  props.availableViews.includes(props.viewMode) ? props.viewMode : props.availableViews[0]);

const hasPeriod = computed(() => props.viewMode === 'week' || props.viewMode === 'month');

function select(view: CalendarViewMode): void {
  if (view !== props.viewMode) {
    emit('update:viewMode', view);
  }
}

/**
 * Whether the radio sits in right-to-left text, where ArrowLeft moves
 * forward. Read from the nearest `dir` attribute, which is how every app
 * sets direction.
 */
function isRtl(el: Element): boolean {
  return el.closest('[dir]')?.getAttribute('dir')?.toLowerCase() === 'rtl';
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const count = props.availableViews.length;
  const forward = isRtl(event.currentTarget as Element) ? 'ArrowLeft' : 'ArrowRight';
  const backward = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
  let target: number;

  switch (event.key) {
    case forward:
    case 'ArrowDown':
      target = (index + 1) % count;
      break;
    case backward:
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
  const view = props.availableViews[target];
  if (view !== props.viewMode) {
    focusPending.value = true;
    select(view);
  }
}

/**
 * Focus leaving the group cancels a pending keyboard move, so a later
 * parent-driven change (a resize clamping the effective view) cannot pull
 * focus back here.
 */
function onFocusout(event: FocusEvent): void {
  const group = event.currentTarget as HTMLElement;
  if (!group.contains(event.relatedTarget as Node | null)) {
    focusPending.value = false;
  }
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
// (TOKENS.md) carries colours and shadows only. An invisible pseudo-element
// stretches each control's hit area to 2.75rem (44px) tall for touch without
// changing what is painted. It grows only vertically, since the controls sit
// closer together than that and overlapping hit areas would misdirect taps;
// the row gap below keeps a wrapped second row clear of the first.
//
// The controls are capsules on the tertiary surface at the 32px height of
// the site's category pills (public-filter-pill), so the toolbar reads as
// part of the filter bar rather than a feature of its own. No token carries a hover fill that differs from the
// tertiary surface, so hover mixes a little ink into it instead.
$capsule: 999px;
$hover-fill: color-mix(in srgb, var(--pav-text-primary) 8%, var(--pav-surface-tertiary));
$control-height: 2rem;
$segment-height: 1.75rem;
$touch-height: 2.75rem;

/// The block inset that stretches a control of the given painted height to
/// the touch height.
@function touch-inset($painted) {
  @return calc(($painted - $touch-height) / 2);
}

.ui-view-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 0.75rem;
}

// The view switcher sits at the end of the row; the period, when shown,
// leads from the start.
.ui-view-toolbar__views {
  display: inline-flex;
  margin-inline-start: auto;
  padding: 0.125rem;
  gap: 0.125rem;
  border-radius: $capsule;
  background-color: var(--pav-surface-tertiary);
  box-shadow: var(--pav-shadow-xs);
}

.ui-view-toolbar__view,
.ui-view-toolbar__step,
.ui-view-toolbar__today {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: $control-height;
  border: none;
  border-radius: $capsule;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;

  svg {
    display: block;
  }

  &::before {
    content: '';
    position: absolute;
    inset-block: touch-inset($control-height);
    inset-inline: 0;
  }

  &:focus-visible {
    outline: 2px solid var(--pav-text-primary);
    outline-offset: 2px;
  }
}

.ui-view-toolbar__view {
  min-block-size: $segment-height;
  min-inline-size: 2.25rem;
  padding: 0;
  background-color: transparent;
  color: var(--pav-text-secondary);

  &::before {
    inset-block: touch-inset($segment-height);
  }

  &:hover {
    background-color: $hover-fill;
    color: var(--pav-text-primary);
  }

  // The checked segment sits on the primary surface with a hairline shadow:
  // enough to find, not enough to compete with the events below. No text
  // sits on the accent — TOKENS.md has no ink that contrasts with it.
  &[aria-checked="true"] {
    background-color: var(--pav-surface-primary);
    color: var(--pav-text-primary);
    box-shadow: var(--pav-shadow-xs);
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
  background-color: var(--pav-surface-tertiary);
  color: var(--pav-text-secondary);
  box-shadow: var(--pav-shadow-xs);

  &:hover {
    background-color: $hover-fill;
    color: var(--pav-text-primary);
  }
}

.ui-view-toolbar__step {
  min-inline-size: 2rem;
  padding: 0;

  // The chevrons point along the reading direction.
  &:dir(rtl) svg {
    transform: scaleX(-1);
  }
}

.ui-view-toolbar__today {
  padding-inline: 0.875rem;
}

// The period is the heading of the grid below it: sized like a page
// section title, in the secondary ink so it sits a step below the calendar
// name above.
.ui-view-toolbar__label {
  margin: 0;
  margin-inline-end: 0.5rem;
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--pav-text-secondary);
}
</style>
