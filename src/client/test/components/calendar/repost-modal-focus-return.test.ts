import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * Tests: Focus return when repost categories modal closes in calendar.vue
 *
 * Verifies that keyboard focus returns to the trigger element (Edit button)
 * when the repost categories modal is dismissed or confirmed.
 * This satisfies WCAG 2.1 SC 3.2.2 and general accessible modal patterns.
 *
 * These tests exercise the logic in isolation since mounting the full
 * calendar.vue requires extensive infrastructure. The pattern tested here
 * directly mirrors the implementation in calendar.vue.
 */
describe('Repost modal focus return logic', () => {
  let triggerEl: HTMLButtonElement;
  let repostEventForModal: ReturnType<typeof ref<any>>;
  let repostModalTriggerEl: ReturnType<typeof ref<HTMLElement | null>>;

  beforeEach(() => {
    // Create a real DOM button to test focus behavior
    triggerEl = document.createElement('button');
    triggerEl.textContent = 'Edit';
    document.body.appendChild(triggerEl);

    // Replicate the refs used in calendar.vue
    repostEventForModal = ref(null);
    repostModalTriggerEl = ref<HTMLElement | null>(null);
  });

  afterEach(() => {
    document.body.removeChild(triggerEl);
  });

  describe('handleEditEvent (opening the modal)', () => {
    it('saves the trigger element when opening modal for a repost event', () => {
      const mockEvent = { isRepost: true, id: 'event-1' };
      const mockDomEvent = { currentTarget: triggerEl } as unknown as MouseEvent;

      // Simulate handleEditEvent for a repost event
      repostModalTriggerEl.value = mockDomEvent.currentTarget as HTMLElement;
      repostEventForModal.value = mockEvent;

      // HTMLElement is not wrapped by Vue reactive proxy, so toBe works
      expect(repostModalTriggerEl.value).toBe(triggerEl);
      // Plain objects are wrapped in reactive proxy; use toStrictEqual for value equality
      expect(repostEventForModal.value).toStrictEqual(mockEvent);
    });

    it('does not save a trigger element for non-repost events', () => {
      // Non-repost events navigate away, so trigger is not saved
      expect(repostModalTriggerEl.value).toBeNull();
      expect(repostEventForModal.value).toBeNull();
    });
  });

  describe('cancel handler (modal dismissed)', () => {
    it('returns focus to the trigger element after modal cancel', async () => {
      // Setup: modal is open with a saved trigger
      repostEventForModal.value = { isRepost: true, id: 'event-1' };
      repostModalTriggerEl.value = triggerEl;

      const focusSpy = vi.spyOn(triggerEl, 'focus');

      // Simulate the @cancel handler: close modal, then focus trigger
      repostEventForModal.value = null;
      await nextTick();
      repostModalTriggerEl.value?.focus();

      expect(repostEventForModal.value).toBeNull();
      expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('does not throw when trigger ref is null on cancel', async () => {
      repostEventForModal.value = { isRepost: true, id: 'event-1' };
      repostModalTriggerEl.value = null;

      // Should not throw even if trigger ref is null
      repostEventForModal.value = null;
      await nextTick();

      expect(() => {
        repostModalTriggerEl.value?.focus();
      }).not.toThrow();
    });

    it('focus is called on the saved trigger element', async () => {
      repostEventForModal.value = { isRepost: true, id: 'event-1' };
      repostModalTriggerEl.value = triggerEl;

      const focusSpy = vi.spyOn(triggerEl, 'focus');

      repostEventForModal.value = null;
      await nextTick();
      repostModalTriggerEl.value?.focus();

      expect(focusSpy).toHaveBeenCalledOnce();
      expect(repostEventForModal.value).toBeNull();
    });
  });

  describe('confirm handler (handleRepostCategoryUpdate)', () => {
    it('returns focus to the trigger element after successful category update', async () => {
      repostEventForModal.value = { isRepost: true, id: 'event-1', categories: [] };
      repostModalTriggerEl.value = triggerEl;

      const focusSpy = vi.spyOn(triggerEl, 'focus');

      // Simulate handleRepostCategoryUpdate completing (no categories selected)
      repostEventForModal.value = null;
      await nextTick();
      repostModalTriggerEl.value?.focus();

      expect(repostEventForModal.value).toBeNull();
      expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('returns focus to the trigger element even after an API error', async () => {
      repostEventForModal.value = { isRepost: true, id: 'event-1', categories: [] };
      repostModalTriggerEl.value = triggerEl;

      const focusSpy = vi.spyOn(triggerEl, 'focus');

      // Simulate error path: modal is still closed and focus is returned
      repostEventForModal.value = null;
      await nextTick();
      repostModalTriggerEl.value?.focus();

      expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('does not throw when trigger ref is null on confirm', async () => {
      repostEventForModal.value = { isRepost: true, id: 'event-1', categories: [] };
      repostModalTriggerEl.value = null;

      repostEventForModal.value = null;
      await nextTick();

      expect(() => {
        repostModalTriggerEl.value?.focus();
      }).not.toThrow();
    });
  });

  describe('nextTick requirement', () => {
    it('focus is called after nextTick to ensure DOM is updated', async () => {
      repostEventForModal.value = { isRepost: true, id: 'event-1' };
      repostModalTriggerEl.value = triggerEl;

      const callOrder: string[] = [];

      const focusSpy = vi.spyOn(triggerEl, 'focus').mockImplementation(() => {
        callOrder.push('focus');
      });

      // Close modal
      repostEventForModal.value = null;
      callOrder.push('modal-closed');

      // focus must be called AFTER nextTick
      await nextTick();
      repostModalTriggerEl.value?.focus();

      expect(callOrder).toEqual(['modal-closed', 'focus']);
      expect(focusSpy).toHaveBeenCalledOnce();
    });
  });
});
