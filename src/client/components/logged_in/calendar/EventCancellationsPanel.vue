<script setup lang="ts">
/**
 * EventCancellationsPanel
 *
 * Horizontal scroll-snapping row of occurrence cards for managing
 * cancellations on a recurring event. Occurrences are fetched from the
 * server's /upcoming-occurrences endpoint, independent of the
 * materialization horizon — so a monthly or yearly event is navigable
 * arbitrarily far into the future.
 *
 * The scroller ends with two trailing cards:
 *   - "Jump to month…": input a YYYY-MM month to reposition the list
 *   - "Show more": append the next 10 occurrences
 *
 * When the server reports hasMore=false, "Show more" is replaced by a
 * terminal "No further occurrences" card.
 *
 * Cancel/restore flips the affected card's state in place — no refetch,
 * no reordering.
 *
 * Props:
 * @prop {CalendarEvent} event - The recurring event being managed
 */

import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';
import { DateTime } from 'luxon';
import { useTranslation } from 'i18next-vue';

import PillButton from '@/client/components/common/pill-button.vue';
import EventCancelConfirmModal from '@/client/components/logged_in/calendar/EventCancelConfirmModal.vue';
import EventService, {
  type UpcomingOccurrence,
} from '@/client/service/event';
import type { CalendarEvent } from '@/common/model/events';

const props = defineProps<{
  event: CalendarEvent;
}>();

const { t } = useTranslation('event_editor', {
  keyPrefix: 'cancellations',
});

const eventService = new EventService();

const occurrences = ref<UpcomingOccurrence[]>([]);
const hasMore = ref(true);
const loading = ref(false);
const jumpMonth = ref<string>('');
const showEmpty = ref(false);
const emptyMonthLabel = ref<string>('');
const pendingCancelStart = ref<string | null>(null);

const scrollerEl = useTemplateRef<HTMLElement>('scroller');

const cursor = computed<string | null>(() =>
  occurrences.value.length > 0
    ? occurrences.value[occurrences.value.length - 1].start
    : null,
);

async function fetchBatch(after: string): Promise<{ items: UpcomingOccurrence[]; more: boolean }> {
  loading.value = true;
  try {
    const result = await eventService.listUpcomingOccurrences(props.event.id, after, 10);
    return { items: result.occurrences, more: result.hasMore };
  }
  finally {
    loading.value = false;
  }
}

async function loadFromAnchor(anchorIso: string, monthLabel: string | null) {
  const { items, more } = await fetchBatch(anchorIso);
  occurrences.value = items;
  hasMore.value = more;
  showEmpty.value = items.length === 0;
  emptyMonthLabel.value = monthLabel ?? '';
  // Reset scroll to the start so the user sees the jump target / first item.
  await nextTick();
  if (scrollerEl.value) {
    scrollerEl.value.scrollLeft = 0;
  }
}

async function loadInitial() {
  const nowIso = DateTime.utc().toISO();
  await loadFromAnchor(nowIso!, null);
}

async function onShowMore() {
  const anchor = cursor.value;
  if (!anchor) return;
  const { items, more } = await fetchBatch(anchor);
  if (items.length === 0) {
    hasMore.value = false;
    return;
  }
  occurrences.value = occurrences.value.concat(items);
  hasMore.value = more;
}

async function onJumpSubmit() {
  const value = jumpMonth.value.trim();
  if (!value) return;
  const parsed = DateTime.fromFormat(value, 'yyyy-MM', { zone: 'utc' });
  if (!parsed.isValid) return;
  const anchor = parsed.startOf('month');
  await loadFromAnchor(anchor.toISO()!, parsed.toFormat('MMMM yyyy'));
}

async function onStartFromToday() {
  showEmpty.value = false;
  await loadInitial();
}

function onCancelClick(start: string) {
  pendingCancelStart.value = start;
}

async function onConfirmCancel(payload: { hideFromPublic: boolean }) {
  const start = pendingCancelStart.value;
  pendingCancelStart.value = null;
  if (!start) return;
  try {
    await eventService.cancelOccurrence(props.event.id, start, payload.hideFromPublic);
    // Flip card state in place — do NOT refetch.
    const idx = occurrences.value.findIndex(o => o.start === start);
    if (idx >= 0) {
      occurrences.value[idx] = {
        ...occurrences.value[idx],
        state: payload.hideFromPublic ? 'hidden' : 'cancelled-shown',
      };
    }
  }
  catch (error) {
    console.error('EventCancellationsPanel: cancelOccurrence failed', error);
  }
}

function onCloseConfirm() {
  pendingCancelStart.value = null;
}

async function onRestoreClick(start: string) {
  try {
    await eventService.restoreOccurrence(props.event.id, start);
    // Flip card state in place — do NOT refetch.
    const idx = occurrences.value.findIndex(o => o.start === start);
    if (idx >= 0) {
      occurrences.value[idx] = {
        ...occurrences.value[idx],
        state: 'active',
        scheduleId: null,
      };
    }
  }
  catch (error) {
    console.error('EventCancellationsPanel: restoreOccurrence failed', error);
  }
}

function formatStart(iso: string): string {
  return DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_MED);
}

/**
 * Arrow-key focus navigation across occurrence cards. In RTL, the visual
 * order is reversed, so ArrowRight moves to the previous card (inline-start)
 * and ArrowLeft moves to the next (inline-end).
 */
function onCardKeydown(event: KeyboardEvent, index: number) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const scroller = scrollerEl.value;
  if (!scroller) return;
  const isRtl = getComputedStyle(scroller).direction === 'rtl';
  const forwardKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
  const delta = event.key === forwardKey ? 1 : -1;
  const next = index + delta;
  const cards = scroller.querySelectorAll<HTMLElement>('[data-testid="occurrence-card"]');
  const target = cards[next];
  if (!target) return;
  event.preventDefault();
  target.focus();
}

onMounted(() => {
  loadInitial();
});
</script>

<template>
  <section class="cancellations-panel" aria-labelledby="cancellations-panel-title">
    <h3 id="cancellations-panel-title" class="panel-title">{{ t('panel_title') }}</h3>

    <div
      ref="scroller"
      class="occurrence-scroller"
      role="region"
      :aria-label="t('aria_scroller')"
      :aria-busy="loading"
    >
      <span class="sr-only" aria-live="polite" aria-atomic="true">
        {{ loading ? t('loading') : '' }}
      </span>

      <template v-if="showEmpty">
        <div
          class="occurrence-card occurrence-card--terminal"
          data-testid="scroller-empty-card"
        >
          <p class="occurrence-card__text">
            {{ t('no_occurrences_after', { month: emptyMonthLabel }) }}
          </p>
          <div class="occurrence-card__action">
            <PillButton
              size="sm"
              variant="secondary"
              data-testid="scroller-start-from-today"
              @click="onStartFromToday"
            >
              {{ t('start_from_today_button') }}
            </PillButton>
          </div>
        </div>
      </template>

      <template v-else>
        <article
          v-for="(o, idx) in occurrences"
          :key="o.start"
          class="occurrence-card"
          :class="`occurrence-card--state-${o.state}`"
          data-testid="occurrence-card"
          tabindex="0"
          :aria-labelledby="`card-time-${o.start}`"
          @keydown="onCardKeydown($event, idx)"
        >
          <time
            :id="`card-time-${o.start}`"
            class="occurrence-card__date"
            :datetime="o.start"
          >
            {{ formatStart(o.start) }}
          </time>

          <span
            v-if="o.state === 'cancelled-shown'"
            class="occurrence-card__badge occurrence-card__badge--warning"
            data-testid="badge-cancelled"
          >
            {{ t('cancelled_badge') }}
          </span>
          <span
            v-else-if="o.state === 'hidden'"
            class="occurrence-card__badge occurrence-card__badge--subtle"
            data-testid="badge-hidden"
          >
            {{ t('hidden_badge') }}
          </span>

          <div class="occurrence-card__action">
            <PillButton
              v-if="o.state === 'active'"
              size="sm"
              variant="secondary"
              data-testid="occurrence-card-cancel"
              @click="onCancelClick(o.start)"
            >
              {{ t('cancel_button') }}
            </PillButton>
            <PillButton
              v-else
              size="sm"
              variant="ghost"
              data-testid="occurrence-card-restore"
              @click="onRestoreClick(o.start)"
            >
              {{ t('restore_button') }}
            </PillButton>
          </div>
        </article>

        <div
          class="occurrence-card occurrence-card--control"
          data-testid="scroller-jump-card"
        >
          <label class="occurrence-card__label" :for="`${event.id}-jump`">
            {{ t('jump_label') }}
          </label>
          <input
            :id="`${event.id}-jump`"
            v-model="jumpMonth"
            type="month"
            class="occurrence-card__input"
            :placeholder="t('jump_placeholder')"
            data-testid="scroller-jump-input"
          />
          <div class="occurrence-card__action">
            <PillButton
              size="sm"
              variant="secondary"
              data-testid="scroller-jump-submit"
              @click="onJumpSubmit"
            >
              {{ t('jump_submit_button') }}
            </PillButton>
          </div>
        </div>

        <button
          v-if="hasMore"
          type="button"
          class="occurrence-card occurrence-card--control occurrence-card--clickable"
          data-testid="scroller-show-more-card"
          :aria-label="t('show_more_button')"
          @click="onShowMore"
        >
          <span class="occurrence-card__label">{{ t('show_more_button') }}</span>
        </button>
        <div
          v-else
          class="occurrence-card occurrence-card--terminal"
          data-testid="scroller-terminal-card"
        >
          <p class="occurrence-card__text">{{ t('no_further_occurrences') }}</p>
        </div>
      </template>
    </div>

    <EventCancelConfirmModal
      v-if="pendingCancelStart"
      @confirm="onConfirmCancel"
      @close="onCloseConfirm"
    />
  </section>
</template>

<style scoped lang="scss">
// Scoped locals for card-width clamp literals so component tests and
// token-auditors see the single source of truth.
.cancellations-panel {
  --_card-min-w: 160px;
  --_card-max-w: 220px;
  --_card-min-h: 150px;

  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
}

.panel-title {
  margin: 0;
  font-size: var(--pav-font-size-h6);
  font-weight: var(--pav-font-weight-semibold);
  color: var(--pav-text-primary);
}

.occurrence-scroller {
  display: flex;
  gap: var(--pav-space-sm);
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-block: var(--pav-space-xs);
  padding-inline: var(--pav-space-md);

  @media (prefers-reduced-motion: reduce) {
    scroll-behavior: auto;
    scroll-snap-type: none;
  }
}

.occurrence-card {
  flex: 0 0 auto;
  width: clamp(var(--_card-min-w), 42vw, var(--_card-max-w));
  min-height: var(--_card-min-h);
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-xs);
  padding: var(--pav-space-3);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-md);
  background: var(--pav-surface-secondary);
  scroll-snap-align: start;
  font: inherit;
  color: inherit;
  text-align: start;

  &:focus-visible {
    outline: 2px solid var(--pav-color-brand-primary);
    outline-offset: 2px;
  }

  &--state-cancelled-shown,
  &--state-hidden {
    opacity: 0.85;
  }

  &--control,
  &--terminal {
    align-items: flex-start;
    justify-content: center;
  }

  &--clickable {
    cursor: pointer;
  }

  &__date {
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-text-primary);
  }

  &__label {
    font-weight: var(--pav-font-weight-semibold);
    color: var(--pav-text-primary);
  }

  &__text {
    margin: 0;
    color: var(--pav-text-secondary);
  }

  &__action {
    margin-block-start: auto;
  }

  &__input {
    width: 100%;
    padding-block: var(--pav-space-xs);
    padding-inline: var(--pav-space-sm);
    border: var(--pav-border-width-1) solid var(--pav-border-primary);
    border-radius: var(--pav-border-radius-sm);
    background: var(--pav-surface-primary);
    color: var(--pav-text-primary);
  }
}
</style>
