/**
 * Tests for the eventInstance component.
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
 * - Events with a series show a clickable series link.
 * - Events without a series show no series link.
 * - Recurrence badge is shown when event has a recurrenceSummary from the public API.
 * - Location sidebar card displays location name and address.
 * - Accessibility sidebar card displays location accessibility info.
 * - Recurrence sidebar card displays human-readable recurrence text.
 * - Source calendar pill renders for reposted events with sourceCalendar data.
 * - Source calendar pill does NOT render when sourceCalendar is null.
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
  hasContent?: (lang: string) => boolean;
  content?: (lang: string) => { accessibilityInfo: string };
  getLanguages?: () => string[];
} | null = null;

// Mutable end state so individual tests can inject end time data
let mockEnd: {
  toISO: () => string;
  toLocal: () => { setLocale: (locale: string) => { toLocaleString: (fmt: unknown) => string } };
  hasSame: (other: unknown, unit: string) => boolean;
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

// Mutable recurrenceSummary state so individual tests can inject a summary
// matching the public API's `{ key, params } | null` shape (pv-kzc0.2).
let mockRecurrenceSummary: { key: string; params: Record<string, unknown> } | null = null;

// Mutable source calendar state so individual tests can inject source calendar data
let mockSourceCalendar: {
  urlName: string;
  host: string;
  url: string;
} | null = null;

// Mutable externalUrl / urlPrompt so tests can inject external CTA data
let mockExternalUrl: string | null = null;
let mockUrlPrompt: string | null = null;

// Mutable event-level accessibility info
let mockEventAccessibilityInfo: string = '';

// Mutable isCancelled flag so tests can assert cancelled badge rendering
let mockIsCancelled: boolean = false;

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
            toISODate: () => '2026-03-01',
            toLocal: () => ({
              setLocale: (_locale: string) => ({
                toLocaleString: () => 'March 1, 2026, 10:00 AM',
              }),
            }),
            hasSame: (_other: unknown, unit: string) => unit === 'day' ? true : false,
          },
          end: mockEnd,
          isCancelled: mockIsCancelled,
          event: {
            content: (_lang: string) => ({ name: mockEventName, description: 'Description here', accessibilityInfo: mockEventAccessibilityInfo }),
            hasContent: (_lang: string) => true,
            getLanguages: () => ['en'],
            media: null,
            mediaFocalPointX: 0.5,
            mediaFocalPointY: 0.5,
            mediaZoom: 1.0,
            categories: mockCategories,
            location: mockLocation,
            series: mockSeries,
            recurrenceSummary: mockRecurrenceSummary,
            sourceCalendar: mockSourceCalendar,
            externalUrl: mockExternalUrl,
            urlPrompt: mockUrlPrompt,
          },
        }),
      ),
    })),
  };
});

vi.mock('@/site/components/report-event.vue', () => ({
  default: { template: '<div class="report-event-stub"></div>', props: ['eventId'] },
}));

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

vi.mock('@/site/components/event-image.vue', () => ({
  default: { template: '<div class="event-image-stub"></div>', props: ['media', 'context', 'alt', 'focalPointX', 'focalPointY', 'zoom'] },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import EventInstance from '@/site/components/event-instance.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})',
    component: EventInstance,
    name: 'instance',
  },
  {
    path: '/view/:calendar',
    component: { template: '<div />' },
    name: 'calendar',
  },
  {
    path: '/es/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})',
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

/**
 * Creates a recurrenceSummary object matching the public API's
 * `{ key, params }` intent shape. This is the shape the frontend
 * consumes via `useRecurrenceText` (pv-kzc0.4).
 */
function makeRecurrenceSummary(
  key: string,
  params: Record<string, unknown> = {},
): { key: string; params: Record<string, unknown> } {
  return { key, params };
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
            event_accessibility_event: 'Event Accessibility',
            event_accessibility_venue: 'Venue Accessibility',
            event_recurring: 'Recurring Event',
            event_location: 'Location',
            event_source_calendar: 'Source Calendar',
            event_source_calendar_label: 'View source calendar {{name}}',
            event_cancelled: 'Cancelled',
            url_prompt: {
              tickets: 'Tickets',
              rsvp: 'RSVP',
              more_info: 'More Information',
            },
            recurrence: {
              every_day: 'Every day',
              every_n_days: 'Every {{n}} days',
              weekly_every_week: 'Every week',
              weekly_on_days: 'Weekly on {{days}}',
              every_n_weeks: 'Every {{n}} weeks',
              every_n_weeks_on_days: 'Every {{n}} weeks on {{days}}',
              monthly: 'Monthly',
              every_n_months: 'Every {{n}} months',
              nth_weekday_of_month: 'The {{ordinal}} {{day}} of every month',
              nth_weekday_every_n_months: 'The {{ordinal}} {{day}} every {{n}} months',
              yearly: 'Yearly',
              every_n_years: 'Every {{n}} years',
              days: {
                MO: 'Monday',
                TU: 'Tuesday',
                WE: 'Wednesday',
                TH: 'Thursday',
                FR: 'Friday',
                SA: 'Saturday',
                SU: 'Sunday',
              },
              ordinals: {
                1: 'first',
                2: 'second',
                3: 'third',
                4: 'fourth',
                '-1': 'last',
              },
            },
          },
        },
      },
    });
  }
  else {
    // Add the key to the existing instance if already initialised by another test file
    i18next.addResourceBundle('en', 'system', {
      back_to_calendar: 'Back to {{name}}',
      'series.label': 'Series',
      'series.part_of': 'Part of {{name}}',
      'series.view': 'View series',
      about_this_event: 'About This Event',
      event_categories: 'Categories',
      event_accessibility: 'Accessibility',
      event_recurring: 'Recurring Event',
      event_location: 'Location',
      event_source_calendar: 'Source Calendar',
      event_source_calendar_label: 'View source calendar {{name}}',
      event_cancelled: 'Cancelled',
      url_prompt: {
        tickets: 'Tickets',
        rsvp: 'RSVP',
        more_info: 'More Information',
      },
      recurrence: {
        every_day: 'Every day',
        every_n_days: 'Every {{n}} days',
        weekly_every_week: 'Every week',
        weekly_on_days: 'Weekly on {{days}}',
        every_n_weeks: 'Every {{n}} weeks',
        every_n_weeks_on_days: 'Every {{n}} weeks on {{days}}',
        monthly: 'Monthly',
        every_n_months: 'Every {{n}} months',
        nth_weekday_of_month: 'The {{ordinal}} {{day}} of every month',
        nth_weekday_every_n_months: 'The {{ordinal}} {{day}} every {{n}} months',
        yearly: 'Yearly',
        every_n_years: 'Every {{n}} years',
        days: {
          MO: 'Monday',
          TU: 'Tuesday',
          WE: 'Wednesday',
          TH: 'Thursday',
          FR: 'Friday',
          SA: 'Saturday',
          SU: 'Sunday',
        },
        ordinals: {
          1: 'first',
          2: 'second',
          3: 'third',
          4: 'fourth',
          '-1': 'last',
        },
      },
    }, true, true);
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
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('breadcrumb link generation', () => {
    it('should call localizedPath with the calendar path to generate the breadcrumb href', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      expect(mockLocalizedPath).toHaveBeenCalledWith('/view/test_calendar');
      wrapper.unmount();
    });

    it('should set breadcrumb href to /view/test_calendar for default locale (no prefix)', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path, // default locale: no prefix added
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('/view/test_calendar');
      wrapper.unmount();
    });

    it('should set breadcrumb href to /es/view/test_calendar when localizedPath adds es prefix', async () => {
      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/20260301-1000',
        (path) => '/es' + path, // Spanish locale: adds /es prefix
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe('/es/view/test_calendar');
      wrapper.unmount();
    });

    it('should display the calendar name within "Back to {name}" text', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      expect(link.text()).toContain('Test Calendar');
      wrapper.unmount();
    });

    it('should include a back arrow indicator in the breadcrumb', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      // Arrow icon is present (aria-hidden so screen readers skip it)
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
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('category badge link uses UUID', () => {
    it('should use category.id (UUID) as the category query param', async () => {
      mockCategories = [makeCategoryObject('uuid-arts-123', { en: 'Arts' })];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.attributes('href')).toContain('?categories=uuid-arts-123');
      wrapper.unmount();
    });

    it('should not use the English display name as the category query param', async () => {
      mockCategories = [makeCategoryObject('uuid-sports-456', { en: 'Sports & Recreation' })];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
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
    it('should call localizedPath for the calendar path used in category badge href', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-001', { en: 'Music' })];
      mockCurrentLocale.value = 'en';

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      // localizedPath should have been called with the calendar view path
      expect(mockLocalizedPath).toHaveBeenCalledWith('/view/test_calendar');
      wrapper.unmount();
    });

    it('should include locale prefix in category badge href when locale is Spanish', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-002', { en: 'Music', es: 'Música' })];
      mockCurrentLocale.value = 'es';

      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/20260301-1000',
        (path) => '/es' + path, // Spanish: prepend /es
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      const href = badge.attributes('href') ?? '';
      expect(href).toContain('/es/');
      expect(href).toContain('?categories=cat-uuid-002');
      wrapper.unmount();
    });
  });

  describe('category badge displays name in current locale', () => {
    it('should display the English name when locale is English', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-003', { en: 'Theater', es: 'Teatro' })];
      mockCurrentLocale.value = 'en';

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('Theater');
      wrapper.unmount();
    });

    it('should display the Spanish name when locale is Spanish', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-004', { en: 'Theater', es: 'Teatro' })];
      mockCurrentLocale.value = 'es';

      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/20260301-1000',
        (path) => '/es' + path,
      );

      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('Teatro');
      wrapper.unmount();
    });

    it('should fall back to English name when the current-locale translation is missing', async () => {
      mockCategories = [makeCategoryObject('cat-uuid-005', { en: 'Theater' })]; // No Spanish translation
      mockCurrentLocale.value = 'es';

      const wrapper = await mountInstance(
        '/es/view/test_calendar/events/evt-1/20260301-1000',
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
    it('should render one badge per category', async () => {
      mockCategories = [
        makeCategoryObject('cat-a', { en: 'Arts' }),
        makeCategoryObject('cat-b', { en: 'Business' }),
        makeCategoryObject('cat-c', { en: 'Community' }),
      ];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      const badges = wrapper.findAll('.event-category-badge');
      expect(badges.length).toBe(3);
      wrapper.unmount();
    });

    it('should set each badge href to contain the correct UUID for that category', async () => {
      mockCategories = [
        makeCategoryObject('uuid-alpha', { en: 'Alpha' }),
        makeCategoryObject('uuid-beta', { en: 'Beta' }),
      ];

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
        (path) => path,
      );

      const badges = wrapper.findAll('.event-category-badge');
      expect(badges[0].attributes('href')).toContain('?categories=uuid-alpha');
      expect(badges[1].attributes('href')).toContain('?categories=uuid-beta');
      wrapper.unmount();
    });
  });

  describe('no categories', () => {
    it('should render no category badges when event has no categories', async () => {
      mockCategories = [];
      mockLocation = null;

      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/20260301-1000',
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
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
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

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
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

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
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

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
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

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const accessibilityCard = wrapper.find('.accessibility-card');
    expect(accessibilityCard.exists()).toBe(true);
    expect(accessibilityCard.find('.accessibility-info').text()).toContain('Wheelchair accessible');
    expect(accessibilityCard.find('.accessibility-subheading').exists()).toBe(false);
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
      {}, // No accessibility info
    );

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.accessibility-card').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should not display accessibility card when location is a plain object without accessibility', async () => {
    // Plain object without hasContent method (backward-compatible mock)
    mockLocation = {
      name: 'Community Center',
      address: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.accessibility-card').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should display accessibility card when event has accessibilityInfo but no location', async () => {
    mockLocation = null;
    mockEventAccessibilityInfo = 'ASL interpreter will be provided';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const accessibilityCard = wrapper.find('.accessibility-card');
    expect(accessibilityCard.exists()).toBe(true);
    expect(accessibilityCard.find('.accessibility-info').text()).toContain('ASL interpreter will be provided');
    wrapper.unmount();
  });

  it('should display both event and venue accessibility with subheadings when both are present', async () => {
    mockEventAccessibilityInfo = 'ASL interpreter provided';
    mockLocation = makeLocationObject(
      'Community Center',
      '123 Main St',
      'Springfield',
      'IL',
      '62701',
      'US',
      { en: 'Wheelchair ramp at entrance' },
    );

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const accessibilityCard = wrapper.find('.accessibility-card');
    expect(accessibilityCard.exists()).toBe(true);
    expect(accessibilityCard.text()).toContain('Event Accessibility');
    expect(accessibilityCard.text()).toContain('Venue Accessibility');
    expect(accessibilityCard.text()).toContain('ASL interpreter provided');
    expect(accessibilityCard.text()).toContain('Wheelchair ramp at entrance');
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
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not show an end time separator when end is null', async () => {
    mockEnd = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const timeEl = wrapper.find('.event-datetime');
    expect(timeEl.exists()).toBe(true);
    expect(timeEl.text()).not.toContain('–');
    wrapper.unmount();
  });

  it('should show end time with em-dash separator when end is on the same day', async () => {
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
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const timeEl = wrapper.find('.event-datetime');
    expect(timeEl.exists()).toBe(true);
    const text = timeEl.text();
    expect(text).toContain('–');
    expect(text).toContain('12:00 PM');
    wrapper.unmount();
  });

  it('should show full datetime for end time when end is on a different day', async () => {
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
      '/view/test_calendar/events/evt-1/20260301-1000',
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
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockIsCancelled = false;
    document.title = 'Pavillion'; // Reset to default before each test
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.title = 'Pavillion';
  });

  it('should set document.title to "Event Name | Pavillion" after loading event data', async () => {
    mockEventName = 'My Awesome Concert';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(document.title).toBe('My Awesome Concert | Pavillion');
    wrapper.unmount();
  });

  it('should set document.title using the localized event name', async () => {
    mockEventName = 'Test Event';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(document.title).toBe('Test Event | Pavillion');
    wrapper.unmount();
  });
});

describe('eventInstance series link display', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render a series link when the event belongs to a series', async () => {
    mockSeries = makeSeriesObject('yoga-classes', { en: 'Yoga Classes' });

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(true);
    wrapper.unmount();
  });

  it('should not render a series link when the event has no series', async () => {
    mockSeries = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(false);
    wrapper.unmount();
  });

  it('should set series link href to point to the series page', async () => {
    mockSeries = makeSeriesObject('yoga-classes', { en: 'Yoga Classes' });

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
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

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
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

    const wrapper = await mountInstance(
      '/es/view/test_calendar/events/evt-1/20260301-1000',
      (path) => '/es' + path,
    );

    const seriesLink = wrapper.find('.event-series-link');
    expect(seriesLink.exists()).toBe(true);
    expect(seriesLink.attributes('href')).toBe('/es/view/test_calendar/series/yoga-classes');
    wrapper.unmount();
  });

  it('should show series label text alongside the series link', async () => {
    mockSeries = makeSeriesObject('book-club', { en: 'Book Club' });

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const seriesWrapper = wrapper.find('.series-link-wrapper');
    expect(seriesWrapper.exists()).toBe(true);
    const label = seriesWrapper.find('.series-label');
    expect(label.exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('eventInstance recurrence display', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not show recurrence badge when recurrenceSummary is null', async () => {
    mockRecurrenceSummary = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.recurrence-badge').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should show recurrence badge when summary is a weekly-on-day intent', async () => {
    mockRecurrenceSummary = makeRecurrenceSummary('recurrence.weekly_on_days', { days: ['SA'] });

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const badge = wrapper.find('.recurrence-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('Saturday');
    wrapper.unmount();
  });

  it('should show recurrence badge when summary is a daily intent', async () => {
    mockRecurrenceSummary = makeRecurrenceSummary('recurrence.every_day');

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const badge = wrapper.find('.recurrence-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('Every day');
    wrapper.unmount();
  });

  it('should show recurrence sidebar card joining multi-day lists via Intl.ListFormat', async () => {
    mockRecurrenceSummary = makeRecurrenceSummary('recurrence.weekly_on_days', { days: ['MO', 'WE'] });

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const card = wrapper.find('.recurrence-card');
    expect(card.exists()).toBe(true);
    const text = card.find('.recurrence-text').text();
    expect(text).toContain('Monday');
    expect(text).toContain('Wednesday');
    // Intl.ListFormat should produce "Monday and Wednesday" in en locale,
    // not a hardcoded comma-joined list.
    expect(text).toMatch(/Monday and Wednesday/);
    wrapper.unmount();
  });

  it('should resolve ordinal integer and day code for nth-weekday intents', async () => {
    mockRecurrenceSummary = makeRecurrenceSummary('recurrence.nth_weekday_of_month', {
      ordinal: 1,
      day: 'MO',
    });

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const card = wrapper.find('.recurrence-card');
    expect(card.exists()).toBe(true);
    const text = card.find('.recurrence-text').text();
    expect(text).toContain('first');
    expect(text).toContain('Monday');
    wrapper.unmount();
  });

  it('should not show recurrence sidebar card when recurrenceSummary is null', async () => {
    mockRecurrenceSummary = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.recurrence-card').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('eventInstance source calendar pill', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should show source calendar pill when event has sourceCalendar', async () => {
    mockSourceCalendar = {
      urlName: 'community-events',
      host: 'other.instance.org',
      url: 'https://other.instance.org/view/community-events',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const pill = wrapper.find('.source-calendar-pill');
    expect(pill.exists()).toBe(true);
    wrapper.unmount();
  });

  it('should not show source calendar pill when sourceCalendar is null', async () => {
    mockSourceCalendar = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.source-calendar-pill').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should display urlName@host format in the pill text', async () => {
    mockSourceCalendar = {
      urlName: 'downtown-cal',
      host: 'events.city.gov',
      url: 'https://events.city.gov/view/downtown-cal',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const pill = wrapper.find('.source-calendar-pill');
    expect(pill.text()).toContain('downtown-cal@events.city.gov');
    wrapper.unmount();
  });

  it('should link to the source calendar URL', async () => {
    mockSourceCalendar = {
      urlName: 'my-cal',
      host: 'example.com',
      url: 'https://example.com/view/my-cal',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const pill = wrapper.find('.source-calendar-pill');
    expect(pill.attributes('href')).toBe('https://example.com/view/my-cal');
    wrapper.unmount();
  });

  it('should open remote links in a new tab with noopener noreferrer', async () => {
    mockSourceCalendar = {
      urlName: 'remote-cal',
      host: 'remote.org',
      url: 'https://remote.org/view/remote-cal',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const pill = wrapper.find('.source-calendar-pill');
    expect(pill.attributes('target')).toBe('_blank');
    expect(pill.attributes('rel')).toBe('noopener noreferrer');
    wrapper.unmount();
  });

  it('should have an aria-label with the source calendar name', async () => {
    mockSourceCalendar = {
      urlName: 'arts-cal',
      host: 'arts.org',
      url: 'https://arts.org/view/arts-cal',
    };

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const pill = wrapper.find('.source-calendar-pill');
    expect(pill.attributes('aria-label')).toContain('arts-cal@arts.org');
    wrapper.unmount();
  });
});

describe('event instance external URL CTA button', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render CTA anchor when externalUrl and urlPrompt are both valid', async () => {
    mockExternalUrl = 'https://tickets.example.com/show/123';
    mockUrlPrompt = 'tickets';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const cta = wrapper.find('.external-link-button');
    expect(cta.exists()).toBe(true);
    expect(cta.attributes('href')).toBe('https://tickets.example.com/show/123');
    wrapper.unmount();
  });

  it('should use target="_blank" and rel="noopener noreferrer" on the CTA anchor', async () => {
    mockExternalUrl = 'https://rsvp.example.com/party';
    mockUrlPrompt = 'rsvp';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const cta = wrapper.find('.external-link-button');
    expect(cta.exists()).toBe(true);
    expect(cta.attributes('target')).toBe('_blank');
    expect(cta.attributes('rel')).toBe('noopener noreferrer');
    wrapper.unmount();
  });

  it('should display the translated label from system:url_prompt.<prompt>', async () => {
    mockExternalUrl = 'https://example.com/info';
    mockUrlPrompt = 'more_info';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const cta = wrapper.find('.external-link-button');
    expect(cta.exists()).toBe(true);
    // Visible label is "More Information"; an sr-only span follows with
    // localized "(opens in new tab)" affordance — use toContain to allow
    // the sr-only suffix without making the assertion locale-fragile.
    expect(cta.text()).toContain('More Information');
    wrapper.unmount();
  });

  it('should NOT render the CTA when externalUrl is null', async () => {
    mockExternalUrl = null;
    mockUrlPrompt = 'tickets';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA when urlPrompt is null', async () => {
    mockExternalUrl = 'https://example.com';
    mockUrlPrompt = null;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA for javascript: URLs (defense-in-depth)', async () => {
    mockExternalUrl = 'javascript:alert(1)';
    mockUrlPrompt = 'tickets';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA for unknown urlPrompt values', async () => {
    mockExternalUrl = 'https://example.com';
    mockUrlPrompt = 'hack';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA for malformed URLs', async () => {
    mockExternalUrl = 'not a url at all';
    mockUrlPrompt = 'tickets';

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('eventInstance cancelled badge', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render a cancelled badge on the detail header when isCancelled is true', async () => {
    mockIsCancelled = true;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    const badge = wrapper.find('.cancelled-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('Cancelled');
    wrapper.unmount();
  });

  it('should not render the cancelled badge when isCancelled is false', async () => {
    mockIsCancelled = false;

    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260301-1000',
      (path) => path,
    );

    expect(wrapper.find('.cancelled-badge').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('eventInstance invalid startTime slug', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
    mockLocation = null;
    mockEnd = null;
    mockEventName = 'Test Event';
    mockSeries = null;
    mockRecurrenceSummary = null;
    mockSourceCalendar = null;
    mockExternalUrl = null;
    mockUrlPrompt = null;
    mockEventAccessibilityInfo = '';
    mockIsCancelled = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render NotFound for an impossible date slug (e.g. Feb 30)', async () => {
    // Feb 30 is structurally a \d{8}-\d{4} so it clears the router regex,
    // but parseInstanceSlug rejects it because Luxon flags the DateTime
    // as invalid. The component must short-circuit to notFound without
    // calling the backend.
    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/20260230-1000',
      (path) => path,
    );

    expect(wrapper.find('.not-found-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('should render NotFound for an out-of-bounds year slug', async () => {
    // Year 1900 is outside the [currentYear - 5, currentYear + 10] year-bounds
    // guard in parseInstanceSlug (rejected before Luxon's isValid check).
    const wrapper = await mountInstance(
      '/view/test_calendar/events/evt-1/19000101-0000',
      (path) => path,
    );

    expect(wrapper.find('.not-found-stub').exists()).toBe(true);
    wrapper.unmount();
  });
});
