/**
 * Tests for the widget's event detail overlay shell.
 *
 * The overlay is now a thin shell that owns:
 *   - The back-button header
 *   - The <main class="instance-main"> wrapper
 *   - <EventDetailBody> composition inside <main>
 *   - Loading / error / not-found states
 *
 * Per-region body coverage (hero image, badges, source pill, datetime row,
 * description + categories, sidebar cards, external CTA security guards,
 * AddToCalendar) lives in src/site/test/components/EventDetailBody.test.ts.
 *
 * Validates:
 *   - Back button renders and navigates to the widget calendar route.
 *   - <EventDetailBody> is composed inside <main> with the correct props
 *     (categoryHrefBuilder is omitted, so categories render as <span>).
 *   - Slug routing: parseInstanceSlug + service-call selection between
 *     loadEventInstance (slug present) and loadCalendarEvents (slug absent).
 *   - Not-found rendering when slug is unparseable or instance lookup
 *     returns null.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

// Spy hooks for assertions about which fetch path was taken. Hoisted so
// they are defined before vi.mock factories (which vitest runs at module
// evaluation time, *before* any top-level `const`).
const { loadCalendarEventsMock, loadEventInstanceMock } = vi.hoisted(() => ({
  loadCalendarEventsMock: vi.fn(),
  loadEventInstanceMock: vi.fn(),
}));

function buildFallbackInstanceMock() {
  const localized = {
    setLocale: () => ({
      toLocaleString: () => 'March 1, 2026',
    }),
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
      content: (_lang: string) => ({ name: 'Test Event', description: 'Description' }),
      hasContent: (_lang: string) => true,
      getLanguages: () => ['en'],
      media: null,
      mediaFocalPointX: 0.5,
      mediaFocalPointY: 0.5,
      mediaZoom: 1.0,
      categories: [],
      recurrenceSummary: null,
      location: null,
      sourceCalendar: null,
      externalUrl: null,
      urlPrompt: null,
    },
  };
}

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getCalendarByUrlName: vi.fn().mockResolvedValue({
        urlName: 'test_calendar',
        content: (_lang: string) => ({ name: 'Test Calendar', description: '' }),
        hasContent: (_lang: string) => true,
        getLanguages: () => ['en'],
      }),
      // Note: do NOT call mockImplementation here — that would clobber any
      // per-test mockResolvedValue set up before mountOverlay. The default
      // implementation is installed once in beforeEach instead.
      loadCalendarEvents: loadCalendarEventsMock,
      loadEventInstance: loadEventInstanceMock,
    })),
  };
});

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

vi.mock('@/site/components/EventDetailBody.vue', () => ({
  default: {
    name: 'EventDetailBody',
    props: ['instance', 'categoryHrefBuilder'],
    template: '<div data-test="event-detail-body" class="event-detail-body-stub"></div>',
  },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import EventDetailOverlay from '@/widget/components/event-detail-overlay.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/widget/:urlName/events/:eventId/:startTime(\\d{8}-\\d{4})?',
    component: EventDetailOverlay,
    name: 'widget-event',
  },
  {
    path: '/widget/:urlName',
    component: { template: '<div />' },
    name: 'widget-calendar',
  },
];

async function buildRouter(initialPath: string): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(initialPath);
  await router.isReady();
  return router;
}

async function mountOverlay(initialPath: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = await buildRouter(initialPath);
  const pinia = createPinia();

  const wrapper = mount(EventDetailOverlay, {
    global: {
      plugins: [
        router,
        [I18NextVue, { i18next }],
        pinia,
      ],
    },
  });

  await flushPromises();
  return { wrapper, router };
}

// ---------------------------------------------------------------------------
// i18next initialisation
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const resources = {
    back: 'Back',
    back_to_calendar: 'Back to {{name}}',
    loading_event: 'Loading event...',
    url_prompt: {
      tickets: 'Tickets',
      rsvp: 'RSVP',
      more_info: 'More Information',
    },
  };

  if (!i18next.isInitialized) {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: resources,
        },
      },
    });
  }
  else {
    i18next.addResourceBundle('en', 'system', resources, true, true);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('widget event-detail-overlay shell', () => {
  beforeEach(() => {
    loadCalendarEventsMock.mockReset();
    loadEventInstanceMock.mockReset();
    loadCalendarEventsMock.mockImplementation(
      () => Promise.resolve([buildFallbackInstanceMock()]),
    );
    loadEventInstanceMock.mockImplementation(
      () => Promise.resolve(buildFallbackInstanceMock()),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the back button when an instance is loaded', async () => {
    const { wrapper } = await mountOverlay('/widget/test_calendar/events/evt-1');

    const backButton = wrapper.find('.instance-back-header .back-link');
    expect(backButton.exists()).toBe(true);
    wrapper.unmount();
  });

  it('back-button click navigates to the widget-calendar route', async () => {
    const { wrapper, router } = await mountOverlay('/widget/test_calendar/events/evt-1');
    const pushSpy = vi.spyOn(router, 'push');

    const backButton = wrapper.find('.instance-back-header .back-link');
    expect(backButton.exists()).toBe(true);
    await backButton.trigger('click');

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const arg = pushSpy.mock.calls[0][0];
    expect(arg).toMatchObject({ name: 'widget-calendar' });
    wrapper.unmount();
  });

  it('renders <EventDetailBody> inside <main> when instance and calendar are loaded', async () => {
    const { wrapper } = await mountOverlay('/widget/test_calendar/events/evt-1');

    const main = wrapper.find('main.instance-main');
    expect(main.exists()).toBe(true);
    const body = main.find('[data-test="event-detail-body"]');
    expect(body.exists()).toBe(true);
    wrapper.unmount();
  });

  it('passes the loaded instance and a category href builder to EventDetailBody', async () => {
    const { wrapper } = await mountOverlay('/widget/test_calendar/events/evt-1');

    const body = wrapper.findComponent({ name: 'EventDetailBody' });
    expect(body.exists()).toBe(true);
    expect(body.props('instance')).toBeTruthy();
    expect((body.props('instance') as any).id).toBe('inst-1');
    // Widget shell supplies a categoryHrefBuilder so categories render as
    // clickable <a> badges that filter the widget calendar list.
    const builder = body.props('categoryHrefBuilder') as ((c: { id: string }) => string) | undefined;
    expect(typeof builder).toBe('function');
    const href = builder!({ id: 'cat-123' } as any);
    expect(href).toContain('/widget/test_calendar');
    expect(href).toContain('categories=cat-123');
    wrapper.unmount();
  });
});

describe('widget event-detail-overlay slug routing', () => {
  beforeEach(() => {
    loadCalendarEventsMock.mockReset();
    loadEventInstanceMock.mockReset();
    loadCalendarEventsMock.mockImplementation(
      () => Promise.resolve([buildFallbackInstanceMock()]),
    );
    loadEventInstanceMock.mockImplementation(
      () => Promise.resolve(buildFallbackInstanceMock()),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the instance via calendarService.loadEventInstance when startTime is present in the route', async () => {
    // Arrange: loadEventInstance returns a deserialized occurrence shape
    // the overlay template can render.
    loadEventInstanceMock.mockResolvedValue({
      id: 'inst-1',
      start: {
        toISO: () => '2026-05-08T18:00:00.000Z',
        toLocal: () => ({
          setLocale: () => ({ toLocaleString: () => 'May 8, 2026' }),
          toLocaleString: () => 'May 8, 2026, 6:00 PM',
        }),
        hasSame: () => true,
      },
      end: null,
      event: {
        id: 'evt-1',
        content: (_lang: string) => ({ name: 'Slug Event', description: '' }),
        hasContent: () => true,
        getLanguages: () => ['en'],
        media: null,
        mediaFocalPointX: 0.5,
        mediaFocalPointY: 0.5,
        mediaZoom: 1.0,
        categories: [],
        recurrenceSummary: null,
        location: null,
        sourceCalendar: null,
        externalUrl: null,
        urlPrompt: null,
      },
    });

    const { wrapper } = await mountOverlay('/widget/test_calendar/events/evt-1/20260508-1800');

    expect(loadEventInstanceMock).toHaveBeenCalledTimes(1);
    const [calledEventId, calledStartTime, calledCalendar] = loadEventInstanceMock.mock.calls[0];
    expect(calledEventId).toBe('evt-1');
    // parseInstanceSlug('20260508-1800') → 2026-05-08T18:00:00Z DateTime
    expect(calledStartTime.toISO()).toBe('2026-05-08T18:00:00.000Z');
    // Calendar urlName forwarded so reposted-event categories scope to the
    // display calendar via the backend's `?calendar=` query param.
    expect(calledCalendar).toBe('test_calendar');
    // The fallback list-scan path must NOT run when the slug path is taken.
    expect(loadCalendarEventsMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('falls back to the event list scan when startTime is absent (no redundant detail fetch)', async () => {
    const { wrapper } = await mountOverlay('/widget/test_calendar/events/evt-1');

    // Fallback path uses loadCalendarEvents once; no second detail fetch
    // (the list response already carries enough data for the overlay).
    expect(loadCalendarEventsMock).toHaveBeenCalledTimes(1);
    expect(loadEventInstanceMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('renders not-found when startTime is semantically invalid (parseInstanceSlug returns null)', async () => {
    // The router regex only enforces \d{8}-\d{4}; parseInstanceSlug is the
    // semantic gate (month 13, day 32, bad year, etc.).
    const { wrapper } = await mountOverlay('/widget/test_calendar/events/evt-1/20261301-2500');

    expect(wrapper.find('.not-found-stub').exists()).toBe(true);
    // Neither the slug fetch nor the fallback list scan should run when the
    // slug itself is unparseable — the overlay short-circuits.
    expect(loadEventInstanceMock).not.toHaveBeenCalled();
    expect(loadCalendarEventsMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('renders not-found when loadEventInstance returns null (instance not found)', async () => {
    loadEventInstanceMock.mockResolvedValue(null);

    const { wrapper } = await mountOverlay('/widget/test_calendar/events/evt-1/20260508-1800');

    expect(loadEventInstanceMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.not-found-stub').exists()).toBe(true);
    wrapper.unmount();
  });
});
