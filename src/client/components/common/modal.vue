<template>
  <dialog
    ref="dialogRef"
    :class="['modal modal-dialog', props.modalClass]"
    :aria-labelledby="titleId"
    :aria-modal="true"
    @keydown.esc="close"
    @click="handleBackdropClick"
  >
    <div>
      <header>
        <h2 :id="titleId">{{ props.title }}</h2>
        <button
          class="btn--ghost"
          type="button"
          @click="close"
          aria-label="Close dialog"
          data-variant="ghost"
        >&times;</button>
      </header>
      <div>
        <slot/>
      </div>
    </div>
  </dialog>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';

const props = defineProps({
  title: String,
  modalClass: String,
  // In this application, modals are typically conditionally rendered with v-if.
  // When initiallyOpen=true (default), the dialog opens automatically when mounted,
  // which aligns with the v-if pattern - the component is only in the DOM when it should be visible.
  initiallyOpen: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['close']);
const dialogRef = ref(null);
const titleId = computed(() => `modal-title-${dialogId}`);
const dialogId = Math.random().toString(36).substring(2, 11);

// Methods to control the dialog
const open = () => {
  if (dialogRef.value && !dialogRef.value.open) {
    dialogRef.value.showModal();
    trapFocus();
    document.body.classList.add('modal-open');
  }
};

const close = () => {
  if (dialogRef.value && dialogRef.value.open) {
    dialogRef.value.close();
    document.body.classList.remove('modal-open');
    emit('close');
  }
};

// Handle clicks on the backdrop (outside the modal content)
const handleBackdropClick = (event) => {
  if (event.target === dialogRef.value) {
    close();
  }
};

// Focus trap implementation
const trapFocus = () => {
  setTimeout(() => {
    dialogRef.value?.focus();
  }, 0);
};

// Lifecycle hooks
onMounted(() => {
  if (props.initiallyOpen) {
    open();
  }
});

onBeforeUnmount(() => {
  document.body.classList.remove('modal-open');
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
    background-color: rgba(0, 0, 0, 0.5);
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

    /* Close button uses semantic button with ghost variant */
    button {
      /* Semantic button styling applied automatically from base layer */
      /* data-variant="ghost" styling applied from ARIA roles layer */
    }
  }

  /* Modal body content area */
  > div > div:not(header) {
    width: 100%;
  }
}

/* Responsive design using CSS custom properties */
@media (min-width: 768px) {
  dialog.modal-dialog {
    > div {
      margin: 15% auto;
      max-width: 90vw;
      max-height: 90vh;
    }
  }
}

/* Prevent background scrolling when modal is open */
:global(body.modal-open) {
  overflow: hidden;
}
</style>
