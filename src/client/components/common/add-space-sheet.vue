<script setup lang="ts">
/**
 * Add-space sheet — opens from the per-Place add-space action in the location
 * picker. Wraps SpacesEditor (with the per-row delete affordance hidden) over
 * a working buffer cloned from the target Place. Save persists the snapshot
 * via LocationService.updateLocation; cancel walks away without writing.
 *
 * Component split rationale (parent epic pv-s6s3 design): edit-place's full
 * editor stays on its dedicated route; this sheet is a focused inline flow
 * for the common "I just need to add one room" case from the event editor.
 * Removal is intentionally out of scope here — the editor's per-row delete
 * needs the eventCount-aware reassign branch which lives on the full
 * edit-place screen.
 */
import { ref, nextTick, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import Sheet from '@/client/components/common/Sheet.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import SpacesEditor from '@/client/components/logged_in/calendar/SpacesEditor.vue';
import LocationService from '@/client/service/location';
import { cloneLocationForBuffer } from '@/client/composables/location-helpers';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import { ValidationError } from '@/common/exceptions';

const props = defineProps<{
  place: EventLocation;
  calendarId: string;
}>();

const emit = defineEmits<{
  (e: 'saved', updatedPlace: EventLocation): void;
  (e: 'cancelled'): void;
  (e: 'close'): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'places.add_space' });

const locationService = new LocationService();

/**
 * Working buffer of Spaces. Cloned from `props.place.spaces` so SpacesEditor
 * mutations (add / inline edit) never reach back into the parent's
 * availableLocations array. On save we re-clone from `props.place` so the
 * full Place state (name, address, content, etc.) goes to the server PUT.
 */
const buffer = ref<EventLocationSpace[]>(cloneLocationForBuffer(props.place).spaces);

const submissionError = ref('');
const isSaving = ref(false);
const submissionErrorEl = ref<HTMLElement | null>(null);

watch(submissionError, async (newVal) => {
  if (newVal) {
    await nextTick();
    submissionErrorEl.value?.focus();
  }
});

async function handleSave() {
  submissionError.value = '';
  isSaving.value = true;

  // Build a snapshot from the original Place plus the working buffer's spaces.
  // The clone preserves all fields (name, address, content, etc.) so the
  // server PUT operates on the full Place state.
  const snapshot = cloneLocationForBuffer(props.place);
  snapshot.spaces = buffer.value;

  try {
    const updated = await locationService.updateLocation(props.calendarId, snapshot);
    emit('saved', updated);
  }
  catch (error: unknown) {
    if (error instanceof ValidationError) {
      submissionError.value = error.message;
    }
    else {
      submissionError.value = (error as Error)?.message || t('error_saving');
    }
  }
  finally {
    isSaving.value = false;
  }
}

function handleCancel() {
  emit('cancelled');
  emit('close');
}
</script>

<template>
  <Sheet
    :title="t('title', { name: props.place.name })"
    @close="handleCancel"
  >
    <div class="add-space-body">
      <SpacesEditor
        :spaces="buffer"
        :hide-remove="true"
        @update:spaces="buffer = $event"
      />

      <div
        v-if="submissionError"
        ref="submissionErrorEl"
        class="alert alert--error"
        role="alert"
        tabindex="-1"
      >
        {{ submissionError }}
      </div>

      <footer class="modal-actions">
        <PillButton
          variant="ghost"
          size="sm"
          :disabled="isSaving"
          @click="handleCancel"
        >
          {{ t('cancel_button') }}
        </PillButton>
        <PillButton
          variant="primary"
          size="sm"
          :disabled="isSaving"
          @click="handleSave"
        >
          {{ t('save_button') }}
        </PillButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.add-space-body {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-lg);
  min-height: 0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--pav-space-sm);
  padding-top: var(--pav-space-md);
  border-top: var(--pav-border-width-1) solid var(--pav-border-primary);
}
</style>
