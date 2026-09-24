/**
 * Tests for the widget router's server-config guard.
 *
 * Widget display config (view / accentColor / colorMode) is fetched from
 * `GET /api/widget/v1/calendars/:urlName` by a router guard, so it is in the
 * store before ANY route renders — including a direct entry (deep link or
 * full reload) to the event-detail route, which never mounts
 * widget-container.vue.
 *
 * These tests drive the real widget router (real routes + real guard) through
 * the real app shell, so the assertions cover what a visitor sees: the
 * `.widget-root` theme class and the accent custom property.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

import { WIDGET_CONFIG_DEFAULTS } from '@/common/model/widget_config';

// ---------------------------------------------------------------------------
// Mocks — declared before subject import
// ---------------------------------------------------------------------------

function buildInstanceMock() {
  const localized = {
    setLocale: () => ({ toLocaleString: () => 'March 1, 2026' }),
    toLocaleString: () => 'March 1, 2026, 10:00 AM',
  };
  return {
    id: 'inst-1',
    start: {
      toISO: () => '2026-03-01T10:00:00.000Z',
      toLocal: () => localized,
      hasSame: () => true,
    },
    end: null,
    event: {
      id: 'evt-1',
      content: () => ({ name: 'Test Event', description: '' }),
      hasContent: () => true,
      getLanguages: () => ['en'],
      categories: [],
    },
  };
}

vi.mock('@/site/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    getCalendarByUrlName: vi.fn().mockResolvedValue({
      urlName: 'test_calendar',
      content: () => ({ name: 'Test Calendar', description: '' }),
      hasContent: () => true,
      getLanguages: () => ['en'],
    }),
    loadEventInstance: vi.fn().mockImplementation(() => Promise.resolve(buildInstanceMock())),
    loadCalendarEvents: vi.fn().mockImplementation(() => Promise.resolve([buildInstanceMock()])),
  })),
}));

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

vi.mock('@/site/components/EventDetailBody.vue', () => ({
  default: {
    name: 'EventDetailBody',
    props: ['instance', 'categoryHrefBuilder'],
    template: '<div data-test="event-detail-body"></div>',
  },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import router from '@/widget/router';
import AppVue from '@/widget/components/app.vue';
import { useWidgetStore } from '@/widget/stores/widgetStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVER_CONFIG = { view: 'list', accentColor: '#669c35', colorMode: 'light' };

function stubFetch(response: { ok: boolean; body?: unknown } | Error) {
  const fetchMock = vi.fn().mockImplementation(() => {
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve({
      ok: response.ok,
      json: () => Promise.resolve(response.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Simulate an OS in dark mode, which is where an unloaded `auto` default goes wrong. */
function stubDarkSystem() {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function widgetConfigCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith('/api/widget/v1/calendars/'));
}

/**
 * Mount the widget app shell, then enter the widget at `path` the way a deep
 * link or full iframe reload does: the location is already `path` when the
 * router resolves it.
 */
async function enterWidgetAt(path: string, pinia: ReturnType<typeof createPinia>): Promise<VueWrapper> {
  window.history.replaceState(window.history.state, '', path);
  const wrapper = mount(AppVue, {
    global: {
      plugins: [pinia, router, [I18NextVue, { i18next }]],
    },
  });
  await router.push(path);
  await flushPromises();
  return wrapper;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const resources = { back: 'Back', loading_events: 'Loading event...', powered_by: 'Powered by Pavillion' };
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources: { en: { system: resources } } });
  }
  else {
    i18next.addResourceBundle('en', 'system', resources, true, true);
  }
});

describe('widget router server-config guard', () => {
  let pinia: ReturnType<typeof createPinia>;
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    stubDarkSystem();
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    })));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.unstubAllGlobals();
  });

  it('applies the server colorMode and accent on direct entry to the event-detail route', async () => {
    const fetchMock = stubFetch({ ok: true, body: { widgetConfig: SERVER_CONFIG } });

    wrapper = await enterWidgetAt('/widget/direct_cal/events/evt-1', pinia);

    expect(router.currentRoute.value.name).toBe('widget-event-detail');
    expect(widgetConfigCalls(fetchMock)).toEqual(['/api/widget/v1/calendars/direct_cal']);

    const root = wrapper.find('.widget-root').element as HTMLElement;
    expect(root.classList.contains('widget-theme-light')).toBe(true);
    expect(root.classList.contains('widget-theme-dark')).toBe(false);
    expect(root.style.getPropertyValue('--pav-accent-light')).toBe('#669c35');
    expect(wrapper.find('[data-test="event-detail-body"]').exists()).toBe(true);
  });

  it('holds the navigation until server config resolves, so the detail route never renders with defaults', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    })));
    const store = useWidgetStore();

    const navigation = router.push('/widget/pending_cal/events/evt-1');
    await flushPromises();

    expect(router.currentRoute.value.params.urlName).not.toBe('pending_cal');

    resolveFetch({ ok: true, json: () => Promise.resolve({ widgetConfig: SERVER_CONFIG }) });
    await navigation;

    expect(router.currentRoute.value.params.urlName).toBe('pending_cal');
    expect(store.colorMode).toBe('light');
    expect(store.accentColor).toBe('#669c35');
    expect(store.calendarUrlName).toBe('pending_cal');
  });

  it('fetches config once per calendar across navigations within that calendar', async () => {
    const fetchMock = stubFetch({ ok: true, body: { widgetConfig: SERVER_CONFIG } });

    wrapper = await enterWidgetAt('/widget/same_cal/events/evt-1', pinia);
    await router.push('/widget/same_cal/events/evt-2');
    await flushPromises();

    expect(widgetConfigCalls(fetchMock)).toEqual(['/api/widget/v1/calendars/same_cal']);
  });

  it('re-fetches config when navigation moves to a different calendar', async () => {
    const fetchMock = stubFetch({ ok: true, body: { widgetConfig: SERVER_CONFIG } });

    wrapper = await enterWidgetAt('/widget/first_cal/events/evt-1', pinia);
    await router.push('/widget/second_cal/events/evt-1');
    await flushPromises();

    expect(widgetConfigCalls(fetchMock)).toEqual([
      '/api/widget/v1/calendars/first_cal',
      '/api/widget/v1/calendars/second_cal',
    ]);
  });

  it('lets admin-preview URL params override the server config', async () => {
    stubFetch({ ok: true, body: { widgetConfig: SERVER_CONFIG } });

    wrapper = await enterWidgetAt('/widget/preview_cal/events/evt-1?colorMode=dark&accentColor=%23123456', pinia);

    const store = useWidgetStore();
    expect(store.colorMode).toBe('dark');
    expect(store.accentColor).toBe('#123456');
    // Unoverridden server values still apply.
    expect(store.viewMode).toBe('list');
  });

  it('falls back to defaults when the widget config endpoint responds with an error', async () => {
    stubFetch({ ok: false });

    wrapper = await enterWidgetAt('/widget/error_cal/events/evt-1', pinia);

    const store = useWidgetStore();
    expect(store.colorMode).toBe(WIDGET_CONFIG_DEFAULTS.colorMode);
    expect(store.accentColor).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);
    expect(wrapper.find('[data-test="event-detail-body"]').exists()).toBe(true);
  });

  it('falls back to defaults and still renders the route when the config fetch throws', async () => {
    stubFetch(new Error('network down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    wrapper = await enterWidgetAt('/widget/offline_cal/events/evt-1', pinia);

    const store = useWidgetStore();
    expect(store.colorMode).toBe(WIDGET_CONFIG_DEFAULTS.colorMode);
    expect(warnSpy).toHaveBeenCalled();
    expect(router.currentRoute.value.params.urlName).toBe('offline_cal');
    expect(wrapper.find('[data-test="event-detail-body"]').exists()).toBe(true);
    warnSpy.mockRestore();
  });
});
