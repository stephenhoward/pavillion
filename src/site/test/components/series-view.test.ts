/**
 * Tests for the SeriesView component.
 *
 * Validates:
 * - SeriesView renders series name, description, and event list
 * - Breadcrumb link uses localizedPath() for locale awareness
 * - NotFound is shown when calendar or series is not found
 * - Event list items link to the correct event page
 * - Pagination controls appear when there are more events than the current page
 * - document.title is set to "Series Name | Pavillion" after loading
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

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

vi.mock('@/site/components/event-image.vue', () => ({
  default: { template: '<div class="event-image-stub"></div>', props: ['media', 'context'] },
}));

// Mutable mock data
let mockSeriesResult: {
  series: Record<string, any> | null;
  events: Array<Record<string, any>>;
  pagination: { total: number; limit: number; offset: number };
} = {
  series: null,
  events: [],
  pagination: { total: 0, limit: 20, offset: 0 },
};

let mockCalendar: Record<string, any> | null = null;

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getCalendarByUrlName: vi.fn().mockImplementation(() => Promise.resolve(mockCalendar)),
      loadSeriesDetail: vi.fn().mockImplementation(() => {
        if (!mockSeriesResult.series) {
          return Promise.resolve(null);
        }
        return Promise.resolve(mockSeriesResult);
      }),
    })),
  };
});

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import SeriesView from '@/site/components/series-view.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/view/:calendar/series/:series',
    component: SeriesView,
    name: 'series',
  },
  {
    path: '/view/:calendar',
    component: { template: '<div />' },
    name: 'calendar',
  },
  {
    path: '/es/view/:calendar/series/:series',
    component: SeriesView,
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

async function mountSeriesView(
  initialPath: string,
  localizedPathFn: (path: string) => string = (path) => path,
): Promise<VueWrapper> {
  mockLocalizedPath.mockImplementation(localizedPathFn);

  const router = await buildRouter(initialPath);
  const pinia = createPinia();

  const wrapper = mount(SeriesView, {
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

function makeCalendar(urlName: string, name: string) {
  return {
    urlName,
    content: (_lang: string) => ({ name, description: '' }),
    hasContent: (_lang: string) => true,
    getLanguages: () => ['en'],
  };
}

function makeSeries(urlName: string, name: string, description: string = '') {
  return {
    id: `series-${urlName}`,
    urlName,
    calendarId: 'cal-id',
    mediaId: null,
    content: (_lang: string) => ({ name, description }),
    hasContent: (_lang: string) => true,
    getLanguages: () => ['en'],
  };
}

function makeEvent(id: string, name: string) {
  return {
    id,
    content: (_lang: string) => ({ name, description: '' }),
    hasContent: (_lang: string) => true,
    getLanguages: () => ['en'],
    media: null,
    schedules: [],
  };
}

// ---------------------------------------------------------------------------
// i18next initialisation
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const resources = {
    en: {
      system: {
        back_to_calendar: 'Back to {{name}}',
        series_events: 'Events in this series',
        series_no_events: 'No events in this series',
        series_load_error: 'Failed to load series',
        series_previous_page: 'Previous page',
        series_next_page: 'Next page',
        series_page_info: 'Page {{current}} of {{total}}',
        series_loading: 'Loading series...',
        series_pagination: 'Pagination',
      },
    },
  };

  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources });
  }
  else {
    i18next.addResourceBundle('en', 'system', resources.en.system, true, true);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SeriesView', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCalendar = makeCalendar('test_calendar', 'Test Calendar');
    mockSeriesResult = {
      series: makeSeries('yoga-classes', 'Yoga Classes', 'A weekly yoga series'),
      events: [
        makeEvent('event-1', 'Morning Yoga'),
        makeEvent('event-2', 'Evening Yoga'),
      ],
      pagination: { total: 2, limit: 20, offset: 0 },
    };
    document.title = 'Pavillion';
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.title = 'Pavillion';
  });

  describe('series content display', () => {
    it('renders the series name as h1', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      const h1 = wrapper.find('h1');
      expect(h1.exists()).toBe(true);
      expect(h1.text()).toBe('Yoga Classes');
      wrapper.unmount();
    });

    it('renders the series description', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      expect(wrapper.text()).toContain('A weekly yoga series');
      wrapper.unmount();
    });

    it('sets document.title to "Series Name | Pavillion" after loading', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      expect(document.title).toBe('Yoga Classes | Pavillion');
      wrapper.unmount();
    });
  });

  describe('breadcrumb navigation', () => {
    it('renders a breadcrumb back link to the calendar', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      const link = wrapper.find('.breadcrumb a');
      expect(link.exists()).toBe(true);
      wrapper.unmount();
    });

    it('breadcrumb href is /view/test_calendar for default locale', async () => {
      const wrapper = await mountSeriesView(
        '/view/test_calendar/series/yoga-classes',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.attributes('href')).toBe('/view/test_calendar');
      wrapper.unmount();
    });

    it('breadcrumb href is locale-prefixed when locale is Spanish', async () => {
      const wrapper = await mountSeriesView(
        '/es/view/test_calendar/series/yoga-classes',
        (path) => '/es' + path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.attributes('href')).toBe('/es/view/test_calendar');
      wrapper.unmount();
    });

    it('calls localizedPath with the calendar path for the breadcrumb', async () => {
      const wrapper = await mountSeriesView(
        '/view/test_calendar/series/yoga-classes',
        (path) => path,
      );

      expect(mockLocalizedPath).toHaveBeenCalledWith('/view/test_calendar');
      wrapper.unmount();
    });

    it('breadcrumb includes the calendar name', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      const link = wrapper.find('.breadcrumb a');
      expect(link.text()).toContain('Test Calendar');
      wrapper.unmount();
    });
  });

  describe('event list', () => {
    it('renders a list of events in the series', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      const items = wrapper.findAll('.series-event-item');
      expect(items.length).toBe(2);
      wrapper.unmount();
    });

    it('each event item shows the event name', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      const items = wrapper.findAll('.series-event-item');
      expect(items[0].text()).toContain('Morning Yoga');
      expect(items[1].text()).toContain('Evening Yoga');
      wrapper.unmount();
    });

    it('each event item links to the event page', async () => {
      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      const links = wrapper.findAll('.series-event-item a');
      expect(links[0].attributes('href')).toContain('/view/test_calendar/events/event-1');
      expect(links[1].attributes('href')).toContain('/view/test_calendar/events/event-2');
      wrapper.unmount();
    });

    it('shows no events message when series has no events', async () => {
      mockSeriesResult = {
        series: makeSeries('empty-series', 'Empty Series'),
        events: [],
        pagination: { total: 0, limit: 20, offset: 0 },
      };

      const wrapper = await mountSeriesView('/view/test_calendar/series/empty-series');

      expect(wrapper.find('.series-no-events').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('pagination', () => {
    it('does not show pagination when all events fit on one page', async () => {
      mockSeriesResult = {
        series: makeSeries('yoga-classes', 'Yoga Classes'),
        events: [makeEvent('e1', 'Event 1'), makeEvent('e2', 'Event 2')],
        pagination: { total: 2, limit: 20, offset: 0 },
      };

      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      expect(wrapper.find('.series-pagination').exists()).toBe(false);
      wrapper.unmount();
    });

    it('shows pagination controls when there are more pages', async () => {
      mockSeriesResult = {
        series: makeSeries('yoga-classes', 'Yoga Classes'),
        events: Array.from({ length: 20 }, (_, i) => makeEvent(`e${i}`, `Event ${i}`)),
        pagination: { total: 25, limit: 20, offset: 0 },
      };

      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      expect(wrapper.find('.series-pagination').exists()).toBe(true);
      wrapper.unmount();
    });

    it('disables previous button on first page', async () => {
      mockSeriesResult = {
        series: makeSeries('yoga-classes', 'Yoga Classes'),
        events: Array.from({ length: 20 }, (_, i) => makeEvent(`e${i}`, `Event ${i}`)),
        pagination: { total: 25, limit: 20, offset: 0 },
      };

      const wrapper = await mountSeriesView('/view/test_calendar/series/yoga-classes');

      const prevBtn = wrapper.find('.series-pagination .prev-page');
      expect(prevBtn.attributes('disabled')).toBeDefined();
      wrapper.unmount();
    });
  });

  describe('not found states', () => {
    it('shows NotFound when calendar does not exist', async () => {
      mockCalendar = null;

      const wrapper = await mountSeriesView('/view/nonexistent_cal/series/yoga-classes');

      expect(wrapper.find('.not-found-stub').exists()).toBe(true);
      wrapper.unmount();
    });

    it('shows NotFound when series does not exist', async () => {
      mockSeriesResult = {
        series: null,
        events: [],
        pagination: { total: 0, limit: 20, offset: 0 },
      };

      const wrapper = await mountSeriesView('/view/test_calendar/series/nonexistent-series');

      expect(wrapper.find('.not-found-stub').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('locale-prefixed routes', () => {
    it('renders correctly on a locale-prefixed route', async () => {
      mockCurrentLocale.value = 'es';

      const wrapper = await mountSeriesView(
        '/es/view/test_calendar/series/yoga-classes',
        (path) => '/es' + path,
      );

      const h1 = wrapper.find('h1');
      expect(h1.exists()).toBe(true);
      expect(h1.text()).toBe('Yoga Classes');
      wrapper.unmount();
    });
  });
});
