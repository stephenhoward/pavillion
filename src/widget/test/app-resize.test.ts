/**
 * Tests for the widget shell's height reporting.
 *
 * app.vue observes `.widget-root` and posts its border-box height to the
 * embedding page, which sizes the iframe from it. Notifications are
 * debounced, the height is measured when the debounce fires (so the latest
 * size wins), and the observer is torn down on unmount.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

import AppVue from '@/widget/components/app.vue';
import { useWidgetStore } from '@/widget/stores/widgetStore';

interface ObserverStub {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let observers: ObserverStub[];

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

  /** Mount the shell and return its observer and a setter for the root's height. */
  async function mountApp() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
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

    return { observer, setHeight, fire };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    notifyResize = vi.spyOn(useWidgetStore(), 'notifyResize').mockImplementation(() => {});

    observers = [];
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
      const observer: ObserverStub = { callback, observe: vi.fn(), disconnect: vi.fn() };
      observers.push(observer);
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
});
