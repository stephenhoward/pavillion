import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, computed } from 'vue';
import { useTabNavigation } from '@/client/composables/useTabNavigation';

/**
 * Tests for the useTabNavigation composable.
 *
 * Validates ARIA APG tab keyboard interaction:
 * - ArrowRight moves to next tab, wrapping from last to first
 * - ArrowLeft moves to previous tab, wrapping from first to last
 * - Home jumps to first tab
 * - End jumps to last tab
 * - preventDefault is called for handled keys
 * - Unhandled keys are ignored (no preventDefault)
 * - Focus is set on the target tab element
 * - activateTab callback is invoked with the correct tab name
 * - Works with both plain arrays and Ref<string[]>
 */

const TABS = ['events', 'places', 'categories', 'series'];

const createKeyboardEvent = (key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  vi.spyOn(event, 'preventDefault');
  return event;
};

describe('useTabNavigation', () => {
  let activateTab: ReturnType<typeof vi.fn>;
  let focusSpy: ReturnType<typeof vi.fn>;
  let getElementByIdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    activateTab = vi.fn();
    focusSpy = vi.fn();
    getElementByIdSpy = vi.spyOn(document, 'getElementById').mockReturnValue({
      focus: focusSpy,
    } as unknown as HTMLElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('with plain array of tabs', () => {
    it('should move to the next tab on ArrowRight', () => {
      const activeTab = ref('events');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('ArrowRight');

      handleTabKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(getElementByIdSpy).toHaveBeenCalledWith('places-tab');
      expect(focusSpy).toHaveBeenCalled();
      expect(activateTab).toHaveBeenCalledWith('places');
    });

    it('should wrap from last to first on ArrowRight', () => {
      const activeTab = ref('series');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('ArrowRight');

      handleTabKeydown(event);

      expect(activateTab).toHaveBeenCalledWith('events');
      expect(getElementByIdSpy).toHaveBeenCalledWith('events-tab');
    });

    it('should move to the previous tab on ArrowLeft', () => {
      const activeTab = ref('categories');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('ArrowLeft');

      handleTabKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(activateTab).toHaveBeenCalledWith('places');
      expect(getElementByIdSpy).toHaveBeenCalledWith('places-tab');
    });

    it('should wrap from first to last on ArrowLeft', () => {
      const activeTab = ref('events');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('ArrowLeft');

      handleTabKeydown(event);

      expect(activateTab).toHaveBeenCalledWith('series');
      expect(getElementByIdSpy).toHaveBeenCalledWith('series-tab');
    });

    it('should jump to first tab on Home', () => {
      const activeTab = ref('series');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('Home');

      handleTabKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(activateTab).toHaveBeenCalledWith('events');
      expect(getElementByIdSpy).toHaveBeenCalledWith('events-tab');
    });

    it('should jump to last tab on End', () => {
      const activeTab = ref('events');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('End');

      handleTabKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(activateTab).toHaveBeenCalledWith('series');
      expect(getElementByIdSpy).toHaveBeenCalledWith('series-tab');
    });

    it('should not call preventDefault for unhandled keys', () => {
      const activeTab = ref('events');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('Tab');

      handleTabKeydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(activateTab).not.toHaveBeenCalled();
    });

    it('should not call activateTab if target element is not found', () => {
      getElementByIdSpy.mockReturnValue(null);

      const activeTab = ref('events');
      const { handleTabKeydown } = useTabNavigation(TABS, activeTab, activateTab);
      const event = createKeyboardEvent('ArrowRight');

      handleTabKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(activateTab).not.toHaveBeenCalled();
    });
  });

  describe('with Ref<string[]> tabs', () => {
    it('should work with a ref array of tabs', () => {
      const tabs = ref(['alpha', 'beta', 'gamma']);
      const activeTab = ref('alpha');
      const { handleTabKeydown } = useTabNavigation(tabs, activeTab, activateTab);
      const event = createKeyboardEvent('ArrowRight');

      handleTabKeydown(event);

      expect(activateTab).toHaveBeenCalledWith('beta');
    });

    it('should react to dynamic tab list changes', () => {
      const tabs = ref(['a', 'b', 'c']);
      const activeTab = ref('b');
      const { handleTabKeydown } = useTabNavigation(tabs, activeTab, activateTab);

      // Simulate a dynamic change: remove 'c' from tabs
      tabs.value = ['a', 'b'];

      const event = createKeyboardEvent('ArrowRight');
      handleTabKeydown(event);

      // Should wrap from 'b' to 'a' since 'c' is gone
      expect(activateTab).toHaveBeenCalledWith('a');
    });
  });

  describe('with computed tabs', () => {
    it('should work with a computed ref of tabs', () => {
      const isOwner = ref(true);
      const tabs = computed(() => {
        const base = ['editors'];
        if (isOwner.value) base.push('settings');
        base.push('widget');
        return base;
      });
      const activeTab = ref('editors');
      const { handleTabKeydown } = useTabNavigation(tabs, activeTab, activateTab);
      const event = createKeyboardEvent('End');

      handleTabKeydown(event);

      expect(activateTab).toHaveBeenCalledWith('widget');
    });
  });
});
