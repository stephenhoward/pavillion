import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import SearchFilterPublic from '@/site/components/SearchFilterPublic.vue';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { EventCategory } from '@/common/model/event_category';
import { DateTime } from 'luxon';

describe('SearchFilterPublic Component', () => {
  let pinia: ReturnType<typeof createPinia>;
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    // Create a simple router for testing
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
        { path: '/calendar/:calendar', name: 'calendar', component: { template: '<div>Calendar</div>' } },
      ],
    });
  });

  describe('Search Input', () => {
    it('should update store on search input with debounce', async () => {
      const store = usePublicCalendarStore();
      const reloadSpy = vi.spyOn(store, 'reloadWithFilters');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      const searchInput = wrapper.find('input[type="text"]');
      expect(searchInput.exists()).toBe(true);

      // Type in search input
      await searchInput.setValue('yoga');

      // Should not call immediately (debounce)
      expect(reloadSpy).not.toHaveBeenCalled();

      // Wait for debounce (300ms)
      await new Promise(resolve => setTimeout(resolve, 350));

      // Now should have reloaded with filters
      expect(reloadSpy).toHaveBeenCalled();
      expect(store.searchQuery).toBe('yoga');
    });

    it('should show clear button when search has value', async () => {
      const store = usePublicCalendarStore();
      store.searchQuery = 'test query';

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const clearButton = wrapper.find('.clear-search');
      expect(clearButton.exists()).toBe(true);
    });

    it('should clear search when clear button clicked', async () => {
      const store = usePublicCalendarStore();
      store.searchQuery = 'test query';

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const clearButton = wrapper.find('.clear-search');
      await clearButton.trigger('click');

      expect(store.searchQuery).toBe('');
    });
  });

  describe('Category Filtering', () => {
    it('should display CategoryPillSelector with available categories', async () => {
      const store = usePublicCalendarStore();

      // Create mock categories
      const category1 = EventCategory.fromObject({
        id: 'cat-1',
        calendar_id: 'cal-1',
        content: [{ language: 'en', name: 'Sports' }],
      });

      store.availableCategories = [category1];

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      // Should render CategoryPillSelector
      const pillSelector = wrapper.findComponent({ name: 'CategoryPillSelector' });
      expect(pillSelector.exists()).toBe(true);
    });

    it('should update store when category selected', async () => {
      const store = usePublicCalendarStore();

      const category1 = EventCategory.fromObject({
        id: 'cat-1',
        calendar_id: 'cal-1',
        content: [{ language: 'en', name: 'Sports' }],
      });

      store.availableCategories = [category1];

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const pillSelector = wrapper.findComponent({ name: 'CategoryPillSelector' });

      // Emit category selection
      await pillSelector.vm.$emit('update:selectedCategories', ['Sports']);

      expect(store.selectedCategoryNames).toContain('Sports');
    });
  });

  describe('Date Range Filtering', () => {
    it('should render date picker inputs', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      const dateInputs = wrapper.findAll('input[type="date"]');
      expect(dateInputs.length).toBe(2); // Start and end date inputs
    });

    it('should set correct date range when "This Week" button clicked', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const thisWeekButton = wrapper.find('button.preset-this-week');
      await thisWeekButton.trigger('click');

      // Should have set start and end dates
      expect(store.startDate).toBeTruthy();
      expect(store.endDate).toBeTruthy();

      // Verify Sunday-Saturday range
      const start = DateTime.fromISO(store.startDate as string);
      const end = DateTime.fromISO(store.endDate as string);

      expect(start.weekday).toBe(7); // Sunday
      expect(end.weekday).toBe(6); // Saturday
    });

    it('should set correct date range when "Next Week" button clicked', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      const nextWeekButton = wrapper.find('button.preset-next-week');
      await nextWeekButton.trigger('click');

      expect(store.startDate).toBeTruthy();
      expect(store.endDate).toBeTruthy();

      const start = DateTime.fromISO(store.startDate as string);
      const end = DateTime.fromISO(store.endDate as string);

      expect(start.weekday).toBe(7); // Sunday
      expect(end.weekday).toBe(6); // Saturday
    });

    it('should update store when manual date input changed', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      const dateInputs = wrapper.findAll('input[type="date"]');
      const startDateInput = dateInputs[0];

      await startDateInput.setValue('2025-01-15');
      expect(store.startDate).toBe('2025-01-15');
    });
  });

  describe('Clear All Filters', () => {
    it('should show "Clear all filters" button when any filter active', async () => {
      const store = usePublicCalendarStore();
      store.searchQuery = 'test';

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const clearAllButton = wrapper.find('.clear-all-filters');
      expect(clearAllButton.exists()).toBe(true);
    });

    it('should hide "Clear all filters" button when no filters active', async () => {
      const store = usePublicCalendarStore();
      store.searchQuery = '';
      store.selectedCategoryNames = [];
      store.startDate = null;
      store.endDate = null;

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const clearAllButton = wrapper.find('.clear-all-filters');
      expect(clearAllButton.exists()).toBe(false);
    });

    it('should reset all filters when clear all button clicked', async () => {
      const store = usePublicCalendarStore();
      store.searchQuery = 'yoga';
      store.selectedCategoryNames = ['Sports'];
      store.startDate = '2025-01-01';
      store.endDate = '2025-01-07';

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const clearAllButton = wrapper.find('.clear-all-filters');
      await clearAllButton.trigger('click');

      expect(store.searchQuery).toBe('');
      expect(store.selectedCategoryNames).toEqual([]);
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();
    });
  });

  describe('Mobile Accordion', () => {
    it('should render accordion for category and date filters on mobile', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const accordion = wrapper.find('.filter-accordion');
      expect(accordion.exists()).toBe(true);
    });

    it('should toggle accordion when clicked', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      const accordionButton = wrapper.find('.accordion-toggle');
      expect(accordionButton.exists()).toBe(true);

      // Initially closed
      expect(wrapper.vm.isAccordionOpen).toBe(false);

      // Click to open
      await accordionButton.trigger('click');
      expect(wrapper.vm.isAccordionOpen).toBe(true);

      // Click to close
      await accordionButton.trigger('click');
      expect(wrapper.vm.isAccordionOpen).toBe(false);
    });
  });

  describe('URL Parameter Synchronization', () => {
    it('should initialize filters from URL parameters on mount', async () => {
      const store = usePublicCalendarStore();

      // Navigate to route with query parameters
      await router.push({
        path: '/calendar/test',
        query: {
          search: 'yoga',
          category: ['Sports', 'Health'],
          startDate: '2025-01-01',
          endDate: '2025-01-07',
        },
      });

      mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      // Store should be initialized from URL params
      expect(store.searchQuery).toBe('yoga');
      expect(store.selectedCategoryNames).toEqual(['Sports', 'Health']);
      expect(store.startDate).toBe('2025-01-01');
      expect(store.endDate).toBe('2025-01-07');
    });

    it('should update URL when filters change', async () => {
      const store = usePublicCalendarStore();

      await router.push('/calendar/test');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      // Change search filter
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue('new search');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      // URL should be updated
      expect(router.currentRoute.value.query.search).toBe('new search');
    });
  });

  describe('Real-time Filter Application', () => {
    it('should reload events when any filter changes', async () => {
      const store = usePublicCalendarStore();
      const reloadSpy = vi.spyOn(store, 'reloadWithFilters');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router],
        },
      });

      await flushPromises();

      // Click preset button
      const thisWeekButton = wrapper.find('button.preset-this-week');
      await thisWeekButton.trigger('click');

      // Should have triggered reload
      expect(reloadSpy).toHaveBeenCalled();
    });
  });
});
