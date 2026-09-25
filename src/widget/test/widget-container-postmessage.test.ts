/**
 * Tests for the widget container's postMessage configuration handler.
 *
 * The admin preview updates a live widget by posting
 * `{ type: 'pavillion:updateConfig', config }` into its iframe. The handler
 * is one of the three writers of `widgetStore.accentColor`, a value that
 * reaches the DOM as CSS custom properties, so it must ignore messages from
 * any other origin and reject malformed values.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

vi.mock('@/site/service/calendar', () => ({
  // No calendar: the container renders its not-found branch and loads
  // nothing else, which keeps these tests about the message handler alone.
  default: vi.fn().mockImplementation(() => ({
    getCalendarByUrlName: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));
vi.mock('@/site/components/search-filter-public.vue', () => ({
  default: { template: '<div></div>' },
}));
vi.mock('@/widget/components/week-view.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('@/widget/components/month-view.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('@/widget/components/list-view.vue', () => ({ default: { template: '<div></div>' } }));

import WidgetContainer from '@/widget/components/widget-container.vue';
import { useWidgetStore } from '@/widget/stores/widgetStore';

const mounted: VueWrapper[] = [];

async function mountContainer() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/widget/:urlName', component: WidgetContainer }],
  });
  await router.push('/widget/test_calendar');
  await router.isReady();

  const pinia = createPinia();
  const wrapper = mount(WidgetContainer, {
    global: {
      plugins: [router, [I18NextVue, { i18next }], pinia],
      provide: { site_config: { settings: () => ({}) } },
    },
  });
  mounted.push(wrapper);
  await flushPromises();

  return useWidgetStore(pinia);
}

function postConfig(config: unknown, origin: string) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'pavillion:updateConfig', config },
    origin,
  }));
}

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources: { en: { system: {} } } });
  }
});

afterEach(() => {
  while (mounted.length) {
    mounted.pop()!.unmount();
  }
});

describe('widget-container postMessage config handler', () => {
  it('applies a valid accent from the same origin', async () => {
    const store = await mountContainer();

    postConfig({ accentColor: '#669c35' }, window.location.origin);

    expect(store.accentColor).toBe('#669c35');
  });

  it('ignores a message from another origin', async () => {
    const store = await mountContainer();
    const before = store.accentColor;

    postConfig({ accentColor: '#669c35', colorMode: 'dark' }, 'https://evil.example');

    expect(store.accentColor).toBe(before);
    expect(store.colorMode).not.toBe('dark');
  });

  it('rejects a malformed accent from the same origin and keeps the prior value', async () => {
    const store = await mountContainer();
    postConfig({ accentColor: '#669c35' }, window.location.origin);

    postConfig({ accentColor: 'red; } body { background: url(evil) }' }, window.location.origin);

    expect(store.accentColor).toBe('#669c35');
  });
});
