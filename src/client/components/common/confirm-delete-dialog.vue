<script setup>
import ModalLayout from '@/client/components/common/modal.vue';
import PillButton from '@/client/components/common/pill-button.vue';

defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  isDeleting: {
    type: Boolean,
    default: false,
  },
  deleteLabel: {
    type: String,
    required: true,
  },
  cancelLabel: {
    type: String,
    required: true,
  },
  deletingLabel: {
    type: String,
    default: '',
  },
  modalClass: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['confirm', 'close']);

function handleClose() {
  emit('close');
}

function handleConfirm() {
  emit('confirm');
}
</script>

<template>
  <ModalLayout
    v-if="visible"
    :title="title"
    :modal-class="modalClass"
    @close="handleClose"
  >
    <div class="delete-dialog">
      <p class="dialog-description">
        {{ message }}
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn-ghost"
          @click="handleClose"
          :disabled="isDeleting"
        >
          {{ cancelLabel }}
        </button>
        <PillButton
          variant="danger"
          @click="handleConfirm"
          :disabled="isDeleting"
        >
          {{ isDeleting && deletingLabel ? deletingLabel : deleteLabel }}
        </PillButton>
      </div>
    </div>
  </ModalLayout>
</template>

<style scoped lang="scss">
@use '../../assets/style/components/calendar-admin' as *;

.delete-dialog {
  @include admin-dialog-layout;
}
</style>
