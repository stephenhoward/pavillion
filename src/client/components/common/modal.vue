<template>
  <dialog
    ref="dialogRef"
    role="dialog"
    :class="['modal', 'modal-dialog', `modal-size-${size}`, props.modalClass]"
    :aria-labelledby="titleId"
    :aria-modal="true"
    @keydown.esc="close"
    @click="handleBackdropClick"
  >
    <div>
      <header>
        <h2 :id="titleId">{{ props.title }}</h2>
        <button
          type="button"
          @click="close"
          :aria-label="t('modal.close')"
        >&times;</button>
      </header>
      <div>
        <slot/>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, withDefaults } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useDialog } from '@/client/composables/useDialog';

export type ModalSize = 'md' | 'lg' | 'xl';

const { t } = useTranslation('system');

const props = withDefaults(defineProps<{
  title?: string;
  modalClass?: string;
  /**
   * In this application, modals are typically conditionally rendered with v-if.
   * When initiallyOpen=true (default), the dialog opens automatically when mounted,
   * which aligns with the v-if pattern - the component is only in the DOM when it
   * should be visible.
   */
  initiallyOpen?: boolean;
  /**
   * Maximum width size for the modal surface.
   * - 'md' ~ 32rem (default, most dialogs/confirmations)
   * - 'lg' ~ 40rem (forms like create-report, blocked-instances/reporters)
   * - 'xl' ~ 56rem (report-detail review dialog)
   */
  size?: ModalSize;
}>(), {
  initiallyOpen: true,
  size: 'md',
});

const emit = defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

const { titleId, open, close, handleBackdropClick, cleanup } = useDialog(
  dialogRef,
  emit,
  { idPrefix: 'modal' },
);

onMounted(() => {
  if (props.initiallyOpen) {
    open();
  }
});

onBeforeUnmount(() => {
  cleanup();
});

// Expose methods to parent components
defineExpose({ open, close });
</script>

<style scoped lang="scss">
/* Modal styling using semantic dialog element with design tokens */
dialog.modal-dialog {
  /* Override default dialog positioning for full-screen backdrop */
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
  z-index: 1000;

  /* Custom backdrop styling (semantic dialog::backdrop is styled in base layer) */
  &::backdrop {
    background-color: var(--pav-color-darken);
    backdrop-filter: blur(4px);
  }

  /* Modal content container - replaces .modal-content class with semantic structure */
  > div {
    margin: 0;
    padding: var(--pav-space-xl);
    width: 100%;
    border-radius: var(--pav-border-radius-modal);
    background-color: var(--pav-surface-primary);
    color: var(--pav-text-primary);
    border: var(--pav-border-width-1) solid var(--pav-border-primary);
    box-shadow: var(--pav-shadow-modal);
  }

  /* Semantic header element styling */
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--pav-space-lg);
    padding-bottom: var(--pav-space-sm);

    /* Heading in header inherits semantic styling from base layer */
    h2 {
      font-size: var(--pav-font-size-h4);
      margin: 0;
      color: var(--pav-text-primary);
    }

    /* Close button - transparent by default, round highlight on hover */
    button {
      background-color: transparent;
      border-color: transparent;
      color: var(--pav-text-secondary);

      &:hover:not(:disabled) {
        background-color: var(--pav-interactive-hover);
        border-color: transparent;
        border-radius: 50%;
        color: var(--pav-text-primary);
      }
    }
  }

  /* Modal body content area */
  > div > div:not(header) {
    width: 100%;
  }
}

/* Responsive design: size-aware max-width on desktop */
@media (min-width: 768px) {
  dialog.modal-dialog {
    > div {
      margin: 15% auto;
      max-height: 90vh;
    }

    &.modal-size-md > div {
      max-width: 32rem;
    }

    &.modal-size-lg > div {
      max-width: 40rem;
    }

    &.modal-size-xl > div {
      max-width: 56rem;
    }
  }
}

/* Prevent background scrolling when modal is open */
:global(body.modal-open) {
  overflow: hidden;
}
</style>
