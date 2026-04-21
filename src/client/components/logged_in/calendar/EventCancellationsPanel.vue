<script setup lang="ts">
/**
 * EventCancellationsPanel
 *
 * Container panel for managing cancellations on a recurring event's
 * upcoming instances. Lists upcoming materialized occurrences alongside
 * already-hidden exclusion dates (derived from the event's schedules),
 * letting the calendar owner cancel active instances or restore
 * cancelled-shown instances.
 *
 * States rendered per row:
 *  - active: instance with isCancelled=false → offers a Cancel button that
 *    opens {@link EventCancelConfirmModal}. On confirm, calls the client
 *    service's cancelEventInstance with the emitted hideFromPublic value.
 *  - cancelled-shown: instance with isCancelled=true → offers a Restore
 *    button that calls restoreEventInstance directly (no modal).
 *  - hidden: derived from event.schedules with isExclusion && hideFromPublic.
 *    These dates do not materialize as instances; the row is informational.
 *
 * Props:
 * @prop {CalendarEvent} event - The recurring event whose cancellations are managed
 * @prop {CalendarEventInstance[]} instances - Currently materialized upcoming instances
 */

import { computed, ref } from 'vue';
import { DateTime } from 'luxon';
import { useTranslation } from 'i18next-vue';

import PillButton from '@/client/components/common/pill-button.vue';
import EventCancelConfirmModal from '@/client/components/logged_in/calendar/EventCancelConfirmModal.vue';
import EventService from '@/client/service/event';
import type { CalendarEvent } from '@/common/model/events';
import type CalendarEventInstance from '@/common/model/event_instance';

type RowKind = 'active' | 'cancelled-shown' | 'hidden';

interface Row {
  key: string;
  kind: RowKind;
  start: DateTime;
  instanceId: string | null;
}

const props = defineProps<{
  event: CalendarEvent;
  instances: CalendarEventInstance[];
}>();

const { t } = useTranslation('event_editor', {
  keyPrefix: 'cancellations',
});

const eventService = new EventService();

// Holds the instance currently being cancelled; drives modal visibility.
const pendingCancelInstanceId = ref<string | null>(null);

const rows = computed<Row[]>(() => {
  const result: Row[] = [];

  for (const instance of props.instances) {
    result.push({
      key: `instance-${instance.id}`,
      kind: instance.isCancelled ? 'cancelled-shown' : 'active',
      start: instance.start,
      instanceId: instance.id,
    });
  }

  // Hidden cancellations are inferred from the event's schedules: an
  // exclusion schedule with hideFromPublic=true represents a date the
  // server suppresses from materialization (EXDATE semantics).
  const schedules = props.event?.schedules ?? [];
  for (const schedule of schedules) {
    if (!schedule.isExclusion || !schedule.hideFromPublic || !schedule.startDate) {
      continue;
    }
    result.push({
      key: `hidden-${schedule.id || schedule.startDate.toMillis()}`,
      kind: 'hidden',
      start: schedule.startDate,
      instanceId: null,
    });
  }

  // Stable ordering: earliest start first.
  result.sort((a, b) => a.start.toMillis() - b.start.toMillis());
  return result;
});

function formatStart(start: DateTime): string {
  return start.toLocaleString(DateTime.DATETIME_MED);
}

function onCancelClick(instanceId: string) {
  pendingCancelInstanceId.value = instanceId;
}

async function onConfirmCancel(payload: { hideFromPublic: boolean }) {
  const instanceId = pendingCancelInstanceId.value;
  pendingCancelInstanceId.value = null;
  if (!instanceId) {
    return;
  }
  try {
    await eventService.cancelEventInstance(props.event.id, instanceId, payload.hideFromPublic);
  }
  catch (error) {
    // Service layer logs the error; swallow here so the panel stays mounted.
    console.error('EventCancellationsPanel: cancelEventInstance failed', error);
  }
}

function onCloseConfirm() {
  pendingCancelInstanceId.value = null;
}

async function onRestoreClick(instanceId: string) {
  try {
    await eventService.restoreEventInstance(props.event.id, instanceId);
  }
  catch (error) {
    console.error('EventCancellationsPanel: restoreEventInstance failed', error);
  }
}
</script>

<template>
  <section class="cancellations-panel" aria-labelledby="cancellations-panel-title">
    <h3 id="cancellations-panel-title" class="panel-title">{{ t('panel_title') }}</h3>

    <p v-if="rows.length === 0" class="empty-state">{{ t('no_upcoming') }}</p>

    <ul v-else class="instance-list">
      <li
        v-for="row in rows"
        :key="row.key"
        data-testid="cancellations-item"
        class="instance-row"
        :class="`instance-row--${row.kind}`"
      >
        <div class="instance-info">
          <time class="instance-start" :datetime="row.start.toISO() ?? ''">
            {{ formatStart(row.start) }}
          </time>
          <span
            v-if="row.kind === 'cancelled-shown'"
            data-testid="badge-cancelled"
            class="badge badge--cancelled"
          >
            {{ t('cancelled_badge') }}
          </span>
          <span
            v-else-if="row.kind === 'hidden'"
            data-testid="badge-hidden"
            class="badge badge--hidden"
          >
            {{ t('hidden_badge') }}
          </span>
        </div>

        <div class="instance-actions">
          <PillButton
            v-if="row.kind === 'active' && row.instanceId"
            size="sm"
            variant="secondary"
            data-testid="cancel-instance-button"
            @click="onCancelClick(row.instanceId)"
          >
            {{ t('cancel_button') }}
          </PillButton>
          <PillButton
            v-else-if="row.kind === 'cancelled-shown' && row.instanceId"
            size="sm"
            variant="ghost"
            data-testid="restore-instance-button"
            @click="onRestoreClick(row.instanceId)"
          >
            {{ t('restore_button') }}
          </PillButton>
        </div>
      </li>
    </ul>

    <EventCancelConfirmModal
      v-if="pendingCancelInstanceId"
      @confirm="onConfirmCancel"
      @close="onCloseConfirm"
    />
  </section>
</template>

<style scoped lang="scss">
.cancellations-panel {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-md);
}

.panel-title {
  margin: 0;
  font-size: var(--pav-font-size-heading-sm);
  font-weight: var(--pav-font-weight-semibold);
  color: var(--pav-text-primary);
}

.empty-state {
  margin: 0;
  color: var(--pav-text-secondary);
  font-size: var(--pav-font-size-body);
}

.instance-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-sm);
}

.instance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pav-space-sm);
  padding: var(--pav-space-md);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-md);
  background: var(--pav-surface-secondary);

  &--cancelled-shown,
  &--hidden {
    opacity: 0.85;
  }
}

.instance-info {
  display: flex;
  align-items: center;
  gap: var(--pav-space-sm);
  min-width: 0;
  flex-wrap: wrap;
}

.instance-start {
  font-weight: var(--pav-font-weight-medium);
  color: var(--pav-text-primary);
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: var(--pav-font-size-small);
  font-weight: var(--pav-font-weight-medium);
  background: var(--pav-surface-primary);
  color: var(--pav-text-secondary);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);

  &--cancelled {
    color: var(--pav-text-warning, var(--pav-text-primary));
  }

  &--hidden {
    color: var(--pav-text-secondary);
  }
}

.instance-actions {
  display: flex;
  align-items: center;
  gap: var(--pav-space-xs);
  flex-shrink: 0;
}
</style>
