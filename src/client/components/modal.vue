<template>
  <dialog
    ref="dialogRef"
    :class="['modal-dialog', props.modalClass]"
    :aria-labelledby="titleId"
    :aria-modal="true"
    @keydown.esc="close"
    @click="handleBackdropClick"
  >
    <div class="modal-content">
      <header class="modal-header">
        <h2 :id="titleId" class="title">{{ props.title }}</h2>
        <button
          type="button"
          class="close-button"
          @click="close"
          aria-label="Close dialog"
        >&times;</button>
      </header>
      <div class="modal-body">
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
@use '../assets/mixins' as *;

dialog.modal-dialog {
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
  z-index: 1;

  &::backdrop {
    background-color: rgba(0, 0, 0, 0.4);
  }

  .modal-content {
    margin: 0;
    padding: 20px;
    width: 100%;
    border-radius: 10px;
    background-color: $light-mode-background;
    color: $light-mode-text;

    @include dark-mode {
      background-color: $dark-mode-background;
      color: $dark-mode-text;
    }
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }

  .title {
    font-size: 16px;
    margin: 0;
    font-weight: bold;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    color: inherit;
    line-height: 1;

    &:hover, &:focus {
      opacity: 0.7;
    }
  }

  .modal-body {
    width: 100%;
  }
}

@include medium-size-device {
  dialog.modal-dialog {
    .modal-content {
      margin: 15% auto;
    }
  }
}

// Add styles for when modal is open to prevent background scrolling
:global(body.modal-open) {
  overflow: hidden;
}
</style>
