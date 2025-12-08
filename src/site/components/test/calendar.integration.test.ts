import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import calendar from '../calendar.vue';
import SearchFilterPublic from '../SearchFilterPublic.vue';
import { usePublicCalendarStore } from '../../stores/publicCalendarStore';
import CalendarService from '../../service/calendar';
import ModelService from '@/client/service/models';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import CalendarEventInstance from '@/common/model/event_instance';
import { DateTime } from 'luxon';

vi.mock('../../service/calendar');
vi.mock('@/client/service/models');

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Return key as translation
  }),
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

    // Mock ModelService.listModels to return empty arrays
    vi.mocked(ModelService.listModels).mockResolvedValue([]);
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
        category: ['Fitness', 'Wellness'],
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
    expect(store.selectedCategoryNames).toEqual(['Fitness', 'Wellness']);
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
      query: { search: 'yoga', category: ['Fitness'] },
    });

    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(store.searchQuery).toBe('yoga');
    expect(store.selectedCategoryNames).toEqual(['Fitness']);

    // Apply second set of filters
    await router.push({
      path: '/calendar/test-calendar',
      query: { search: 'concert', category: ['Music'] },
    });

    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(store.searchQuery).toBe('concert');
    expect(store.selectedCategoryNames).toEqual(['Music']);

    // Simulate browser back button
    await router.back();
    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify filters restored to previous state
    expect(store.searchQuery).toBe('yoga');
    expect(store.selectedCategoryNames).toEqual(['Fitness']);
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

    await wrapper.vm.$nextTick();

    // Verify empty state is shown with active filters
    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('no_events_with_filters');

    // Verify clear filters button exists
    expect(wrapper.find('.clear-filters-btn').exists()).toBe(true);
  });
});
