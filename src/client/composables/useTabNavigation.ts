import type { Ref } from 'vue';
import { isRef } from 'vue';

/**
 * Composable for ARIA APG tab keyboard navigation with roving tabindex.
 *
 * Handles ArrowLeft, ArrowRight, Home, and End keys with cyclic wrapping.
 * Each key press calls preventDefault, focuses the target tab element
 * (looked up by `${tabName}-tab` id), and invokes the activateTab callback.
 *
 * @param orderedTabs - A ref or plain array of tab name strings in display order
 * @param activeTab - A ref holding the currently active tab name
 * @param activateTab - Callback to activate a tab by name
 * @returns An object containing the handleTabKeydown event handler
 */
export function useTabNavigation(
  orderedTabs: Ref<string[]> | string[],
  activeTab: Ref<string>,
  activateTab: (tab: string) => void,
) {
  const handleTabKeydown = (event: KeyboardEvent) => {
    const tabs = isRef(orderedTabs) ? orderedTabs.value : orderedTabs;
    const currentIndex = tabs.indexOf(activeTab.value);
    let newIndex = currentIndex;

    if (event.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % tabs.length;
    }
    else if (event.key === 'ArrowLeft') {
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }
    else if (event.key === 'Home') {
      newIndex = 0;
    }
    else if (event.key === 'End') {
      newIndex = tabs.length - 1;
    }
    else {
      return;
    }

    event.preventDefault();
    const targetTab = document.getElementById(`${tabs[newIndex]}-tab`);
    if (targetTab) {
      targetTab.focus();
      activateTab(tabs[newIndex]);
    }
  };

  return { handleTabKeydown };
}
