import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import calendar from '../calendar.vue';
import SearchFilterPublic from '../search-filter-public.vue';
import { usePublicCalendarStore } from '../../stores/publicCalendarStore';
import CalendarService from '../../service/calendar';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import CalendarEventInstance from '@/common/model/event_instance';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { INSTANCE_SLUG_PATTERN } from '@/common/utils/instance-slug';
import { DateTime } from 'luxon';

vi.mock('../../service/calendar');
vi.mock('@/client/service/models');

// Lets a test pin the measured width; null keeps the real composable (which
// reads 0 in JSDOM, leaving the view state at its starting `wide` tier).
const containerWidth = vi.hoisted(() => ({
  value: null as null | { tier: 'narrow' | 'medium' | 'wide'; width: number },
}));
vi.mock('@/common/ui/composables/useContainerWidth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/ui/composables/useContainerWidth')>();
  const { ref } = await import('vue');
  return {
    useContainerWidth: (el: Parameters<typeof actual.useContainerWidth>[0]) => (containerWidth.value
      ? { tier: ref(containerWidth.value.tier), width: ref(containerWidth.value.width) }
      : actual.useContainerWidth(el)),
  };
});

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      // Simple interpolation for testing
      if (params && key === 'no_events_for_search') {
        return `no_events_for_search:${params.term}`;
      }
      return key;
    },
  }),
}));

// Mock i18next for useLocale composable
vi.mock('i18next', () => ({
  default: {
    changeLanguage: vi.fn(),
    language: 'en',
  },
}));

describe('calendar.vue - SearchFilterPublic Integration', () => {
  let pinia;
  let router;
  let mockCalendar: Calendar;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    // Create mock calendar
    mockCalendar = new Calendar('calendar-123', 'test-calendar');
    const content = new CalendarContent('en');
    content.name = 'Test Calendar';
    mockCalendar.addContent(content);

    // Setup router with calendar route
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/calendar/:calendar',
          name: 'calendar',
          component: calendar,
        },
      ],
    });

    // Mock ModelService.listModels to return empty ListResult
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('integrates SearchFilterPublic component into calendar view', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    // Navigate to calendar route
    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    // Verify SearchFilterPublic component is rendered
    expect(wrapper.findComponent({ name: 'SearchFilterPublic' }).exists()).toBe(true);
  });

  it('restores filter state from URL parameters on page load', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    // Navigate with URL parameters
    await router.push({
      path: '/calendar/test-calendar',
      query: {
        search: 'yoga',
        categories: ['Fitness', 'Wellness'],
        startDate: '2025-11-15',
        endDate: '2025-11-22',
      },
    });

    const _wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: false, // Don't stub - we need to test real behavior
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();

    // Verify store state matches URL parameters
    expect(store.searchQuery).toBe('yoga');
    expect(store.selectedCategoryIds).toEqual(['Fitness', 'Wellness']);
    expect(store.startDate).toBe('2025-11-15');
    expect(store.endDate).toBe('2025-11-22');
  });

  it('SearchFilterPublic updates URL when search input changes', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: false, // Don't stub - we need real URL updates
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    // Find SearchFilterPublic and simulate search input
    const searchFilter = wrapper.findComponent(SearchFilterPublic);
    const searchInput = searchFilter.find('input[type="text"]');

    await searchInput.setValue('concert');

    // Wait for debounce and updateURL call
    await new Promise(resolve => setTimeout(resolve, 350)); // 300ms debounce + buffer
    await flushPromises();

    // Verify URL was updated
    expect(router.currentRoute.value.query.search).toBe('concert');
  });

  it('maintains filters through browser back/forward navigation', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    // Start with no filters
    await router.push('/calendar/test-calendar');

    const _wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: false,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();

    // Apply first set of filters
    await router.push({
      path: '/calendar/test-calendar',
      query: { search: 'yoga', categories: ['Fitness'] },
    });

    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(store.searchQuery).toBe('yoga');
    expect(store.selectedCategoryIds).toEqual(['Fitness']);

    // Apply second set of filters
    await router.push({
      path: '/calendar/test-calendar',
      query: { search: 'concert', categories: ['Music'] },
    });

    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(store.searchQuery).toBe('concert');
    expect(store.selectedCategoryIds).toEqual(['Music']);

    // Simulate browser back button
    await router.back();
    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify filters restored to previous state
    expect(store.searchQuery).toBe('yoga');
    expect(store.selectedCategoryIds).toEqual(['Fitness']);
  });

  it('displays loading state during calendar data load', async () => {
    // Mock calendar service with delay
    let resolveCalendar: (value: Calendar) => void;
    const calendarPromise = new Promise<Calendar>((resolve) => {
      resolveCalendar = resolve;
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockReturnValue(calendarPromise);

    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    // Check for loading state immediately (synchronously before first await)
    expect(wrapper.vm.state.isLoading).toBe(true);

    // Resolve the promise
    resolveCalendar!(mockCalendar);
    await flushPromises();

    // Loading should be false after data loads
    expect(wrapper.vm.state.isLoading).toBe(false);
  });

  it('displays search-specific empty state message when search returns no results', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();

    // Set a search query with no results
    store.searchQuery = 'yoga';
    store.allEvents = [];
    store.isLoadingEvents = false;
    store.hasLoadedEvents = true;

    await wrapper.vm.$nextTick();

    // Verify empty state is shown with search-specific hint
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('no_events_for_search:yoga');

  });

  it('displays empty state when no events match filters', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();

    // Set category filter (not search) with no events
    store.selectedCategoryIds = ['some-category-id'];
    store.allEvents = []; // Simulate no events returned from API
    store.isLoadingEvents = false; // Not loading
    store.hasLoadedEvents = true; // Events have been loaded (just empty)

    await wrapper.vm.$nextTick();

    // Verify empty state is shown with generic filter hint (not search-specific)
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('no_events_with_filters_hint');

  });

  it('displays helpful empty state when no upcoming events exist', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();

    // Simulate no events with no active filters (default date range)
    store.allEvents = [];
    store.isLoadingEvents = false;
    store.hasLoadedEvents = true;

    await wrapper.vm.$nextTick();

    // Verify empty state is shown with helpful message
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('no_events_available');
    expect(wrapper.find('.empty-state').text()).toContain('no_events_available_hint');

    // Verify no clear filters button (no active filters)
    expect(wrapper.find('.clear-filters-btn').exists()).toBe(false);
  });

  it('does not show empty state before events have loaded', async () => {
    // Mock calendar service
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();

    // Events have not loaded yet
    store.allEvents = [];
    store.isLoadingEvents = false;
    store.hasLoadedEvents = false;

    await wrapper.vm.$nextTick();

    // Verify empty state is NOT shown before events have loaded
    expect(wrapper.find('.empty-state').exists()).toBe(false);
  });

  it('skips loading state when navigating back to a calendar with cached data', async () => {
    // Pre-populate store to simulate cached data from a previous visit
    const store = usePublicCalendarStore();
    store.currentCalendarUrlName = 'test-calendar';

    // Create a minimal event instance to represent cached events
    const event = new CalendarEvent('event-1', 'calendar-123');
    const eventContent = new CalendarEventContent('en');
    eventContent.name = 'Cached Event';
    event.addContent(eventContent);
    store.allEvents = [
      new CalendarEventInstance('instance-1', event, DateTime.now(), null),
    ];

    // Mock calendar service for the metadata-only fetch
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/calendar/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    // isLoading should not be set when data is cached — no loading flash on back-navigation
    expect(wrapper.vm.state.isLoading).toBe(false);

    await flushPromises();

    // Still false after mount completes
    expect(wrapper.vm.state.isLoading).toBe(false);

    // Full reload should NOT have been triggered (no loadCalendar/loadCategories calls)
    expect(ModelService.getModel).not.toHaveBeenCalled();
  });

});

describe('calendar.vue - Calendar title display', () => {
  let pinia;
  let router;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/:calendar',
          name: 'calendar',
          component: calendar,
        },
      ],
    });

    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('displays the calendar title from content, not the URL slug', async () => {
    const mockCalendar = new Calendar('calendar-123', 'test_calendar');
    const content = new CalendarContent('en');
    content.name = 'My Community Calendar';
    mockCalendar.addContent(content);

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);
    await router.push('/test_calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const h1 = wrapper.find('h1');
    expect(h1.exists()).toBe(true);
    expect(h1.text()).toBe('My Community Calendar');
    expect(h1.text()).not.toBe('test_calendar');
  });

  it('falls back to URL slug when no content is configured', async () => {
    // Calendar with no content added
    const mockCalendar = new Calendar('calendar-456', 'bare_calendar');

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);
    await router.push('/bare_calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const h1 = wrapper.find('h1');
    expect(h1.exists()).toBe(true);
    expect(h1.text()).toBe('bare_calendar');
  });

  it('displays content in the current locale when multilingual content exists', async () => {
    const mockCalendar = new Calendar('calendar-789', 'my_calendar');
    const enContent = new CalendarContent('en');
    enContent.name = 'English Title';
    mockCalendar.addContent(enContent);
    const esContent = new CalendarContent('es');
    esContent.name = 'Titulo en Espanol';
    mockCalendar.addContent(esContent);

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    const esRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:calendar', name: 'calendar', component: calendar },
        { path: '/es/:calendar', component: calendar },
      ],
    });

    await esRouter.push('/es/my_calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, esRouter],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const h1 = wrapper.find('h1');
    expect(h1.exists()).toBe(true);
    expect(h1.text()).toBe('Titulo en Espanol');
  });
});

describe('calendar.vue - Locale-aware event card links', () => {
  let pinia;
  let mockCalendar: Calendar;

  function createMockEventInstance(eventId: string, instanceId: string): CalendarEventInstance {
    const event = new CalendarEvent(eventId, 'calendar-123');
    const eventContent = new CalendarEventContent('en');
    eventContent.name = 'Test Event';
    event.addContent(eventContent);
    // Use a UTC ISO so the slug formatInstanceSlug derives is deterministic
    // regardless of host timezone: 2026-03-15T10:00:00Z → 20260315-1000.
    return new CalendarEventInstance(
      instanceId,
      event,
      DateTime.fromISO('2026-03-15T10:00:00.000Z'),
      null,
    );
  }

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockCalendar = new Calendar('calendar-123', 'test-calendar');
    const content = new CalendarContent('en');
    content.name = 'Test Calendar';
    mockCalendar.addContent(content);

    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('event card links omit locale prefix for default locale (en)', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:calendar', name: 'calendar', component: calendar },
        { path: `/:calendar/events/:event/:startTime(${INSTANCE_SLUG_PATTERN})`, name: 'instance', component: { template: '<div/>' } },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    // Add an event instance directly to the store
    const store = usePublicCalendarStore();
    store.allEvents = [createMockEventInstance('event-abc', 'instance-xyz')];
    store.isLoadingEvents = false;

    await wrapper.vm.$nextTick();

    // Find event card link
    const link = wrapper.find('li.day-event-item h3 a');
    expect(link.exists()).toBe(true);

    const href = link.attributes('href');
    // Default locale — no /en/ prefix; final segment is the UTC slug.
    expect(href).toBe('/test-calendar/events/event-abc/20260315-1000');
  });

  it('event card links include locale prefix for non-default locale (es)', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:calendar', name: 'calendar', component: calendar },
        { path: '/es/:calendar', component: calendar },
        { path: `/:calendar/events/:event/:startTime(${INSTANCE_SLUG_PATTERN})`, name: 'instance', component: { template: '<div/>' } },
        { path: `/es/:calendar/events/:event/:startTime(${INSTANCE_SLUG_PATTERN})`, component: { template: '<div/>' } },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    // Navigate to the Spanish-locale calendar page
    await router.push('/es/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    // Add an event instance directly to the store
    const store = usePublicCalendarStore();
    store.allEvents = [createMockEventInstance('event-abc', 'instance-xyz')];
    store.isLoadingEvents = false;

    await wrapper.vm.$nextTick();

    // Find event card link
    const link = wrapper.find('li.day-event-item h3 a');
    expect(link.exists()).toBe(true);

    const href = link.attributes('href');
    // Non-default locale — must include /es/ prefix; final segment is the UTC slug.
    expect(href).toBe('/es/test-calendar/events/event-abc/20260315-1000');
  });
});

describe('calendar.vue - Locale-aware day group headings', () => {
  let pinia;
  let mockCalendar: Calendar;

  // A fixed date: Sunday, March 15, 2026
  const TEST_DATE_ISO = '2026-03-15T10:00:00';

  function createMockEventInstance(eventId: string, instanceId: string): CalendarEventInstance {
    const event = new CalendarEvent(eventId, 'calendar-123');
    const eventContent = new CalendarEventContent('en');
    eventContent.name = 'Test Event';
    event.addContent(eventContent);
    return new CalendarEventInstance(
      instanceId,
      event,
      DateTime.fromISO(TEST_DATE_ISO),
      null,
    );
  }

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockCalendar = new Calendar('calendar-123', 'test-calendar');
    const content = new CalendarContent('en');
    content.name = 'Test Calendar';
    mockCalendar.addContent(content);

    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders day headings in English when locale is en', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:calendar', name: 'calendar', component: calendar },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);
    await router.push('/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();
    store.allEvents = [createMockEventInstance('event-en', 'instance-en')];
    store.isLoadingEvents = false;

    await wrapper.vm.$nextTick();

    const h2 = wrapper.find('section.day-section h2');
    expect(h2.exists()).toBe(true);

    // English day heading for 2026-03-15: "Sunday, March 15"
    const heading = h2.text();
    expect(heading).toContain('Sunday');
    expect(heading).toContain('March');
  });

  it('renders day headings in Spanish when locale is es', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:calendar', name: 'calendar', component: calendar },
        { path: '/es/:calendar', component: calendar },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);
    await router.push('/es/test-calendar');

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          SearchFilterPublic: true,
          NotFound: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();

    const store = usePublicCalendarStore();
    store.allEvents = [createMockEventInstance('event-es', 'instance-es')];
    store.isLoadingEvents = false;

    await wrapper.vm.$nextTick();

    const h2 = wrapper.find('section.day-section h2');
    expect(h2.exists()).toBe(true);

    // Spanish day heading for 2026-03-15: "domingo, 15 de marzo"
    const heading = h2.text();
    expect(heading).toContain('domingo');
    expect(heading).toContain('marzo');
  });
});

describe('calendar.vue - calendar views', () => {
  let pinia;
  let router;
  let mockCalendar: Calendar;

  /** The query strings of every events request made so far. */
  function eventFetches(): URLSearchParams[] {
    return vi.mocked(ModelService.listModels).mock.calls
      .map(([url]) => url as string)
      .filter(url => url.includes('/events'))
      .map(url => new URLSearchParams(url.split('?')[1] ?? ''));
  }

  async function mountAt(query: Record<string, string | string[]>) {
    await router.push({ path: '/test-calendar', query });

    const wrapper = mount(calendar, {
      global: {
        plugins: [pinia, router],
        stubs: {
          NotFound: true,
          CategoryPillSelector: true,
          EventImage: true,
        },
      },
    });

    await flushPromises();
    return wrapper;
  }

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockCalendar = new Calendar('calendar-123', 'test-calendar');
    const content = new CalendarContent('en');
    content.name = 'Test Calendar';
    mockCalendar.addContent(content);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:calendar', name: 'calendar', component: calendar }],
    });

    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);
  });

  afterEach(() => {
    vi.clearAllMocks();
    containerWidth.value = null;
  });

  it('shows a deep-linked month as the list at a narrow width, fetching once and keeping the URL', async () => {
    containerWidth.value = { tier: 'narrow', width: 500 };

    const wrapper = await mountAt({ view: 'month', date: '2026-03-15' });

    const fetches = eventFetches();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].get('startDate')).not.toBe('2026-03-01');
    expect(wrapper.find('.month-view').exists()).toBe(false);
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(router.currentRoute.value.query).toEqual({ view: 'month', date: '2026-03-15' });
  });

  it('clearing all filters keeps only the view keys', async () => {
    containerWidth.value = { tier: 'narrow', width: 500 };
    const wrapper = await mountAt({
      view: 'month',
      date: '2026-03-15',
      search: 'concert',
      startDate: '2026-02-01',
      endDate: '2026-02-07',
    });

    await wrapper.find('.clear-filters-btn').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({ view: 'month', date: '2026-03-15' });
  });

  it('clearing all filters from a plain list URL empties the query', async () => {
    const wrapper = await mountAt({ search: 'concert', startDate: '2026-02-01', endDate: '2026-02-07' });

    await wrapper.find('.clear-filters-btn').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({});
  });

  it('opens on the list, with the list markup and date controls', async () => {
    const wrapper = await mountAt({});

    expect(wrapper.find('.month-view').exists()).toBe(false);
    expect(wrapper.find('.week-view').exists()).toBe(false);
    expect(wrapper.find('.date-range-section').exists()).toBe(true);
    expect(wrapper.find('[role="radio"][aria-checked="true"]').attributes('aria-label')).toBe('view_list');
  });

  it('fetches a deep-linked month once, for the month window', async () => {
    const wrapper = await mountAt({ view: 'month', date: '2026-03-15' });

    const fetches = eventFetches();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].get('startDate')).toBe('2026-03-01');
    expect(fetches[0].get('endDate')).toBe('2026-03-31');

    expect(wrapper.find('.month-view').exists()).toBe(true);
    expect(wrapper.find('.events-container').exists()).toBe(false);
    expect(wrapper.find('.date-range-section').exists()).toBe(false);
    expect(wrapper.find('.ui-view-toolbar__label').text()).toBe('March 2026');
  });

  it('switches from a filtered list to the month with one fetch, leaving the list filter alone', async () => {
    const wrapper = await mountAt({ startDate: '2026-03-10', endDate: '2026-03-12' });
    const store = usePublicCalendarStore();
    vi.mocked(ModelService.listModels).mockClear();

    const monthRadio = wrapper.findAll('[role="radio"]').find(radio => radio.attributes('aria-label') === 'view_month');
    await monthRadio!.trigger('click');
    await flushPromises();

    const fetches = eventFetches();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].get('startDate')).toBe('2026-03-01');
    expect(fetches[0].get('endDate')).toBe('2026-03-31');

    expect(router.currentRoute.value.query).toEqual({
      startDate: '2026-03-10',
      endDate: '2026-03-12',
      view: 'month',
      date: '2026-03-10',
    });
    expect(store.startDate).toBe('2026-03-10');
    expect(store.endDate).toBe('2026-03-12');
  });

  it('makes one fetch per period step', async () => {
    const wrapper = await mountAt({ view: 'month', date: '2026-03-15' });
    vi.mocked(ModelService.listModels).mockClear();

    await wrapper.find('.ui-view-toolbar__step--next').trigger('click');
    await flushPromises();

    const fetches = eventFetches();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].get('startDate')).toBe('2026-04-01');
    expect(fetches[0].get('endDate')).toBe('2026-04-30');
    expect(router.currentRoute.value.query.date).toBe('2026-04-15');
  });

  it('does not write the month window into the list filter keys on a search', async () => {
    const wrapper = await mountAt({ view: 'month', date: '2026-03-15' });

    await wrapper.find('input[type="text"]').setValue('concert');
    await new Promise(resolve => setTimeout(resolve, 350));
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({
      view: 'month',
      date: '2026-03-15',
      search: 'concert',
    });
    const store = usePublicCalendarStore();
    expect(store.startDate).toBeNull();
    expect(store.endDate).toBeNull();
  });

  it('restores the list filter when returning from the month to the list', async () => {
    const wrapper = await mountAt({
      view: 'month',
      date: '2026-03-15',
      startDate: '2026-02-01',
      endDate: '2026-02-07',
    });
    vi.mocked(ModelService.listModels).mockClear();

    const listRadio = wrapper.findAll('[role="radio"]').find(radio => radio.attributes('aria-label') === 'view_list');
    await listRadio!.trigger('click');
    await flushPromises();

    const fetches = eventFetches();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].get('startDate')).toBe('2026-02-01');
    expect(fetches[0].get('endDate')).toBe('2026-02-07');
    expect(router.currentRoute.value.query).toEqual({ startDate: '2026-02-01', endDate: '2026-02-07' });
    expect(wrapper.find('.date-range-section').exists()).toBe(true);
  });

  it('links a day number to the list filtered to that day, keeping other filters', async () => {
    const wrapper = await mountAt({ view: 'month', date: '2026-03-15', search: 'concert' });

    const dayLink = wrapper.find('a.day-number[aria-label*="March 4"]');
    const href = new URL(dayLink.attributes('href')!, 'http://localhost');

    expect(href.pathname).toBe('/test-calendar');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      search: 'concert',
      startDate: '2026-03-04',
      endDate: '2026-03-04',
    });
  });

  it('shows filtered events from the store in the week grid', async () => {
    const wrapper = await mountAt({ view: 'week', date: '2026-03-15' });
    const store = usePublicCalendarStore();

    const event = new CalendarEvent('event-1', 'calendar-123');
    const content = new CalendarEventContent('en');
    content.name = 'Spring Concert';
    event.addContent(content);
    const instance = new CalendarEventInstance(
      'instance-1',
      event,
      DateTime.fromISO('2026-03-17T19:00:00'),
      DateTime.fromISO('2026-03-17T21:00:00'),
    );
    store.allEvents = [instance];
    await flushPromises();

    const chip = wrapper.find('.week-view a.event-item');
    expect(chip.text()).toContain('Spring Concert');
    expect(chip.attributes('href')).toMatch(/^\/test-calendar\/events\/event-1\//);
  });
});
