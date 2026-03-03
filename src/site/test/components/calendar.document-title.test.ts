/**
 * Tests for the calendar.vue component document.title behaviour.
 *
 * Validates:
 * - document.title is set to "Calendar Name | Pavillion" after loading calendar data.
 * - The calendar URL name is used as fallback when no localized name is available.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

const mockCurrentLocale = ref('en');

vi.mock('@/site/composables/useLocale', () => ({
  useLocale: () => ({
    currentLocale: mockCurrentLocale,
    switchLocale: vi.fn(),
    localizedPath: (path: string) => path,
  }),
}));

// Mutable calendar name so individual tests can control the calendar title
let mockCalendarName = 'Test Calendar';

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getCalendarByUrlName: vi.fn().mockImplementation(() =>
        Promise.resolve({
          urlName: 'test_calendar',
          content: (_lang: string) => ({ name: mockCalendarName, description: '' }),
          hasContent: (_lang: string) => true,
          getLanguages: () => ['en'],
        }),
      ),
    })),
  };
});

vi.mock('@/site/stores/publicCalendarStore', () => {
  return {
    usePublicCalendarStore: () => ({
      availableCategories: [],
      getFilteredEventsByDay: {},
      hasActiveFilters: false,
      hasNonDateFilters: false,
      hasOnlyDateFilters: false,
      isLoadingEvents: false,
      hasLoadedEvents: true,
      isSearchPending: false,
      eventError: null,
      categoryError: null,
      setServerDefaultDateRange: vi.fn(),
      setCurrentCalendar: vi.fn(),
      loadCalendar: vi.fn().mockResolvedValue(undefined),
      loadCategories: vi.fn().mockResolvedValue(undefined),
      clearAllFilters: vi.fn(),
      reloadWithFilters: vi.fn(),
    }),
  };
});

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

vi.mock('@/site/components/search-filter-public.vue', () => ({
  default: { template: '<div class="search-filter-stub"></div>' },
}));

vi.mock('@/site/components/event-card.vue', () => ({
  default: {
    template: '<article class="event-card-stub"></article>',
    props: ['instance', 'calendarUrlName'],
  },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import Calendar from '@/site/components/calendar.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/view/:calendar',
    component: Calendar,
    name: 'calendar',
  },
];

async function mountCalendar(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(initialPath);
  await router.isReady();

  const pinia = createPinia();

  const wrapper = mount(Calendar, {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calendar.vue document.title', () => {
  beforeEach(() => {
    mockCurrentLocale.value = 'en';
    mockCalendarName = 'Test Calendar';
    document.title = 'Pavillion'; // Reset to default before each test
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.title = 'Pavillion';
  });

  it('should set document.title to "Calendar Name | Pavillion" after loading calendar data', async () => {
    mockCalendarName = 'Downtown Events';

    const wrapper = await mountCalendar('/view/test_calendar');

    expect(document.title).toBe('Downtown Events | Pavillion');
    wrapper.unmount();
  });

  it('should set document.title using the localized calendar name', async () => {
    mockCalendarName = 'Test Calendar';

    const wrapper = await mountCalendar('/view/test_calendar');

    expect(document.title).toBe('Test Calendar | Pavillion');
    wrapper.unmount();
  });
});
