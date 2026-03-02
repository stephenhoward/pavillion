/**
 * Tests for the event component (non-instance event detail page).
 *
 * Validates:
 * - The 'Back to calendar' breadcrumb uses localizedPath() so that
 *   locale-prefixed URLs are preserved (e.g. /es/view/:calendar).
 * - The default locale (en) breadcrumb links to /view/:calendar (no prefix).
 * - The breadcrumb displays a prominent "← Back to {calendar name}" link.
 * - Category badge links use localizedPath() for locale awareness.
 * - Category badge links use category.id (UUID) as the query param.
 * - Category names are displayed in the current UI language with English fallback.
 * - Events with a series show a clickable series link.
 * - Events without a series show no series link.
 * - Location sidebar card displays location name and address.
 * - Accessibility sidebar card displays location accessibility info.
 * - No date/time section rendered (non-instance events have no specific dates).
 * - Two-column layout: description and categories in main column, sidebar cards in aside.
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
  hasContent: (lang: string) => boolean;
  getLanguages: () => string[];
}> = [];

// Mutable location state so individual tests can inject location data
let mockLocation: {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  hasContent?: (lang: string) => boolean;
  content?: (lang: string) => { accessibilityInfo: string };
  getLanguages?: () => string[];
} | null = null;

// Mutable event name so individual tests can control the event title
let mockEventName = 'Test Event';

// Mutable series state so individual tests can inject series data
let mockSeries: {
  urlName: string;
  content: (lang: string) => { name: string };
  hasContent: (lang: string) => boolean;
  getLanguages: () => string[];
} | null = null;

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getCalendarByUrlName: vi.fn().mockResolvedValue({
        urlName: 'test_calendar',
        content: (_lang: string) => ({ name: 'Test Calendar', description: '' }),
        hasContent: (_lang: string) => true,
        getLanguages: () => ['en'],
      }),
      loadEvent: vi.fn().mockImplementation(() =>
        Promise.resolve({
          content: (_lang: string) => ({ name: mockEventName, description: 'Description here' }),
          hasContent: (_lang: string) => true,
          getLanguages: () => ['en'],
          media: null,
          categories: mockCategories,
          location: mockLocation,
          series: mockSeries,
          schedules: [],
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
  default: { template: '<div class="event-image-stub"></div>', props: ['media', 'context', 'alt'] },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import EventDetail from '@/site/components/event.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/view/:calendar/events/:event',
    component: EventDetail,
    name: 'event',
  },
  {
    path: '/view/:calendar',
    component: { template: '<div />' },
    name: 'calendar',
  },
  {
    path: '/es/view/:calendar/events/:event',
    component: EventDetail,
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

async function mountEvent(
  initialPath: string,
  localizedPathFn: (path: string) => string,
): Promise<VueWrapper> {
  mockLocalizedPath.mockImplementation(localizedPathFn);

  const router = await buildRouter(initialPath);
  const pinia = createPinia();

  const wrapper = mount(EventDetail, {
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

function makeSeriesObject(urlName: string, translations: Record<string, string>) {
  return {
    urlName,
    content: (lang: string) => {
      const name = translations[lang] ?? translations['en'] ?? '';
      return { name };
    },
    hasContent: (lang: string) => lang in translations,
    getLanguages: () => Object.keys(translations),
  };
}

/**
 * Creates a mock EventLocation with TranslatedModel interface.
 */
function makeLocationObject(
  name: string,
  address: string,
  city: string,
  state: string,
  postalCode: string,
  country: string,
  accessibilityInfo: Record<string, string> = {},
) {
  return {
    name,
    address,
    city,
    state,
    postalCode,
    country,
    hasContent: (lang: string) => lang in accessibilityInfo,
    content: (lang: string) => ({
      language: lang,
      accessibilityInfo: accessibilityInfo[lang] ?? accessibilityInfo['en'] ?? '',
    }),
    getLanguages: () => Object.keys(accessibilityInfo),
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
            'series.label': 'Series',
            'series.part_of': 'Part of {{name}}',
            'series.view': 'View series',
            about_this_event: 'About This Event',
            event_categories: 'Categories',
            event_accessibility: 'Accessibility',
            event_location: 'Location',
          },
        },
      },
    });
  }
  else {
    i18next.addResourceBundle('en', 'system', {
      back_to_calendar: 'Back to {{name}}',
      'series.label': 'Series',
      'series.part_of': 'Part of {{name}}',
      'series.view': 'View series',
      about_this_event: 'About This Event',
      event_categories: 'Categories',
      event_accessibility: 'Accessibility',
      event_location: 'Location',
    }, true, true);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('event breadcrumb locale behaviour', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEventName = 'Test Event';
    mockSeries = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('breadcrumb link generation', () => {
    it('should call localizedPath with the calendar path to generate the breadcrumb href', async () => {
      const wrapper = await mountEvent(
        '/view/test_calendar/events/evt-1',
        (path) => path,
      );

      expect(mockLocalizedPath).toHaveBeenCalledWith('/view/test_calendar');
      wrapper.unmount();
    });

    it('should set breadcrumb href to /view/test_calendar for default locale (no prefix)', async () => {
      const wrapper = await mountEvent(
        '/view/test_calendar/events/evt-1',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('/view/test_calendar');
      wrapper.unmount();
    });

    it('should set breadcrumb href to /es/view/test_calendar when localizedPath adds es prefix', async () => {
      const wrapper = await mountEvent(
        '/es/view/test_calendar/events/evt-1',
        (path) => '/es' + path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('/es/view/test_calendar');
      wrapper.unmount();
    });

    it('should display the calendar name within "Back to {name}" text', async () => {
      const wrapper = await mountEvent(
        '/view/test_calendar/events/evt-1',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.text()).toContain('Test Calendar');
      wrapper.unmount();
    });

    it('should include a back arrow indicator in the breadcrumb', async () => {
      const wrapper = await mountEvent(
        '/view/test_calendar/events/evt-1',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      const arrow = link.find('.back-arrow');
      expect(arrow.exists()).toBe(true);
      wrapper.unmount();
    });
  });
});

describe('event two-column layout', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEventName = 'Test Event';
    mockSeries = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render the detail-grid with detail-main and detail-sidebar', async () => {
    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    expect(wrapper.find('.detail-grid').exists()).toBe(true);
    expect(wrapper.find('.detail-main').exists()).toBe(true);
    expect(wrapper.find('.detail-sidebar').exists()).toBe(true);
    wrapper.unmount();
  });

  it('should NOT render a datetime-row (no dates for non-instance events)', async () => {
    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    expect(wrapper.find('.datetime-row').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render a recurrence-badge (no recurrence for non-instance events)', async () => {
    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    expect(wrapper.find('.recurrence-badge').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render a recurrence-card sidebar card', async () => {
    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    expect(wrapper.find('.recurrence-card').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should render event description in the main column', async () => {
    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const descriptionEl = wrapper.find('.event-description');
    expect(descriptionEl.exists()).toBe(true);
    expect(descriptionEl.text()).toContain('Description here');
    wrapper.unmount();
  });

  it('should render the event title as h1', async () => {
    mockEventName = 'My Special Event';

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const title = wrapper.find('h1');
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe('My Special Event');
    wrapper.unmount();
  });
});

describe('event category badge behaviour', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEventName = 'Test Event';
    mockSeries = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should use category.id (UUID) as the category query param', async () => {
    mockCategories = [makeCategoryObject('uuid-arts-123', { en: 'Arts' })];

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const badge = wrapper.find('.event-category-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.attributes('href')).toContain('category=uuid-arts-123');
    wrapper.unmount();
  });

  it('should not use the English display name as the category query param', async () => {
    mockCategories = [makeCategoryObject('uuid-sports-456', { en: 'Sports & Recreation' })];

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const badge = wrapper.find('.event-category-badge');
    expect(badge.exists()).toBe(true);
    const href = badge.attributes('href') ?? '';
    expect(href).not.toContain('Sports');
    expect(href).toContain('uuid-sports-456');
    wrapper.unmount();
  });

  it('should display category name in English when locale is English', async () => {
    mockCategories = [makeCategoryObject('cat-uuid-003', { en: 'Theater', es: 'Teatro' })];
    mockCurrentLocale.value = 'en';

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const badge = wrapper.find('.event-category-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('Theater');
    wrapper.unmount();
  });

  it('should display category name in Spanish when locale is Spanish', async () => {
    mockCategories = [makeCategoryObject('cat-uuid-004', { en: 'Theater', es: 'Teatro' })];
    mockCurrentLocale.value = 'es';

    const wrapper = await mountEvent(
      '/es/view/test_calendar/events/evt-1',
      (path) => '/es' + path,
    );

    const badge = wrapper.find('.event-category-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('Teatro');
    wrapper.unmount();
  });

  it('should fall back to English name when the current-locale translation is missing', async () => {
    mockCategories = [makeCategoryObject('cat-uuid-005', { en: 'Theater' })];
    mockCurrentLocale.value = 'es';

    const wrapper = await mountEvent(
      '/es/view/test_calendar/events/evt-1',
      (path) => '/es' + path,
    );

    const badge = wrapper.find('.event-category-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('Theater');
    wrapper.unmount();
  });

  it('should render one badge per category', async () => {
    mockCategories = [
      makeCategoryObject('cat-a', { en: 'Arts' }),
      makeCategoryObject('cat-b', { en: 'Business' }),
      makeCategoryObject('cat-c', { en: 'Community' }),
    ];

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const badges = wrapper.findAll('.event-category-badge');
    expect(badges.length).toBe(3);
    wrapper.unmount();
  });

  it('should render no category badges when event has no categories', async () => {
    mockCategories = [];

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const badges = wrapper.findAll('.event-category-badge');
    expect(badges.length).toBe(0);
    wrapper.unmount();
  });

  it('should include locale prefix in category badge href when locale is Spanish', async () => {
    mockCategories = [makeCategoryObject('cat-uuid-002', { en: 'Music', es: 'Música' })];
    mockCurrentLocale.value = 'es';

    const wrapper = await mountEvent(
      '/es/view/test_calendar/events/evt-1',
      (path) => '/es' + path,
    );

    const badge = wrapper.find('.event-category-badge');
    expect(badge.exists()).toBe(true);
    const href = badge.attributes('href') ?? '';
    expect(href).toContain('/es/');
    expect(href).toContain('category=cat-uuid-002');
    wrapper.unmount();
  });
});

describe('event location display', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEventName = 'Test Event';
    mockSeries = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should display location section when event has location data', async () => {
    mockLocation = {
      name: 'Community Center',
      address: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    };

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
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

  it('should not display location section when event has no location', async () => {
    mockLocation = null;

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    expect(wrapper.find('.event-location').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should show venue name without address when only name is set', async () => {
    mockLocation = {
      name: 'Town Hall',
      address: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    };

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const locationSection = wrapper.find('.event-location');
    expect(locationSection.exists()).toBe(true);
    expect(locationSection.find('.location-name').text()).toBe('Town Hall');
    expect(locationSection.find('.location-address').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should display accessibility info card when location has accessibility info', async () => {
    mockLocation = makeLocationObject(
      'Community Center',
      '123 Main St',
      'Springfield',
      'IL',
      '62701',
      'US',
      { en: 'Wheelchair accessible entrance on west side' },
    );

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const accessibilityCard = wrapper.find('.accessibility-card');
    expect(accessibilityCard.exists()).toBe(true);
    expect(accessibilityCard.find('.accessibility-info').text()).toContain('Wheelchair accessible');
    wrapper.unmount();
  });

  it('should not display accessibility card when location has no accessibility info', async () => {
    mockLocation = makeLocationObject(
      'Town Hall',
      '1 Main St',
      'Anytown',
      'CA',
      '90210',
      'US',
      {},
    );

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    expect(wrapper.find('.accessibility-card').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should not display accessibility card when location is a plain object without accessibility', async () => {
    mockLocation = {
      name: 'Community Center',
      address: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    };

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    expect(wrapper.find('.accessibility-card').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('event series link display', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEventName = 'Test Event';
    mockSeries = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render a series link when the event belongs to a series', async () => {
    mockSeries = makeSeriesObject('yoga-classes', { en: 'Yoga Classes' });

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(true);
    wrapper.unmount();
  });

  it('should not render a series link when the event has no series', async () => {
    mockSeries = null;

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(false);
    wrapper.unmount();
  });

  it('should set series link href to point to the series page', async () => {
    mockSeries = makeSeriesObject('yoga-classes', { en: 'Yoga Classes' });

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(true);
    expect(seriesLink.attributes('href')).toBe('/view/test_calendar/series/yoga-classes');
    wrapper.unmount();
  });

  it('should display the localized series name in the series link', async () => {
    mockSeries = makeSeriesObject('yoga-classes', { en: 'Yoga Classes', es: 'Clases de Yoga' });
    mockCurrentLocale.value = 'en';

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(true);
    expect(seriesLink.text()).toBe('Yoga Classes');
    wrapper.unmount();
  });

  it('should include locale prefix in series link href when locale is active', async () => {
    mockSeries = makeSeriesObject('yoga-classes', { en: 'Yoga Classes' });
    mockCurrentLocale.value = 'es';

    const wrapper = await mountEvent(
      '/es/view/test_calendar/events/evt-1',
      (path) => '/es' + path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(true);
    expect(seriesLink.attributes('href')).toBe('/es/view/test_calendar/series/yoga-classes');
    wrapper.unmount();
  });

  it('should show series label text alongside the series link', async () => {
    mockSeries = makeSeriesObject('book-club', { en: 'Book Club' });

    const wrapper = await mountEvent(
      '/view/test_calendar/events/evt-1',
      (path) => path,
    );

    const seriesWrapper = wrapper.find('.series-link-wrapper');
    expect(seriesWrapper.exists()).toBe(true);
    const label = seriesWrapper.find('.series-label');
    expect(label.exists()).toBe(true);
    wrapper.unmount();
  });
});
