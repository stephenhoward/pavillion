<script setup lang="ts">
import { ref, useId } from 'vue';
import { useTranslation } from 'i18next-vue';
import PillButton from '@/client/components/common/pill-button.vue';
import Sheet from '@/client/components/common/sheet.vue';

/**
 * EventCancelConfirmModal
 *
 * Sheet-based confirmation dialog shown when a calendar owner cancels a
 * recurring event instance. Presents the cancellation copy plus a
 * "Hide from public" checkbox, and emits the owner's choice back to the
 * consumer. This component is intentionally dumb: no service or store
 * calls happen here — the consumer wires the `confirm` event to the
 * actual cancellation action.
 *
 * Props:
 * @prop {boolean} allowHide - When false, the "Hide from public" toggle is
 *   suppressed and confirm always emits hideFromPublic:false. Used by the
 *   single-event cancel control where cancellation is show-as-cancelled only.
 *   Defaults to true so the recurring-instance flow is unchanged.
 *
 * Emits:
 * @emits confirm - Fired when the user submits the confirmation
 *   @param {{ hideFromPublic: boolean }} payload
 * @emits close - Fired when the user cancels or dismisses the dialog
 */

const props = withDefaults(
  defineProps<{
    allowHide?: boolean;
  }>(),
  {
    allowHide: true,
  },
);

const emit = defineEmits<{
  (e: 'confirm', payload: { hideFromPublic: boolean }): void;
  (e: 'close'): void;
}>();

const { t } = useTranslation('event_editor', {
  keyPrefix: 'cancellations',
});

const hideFromPublic = ref(false);
const hideToggleId = useId();
const hideDescriptionId = useId();

function onSubmit() {
  emit('confirm', {
    hideFromPublic: props.allowHide ? hideFromPublic.value : false,
  });
}

function onCancel() {
  emit('close');
}

function onSheetClose() {
  emit('close');
}
</script>

<template>
  <Sheet
    :title="t('confirm_title')"
    @close="onSheetClose"
  >
    <div class="cancel-confirm-body">
      <p class="confirm-message">{{ t('confirm_message') }}</p>

      <label v-if="allowHide" :for="hideToggleId" class="hide-toggle">
        <input
          :id="hideToggleId"
          v-model="hideFromPublic"
          type="checkbox"
          :aria-describedby="hideDescriptionId"
        />
        <span class="hide-toggle-text">
          <span class="hide-toggle-label">{{ t('hide_toggle_label') }}</span>
          <span :id="hideDescriptionId" class="hide-toggle-description">
            {{ t('hide_toggle_description') }}
          </span>
        </span>
      </label>

      <footer class="confirm-footer">
        <PillButton
          variant="ghost"
          data-testid="confirm-cancel"
          @click="onCancel"
        >
          {{ t('cancel_button') }}
        </PillButton>
        <PillButton
          variant="primary"
          data-testid="confirm-submit"
          @click="onSubmit"
        >
          {{ t('confirm_submit') }}
        </PillButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.cancel-confirm-body {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-lg);
}

.confirm-message {
  margin: 0;
  color: var(--pav-text-primary);
  font-size: var(--pav-font-size-body);
  line-height: var(--pav-line-height-body);
}

.hide-toggle {
  display: flex;
  gap: var(--pav-space-sm);
  align-items: flex-start;
  padding: var(--pav-space-md);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-md);
  background: var(--pav-surface-secondary);
  cursor: pointer;

  input[type="checkbox"] {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }

  .hide-toggle-text {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-xs);
  }

  .hide-toggle-label {
    font-weight: var(--pav-font-weight-semibold);
    color: var(--pav-text-primary);
  }

  .hide-toggle-description {
    font-size: var(--pav-font-size-small);
    color: var(--pav-text-secondary);
    line-height: var(--pav-line-height-body);
  }
}

.confirm-footer {
  display: flex;
  gap: var(--pav-space-sm);
  justify-content: flex-end;
  padding-top: var(--pav-space-md);
  border-top: var(--pav-border-width-1) solid var(--pav-border-primary);
}
</style>
