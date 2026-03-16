<template>
  <dialog
    ref="dialogRef"
    class="sheet-dialog"
    :aria-labelledby="titleId"
    :aria-modal="true"
    @keydown.esc="close"
    @click="handleBackdropClick"
  >
    <div class="sheet-content">
      <header class="sheet-header">
        <h2 :id="titleId">{{ props.title }}</h2>
        <button
          type="button"
          @click="close"
          :aria-label="t('modal.close')"
        >&times;</button>
      </header>
      <div class="sheet-body">
        <slot/>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('system');

const props = defineProps<{
  title: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const dialogId = Math.random().toString(36).substring(2, 11);
const titleId = computed(() => `sheet-title-${dialogId}`);

const open = () => {
  if (dialogRef.value && !dialogRef.value.open) {
    dialogRef.value.showModal();
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

const handleBackdropClick = (event: MouseEvent) => {
  if (event.target === dialogRef.value) {
    close();
  }
};

onMounted(() => {
  open();
});

onBeforeUnmount(() => {
  document.body.classList.remove('modal-open');
});

defineExpose({ open, close });
</script>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoint-mixins' as *;

.sheet-dialog {
  position: fixed;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  overflow: auto;
  z-index: 1000;

  /* Mobile: bottom sheet */
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;

  &::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }

  .sheet-content {
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    padding: var(--pav-space-xl);
    background-color: var(--pav-surface-primary);
    color: var(--pav-text-primary);
    border: var(--pav-border-width-1) solid var(--pav-border-primary);
    box-shadow: var(--pav-shadow-modal);

    /* Mobile: rounded top corners */
    border-radius: var(--pav-border-radius-modal) var(--pav-border-radius-modal) 0 0;
  }

  /* Desktop: centered modal */
  @include pav-media('md') {
    justify-content: center;
    align-items: center;

    .sheet-content {
      max-width: 32rem;
      max-height: 90vh;
      margin: auto;
      border-radius: var(--pav-border-radius-modal);
    }
  }
}

.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--pav-space-lg);
  padding-bottom: var(--pav-space-sm);

  h2 {
    font-size: var(--pav-font-size-h4);
    margin: 0;
    color: var(--pav-text-primary);
  }

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

.sheet-body {
  width: 100%;
}
</style>
