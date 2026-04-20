import { ref, computed, Ref, ComputedRef } from 'vue';

/**
 * Shared dialog behavior for <Modal> and <Sheet> components.
 *
 * Encapsulates the open/close lifecycle, Escape handling, backdrop clicks,
 * `document.body.classList` toggle for `modal-open`, a first-focusable focus
 * trap, and deterministic title id generation.
 *
 * Intentionally minimal: no configuration options, no extension points.
 */

export interface UseDialogOptions {
  /**
   * Prefix used for the generated `titleId`. Defaults to `'dialog'`.
   */
  idPrefix?: string;
}

export interface UseDialogReturn {
  /** The generated id to wire into `aria-labelledby` and the title element. */
  titleId: ComputedRef<string>;
  /** Opens the dialog via `showModal()`. No-op when already open or ref is null. */
  open: () => void;
  /** Closes the dialog via `close()`. No-op when not open or ref is null. */
  close: () => void;
  /** Closes the dialog when the click target is the dialog element itself. */
  handleBackdropClick: (event: MouseEvent) => void;
  /** Cleanup helper for `onBeforeUnmount`. */
  cleanup: () => void;
}

type CloseEmit = (event: 'close') => void;

/**
 * Sets up shared modal/sheet behavior for a native <dialog> element.
 *
 * @param dialogRef - Template ref pointing at the <dialog> element
 * @param emit - Component emit function, expected to support a 'close' event
 * @param options - Optional configuration (currently just idPrefix)
 */
export function useDialog(
  dialogRef: Ref<HTMLDialogElement | null>,
  emit: CloseEmit,
  options: UseDialogOptions = {},
): UseDialogReturn {
  const idPrefix = options.idPrefix ?? 'dialog';

  // Stable per-instance id. Using Math.random() matches the pre-refactor pattern
  // in modal.vue / Sheet.vue and avoids SSR mismatch concerns in this client-only
  // composable.
  const dialogId = ref(Math.random().toString(36).substring(2, 11));
  const titleId = computed(() => `${idPrefix}-title-${dialogId.value}`);

  const trapFocus = () => {
    // First-focusable focus trap: defer to the next tick so the dialog is in
    // the top layer before focusing.
    setTimeout(() => {
      dialogRef.value?.focus();
    }, 0);
  };

  const open = () => {
    const el = dialogRef.value;
    // No-op when the DOM target is missing or already open (concurrent open).
    if (!el || el.open) {
      return;
    }
    el.showModal();
    trapFocus();
    if (typeof document !== 'undefined') {
      document.body.classList.add('modal-open');
    }
  };

  const close = () => {
    const el = dialogRef.value;
    if (!el || !el.open) {
      return;
    }
    el.close();
    if (typeof document !== 'undefined') {
      document.body.classList.remove('modal-open');
    }
    emit('close');
  };

  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target === dialogRef.value) {
      close();
    }
  };

  const cleanup = () => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('modal-open');
    }
  };

  return {
    titleId,
    open,
    close,
    handleBackdropClick,
    cleanup,
  };
}
