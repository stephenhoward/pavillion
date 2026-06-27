import { ref, computed, Ref, ComputedRef } from 'vue';

/**
 * Shared dialog behavior for <Modal> and <Sheet> components.
 *
 * Encapsulates the open/close lifecycle, Escape handling, backdrop clicks,
 * `document.body.classList` toggle for `modal-open`, a first-focusable focus
 * trap, Tab/Shift+Tab focus cycling, return-focus on close, and deterministic
 * title id generation.
 *
 * Intentionally minimal: no configuration options, no extension points.
 */

/**
 * Standard tabbable-elements selector. Acknowledged 90% solution; covers the
 * tabbable surface a Pavillion modal is expected to expose. Post-query filtering
 * removes disabled / [tabindex="-1"] / [hidden] / display:none / visibility:hidden
 * elements (the selector cannot express computed-style filters).
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

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
  // in modal.vue / sheet.vue and avoids SSR mismatch concerns in this client-only
  // composable.
  const dialogId = ref(Math.random().toString(36).substring(2, 11));
  const titleId = computed(() => `${idPrefix}-title-${dialogId.value}`);

  // Element that held focus immediately before open() ran. Restored on close()
  // when still attached to the document, nulled on close()/cleanup() to avoid
  // stale references across open/close cycles or when the trigger is unmounted.
  let previouslyFocused: HTMLElement | null = null;

  const setInitialFocus = () => {
    // Initial focus policy:
    //   1. If a descendant has [autofocus], the native <dialog>.showModal()
    //      already placed focus there per spec — leave it alone.
    //   2. Otherwise, focus the dialog's heading (matched by titleId) so the
    //      close button (the first focusable in DOM order) does not steal the
    //      visible focus ring on open. The heading must carry tabindex="-1"
    //      to be programmatically focusable.
    //   3. Final fallback: focus the dialog element itself.
    setTimeout(() => {
      const el = dialogRef.value;
      if (!el) return;
      if (el.querySelector('[autofocus]')) return;
      const heading = el.querySelector<HTMLElement>(`#${CSS.escape(titleId.value)}`);
      if (heading) {
        heading.focus();
        return;
      }
      const active = document.activeElement;
      if (active && active !== el && el.contains(active)) return;
      el.focus();
    }, 0);
  };

  /**
   * Returns the currently tabbable descendants of the dialog, in document order.
   * Filters out elements that match the selector but are not actually tabbable:
   * disabled, tabindex="-1", hidden attribute, display:none, visibility:hidden.
   */
  const getFocusableElements = (el: HTMLDialogElement): HTMLElement[] => {
    const candidates = Array.from(
      el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    return candidates.filter((node) => {
      if (node.hasAttribute('disabled')) return false;
      if (node.getAttribute('tabindex') === '-1') return false;
      if (node.hasAttribute('hidden')) return false;
      const style = typeof window !== 'undefined' ? window.getComputedStyle(node) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      return true;
    });
  };

  /**
   * Tab-key handler that cycles focus within the dialog. Bound to the dialog
   * element in open(), removed in close() and cleanup() (idempotent — duplicate
   * removeEventListener is a no-op).
   */
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const el = dialogRef.value;
    if (!el) return;

    const focusable = getFocusableElements(el);

    // Empty list: prevent focus from escaping the dialog. There is nothing to
    // cycle to inside, so the only correct behavior is to swallow the Tab.
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
    else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const open = () => {
    const el = dialogRef.value;
    // No-op when the DOM target is missing or already open (concurrent open).
    if (!el || el.open) {
      return;
    }
    // Capture the trigger so close() can restore focus to it.
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    el.showModal();
    el.addEventListener('keydown', handleKeydown);
    setInitialFocus();
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
    el.removeEventListener('keydown', handleKeydown);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('modal-open');
    }
    // Restore focus only when the trigger is still in the DOM. If it was
    // unmounted while the modal was open, skip restoration to avoid focusing
    // a detached element.
    if (previouslyFocused && document.body.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
    emit('close');
  };

  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target === dialogRef.value) {
      close();
    }
  };

  const cleanup = () => {
    const el = dialogRef.value;
    if (el) {
      // Idempotent: safe even if open() never registered the listener.
      el.removeEventListener('keydown', handleKeydown);
    }
    if (typeof document !== 'undefined') {
      document.body.classList.remove('modal-open');
    }
    previouslyFocused = null;
  };

  return {
    titleId,
    open,
    close,
    handleBackdropClick,
    cleanup,
  };
}
