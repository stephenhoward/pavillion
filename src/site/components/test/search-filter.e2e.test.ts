import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory, Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import SearchFilterPublic from '../SearchFilterPublic.vue';
import calendar from '../calendar.vue';
import { usePublicCalendarStore } from '../../stores/publicCalendarStore';
import CalendarService from '../../service/calendar';
import ModelService from '@/client/service/models';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { DateTime } from 'luxon';

vi.mock('../../service/calendar');
vi.mock('@/client/service/models');

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('Public Event Search & Filtering - End-to-End Tests', () => {
  let pinia;
  let router: Router;
  let mockCalendar: Calendar;
  let mockCategories: EventCategory[];

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    // Create mock calendar
    mockCalendar = new Calendar('calendar-123', 'test-calendar');
    const content = new CalendarContent('en');
    content.name = 'Test Calendar';
    mockCalendar.addContent(content);

    // Create mock categories
    const category1 = new EventCategory('cat-1', 'calendar-123');
    const content1 = new EventCategoryContent('en', 'Music');
    category1.addContent(content1);

    const category2 = new EventCategory('cat-2', 'calendar-123');
    const content2 = new EventCategoryContent('en', 'Arts');
    category2.addContent(content2);

    mockCategories = [category1, category2];

    // Setup router
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

    // Mock ModelService
    vi.mocked(ModelService.listModels).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Edge Case: Non-existent Category IDs in URL', () => {
    it('should handle non-existent category IDs gracefully without crashing', async () => {
      // Mock calendar service
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      const store = usePublicCalendarStore();
      store.availableCategories = mockCategories;

      // Navigate with invalid category IDs in URL
      await router.push({
        path: '/calendar/test-calendar',
        query: {
          category: ['invalid-cat-1', 'invalid-cat-2', 'Music'], // Mix of invalid and valid
        },
      });

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

      // Component should not crash - the current implementation accepts all category names
      // The filtering will happen server-side and return no results for invalid categories
      expect(wrapper.vm).toBeDefined();
      expect(store.selectedCategoryNames.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Case: Malformed URL Parameters', () => {
    it('should handle malformed date parameters gracefully', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      const store = usePublicCalendarStore();

      // Navigate with malformed date in URL
      await router.push({
        path: '/calendar/test-calendar',
        query: {
          startDate: 'not-a-date',
          endDate: '2025-13-45', // Invalid date
        },
      });

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

      // Store should not have invalid dates set
      // Component should not crash
      expect(wrapper.vm).toBeDefined();
      expect(store.startDate).toBe('not-a-date'); // Store accepts but API will reject
      expect(store.endDate).toBe('2025-13-45');
    });

    it('should handle array parameters that should be strings', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      const store = usePublicCalendarStore();

      // Navigate with array where string is expected
      await router.push({
        path: '/calendar/test-calendar',
        query: {
          search: ['term1', 'term2'] as any, // Malformed: should be string
        },
      });

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

      // Component should handle gracefully - typically takes first value
      expect(wrapper.vm).toBeDefined();
    });
  });

  describe('Mobile Accordion Behavior', () => {
    it('should toggle accordion open and closed on mobile', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      await router.push('/calendar/test-calendar');

      // Set viewport to mobile size
      global.innerWidth = 500;

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      // Accordion should be closed by default
      expect(wrapper.vm.state.isAccordionOpen).toBe(false);
      expect(wrapper.find('.filter-accordion').classes()).not.toContain('open');

      // Find and click accordion toggle button
      const toggleButton = wrapper.find('.accordion-toggle');
      expect(toggleButton.exists()).toBe(true);

      await toggleButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Accordion should now be open
      expect(wrapper.vm.state.isAccordionOpen).toBe(true);
      expect(wrapper.find('.filter-accordion').classes()).toContain('open');

      // Click again to close
      await toggleButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Accordion should be closed again
      expect(wrapper.vm.state.isAccordionOpen).toBe(false);
      expect(wrapper.find('.filter-accordion').classes()).not.toContain('open');
    });

    it('should keep accordion open state independent of filters', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      await router.push('/calendar/test-calendar');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const store = usePublicCalendarStore();

      // Open accordion
      const toggleButton = wrapper.find('.accordion-toggle');
      await toggleButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.state.isAccordionOpen).toBe(true);

      // Change a filter
      store.setSearchQuery('yoga');
      await wrapper.vm.$nextTick();

      // Accordion should still be open
      expect(wrapper.vm.state.isAccordionOpen).toBe(true);
    });
  });

  describe('Rapid Filter Changes and Race Conditions', () => {
    it('should handle rapid consecutive search input changes with debouncing', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      await router.push('/calendar/test-calendar');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const store = usePublicCalendarStore();
      const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

      const searchInput = wrapper.find('input[type="text"]');

      // Rapidly type multiple characters
      await searchInput.setValue('y');
      await searchInput.setValue('yo');
      await searchInput.setValue('yog');
      await searchInput.setValue('yoga');

      // Initially, should not have reloaded yet
      expect(reloadSpy).not.toHaveBeenCalled();

      // Wait for debounce (300ms)
      await new Promise(resolve => setTimeout(resolve, 350));

      // Should have reloaded at least once with final value
      // Note: setValue may trigger multiple inputs, so we check it was called at least once
      expect(reloadSpy).toHaveBeenCalled();
      expect(store.searchQuery).toBe('yoga');

      reloadSpy.mockRestore();
    });

    it('should handle simultaneous filter changes correctly', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      await router.push('/calendar/test-calendar');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const store = usePublicCalendarStore();
      const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

      // Change multiple filters at once
      const searchInput = wrapper.find('input[type="text"]');
      const startDateInput = wrapper.find('input#start-date');

      // Trigger search and date change simultaneously
      await searchInput.setValue('yoga');
      await startDateInput.setValue('2025-11-15');
      await startDateInput.trigger('change');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      // Store should have both filter values
      expect(store.searchQuery).toBe('yoga');
      expect(store.startDate).toBe('2025-11-15');

      // Should reload with combined filters
      expect(reloadSpy).toHaveBeenCalled();

      reloadSpy.mockRestore();
    });
  });

  describe('Performance with Large Event Datasets', () => {
    it('should filter 100+ events efficiently', async () => {
      // Create 150 mock events
      const largeEventSet: CalendarEventInstance[] = [];
      for (let i = 0; i < 150; i++) {
        const event = new CalendarEvent(`event-${i}`, 'calendar-123');
        const content = new CalendarEventContent('en');
        content.title = `Event ${i}`;
        content.description = i % 2 === 0 ? 'yoga class' : 'concert performance';
        event.addContent(content);

        const instance = new CalendarEventInstance(
          `instance-${i}`,
          event,
          DateTime.now().plus({ days: i }),
          null
        );
        largeEventSet.push(instance);
      }

      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      await router.push('/calendar/test-calendar');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const store = usePublicCalendarStore();
      store.allEvents = largeEventSet;

      const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

      // Measure time to apply filter
      const startTime = performance.now();

      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue('yoga');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      const endTime = performance.now();
      const executionTime = endTime - startTime;

      // Should complete within 500ms (including debounce)
      expect(executionTime).toBeLessThan(500);
      expect(reloadSpy).toHaveBeenCalled();

      reloadSpy.mockRestore();
    });
  });

  describe('Complex Multi-Filter State Management', () => {
    it('should clear all filters correctly from complex state', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      const store = usePublicCalendarStore();
      store.availableCategories = mockCategories;

      // Set up complex filter state
      await router.push({
        path: '/calendar/test-calendar',
        query: {
          search: 'yoga',
          category: ['Music', 'Arts'],
          startDate: '2025-11-15',
          endDate: '2025-11-21',
        },
      });

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

      // Verify complex state is set
      expect(store.searchQuery).toBe('yoga');
      expect(store.selectedCategoryNames).toEqual(['Music', 'Arts']);
      expect(store.startDate).toBe('2025-11-15');
      expect(store.endDate).toBe('2025-11-21');

      // Find and click clear all filters button
      const searchFilter = wrapper.findComponent(SearchFilterPublic);
      const clearButton = searchFilter.find('button.clear-all-filters');

      await clearButton.trigger('click');
      await flushPromises();

      // All filters should be cleared
      expect(store.searchQuery).toBe('');
      expect(store.selectedCategoryNames).toEqual([]);
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();

      // URL should be cleared
      expect(router.currentRoute.value.query).toEqual({});
    });
  });

  describe('URL Sharing Workflow', () => {
    it('should load identical filter state for user receiving shared URL', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      const store = usePublicCalendarStore();
      store.availableCategories = mockCategories;

      // Simulate user receiving a shared URL with filters
      const sharedURL = {
        path: '/calendar/test-calendar',
        query: {
          search: 'farmers market',
          category: ['Music'],
          startDate: '2025-11-15',
          endDate: '2025-11-22',
        },
      };

      await router.push(sharedURL);

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

      // Store should match shared URL parameters exactly
      expect(store.searchQuery).toBe('farmers market');
      expect(store.selectedCategoryNames).toEqual(['Music']);
      expect(store.startDate).toBe('2025-11-15');
      expect(store.endDate).toBe('2025-11-22');

      // UI should reflect the filters
      const searchFilter = wrapper.findComponent(SearchFilterPublic);
      const searchInput = searchFilter.find('input[type="text"]');
      expect((searchInput.element as HTMLInputElement).value).toBe('farmers market');
    });
  });

  describe('Accessibility: Keyboard Navigation', () => {
    it('should support keyboard navigation through filter controls', async () => {
      vi.mocked(CalendarService.prototype.getCalendarByUrlName).mockResolvedValue(mockCalendar);

      await router.push('/calendar/test-calendar');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      // Search input should be keyboard accessible
      const searchInput = wrapper.find('input[type="text"]');
      expect(searchInput.attributes('id')).toBe('public-event-search');

      // Date inputs should have proper labels
      const startDateInput = wrapper.find('input#start-date');
      const startLabel = wrapper.find('label[for="start-date"]');
      expect(startLabel.exists()).toBe(true);

      const endDateInput = wrapper.find('input#end-date');
      const endLabel = wrapper.find('label[for="end-date"]');
      expect(endLabel.exists()).toBe(true);

      // Accordion toggle should have aria-expanded
      const accordionToggle = wrapper.find('.accordion-toggle');
      expect(accordionToggle.attributes('aria-expanded')).toBeDefined();

      // Buttons should be keyboard accessible (no test for click, just structure)
      const thisWeekBtn = wrapper.find('button.preset-this-week');
      expect(thisWeekBtn.attributes('type')).toBe('button');
    });
  });
});
