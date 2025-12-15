import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
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

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Set up spy after mount to avoid catching initialization calls
      const reloadSpy = vi.spyOn(store, 'reloadWithFilters');

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
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Initially no clear button
      expect(wrapper.find('.clear-search').exists()).toBe(false);

      // Type in search input
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('test query');
      await flushPromises();

      // Clear button should now appear
      const clearButton = wrapper.find('.clear-search');
      expect(clearButton.exists()).toBe(true);
    });

    it('should clear search when clear button clicked', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      // Type in search input to show clear button
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('test query');
      await flushPromises();

      // Click clear button
      const clearButton = wrapper.find('.clear-search');
      await clearButton.trigger('click');
      await flushPromises();

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
          plugins: [pinia, router, [I18NextVue, { i18next }]],
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
          plugins: [pinia, router, [I18NextVue, { i18next }]],
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
    it('should open date filter dropdown when button clicked', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      const dateFilterButton = wrapper.find('.date-filter-button');
      expect(dateFilterButton.exists()).toBe(true);

      // Initially closed
      expect(wrapper.find('.date-dropdown').exists()).toBe(false);

      // Click to open
      await dateFilterButton.trigger('click');
      await flushPromises();

      // Should show dropdown
      expect(wrapper.find('.date-dropdown').exists()).toBe(true);
    });

    it('should set correct date range when "This Week" pill clicked', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open date filter dropdown
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      // Find and click "This Week" pill
      const pills = wrapper.findAll('.date-pill');
      const thisWeekPill = pills[0]; // First pill is "This Week"
      await thisWeekPill.trigger('click');
      await flushPromises();

      // Should have set start and end dates
      expect(store.startDate).toBeTruthy();
      expect(store.endDate).toBeTruthy();

      // Verify Sunday-Saturday range
      const start = DateTime.fromISO(store.startDate as string);
      const end = DateTime.fromISO(store.endDate as string);

      expect(start.weekday).toBe(7); // Sunday
      expect(end.weekday).toBe(6); // Saturday
    });

    it('should set correct date range when "Next Week" pill clicked', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open date filter dropdown
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      // Find and click "Next Week" pill
      const pills = wrapper.findAll('.date-pill');
      const nextWeekPill = pills[1]; // Second pill is "Next Week"
      await nextWeekPill.trigger('click');
      await flushPromises();

      expect(store.startDate).toBeTruthy();
      expect(store.endDate).toBeTruthy();

      const start = DateTime.fromISO(store.startDate as string);
      const end = DateTime.fromISO(store.endDate as string);

      expect(start.weekday).toBe(7); // Sunday
      expect(end.weekday).toBe(6); // Saturday
    });

    it('should show custom date inputs when calendar pill clicked', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open date filter dropdown
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      // Initially no date inputs visible
      expect(wrapper.findAll('input[type="date"]').length).toBe(0);

      // Click calendar pill (third pill)
      const pills = wrapper.findAll('.date-pill');
      const customPill = pills[2];
      await customPill.trigger('click');
      await flushPromises();

      // Should show date inputs
      const dateInputs = wrapper.findAll('input[type="date"]');
      expect(dateInputs.length).toBe(2);
    });

    it('should update store when manual date input changed', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open date filter and activate custom mode
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[2].trigger('click'); // Click custom pill
      await flushPromises();

      // Change date input
      const dateInputs = wrapper.findAll('input[type="date"]');
      const startDateInput = dateInputs[0];
      await startDateInput.setValue('2025-01-15');
      await flushPromises();

      expect(store.startDate).toBe('2025-01-15');
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
          plugins: [pinia, router, [I18NextVue, { i18next }]],
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
          plugins: [pinia, router, [I18NextVue, { i18next }]],
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
    it('should reload events when date filter changes', async () => {
      const store = usePublicCalendarStore();
      const reloadSpy = vi.spyOn(store, 'reloadWithFilters');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open date filter and click "This Week" pill
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week" pill
      await flushPromises();

      // Should have triggered reload
      expect(reloadSpy).toHaveBeenCalled();
    });
  });
});
