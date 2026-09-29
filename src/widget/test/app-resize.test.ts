/**
 * Tests for the widget shell's height reporting.
 *
 * app.vue observes `.widget-root` and posts its border-box height to the
 * embedding page, which sizes the iframe from it. Notifications are
 * debounced, the height is measured when the debounce fires (so the latest
 * size wins), and the observer is torn down on unmount. Across a route
 * change the root holds its height until the new view is no longer
 * `aria-busy`, so a loading state never collapses the frame.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { h, nextTick, ref } from 'vue';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

import AppVue from '@/widget/components/app.vue';
import { useWidgetStore } from '@/widget/stores/widgetStore';

interface ObserverStub<Callback> {
  callback: Callback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let observers: ObserverStub<ResizeObserverCallback>[];
// Stubbed rather than real: happy-dom's MutationObserver delivery is not
// dependable enough to assert on. The real one is exercised by the embedded
// e2e navigation test.
let mutationObservers: ObserverStub<MutationCallback>[];

/** Busy state of the routed view, as a widget view binds `aria-busy` to its loading state. */
const busy = ref(false);
const RoutedView = {
  setup: () => () => h('div', { class: 'routed-view', 'aria-busy': String(busy.value) }),
};

beforeAll(async () => {
  const resources = { powered_by: 'Powered by Pavillion' };
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources: { en: { system: resources } } });
  }
  else {
    i18next.addResourceBundle('en', 'system', resources, true, true);
  }
});

describe('widget app height reporting', () => {
  let wrapper: VueWrapper | null = null;
  let notifyResize: ReturnType<typeof vi.spyOn>;

  /** Mount the shell and return its observer, root, router and a setter for the root's height. */
  async function mountApp() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: RoutedView }],
    });
    await router.push('/widget/test_calendar');
    await router.isReady();

    wrapper = mount(AppVue, {
      global: { plugins: [router, [I18NextVue, { i18next }]] },
    });
    await flushPromises();

    expect(observers).toHaveLength(1);
    const observer = observers[0];
    const root = wrapper.get('.widget-root').element as HTMLElement;
    expect(observer.observe).toHaveBeenCalledWith(root);

    let height = 0;
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ height } as DOMRect));
    const setHeight = (value: number) => {
      height = value;
    };
    const fire = () => observer.callback([], observer as unknown as ResizeObserver);

    return { observer, root, router, setHeight, fire };
  }

  beforeEach(() => {
    busy.value = false;
    setActivePinia(createPinia());
    notifyResize = vi.spyOn(useWidgetStore(), 'notifyResize').mockImplementation(() => {});

    observers = [];
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
      const observer = { callback, observe: vi.fn(), disconnect: vi.fn() };
      observers.push(observer);
      return observer;
    }));

    mutationObservers = [];
    vi.stubGlobal('MutationObserver', vi.fn().mockImplementation((callback: MutationCallback) => {
      const observer = { callback, observe: vi.fn(), disconnect: vi.fn() };
      mutationObservers.push(observer);
      return observer;
    }));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it('debounces resizes and reports the latest border-box height once, rounded up', async () => {
    const { setHeight, fire } = await mountApp();
    vi.useFakeTimers();

    setHeight(1200);
    fire();
    setHeight(640.4);
    fire();

    vi.advanceTimersByTime(99);
    expect(notifyResize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(notifyResize).toHaveBeenCalledTimes(1);
    expect(notifyResize).toHaveBeenCalledWith(641);
  });

  it('disconnects on unmount and drops a pending notification', async () => {
    const { observer, setHeight, fire } = await mountApp();
    vi.useFakeTimers();

    setHeight(800);
    fire();
    wrapper!.unmount();
    wrapper = null;

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(notifyResize).not.toHaveBeenCalled();
  });

  describe('across a route change', () => {
    /** Navigate, recording the root's min-height as the navigation completes. */
    async function navigate(router: ReturnType<typeof createRouter>, root: HTMLElement, path: string) {
      let heldDuringNavigation = '';
      const remove = router.afterEach(() => {
        heldDuringNavigation = root.style.minHeight;
      });
      await router.push(path);
      remove();
      await flushPromises();
      return heldDuringNavigation;
    }

    it('holds the height while the new view is busy and releases it when it settles', async () => {
      const { root, router, setHeight } = await mountApp();
      setHeight(900.2);

      busy.value = true;
      expect(await navigate(router, root, '/widget/test_calendar/events/evt-1')).toBe('901px');
      expect(root.style.minHeight).toBe('901px');

      expect(mutationObservers).toHaveLength(1);
      const busyObserver = mutationObservers[0];
      expect(busyObserver.observe).toHaveBeenCalledWith(root, expect.objectContaining({
        subtree: true,
        attributeFilter: ['aria-busy'],
      }));
      const notify = () => busyObserver.callback([], busyObserver as unknown as MutationObserver);

      // A mutation while the view is still busy keeps the hold.
      notify();
      expect(root.style.minHeight).toBe('901px');

      busy.value = false;
      await nextTick();
      notify();
      expect(root.style.minHeight).toBe('');
      expect(busyObserver.disconnect).toHaveBeenCalled();
    });

    it('releases on the first check when the new view never goes busy', async () => {
      const { root, router, setHeight } = await mountApp();
      setHeight(900);

      expect(await navigate(router, root, '/widget/test_calendar/events/evt-1')).toBe('900px');
      expect(root.style.minHeight).toBe('');
      expect(mutationObservers).toHaveLength(0);
    });

    it('stops observing and holding after unmount', async () => {
      const { root, router, setHeight } = await mountApp();
      setHeight(900);

      busy.value = true;
      await navigate(router, root, '/widget/test_calendar/events/evt-1');
      expect(root.style.minHeight).toBe('900px');
      expect(mutationObservers).toHaveLength(1);

      wrapper!.unmount();
      wrapper = null;
      expect(mutationObservers[0].disconnect).toHaveBeenCalled();

      // The router outlives the shell; its hooks must not.
      root.style.minHeight = '';
      await router.push('/widget/test_calendar');
      await flushPromises();
      expect(root.style.minHeight).toBe('');
    });
  });
});
