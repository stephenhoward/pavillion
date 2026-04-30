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

    it('focuses the dialog element when no descendant holds focus (fallback)', () => {
      const { el, focusSpy } = makeDialogStub();
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);

      open();
      expect(focusSpy).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('does not steal focus from a descendant that already holds it (autofocus)', () => {
      const { el, focusSpy } = makeDialogStub();
      const input = document.createElement('input');
      el.appendChild(input);
      // Simulate the native <dialog>.showModal() having focused an autofocus
      // descendant before our setTimeout callback runs.
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => input,
      });
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);

      open();
      vi.runAllTimers();

      expect(focusSpy).not.toHaveBeenCalled();
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

  describe('focus trap', () => {
    /**
     * Helper: dispatch a keydown to the dialog element with controllable
     * activeElement so we can simulate focus cycling without relying on
     * happy-dom's full focus model. preventDefault is observable via the
     * returned spy.
     */
    function dispatchTab(
      el: HTMLDialogElement,
      activeEl: Element | null,
      options: { shift?: boolean } = {},
    ) {
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => activeEl,
      });
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: !!options.shift,
        bubbles: true,
        cancelable: true,
      });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      el.dispatchEvent(event);
      return { preventDefault };
    }

    it('Tab on the last focusable cycles to the first', () => {
      const { el } = makeDialogStub();
      const first = document.createElement('button');
      const last = document.createElement('button');
      const firstFocus = vi.fn();
      const lastFocus = vi.fn();
      first.focus = firstFocus;
      last.focus = lastFocus;
      el.appendChild(first);
      el.appendChild(last);
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);
      open();

      const { preventDefault } = dispatchTab(el, last);

      expect(preventDefault).toHaveBeenCalled();
      expect(firstFocus).toHaveBeenCalledTimes(1);
      expect(lastFocus).not.toHaveBeenCalled();
    });

    it('Shift+Tab on the first focusable cycles to the last', () => {
      const { el } = makeDialogStub();
      const first = document.createElement('button');
      const last = document.createElement('button');
      const firstFocus = vi.fn();
      const lastFocus = vi.fn();
      first.focus = firstFocus;
      last.focus = lastFocus;
      el.appendChild(first);
      el.appendChild(last);
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);
      open();

      const { preventDefault } = dispatchTab(el, first, { shift: true });

      expect(preventDefault).toHaveBeenCalled();
      expect(lastFocus).toHaveBeenCalledTimes(1);
      expect(firstFocus).not.toHaveBeenCalled();
    });

    it('Tab in the middle of the list lets default behavior run', () => {
      const { el } = makeDialogStub();
      const first = document.createElement('button');
      const middle = document.createElement('button');
      const last = document.createElement('button');
      const firstFocus = vi.fn();
      const middleFocus = vi.fn();
      const lastFocus = vi.fn();
      first.focus = firstFocus;
      middle.focus = middleFocus;
      last.focus = lastFocus;
      el.appendChild(first);
      el.appendChild(middle);
      el.appendChild(last);
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);
      open();

      const { preventDefault } = dispatchTab(el, middle);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(firstFocus).not.toHaveBeenCalled();
      expect(middleFocus).not.toHaveBeenCalled();
      expect(lastFocus).not.toHaveBeenCalled();
    });

    it('Tab with no focusable elements calls preventDefault only', () => {
      const { el } = makeDialogStub();
      // No focusable descendants — the dialog is empty.
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);
      open();

      const { preventDefault } = dispatchTab(el, document.body);

      expect(preventDefault).toHaveBeenCalled();
    });

    it('Tab listener removed after close()', () => {
      const { el } = makeDialogStub();
      const first = document.createElement('button');
      const last = document.createElement('button');
      const firstFocus = vi.fn();
      const lastFocus = vi.fn();
      first.focus = firstFocus;
      last.focus = lastFocus;
      el.appendChild(first);
      el.appendChild(last);
      dialogRef.value = el;
      const { open, close } = useDialog(dialogRef, emit);
      open();
      close();

      const { preventDefault } = dispatchTab(el, last);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(firstFocus).not.toHaveBeenCalled();
    });

    it('Tab listener removed after cleanup() without an explicit close()', () => {
      const { el } = makeDialogStub();
      const first = document.createElement('button');
      const last = document.createElement('button');
      const firstFocus = vi.fn();
      const lastFocus = vi.fn();
      first.focus = firstFocus;
      last.focus = lastFocus;
      el.appendChild(first);
      el.appendChild(last);
      dialogRef.value = el;
      const { open, cleanup } = useDialog(dialogRef, emit);
      open();
      cleanup();

      const { preventDefault } = dispatchTab(el, last);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(firstFocus).not.toHaveBeenCalled();
    });

    it('cycles only between enabled focusable elements (filters disabled / tabindex=-1)', () => {
      const { el } = makeDialogStub();
      const first = document.createElement('button');
      const disabled = document.createElement('button');
      disabled.setAttribute('disabled', '');
      const skipped = document.createElement('input');
      skipped.setAttribute('tabindex', '-1');
      const last = document.createElement('button');
      const firstFocus = vi.fn();
      const lastFocus = vi.fn();
      first.focus = firstFocus;
      last.focus = lastFocus;
      el.appendChild(first);
      el.appendChild(disabled);
      el.appendChild(skipped);
      el.appendChild(last);
      dialogRef.value = el;
      const { open } = useDialog(dialogRef, emit);
      open();

      // Tab on last should cycle to first (disabled and tabindex=-1 are ignored).
      const { preventDefault: pd1 } = dispatchTab(el, last);
      expect(pd1).toHaveBeenCalled();
      expect(firstFocus).toHaveBeenCalledTimes(1);

      // Shift+Tab on first should cycle to last.
      const { preventDefault: pd2 } = dispatchTab(el, first, { shift: true });
      expect(pd2).toHaveBeenCalled();
      expect(lastFocus).toHaveBeenCalledTimes(1);
    });
  });

  describe('return focus', () => {
    it('restores focus to the trigger on close (real-DOM round-trip)', () => {
      const trigger = document.createElement('button');
      const triggerFocus = vi.fn();
      trigger.focus = triggerFocus;
      document.body.appendChild(trigger);
      // Make activeElement report the trigger before open().
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => trigger,
      });

      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open, close } = useDialog(dialogRef, emit);

      open();
      close();

      expect(triggerFocus).toHaveBeenCalledTimes(1);
    });

    it('skips restoration when the captured element is no longer in document.body', () => {
      const trigger = document.createElement('button');
      const triggerFocus = vi.fn();
      trigger.focus = triggerFocus;
      document.body.appendChild(trigger);
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => trigger,
      });

      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open, close } = useDialog(dialogRef, emit);

      open();
      // Detach the trigger while the modal is open.
      trigger.remove();
      close();

      expect(triggerFocus).not.toHaveBeenCalled();
    });

    it('a second open/close cycle uses the new trigger, not a stale reference', () => {
      const triggerA = document.createElement('button');
      const triggerB = document.createElement('button');
      const focusA = vi.fn();
      const focusB = vi.fn();
      triggerA.focus = focusA;
      triggerB.focus = focusB;
      document.body.appendChild(triggerA);
      document.body.appendChild(triggerB);

      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open, close } = useDialog(dialogRef, emit);

      // First cycle: trigger A is active.
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => triggerA,
      });
      open();
      close();

      expect(focusA).toHaveBeenCalledTimes(1);
      expect(focusB).not.toHaveBeenCalled();

      // Second cycle: trigger B is active.
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => triggerB,
      });
      open();
      close();

      expect(focusA).toHaveBeenCalledTimes(1); // still only once — no stale reference
      expect(focusB).toHaveBeenCalledTimes(1);
    });

    it('cleanup() clears the captured reference', () => {
      const trigger = document.createElement('button');
      const triggerFocus = vi.fn();
      trigger.focus = triggerFocus;
      document.body.appendChild(trigger);
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => trigger,
      });

      const { el } = makeDialogStub();
      dialogRef.value = el;
      const { open, close, cleanup } = useDialog(dialogRef, emit);

      open();
      // cleanup() clears the captured reference; a subsequent close() should
      // not restore focus to the trigger (it was nulled).
      cleanup();
      // Re-open and close to prove the reference was nulled (open captures
      // the current activeElement, but if we point activeElement at body,
      // capture is null and no restoration happens).
      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => document.body,
      });
      open();
      close();

      expect(triggerFocus).not.toHaveBeenCalled();
    });
  });
});
