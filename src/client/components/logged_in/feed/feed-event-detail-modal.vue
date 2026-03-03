<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { type FeedEvent } from '@/client/service/feed';

const { t } = useTranslation('feed', { keyPrefix: 'events' });

const props = defineProps<{
  event: FeedEvent;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'repost', domEvent: MouseEvent): void;
  (e: 'unrepost'): void;
  (e: 'report', domEvent: MouseEvent): void;
}>();

/** Unique ID for accessible label association. */
const dialogId = Math.random().toString(36).substring(2, 11);
const titleId = computed(() => `feed-detail-modal-title-${dialogId}`);

const dialogRef = ref<HTMLDialogElement | null>(null);

/**
 * Format event date and time for display.
 * Reads the start date from the first schedule, falling back to the legacy date field.
 */
const formattedDate = computed(() => {
  const scheduleStart = props.event.schedules?.[0]?.startDate;
  if (scheduleStart) {
    try {
      const dt: DateTime = scheduleStart instanceof DateTime
        ? scheduleStart
        : DateTime.fromISO(String(scheduleStart));
      return dt.toLocaleString(DateTime.DATETIME_MED);
    }
    catch (error) {
      console.error('Error formatting schedule date:', error);
    }
  }

  if (!props.event.date) {
    return '';
  }

  try {
    const dt = DateTime.fromISO(props.event.date);
    return dt.toLocaleString(DateTime.DATETIME_MED);
  }
  catch (error) {
    console.error('Error formatting date:', error);
    return props.event.date;
  }
});

/**
 * Get the event title in the appropriate language.
 */
const eventTitle = computed(() => {
  if (!props.event || typeof props.event.content !== 'function') {
    return '';
  }
  const content = props.event.content('en'); // TODO: Use user's preferred language
  return content?.name || t('untitled_event');
});

/**
 * Get the event description in the appropriate language (full, not truncated).
 */
const eventDescription = computed(() => {
  const content = props.event.content('en'); // TODO: Use user's preferred language
  return content?.description || '';
});

/**
 * Get the calendar identifier for display.
 */
const calendarIdentifier = computed(() => {
  return props.event.sourceCalendarActorId || t('unknown_calendar');
});

/**
 * Get the event location name when available.
 */
const eventLocation = computed(() => {
  return props.event.location?.name || '';
});

/**
 * Open the modal dialog.
 */
function open() {
  if (dialogRef.value && !dialogRef.value.open) {
    dialogRef.value.showModal();
    document.body.classList.add('modal-open');
  }
}

/**
 * Close the modal dialog and emit close event.
 */
function close() {
  if (dialogRef.value && dialogRef.value.open) {
    dialogRef.value.close();
  }
  document.body.classList.remove('modal-open');
  emit('close');
}

/**
 * Handle backdrop clicks to close the modal.
 */
function handleBackdropClick(event: MouseEvent) {
  if (event.target === dialogRef.value) {
    close();
  }
}

onMounted(() => {
  open();
});

onBeforeUnmount(() => {
  document.body.classList.remove('modal-open');
});

defineExpose({ open, close });
</script>

<template>
  <dialog
    ref="dialogRef"
    class="feed-detail-dialog"
    :aria-labelledby="titleId"
    :aria-modal="true"
    @keydown.esc="close"
    @click="handleBackdropClick"
  >
    <div class="feed-detail-dialog__content">
      <header class="feed-detail-dialog__header">
        <h2
          :id="titleId"
          class="feed-detail-dialog__title"
        >
          {{ eventTitle }}
        </h2>
        <button
          type="button"
          class="btn btn--ghost feed-detail-dialog__close"
          :aria-label="t('close_aria_label')"
          @click="close"
        >&times;</button>
      </header>

      <div class="feed-detail-dialog__body">
        <p
          v-if="formattedDate"
          class="feed-detail-dialog__date"
        >
          {{ formattedDate }}
        </p>

        <p
          v-if="eventLocation"
          class="feed-detail-dialog__location"
        >
          {{ eventLocation }}
        </p>

        <p
          v-if="eventDescription"
          class="feed-detail-dialog__description"
        >
          {{ eventDescription }}
        </p>

        <p class="feed-detail-dialog__source">
          {{ calendarIdentifier }}
        </p>
      </div>

      <footer class="feed-detail-dialog__actions">
        <!-- Not reposted - show Repost button -->
        <button
          v-if="event.repostStatus === 'none'"
          type="button"
          class="repost-button"
          data-testid="modal-repost-button"
          :aria-label="t('repost_aria_label', { eventTitle })"
          @click="emit('repost', $event)"
        >
          {{ t('repost_button') }}
        </button>

        <!-- Manually reposted - show clickable label to unrepost -->
        <button
          v-else-if="event.repostStatus === 'manual'"
          type="button"
          class="reposted-label"
          data-testid="modal-reposted-label"
          :aria-label="t('unrepost_aria_label', { eventTitle })"
          @click="emit('unrepost')"
        >
          {{ t('reposted_button') }}
        </button>

        <!-- Auto-posted - show non-clickable label -->
        <span
          v-else-if="event.repostStatus === 'auto'"
          class="auto-posted-label"
          data-testid="modal-auto-posted-label"
        >
          {{ t('auto_posted_label') }}
        </span>

        <button
          type="button"
          class="report-button"
          data-testid="modal-report-button"
          :aria-label="t('report_aria_label', { eventTitle })"
          @click="emit('report', $event)"
        >
          {{ t('report_button') }}
        </button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
.feed-detail-dialog {
  position: fixed;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  overflow: auto;
  z-index: var(--pav-z-index-modal);

  &::backdrop {
    background-color: rgb(0 0 0 / 50%);
    backdrop-filter: blur(4px);
  }
}

.feed-detail-dialog__content {
  margin-block-start: 10vh;
  margin-inline: auto;
  padding: var(--pav-space-xl);
  width: 100%;
  max-width: 560px;
  background-color: var(--pav-surface-primary);
  border-radius: var(--pav-border-radius-modal);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  box-shadow: var(--pav-shadow-modal);

  @media (max-width: 768px) {
    margin: var(--pav-space-md);
    max-width: calc(100% - var(--pav-space-xl));
  }
}

.feed-detail-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-block-end: var(--pav-space-lg);
  padding-block-end: var(--pav-space-md);
  border-block-end: var(--pav-border-width-1) solid var(--pav-border-subtle);
}

.feed-detail-dialog__title {
  margin: 0;
  font-size: var(--pav-font-size-h5);
  font-weight: var(--pav-font-weight-semibold);
  color: var(--pav-text-primary);
  flex: 1;
  padding-inline-end: var(--pav-space-md);
}

.feed-detail-dialog__close {
  font-size: var(--pav-font-size-xl);
  line-height: 1;
  min-width: 44px;
  min-height: 44px;
  flex-shrink: 0;
}

.feed-detail-dialog__body {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-sm);
  margin-block-end: var(--pav-space-lg);
}

.feed-detail-dialog__date {
  margin: 0;
  font-size: var(--pav-font-size-sm);
  color: var(--pav-text-secondary);
  font-weight: var(--pav-font-weight-medium);
}

.feed-detail-dialog__location {
  margin: 0;
  font-size: var(--pav-font-size-sm);
  color: var(--pav-text-secondary);
}

.feed-detail-dialog__description {
  margin: 0;
  font-size: var(--pav-font-size-body);
  color: var(--pav-text-primary);
  line-height: var(--pav-line-height-relaxed);
  white-space: pre-line;
}

.feed-detail-dialog__source {
  margin: 0;
  font-size: var(--pav-font-size-caption);
  color: var(--pav-text-muted);
  font-style: italic;
}

.feed-detail-dialog__actions {
  display: flex;
  align-items: center;
  gap: var(--pav-space-2);
  padding-block-start: var(--pav-space-lg);
  border-block-start: var(--pav-border-width-1) solid var(--pav-border-subtle);

  button.repost-button {
    padding: var(--pav-space-2) var(--pav-space-4);
    background: var(--pav-color-orange-500);
    color: var(--pav-color-text-inverse);
    border: none;
    border-radius: var(--pav-border-radius-sm);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    cursor: pointer;
    transition: background 0.2s ease;

    &:hover {
      background: var(--pav-color-orange-600);
    }

    &:active {
      background: var(--pav-color-orange-700);
    }
  }

  button.reposted-label {
    padding: var(--pav-space-2) var(--pav-space-4);
    background: var(--pav-color-success);
    color: var(--pav-color-text-inverse);
    border: none;
    border-radius: var(--pav-border-radius-sm);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
    cursor: pointer;
    transition: background 0.2s ease;

    &:hover {
      filter: brightness(0.85);
    }

    &:active {
      filter: brightness(0.75);
    }
  }

  span.auto-posted-label {
    padding: var(--pav-space-2) var(--pav-space-4);
    background: var(--pav-color-stone-500);
    color: var(--pav-color-text-inverse);
    border-radius: var(--pav-border-radius-sm);
    font-size: var(--pav-font-size-xs);
    font-weight: var(--pav-font-weight-medium);
  }

  button.report-button {
    padding: var(--pav-space-2) var(--pav-space-3);
    background: transparent;
    color: var(--pav-color-text-secondary);
    border: 1px solid var(--pav-color-border-primary);
    border-radius: var(--pav-border-radius-sm);
    font-size: var(--pav-font-size-xs);
    cursor: pointer;
    transition: color 0.2s ease, border-color 0.2s ease;

    &:hover {
      color: var(--pav-color-error);
      border-color: var(--pav-color-error);
    }

    &:active {
      opacity: 0.8;
    }
  }
}

// Prevent background scroll when modal is open
:global(body.modal-open) {
  overflow: hidden;
}
</style>
