import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import calendar from '../calendar.vue';
import SearchFilterPublic from '../SearchFilterPublic.vue';
import { usePublicCalendarStore } from '../../stores/publicCalendarStore';
import CalendarService from '../../service/calendar';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { DateTime } from 'luxon';

vi.mock('../../service/calendar');
vi.mock('@/client/service/models');

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Return key as translation
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

    const wrapper = mount(calendar, {
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

    const wrapper = mount(calendar, {
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

    // Set filters that will result in no events
    store.searchQuery = 'nonexistent event';
    store.allEvents = []; // Simulate no events returned from API
    store.isLoadingEvents = false; // Not loading
    store.hasLoadedEvents = true; // Events have been loaded (just empty)

    await wrapper.vm.$nextTick();

    // Verify empty state is shown with active filters
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('no_events_with_filters');

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
          path: '/view/:calendar',
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
    await router.push('/view/test_calendar');

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
    await router.push('/view/bare_calendar');

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
        { path: '/view/:calendar', name: 'calendar', component: calendar },
        { path: '/es/view/:calendar', component: calendar },
      ],
    });

    await esRouter.push('/es/view/my_calendar');

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
    return new CalendarEventInstance(
      instanceId,
      event,
      DateTime.fromISO('2026-03-15T10:00:00'),
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
        { path: '/view/:calendar', name: 'calendar', component: calendar },
        { path: '/view/:calendar/events/:event/:instance', name: 'instance', component: { template: '<div/>' } },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    await router.push('/view/test-calendar');

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
    const link = wrapper.find('li.event h3 a');
    expect(link.exists()).toBe(true);

    const href = link.attributes('href');
    // Default locale — no /en/ prefix
    expect(href).toBe('/view/test-calendar/events/event-abc/instance-xyz');
  });

  it('event card links include locale prefix for non-default locale (es)', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/view/:calendar', name: 'calendar', component: calendar },
        { path: '/es/view/:calendar', component: calendar },
        { path: '/view/:calendar/events/:event/:instance', name: 'instance', component: { template: '<div/>' } },
        { path: '/es/view/:calendar/events/:event/:instance', component: { template: '<div/>' } },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

    // Navigate to the Spanish-locale calendar page
    await router.push('/es/view/test-calendar');

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
    const link = wrapper.find('li.event h3 a');
    expect(link.exists()).toBe(true);

    const href = link.attributes('href');
    // Non-default locale — must include /es/ prefix
    expect(href).toBe('/es/view/test-calendar/events/event-abc/instance-xyz');
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
        { path: '/view/:calendar', name: 'calendar', component: calendar },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);
    await router.push('/view/test-calendar');

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

    const h2 = wrapper.find('section.day h2');
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
        { path: '/view/:calendar', name: 'calendar', component: calendar },
        { path: '/es/view/:calendar', component: calendar },
      ],
    });

    vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);
    await router.push('/es/view/test-calendar');

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

    const h2 = wrapper.find('section.day h2');
    expect(h2.exists()).toBe(true);

    // Spanish day heading for 2026-03-15: "domingo, 15 de marzo"
    const heading = h2.text();
    expect(heading).toContain('domingo');
    expect(heading).toContain('marzo');
  });
});
