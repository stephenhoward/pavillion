/**
 * Tests for the eventInstance component breadcrumb and category badge locale behaviour.
 *
 * Validates:
 * - The 'Back to calendar' breadcrumb uses localizedPath() so that
 *   locale-prefixed URLs are preserved (e.g. /es/view/:calendar).
 * - The default locale (en) breadcrumb links to /view/:calendar (no prefix).
 * - Category badge links use localizedPath() for locale awareness.
 * - Category badge links use category.id (UUID) as the query param, not the English display name.
 * - Category names are displayed in the current UI language with English fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getCalendarByUrlName: vi.fn().mockResolvedValue({
        urlName: 'test_calendar',
        content: (_lang: string) => ({ name: 'Test Calendar', description: '' }),
      }),
      loadEventInstance: vi.fn().mockImplementation(() =>
        Promise.resolve({
          start: {
            toISO: () => '2026-03-01T10:00:00.000Z',
            toLocal: () => ({ toLocaleString: () => 'March 1, 2026, 10:00 AM' }),
          },
          event: {
            content: (_lang: string) => ({ name: 'Test Event', description: 'Description here' }),
            media: null,
            categories: mockCategories,
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('eventInstance breadcrumb locale behaviour', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
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

    it('breadcrumb displays the calendar name', async () => {
      const wrapper = await mountInstance(
        '/view/test_calendar/events/evt-1/inst-1',
        (path) => path,
      );

      const link = wrapper.find('.breadcrumb a');
      expect(link.text()).toBe('Test Calendar');
      wrapper.unmount();
    });
  });
});

describe('eventInstance category badge locale behaviour', () => {
  beforeEach(() => {
    mockLocalizedPath.mockReset();
    mockCurrentLocale.value = 'en';
    mockCategories = [];
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
