import { ref, watch, onUnmounted } from 'vue';
import type { Ref } from 'vue';

/**
 * Composable for tracking scroll position of a tab strip container.
 *
 * Returns a template ref to attach to the scroll container element, and reactive
 * state { canScrollLeft, canScrollRight } that updates on scroll and resize.
 * These values drive CSS classes that show/hide edge-fade mask gradients.
 *
 * Usage:
 *   const { tabsRef, canScrollLeft, canScrollRight } = useTabScroll();
 *   // In template: <nav ref="tabsRef" :class="{ 'can-scroll-left': canScrollLeft, 'can-scroll-right': canScrollRight }">
 */
export function useTabScroll() {
  const tabsRef: Ref<HTMLElement | null> = ref(null);
  const canScrollLeft = ref(false);
  const canScrollRight = ref(false);

  /**
   * Recomputes scroll state from the container's current dimensions.
   * canScrollRight uses a 1px tolerance to account for sub-pixel rounding.
   */
  const updateScrollState = () => {
    const el = tabsRef.value;
    if (!el) {
      canScrollLeft.value = false;
      canScrollRight.value = false;
      return;
    }

    canScrollLeft.value = el.scrollLeft > 0;
    canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  };

  const onScrollOrResize = () => updateScrollState();

  // Watch the ref so the listener attaches/detaches reactively, even when the
  // element is conditionally rendered with v-if/v-else-if. { immediate: true }
  // fires on mount so no separate onMounted block is needed.
  watch(tabsRef, (el, prevEl) => {
    if (prevEl) {
      prevEl.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    }
    if (el) {
      el.addEventListener('scroll', onScrollOrResize, { passive: true });
      window.addEventListener('resize', onScrollOrResize, { passive: true });
      updateScrollState();
    }
  }, { immediate: true });

  onUnmounted(() => {
    const el = tabsRef.value;
    if (el) {
      el.removeEventListener('scroll', onScrollOrResize);
    }
    window.removeEventListener('resize', onScrollOrResize);
  });

  return {
    tabsRef,
    canScrollLeft,
    canScrollRight,
  };
}
