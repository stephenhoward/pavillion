import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

import { widthTier, type WidthTier } from '@/common/ui/assets/breakpoints';

/**
 * Tracks the rendered width of an element and the layout tier it falls into.
 *
 * The element's own width is measured, not the window's: a calendar embedded
 * in a narrow sidebar or a widget iframe must lay out for the space it has.
 *
 * Observation starts whenever the ref holds an element, not only at mount,
 * because a caller's element may sit under a `v-if` and appear later. The
 * element is measured with getBoundingClientRect() as soon as it is bound, so
 * the first render after binding already has a tier, and a ResizeObserver
 * keeps the measurement current from then on. Where ResizeObserver does not
 * exist (JSDOM, older runtimes) the element is measured once and left at that.
 *
 * The first reading is getBoundingClientRect().width, the border box; the
 * observer reports contentRect.width, the content box. Bind an element with no
 * horizontal padding or border (the calendar root), or the two disagree and
 * the tier can flip across a boundary on the observer's first callback.
 *
 * Whenever no element is bound — before the first one, or after the ref goes
 * back to null — the width is 0 and the tier is `narrow`. Narrow is
 * the safe default because it renders the list layout, which works at any
 * width. Avoiding a flash of the wrong layout is the mounting container's job
 * (it holds a loading state until data and measurement are ready), not this
 * composable's.
 */
export function useContainerWidth(el: Ref<HTMLElement | null>): {
  tier: Ref<WidthTier>;
  width: Ref<number>;
} {
  const width = ref(0);
  const tier = computed(() => widthTier(width.value));

  let observer: ResizeObserver | null = null;

  function stopObserving() {
    observer?.disconnect();
    observer = null;
  }

  watch(el, (element) => {
    stopObserving();

    if (!element) {
      width.value = 0;
      return;
    }

    width.value = element.getBoundingClientRect().width;

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) {
        width.value = entry.contentRect.width;
      }
    });
    observer.observe(element);
  }, { immediate: true, flush: 'post' });

  onBeforeUnmount(stopObserving);

  return { tier, width };
}
