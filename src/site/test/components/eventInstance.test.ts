/**
 * Tests for the eventInstance component breadcrumb and category badge locale behaviour.
 *
 * Validates:
 * - The 'Back to calendar' breadcrumb uses localizedPath() so that
 *   locale-prefixed URLs are preserved (e.g. /es/view/:calendar).
 * - The default locale (en) breadcrumb links to /view/:calendar (no prefix).
 * - The breadcrumb displays a prominent "← Back to {calendar name}" link.
 * - Category badge links use localizedPath() for locale awareness.
 * - Category badge links use category.id (UUID) as the query param, not the English display name.
 * - Category names are displayed in the current UI language with English fallback.
 * - End time is displayed when state.instance.end is not null.
 * - Same-day events show only the time portion for the end time.
 * - Multi-day events show the full datetime for the end time.
 * - document.title is set to "Event Name | Pavillion" after loading.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

const mockCurrentLocale = ref('en');
const mockLocalizedPath = vi.fn((path: string) => path);

vi.mock('@/site/composables/useLocale', () => ({
  useLocale: () => ({
    currentLocale: mockCurrentLocale,
    switchLocale: vi.fn(),
    localizedPath: mockLocalizedPath,
  }),
}));

// Mutable categories state so individual tests can inject category data
let mockCategories: Array<{
  id: string;
  content: (lang: string) => { name: string };
}> = [];

// Mutable location state so individual tests can inject location data
let mockLocation: {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
} | null = null;

// Mutable end state so individual tests can inject end time data
let mockEnd: {
  toISO: () => string;
  toLocal: () => { setLocale: (locale: string) => { toLocaleString: (fmt: unknown) => string } };
  hasSame: (other: unknown, unit: string) => boolean;
} | null = null;

// Mutable event name so individual tests can control the event title
let mockEventName = 'Test Event';

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getCalendarByUrlName: vi.fn().mockResolvedValue({
        urlName: 'test_calendar',
        content: (_lang: string) => ({ name: 'Test Calendar', description: '' }),
        hasContent: (_lang: string) => true,
        getLanguages: () => ['en'],
      }),
      loadEventInstance: vi.fn().mockImplementation(() =>
        Promise.resolve({
          start: {
            toISO: () => '2026-03-01T10:00:00.000Z',
            toLocal: () => ({
              setLocale: (_locale: string) => ({
                toLocaleString: () => 'March 1, 2026, 10:00 AM',
              }),
            }),
            hasSame: (_other: unknown, unit: string) => unit === 'day' ? true : false,
          },
          end: mockEnd,
          event: {
            content: (_lang: string) => ({ name: mockEventName, description: 'Description here' }),
            hasContent: (_lang: string) => true,
            getLanguages: () => ['en'],
            media: null,
            categories: mockCategories,
            location: mockLocation,
          },
        }),
      ),
    })),
  };
});

vi.mock('@/site/components/report-event.vue', () => ({
  default: { template: '<div class="report-event-stub"></div>', props: ['eventId'] },
}));

vi.mock('@/site/components/notFound.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

vi.mock('@/site/components/EventImage.vue', () => ({
  default: { template: '<div class="event-image-stub"></div>', props: ['media', 'context'] },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import EventInstance from '@/site/components/eventInstance.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/view/:calendar/events/:event/:instance',
    component: EventInstance,
    name: 'instance',
  },
  {
    path: '/view/:calendar',
    component: { template: '<div />' },
    name: 'calendar',
  },
  {
    path: '/es/view/:calendar/events/:event/:instance',
    component: EventInstance,
  },
  {
    path: '/es/view/:calendar',
    component: { template: '<div />' },
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

async function mountInstance(
  initialPath: string,
  localizedPathFn: (path: string) => string,
): Promise<VueWrapper> {
  mockLocalizedPath.mockImplementation(localizedPathFn);

  const router = await buildRouter(initialPath);
  const pinia = createPinia();

  const wrapper = mount(EventInstance, {
    global: {
      plugins: [
        router,
        [I18NextVue, { i18next }],
        pinia,
      ],
    },
  });

  await flushPromises();
  return wrapper;
}

function makeCategoryObject(id: string, translations: Record<string, string>) {
  return {
    id,
    content: (lang: string) => {
      const name = translations[lang] ?? translations['en'] ?? '';
      return { name };
    },
    hasContent: (lang: string) => lang in translations,
    getLanguages: () => Object.keys(translations),
  };
}

// ---------------------------------------------------------------------------
// i18next initialisation
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: {
            back_to_calendar: 'Back to {{name}}',
          },
        },
      },
    });
  }
  else {
    // Add the key to the existing instance if already initialised by another test file
    i18next.addResourceBundle('en', 'system', { back_to_calendar: 'Back to {{name}}' }, true, true);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('eventInstance breadcrumb locale behaviour', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('breadcrumb link generation', () => {
    it('calls localizedPath with the calendar path to generate the breadcrumb href', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      expect(mockLocalizedPath).toHaveBeenCalledWith('/view/test_calendar');
      wrapper.unmount();
    });

    it('breadcrumb href is /view/test_calendar for default locale (no prefix)', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path, // default locale: no prefix added
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('/view/test_calendar');
      wrapper.unmount();
    });

    it('breadcrumb href is /es/view/test_calendar when localizedPath adds es prefix', async () => {
      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/inst-1',
        (path) => '/es' + path, // Spanish locale: adds /es prefix
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('/es/view/test_calendar');
      wrapper.unmount();
    });

    it('breadcrumb displays the calendar name within "Back to {name}" text', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.text()).toContain('Test Calendar');
      wrapper.unmount();
    });

    it('breadcrumb includes a back arrow indicator', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      // Arrow span is present (aria-hidden so screen readers skip it)
      const arrow = link.find('.back-arrow');
      expect(arrow.exists()).toBe(true);
      wrapper.unmount();
    });
  });
});

describe('eventInstance category badge locale behaviour', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('category badge link uses UUID', () => {
    it('uses category.id (UUID) as the category query param', async () => {
      mockCategories = [makeCategoryObject('uuid-arts-123', { en: 'Arts' })];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.attributes('href')).toContain('category=uuid-arts-123');
      wrapper.unmount();
    });

    it('does not use the English display name as the category query param', async () => {
      mockCategories = [makeCategoryObject('uuid-sports-456', { en: 'Sports & Recreation' })];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      const href = badge.attributes('href') ?? '';
      expect(href).not.toContain('Sports');
      expect(href).toContain('uuid-sports-456');
      wrapper.unmount();
    });
  });

  describe('category badge link includes locale prefix', () => {
    it('calls localizedPath for the calendar path used in category badge href', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-001', { en: 'Music' })];
      mockCurrentLocale.value = 'en';

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      // localizedPath should have been called with the calendar view path
      expect(mockLocalizedPath).toHaveBeenCalledWith('/view/test_calendar');
      wrapper.unmount();
    });

    it('category badge href includes locale prefix when locale is Spanish', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-002', { en: 'Music', es: 'Música' })];
      mockCurrentLocale.value = 'es';

      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/inst-1',
        (path) => '/es' + path, // Spanish: prepend /es
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      const href = badge.attributes('href') ?? '';
      expect(href).toContain('/es/');
      expect(href).toContain('category=cat-uuid-002');
      wrapper.unmount();
    });
  });

  describe('category badge displays name in current locale', () => {
    it('displays the English name when locale is English', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-003', { en: 'Theater', es: 'Teatro' })];
      mockCurrentLocale.value = 'en';

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('Theater');
      wrapper.unmount();
    });

    it('displays the Spanish name when locale is Spanish', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-004', { en: 'Theater', es: 'Teatro' })];
      mockCurrentLocale.value = 'es';

      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/inst-1',
        (path) => '/es' + path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('Teatro');
      wrapper.unmount();
    });

    it('falls back to English name when the current-locale translation is missing', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-005', { en: 'Theater' })]; // No Spanish translation
      mockCurrentLocale.value = 'es';

      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/inst-1',
        (path) => '/es' + path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      // Should fall back to English name since Spanish is missing
      expect(badge.text()).toBe('Theater');
      wrapper.unmount();
    });
  });

  describe('multiple category badges', () => {
    it('renders one badge per category', async () => {
      mockCategories = [
        makeCategoryObject('cat-a', { en: 'Arts' }),
        makeCategoryObject('cat-b', { en: 'Business' }),
        makeCategoryObject('cat-c', { en: 'Community' }),
      ];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const badges = wrapper.findAll('.event-category-badge');
      expect(badges.length).toBe(3);
      wrapper.unmount();
    });

    it('each badge href contains the correct UUID for that category', async () => {
      mockCategories = [
        makeCategoryObject('uuid-alpha', { en: 'Alpha' }),
        makeCategoryObject('uuid-beta', { en: 'Beta' }),
      ];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const badges = wrapper.findAll('.event-category-badge');
      expect(badges[0].attributes('href')).toContain('category=uuid-alpha');
      expect(badges[1].attributes('href')).toContain('category=uuid-beta');
      wrapper.unmount();
    });
  });

  describe('no categories', () => {
    it('renders no category badges when event has no categories', async () => {
      mockCategories = [];
      mockLocation = null;

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const badges = wrapper.findAll('.event-category-badge');
      expect(badges.length).toBe(0);
      wrapper.unmount();
    });
  });
});

describe('eventInstance location display', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('displays location section when event has location data', async () => {
    mockLocation = {
      name: 'Community Center',
      address: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    const locationSection = wrapper.find('.event-location');
    expect(locationSection.exists()).toBe(true);
    expect(locationSection.find('.location-name').text()).toBe('Community Center');
    expect(locationSection.find('.location-address').text()).toContain('123 Main St');
    expect(locationSection.find('.location-address').text()).toContain('Springfield');
    expect(locationSection.find('.location-address').text()).toContain('IL');
    wrapper.unmount();
  });

  it('does not display location section when event has no location', async () => {
    mockLocation = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    expect(wrapper.find('.event-location').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows venue name without address when only name is set', async () => {
    mockLocation = {
      name: 'Town Hall',
      address: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    const locationSection = wrapper.find('.event-location');
    expect(locationSection.exists()).toBe(true);
    expect(locationSection.find('.location-name').text()).toBe('Town Hall');
    expect(locationSection.find('.location-address').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('eventInstance end time display', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not show an end time separator when end is null', async () => {
    mockEnd = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    const timeEl = wrapper.find('.event-datetime');
    expect(timeEl.exists()).toBe(true);
    expect(timeEl.text()).not.toContain('–');
    wrapper.unmount();
  });

  it('shows end time with em-dash separator when end is on the same day', async () => {
    // Same day: hasSame('day') returns true => TIME_SIMPLE format for end
    mockEnd = {
      toISO: () => '2026-03-01T12:00:00.000Z',
      toLocal: () => ({
        setLocale: (_locale: string) => ({
          toLocaleString: () => '12:00 PM',
        }),
      }),
      hasSame: (_other: unknown, unit: string) => unit === 'day',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    const timeEl = wrapper.find('.event-datetime');
    expect(timeEl.exists()).toBe(true);
    const text = timeEl.text();
    expect(text).toContain('–');
    expect(text).toContain('12:00 PM');
    wrapper.unmount();
  });

  it('shows full datetime for end time when end is on a different day', async () => {
    // Different day: hasSame('day') returns false => DATETIME_MED format for end
    mockEnd = {
      toISO: () => '2026-03-02T02:00:00.000Z',
      toLocal: () => ({
        setLocale: (_locale: string) => ({
          toLocaleString: () => 'Mar 2, 2026, 2:00 AM',
        }),
      }),
      hasSame: (_other: unknown, unit: string) => unit !== 'day',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    const timeEl = wrapper.find('.event-datetime');
    expect(timeEl.exists()).toBe(true);
    const text = timeEl.text();
    expect(text).toContain('–');
    expect(text).toContain('Mar 2, 2026, 2:00 AM');
    wrapper.unmount();
  });
});

describe('eventInstance document.title', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
    document.title = 'Pavillion'; // Reset to default before each test
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.title = 'Pavillion';
  });

  it('sets document.title to "Event Name | Pavillion" after loading event data', async () => {
    mockEventName = 'My Awesome Concert';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    expect(document.title).toBe('My Awesome Concert | Pavillion');
    wrapper.unmount();
  });

  it('sets document.title using the localized event name', async () => {
    mockEventName = 'Test Event';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/inst-1',
      (path) => path,
    );

    expect(document.title).toBe('Test Event | Pavillion');
    wrapper.unmount();
  });
});
