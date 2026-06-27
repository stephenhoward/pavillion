<script setup lang="ts">
/**
 * SingleEventCancelControl
 *
 * Cancel/Restore action for a single (non-recurring) event — i.e. an event
 * whose only positive schedule materializes exactly one occurrence. Cancelling
 * is show-as-cancelled ONLY: the EventCancelConfirmModal is reused with
 * allowHide=false so the "hide from public" toggle is suppressed and the
 * cancellation always emits hideFromPublic:false.
 *
 * State is flipped in place after cancel/restore — no refetch — mirroring
 * EventCancellationsPanel.
 *
 * Props:
 * @prop {CalendarEvent} event - The single-occurrence event being managed.
 */

import { computed, nextTick, onMounted, ref } from 'vue';
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

const state = ref<UpcomingOccurrence['state'] | null>(null);
const showConfirm = ref(false);

// Refs on a PillButton resolve to its component instance, not the native
// <button>; the element is reached via `$el`. Used to return focus after the
// trigger that was activated is removed from the DOM on a state flip
// (WCAG 2.4.3). Mirrors the $el fallback in places-tab.vue.
const cancelButtonRef = ref(null);
const restoreButtonRef = ref(null);

function focusPillButton(buttonRef: typeof cancelButtonRef) {
  const el = (buttonRef.value as { $el?: HTMLElement } | null)?.$el;
  el?.focus();
}

/**
 * The lone positive (non-exclusion) schedule's start. A single event has
 * exactly one positive schedule with frequency:null that materializes one
 * occurrence; that occurrence's start is the cancellation key.
 */
const occurrenceStart = computed<DateTime | null>(() => {
  const positive = props.event.schedules.filter(s => !s.isExclusion);
  return positive.length === 1 ? positive[0].startDate : null;
});

async function loadState() {
  const start = occurrenceStart.value;
  if (!start) return;
  try {
    // Single-occurrence state read: we anchor one millisecond before the
    // occurrence and read the returned occurrence's `state` field (active /
    // cancelled-shown / hidden), past or future — NOT its absence. The editor
    // schedule rows are not the source of truth for cancellation: reconcileSchedules
    // rejects exclusion rows in its update payload, so a cancellation never
    // round-trips through the editor model.
    const result = await eventService.listUpcomingOccurrences(
      props.event.id,
      start.minus({ milliseconds: 1 }).toISO()!,
      1,
    );
    state.value = result.occurrences[0]?.state ?? 'active';
  }
  catch (error) {
    console.error('SingleEventCancelControl: listUpcomingOccurrences failed', error);
  }
}

function onCancelClick() {
  showConfirm.value = true;
}

async function onConfirmCancel() {
  showConfirm.value = false;
  const start = occurrenceStart.value;
  if (!start) return;
  try {
    // Show-as-cancelled only: hideFromPublic is always false here.
    await eventService.cancelOccurrence(props.event.id, start.toISO()!, false);
    state.value = 'cancelled-shown';
    // The cancel trigger has just been unmounted; return focus to the Restore
    // button that replaced it so focus doesn't drop to <body> (WCAG 2.4.3).
    await nextTick();
    focusPillButton(restoreButtonRef);
  }
  catch (error) {
    console.error('SingleEventCancelControl: cancelOccurrence failed', error);
  }
}

function onCloseConfirm() {
  showConfirm.value = false;
}

async function onRestoreClick() {
  const start = occurrenceStart.value;
  if (!start) return;
  try {
    await eventService.restoreOccurrence(props.event.id, start.toISO()!);
    state.value = 'active';
    // The Restore button has just been unmounted; return focus to the cancel
    // trigger that replaced it so focus doesn't drop to <body> (WCAG 2.4.3).
    await nextTick();
    focusPillButton(cancelButtonRef);
  }
  catch (error) {
    console.error('SingleEventCancelControl: restoreOccurrence failed', error);
  }
}

onMounted(() => {
  loadState();
});
</script>

<template>
  <div class="single-cancel-control" data-testid="single-event-cancel-control">
    <!--
      The live region is rendered unconditionally so its content change is
      announced when the event is cancelled (WCAG 4.1.3). Toggling the element
      in/out with v-if means it enters the DOM already-populated, which some
      screen readers do not announce. The text is empty while active (or still
      loading) and carries the cancelled-status copy once cancelled.
    -->
    <span
      class="single-cancel-control__status"
      role="status"
      data-testid="single-event-cancelled-status"
    >
      {{ state && state !== 'active' ? t('single_cancelled_status') : '' }}
    </span>

    <PillButton
      v-if="state === 'active'"
      ref="cancelButtonRef"
      size="sm"
      variant="secondary"
      data-testid="single-event-cancel"
      @click="onCancelClick"
    >
      {{ t('single_cancel_button') }}
    </PillButton>

    <PillButton
      v-else-if="state"
      ref="restoreButtonRef"
      size="sm"
      variant="ghost"
      data-testid="single-event-restore"
      @click="onRestoreClick"
    >
      {{ t('single_restore_button') }}
    </PillButton>

    <EventCancelConfirmModal
      v-if="showConfirm"
      :allow-hide="false"
      @confirm="onConfirmCancel"
      @close="onCloseConfirm"
    />
  </div>
</template>

<style scoped lang="scss">
.single-cancel-control {
  display: flex;
  align-items: center;
  gap: var(--pav-space-sm);

  &__status {
    font-weight: var(--pav-font-weight-semibold);
    color: var(--pav-text-secondary);
  }
}
</style>
