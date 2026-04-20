import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, Ref } from 'vue';
import { useDialog } from '@/client/composables/useDialog';

/**
 * Helper: construct a fake HTMLDialogElement surface sufficient for the
 * composable. happy-dom's HTMLDialogElement can have inconsistent behavior
 * for showModal/close across versions, so we stub the methods we rely on
 * and use a real element for focus()/event target identity.
 */
function makeDialogStub() {
  const el = document.createElement('dialog') as HTMLDialogElement;
  // Many happy-dom versions leave `open` as a non-reflecting boolean; manage it ourselves.
  let isOpen = false;
  Object.defineProperty(el, 'open', {
    configurable: true,
    get: () => isOpen,
    set: (v: boolean) => { isOpen = v; },
  });
  el.showModal = vi.fn(() => { isOpen = true; });
  el.close = vi.fn(() => { isOpen = false; });
  // Make focus observable without relying on DOM default behavior.
  const focusSpy = vi.fn();
  el.focus = focusSpy;
  document.body.appendChild(el);
  return { el, focusSpy };
}

describe('useDialog', () => {
  let dialogRef: Ref<HTMLDialogElement | null>;
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    emit = vi.fn();
    dialogRef = ref<HTMLDialogElement | null>(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.classList.remove('modal-open');
    // Strip any dialogs appended during the test
    document.querySelectorAll('dialog').forEach(d => d.remove());
  });

  describe('titleId', () => {
    it('generates an id with the default prefix', () => {
      const { titleId } = useDialog(dialogRef, emit);
      expect(titleId.value).toMatch(/^dialog-title-[a-z0-9]+$/);
    });

    it('uses a custom prefix when provided', () => {
      const { titleId } = useDialog(dialogRef, emit, { idPrefix: 'modal' });
      expect(titleId.value).toMatch(/^modal-title-[a-z0-9]+$/);
    });

    it('generates a unique id per composable instance', () => {
      const a = useDialog(dialogRef, emit, { idPrefix: 'modal' });
      const b = useDialog(dialogRef, emit, { idPrefix: 'modal' });
      const c = useDialog(dialogRef, emit, { idPrefix: 'modal' });
      expect(a.titleId.value).not.toBe(b.titleId.value);
      expect(b.titleId.value).not.toBe(c.titleId.value);
      expect(a.titleId.value).not.toBe(c.titleId.value);
    });
  });

  describe('open()', () => {
    it('invokes showModal and adds body.modal-open', () => {
      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);

      open();

      expect(el.showModal).toHaveBeenCalledTimes(1);
      expect(document.body.classList.contains('modal-open')).toBe(true);
    });

    it('traps focus via setTimeout', () => {
      const { el, focusSpy } = makeDialogStub();
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);

      open();
      expect(focusSpy).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when already open (concurrent open)', () => {
      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);

      open();
      (el.showModal as ReturnType<typeof vi.fn>).mockClear();

      open();

      expect(el.showModal).not.toHaveBeenCalled();
    });

    it('does not crash when dialogRef.value is null', () => {
      const { open } = useDialog(dialogRef, emit);
      expect(() => open()).not.toThrow();
      expect(document.body.classList.contains('modal-open')).toBe(false);
    });
  });

  describe('close()', () => {
    it('invokes close, removes body.modal-open, and emits close', () => {
      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open, close } = useDialog(dialogRef, emit);

      open();
      close();

      expect(el.close).toHaveBeenCalledTimes(1);
      expect(document.body.classList.contains('modal-open')).toBe(false);
      expect(emit).toHaveBeenCalledWith('close');
    });

    it('is a no-op when not open', () => {
      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { close } = useDialog(dialogRef, emit);

      close();

      expect(el.close).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('does not crash when dialogRef.value is null', () => {
      const { close } = useDialog(dialogRef, emit);
      expect(() => close()).not.toThrow();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('handleBackdropClick()', () => {
    it('closes when the click target is the dialog element itself', () => {
      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open, handleBackdropClick } = useDialog(dialogRef, emit);
      open();

      const event = { target: el } as unknown as MouseEvent;
      handleBackdropClick(event);

      expect(el.close).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('close');
    });

    it('does NOT close when the click target is an inner element', () => {
      const { el } = makeDialogStub();
      const inner = document.createElement('div');
      el.appendChild(inner);
      dialogRef.value = el;
      const { open, handleBackdropClick } = useDialog(dialogRef, emit);
      open();

      const event = { target: inner } as unknown as MouseEvent;
      handleBackdropClick(event);

      expect(el.close).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('cleanup()', () => {
    it('removes body.modal-open', () => {
      document.body.classList.add('modal-open');
      const { cleanup } = useDialog(dialogRef, emit);

      cleanup();

      expect(document.body.classList.contains('modal-open')).toBe(false);
    });
  });
});
