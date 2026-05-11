/**
 * Integration tests for the /view/ public discovery page (pv-u4ew.4).
 *
 * Full-mount, mocked-HTTP coverage of the five behavioral states:
 *   - loading
 *   - populated (tile list rendered)
 *   - empty
 *   - error
 *   - navigation (tile click resolves to /view/:urlName)
 *
 * Plus a per-locale rendering smoke test confirming that a representative
 * discovery.* key renders translated text in en / es / fr — not the literal
 * key string.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

import Discovery from '../discovery.vue';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';

import enSystem from '@/site/locales/en/system.json';
import esSystem from '@/site/locales/es/system.json';
import frSystem from '@/site/locales/fr/system.json';

// Stub HTTP transport at the ModelService layer so CalendarService.listPublicCalendars()
// runs its real entity -> PublicCalendarListing mapping against canned API responses.
vi.mock('@/client/service/models');

// A minimal stub for the site_config Config object the component injects.
// The discovery page reads settings().siteTitle and settings().instanceDescription;
// everything else can be omitted.
function makeSiteConfig(opts?: { instanceDescription?: Record<string, string>; siteTitle?: string }) {
  return {
    settings: () => ({
      registrationMode: 'closed',
      defaultDateRange: '1month',
      defaultLanguage: 'en',
      domain: 'test.local',
      siteTitle: opts?.siteTitle,
      instanceDescription: opts?.instanceDescription,
    }),
  };
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/view', name: 'discovery', component: Discovery },
      { path: '/view/:calendar', name: 'calendar', component: { template: '<div class="calendar-stub" />' } },
      { path: '/es/view', component: Discovery },
      { path: '/es/view/:calendar', component: { template: '<div class="calendar-stub" />' } },
      { path: '/fr/view', component: Discovery },
      { path: '/fr/view/:calendar', component: { template: '<div class="calendar-stub" />' } },
    ],
  });
}

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { system: enSystem },
        es: { system: esSystem },
        fr: { system: frSystem },
      },
    });
  }
  else {
    i18next.addResourceBundle('en', 'system', enSystem, true, true);
    i18next.addResourceBundle('es', 'system', esSystem, true, true);
    i18next.addResourceBundle('fr', 'system', frSystem, true, true);
  }
});

describe('discovery.vue - five behavioral states', () => {
  let pinia: ReturnType<typeof createPinia>;
  let router: ReturnType<typeof buildRouter>;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    router = buildRouter();
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mountDiscovery() {
    return mount(Discovery, {
      global: {
        plugins: [pinia, router, [I18NextVue, { i18next }]],
        provide: {
          site_config: makeSiteConfig(),
        },
      },
    });
  }

  it('renders the loading state before the request resolves', async () => {
    // Hold the listModels promise open so we can assert the loading frame.
    let resolveList: (value: ListResult) => void;
    const listPromise = new Promise<ListResult>((resolve) => {
      resolveList = resolve;
    });
    vi.mocked(ModelService.listModels).mockReturnValue(listPromise);

    await router.push('/view');
    const wrapper = mountDiscovery();

    // Synchronous-ish read before flushPromises: the loading state should be
    // the initial render. The discovery-loading container carries role=status.
    const loading = wrapper.find('.discovery-loading');
    expect(loading.exists()).toBe(true);
    expect(loading.attributes('role')).toBe('status');
    expect(loading.text()).toContain(enSystem.discovery.loading_label);

    // List/empty/error must NOT render in the loading frame.
    expect(wrapper.find('.discovery-list').exists()).toBe(false);
    expect(wrapper.find('.discovery-empty').exists()).toBe(false);
    expect(wrapper.find('.discovery-error').exists()).toBe(false);

    resolveList!(ListResult.fromArray([]));
    await flushPromises();
  });

  it('renders the populated tile list when the API returns calendars', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(
      ListResult.fromArray([
        {
          id: 'cal-1',
          urlName: 'alpha',
          content: [
            { language: 'en', name: 'Alpha Calendar', description: 'Alpha description' },
          ],
          lastEventActivity: '2026-05-01T12:00:00.000Z',
        },
        {
          id: 'cal-2',
          urlName: 'beta',
          content: [
            { language: 'en', name: 'Beta Calendar', description: '' },
          ],
          lastEventActivity: null,
        },
      ]),
    );

    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    // Loading frame must be gone.
    expect(wrapper.find('.discovery-loading').exists()).toBe(false);

    // Semantic list landmark with role='list' (preserves list semantics
    // even when list-style is none).
    const list = wrapper.find('ul.discovery-list');
    expect(list.exists()).toBe(true);
    expect(list.attributes('role')).toBe('list');

    const items = wrapper.findAll('.discovery-list-item');
    expect(items).toHaveLength(2);

    // Order is server-provided — first row should be the first tile rendered.
    const titles = wrapper.findAll('.discovery-tile-title').map((n) => n.text());
    expect(titles).toEqual(['Alpha Calendar', 'Beta Calendar']);

    // Description renders when present and is omitted when empty.
    const firstTile = items[0];
    expect(firstTile.find('.discovery-tile-description').text()).toBe('Alpha description');
    const secondTile = items[1];
    expect(secondTile.find('.discovery-tile-description').exists()).toBe(false);

    // applyHead() must have written the page_title into document.title — catches
    // a typo or wrong key path in the head metadata wiring.
    expect(document.title).toContain(enSystem.discovery.page_title);
  });

  it('renders the empty state when the API returns an empty array', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));

    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    expect(wrapper.find('.discovery-list').exists()).toBe(false);
    const empty = wrapper.find('.discovery-empty');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain(enSystem.discovery.empty_state_heading);
    expect(empty.text()).toContain(enSystem.discovery.empty_state_body);
  });

  it('renders the error state when the request rejects', async () => {
    vi.mocked(ModelService.listModels).mockRejectedValue(new Error('boom'));

    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    const error = wrapper.find('.discovery-error');
    expect(error.exists()).toBe(true);
    expect(error.attributes('role')).toBe('alert');
    expect(error.text()).toContain(enSystem.discovery.error_message);

    expect(wrapper.find('.discovery-list').exists()).toBe(false);
    expect(wrapper.find('.discovery-empty').exists()).toBe(false);
  });

  it('navigates to /view/:urlName when a calendar tile is clicked', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(
      ListResult.fromArray([
        {
          id: 'cal-1',
          urlName: 'alpha',
          content: [
            { language: 'en', name: 'Alpha Calendar', description: 'Alpha description' },
          ],
          lastEventActivity: '2026-05-01T12:00:00.000Z',
        },
      ]),
    );

    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    const tile = wrapper.find('.discovery-tile');
    expect(tile.exists()).toBe(true);
    // Keyboard-focusable: RouterLink renders an <a> with an href.
    expect(tile.element.tagName).toBe('A');
    expect(tile.attributes('href')).toBe('/view/alpha');

    await tile.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/view/alpha');
  });

  it('produces locale-prefixed tile hrefs when the visitor is on a non-default locale', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(
      ListResult.fromArray([
        {
          id: 'cal-1',
          urlName: 'alpha',
          content: [
            { language: 'es', name: 'Calendario Alfa', description: '' },
          ],
          lastEventActivity: '2026-05-01T12:00:00.000Z',
        },
      ]),
    );

    await i18next.changeLanguage('es');
    await router.push('/es/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    const tile = wrapper.find('.discovery-tile');
    expect(tile.exists()).toBe(true);
    // useLocale.localizedPath() should prefix the route with /es because the
    // visitor is on a non-default-locale URL.
    expect(tile.attributes('href')).toBe('/es/view/alpha');
  });

  it('uses a single <main> landmark and a single <h1> for the page', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    expect(wrapper.findAll('main')).toHaveLength(1);
    expect(wrapper.findAll('h1')).toHaveLength(1);
  });

  it('shows the instance description from site_config when configured for the visitor locale', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
    await router.push('/view');

    const wrapper = mount(Discovery, {
      global: {
        plugins: [pinia, router, [I18NextVue, { i18next }]],
        provide: {
          site_config: makeSiteConfig({ instanceDescription: { en: 'Welcome to the local instance' } }),
        },
      },
    });
    await flushPromises();

    const desc = wrapper.find('.discovery-instance-description');
    expect(desc.exists()).toBe(true);
    expect(desc.text()).toBe('Welcome to the local instance');
  });

  it('renders the configured siteTitle as the <h1> at the top of the page', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
    await router.push('/view');

    const wrapper = mount(Discovery, {
      global: {
        plugins: [pinia, router, [I18NextVue, { i18next }]],
        provide: { site_config: makeSiteConfig({ siteTitle: 'Local Events Hub' }) },
      },
    });
    await flushPromises();

    expect(wrapper.find('h1.discovery-title').text()).toBe('Local Events Hub');
  });

  it('falls back to "Pavillion" in the <h1> when siteTitle is not configured', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    expect(wrapper.find('h1.discovery-title').text()).toBe('Pavillion');
  });

  it('renders "Calendars on this instance" as an <h2> subheading after the description', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    const subheading = wrapper.find('h2.discovery-subheading');
    expect(subheading.exists()).toBe(true);
    expect(subheading.text()).toBe(enSystem.discovery.page_title);
  });

  it('renders a "Learn more about Pavillion" link pointing to pavillion.social with rel=noopener', async () => {
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
    await router.push('/view');
    const wrapper = mountDiscovery();
    await flushPromises();

    const link = wrapper.find('.discovery-learn-more a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://pavillion.social');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toContain('noopener');
    expect(link.text()).toBe(enSystem.discovery.learn_more);
  });
});

describe('discovery.vue - per-locale rendering smoke', () => {
  let pinia: ReturnType<typeof createPinia>;
  let router: ReturnType<typeof buildRouter>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    router = buildRouter();
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Mount the discovery page under a specific locale and read the rendered
   * subheading (h2) text. Asserts that the i18n bundle is wired up — the
   * page_title key must resolve to a translated string, not the literal
   * "discovery.page_title". The h1 carries siteTitle (Pavillion fallback),
   * not the translated page_title, so the subheading is the right target.
   */
  async function pageTitleFor(locale: 'en' | 'es' | 'fr', path: string): Promise<string> {
    await i18next.changeLanguage(locale);
    await router.push(path);
    const wrapper = mount(Discovery, {
      global: {
        plugins: [pinia, router, [I18NextVue, { i18next }]],
        provide: { site_config: { settings: () => ({}) } },
      },
    });
    await flushPromises();
    const text = wrapper.find('.discovery-subheading').text();
    wrapper.unmount();
    return text;
  }

  it('renders the page_title in English at /view', async () => {
    const text = await pageTitleFor('en', '/view');
    expect(text).toBe(enSystem.discovery.page_title);
    expect(text).not.toBe('discovery.page_title');
  });

  it('renders the page_title in Spanish at /es/view', async () => {
    const text = await pageTitleFor('es', '/es/view');
    expect(text).toBe(esSystem.discovery.page_title);
    expect(text).not.toBe('discovery.page_title');
    // Sanity: Spanish version must differ from English so we know the
    // translation actually resolved per-locale, not just hit a fallback.
    expect(text).not.toBe(enSystem.discovery.page_title);
  });

  it('renders the page_title in French at /fr/view', async () => {
    const text = await pageTitleFor('fr', '/fr/view');
    expect(text).toBe(frSystem.discovery.page_title);
    expect(text).not.toBe('discovery.page_title');
    expect(text).not.toBe(enSystem.discovery.page_title);
  });
});
