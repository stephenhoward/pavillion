/**
 * Tests for the useContainerWidth composable.
 *
 * The composable measures an element, not the window, so each test mounts a
 * small host component that binds a template ref and hands it to the
 * composable. ResizeObserver is stubbed with a class that records its callback
 * so a test can report any width it likes; JSDOM provides no ResizeObserver of
 * its own, and its layout reports every element as 0px wide.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useContainerWidth } from '@/common/ui/composables/useContainerWidth';
import type { WidthTier } from '@/common/ui/assets/breakpoints';

/** Every observer the stub has constructed, newest last. */
let observers: StubResizeObserver[] = [];

class StubResizeObserver {
  callback: ResizeObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  /** Reports a new content width for the observed element. */
  resize(width: number) {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

interface Exposed {
  tier: Ref<WidthTier>;
  width: Ref<number>;
}

/**
 * Mounts a host that renders its measured element only while `show` is true,
 * so a test can start with the ref null and populate it later.
 */
function mountHost(show = true) {
  const visible = ref(show);
  let exposed!: Exposed;

  const Host = defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null);
      exposed = useContainerWidth(el);
      return () => h('section', visible.value ? [h('div', { ref: el })] : []);
    },
  });

  const wrapper = mount(Host);
  return { wrapper, visible, get tier() { return exposed.tier.value; }, get width() { return exposed.width.value; } };
}

describe('useContainerWidth', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts narrow when the element has not been laid out', async () => {
    const host = mountHost();
    await nextTick();

    expect(host.width).toBe(0);
    expect(host.tier).toBe('narrow');
  });

  it('observes the bound element', async () => {
    const host = mountHost();
    await nextTick();

    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(host.wrapper.find('div').element);
  });

  it.each([
    [599, 'narrow'],
    [600, 'medium'],
    [1023, 'medium'],
    [1024, 'wide'],
  ] as const)('reports %ipx as %s', async (px, expected) => {
    const host = mountHost();
    await nextTick();

    observers[0].resize(px);

    expect(host.width).toBe(px);
    expect(host.tier).toBe(expected);
  });

  it('follows the element as it resizes', async () => {
    const host = mountHost();
    await nextTick();

    observers[0].resize(1200);
    expect(host.tier).toBe('wide');

    observers[0].resize(400);
    expect(host.tier).toBe('narrow');
  });

  it('measures the element before the observer first fires', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800 } as DOMRect);

    const host = mountHost();
    await nextTick();

    expect(host.width).toBe(800);
    expect(host.tier).toBe('medium');
  });

  it('disconnects the observer on unmount', async () => {
    const host = mountHost();
    await nextTick();

    host.wrapper.unmount();

    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('starts observing when the element ref is populated after mount', async () => {
    const host = mountHost(false);
    await nextTick();

    expect(observers).toHaveLength(0);
    expect(host.tier).toBe('narrow');

    host.visible.value = true;
    await nextTick();

    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(host.wrapper.find('div').element);

    observers[0].resize(1024);
    expect(host.tier).toBe('wide');
  });

  it('measures once and does not throw when ResizeObserver is unavailable', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1100 } as DOMRect);

    let host!: ReturnType<typeof mountHost>;
    expect(() => {
      host = mountHost();
    }).not.toThrow();
    await nextTick();

    expect(host.width).toBe(1100);
    expect(host.tier).toBe('wide');
    expect(() => host.wrapper.unmount()).not.toThrow();
  });
});
