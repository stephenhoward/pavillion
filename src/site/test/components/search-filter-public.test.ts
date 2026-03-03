import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import SearchFilterPublic from '@/site/components/search-filter-public.vue';
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


    it('should NOT show clear button when search contains only whitespace', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Initially no clear button
      expect(wrapper.find('.clear-search').exists()).toBe(false);

      // Type only spaces into search input
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('   ');
      await flushPromises();

      // Clear button should NOT appear for whitespace-only input
      expect(wrapper.find('.clear-search').exists()).toBe(false);
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

  describe('Search Pending State', () => {
    it('should set isSearchPending in store when 1-2 characters typed', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Initially not pending
      expect(store.isSearchPending).toBe(false);

      // Type 2 characters
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('yo');
      await flushPromises();

      // Should be pending (1-2 chars typed, below 3-char minimum)
      expect(store.isSearchPending).toBe(true);
    });

    it('should clear isSearchPending when search reaches 3+ characters', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Type 2 characters first
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('yo');
      await flushPromises();
      expect(store.isSearchPending).toBe(true);

      // Type 3+ characters
      await searchInput.setValue('yoga');
      await flushPromises();

      // Should no longer be pending
      expect(store.isSearchPending).toBe(false);
    });

    it('should clear isSearchPending when search is cleared', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Type 2 characters
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('yo');
      await flushPromises();
      expect(store.isSearchPending).toBe(true);

      // Clear the search
      await searchInput.setValue('');
      await flushPromises();

      // Should no longer be pending
      expect(store.isSearchPending).toBe(false);
    });

    it('should show helper text and not trigger reload when 1-2 chars typed', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      const reloadSpy = vi.spyOn(store, 'reloadWithFilters');

      // Type 1 character
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('y');
      await flushPromises();

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      // Should show helper text
      expect(wrapper.find('.search-helper-text').exists()).toBe(true);

      // Should NOT have reloaded (1 char is below minimum)
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('should clear isSearchPending when clear button clicked', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Type 2 characters to trigger pending state
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('yo');
      await flushPromises();
      expect(store.isSearchPending).toBe(true);

      // Click clear button
      const clearButton = wrapper.find('.clear-search');
      await clearButton.trigger('click');
      await flushPromises();

      // Should no longer be pending
      expect(store.isSearchPending).toBe(false);
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

      expect(store.selectedCategoryIds).toContain('Sports');
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

    it('should close dropdown when both date fields are manually cleared', async () => {
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

      // Set both date inputs to values
      const dateInputs = wrapper.findAll('input[type="date"]');
      await dateInputs[0].setValue('2025-01-15');
      await flushPromises();
      await dateInputs[1].setValue('2025-01-22');
      await flushPromises();

      // Confirm dropdown is still open
      expect(wrapper.find('.date-dropdown').exists()).toBe(true);

      // Clear start date field
      await dateInputs[0].setValue('');
      await flushPromises();

      // Dropdown still open (only one field cleared)
      expect(wrapper.find('.date-dropdown').exists()).toBe(true);

      // Clear end date field
      await dateInputs[1].setValue('');
      await flushPromises();

      // Dropdown should now be closed because both fields are empty
      expect(wrapper.find('.date-dropdown').exists()).toBe(false);
    });

    it('should reset dateFilterMode to null when both date fields are cleared', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open date filter and activate custom mode with dates
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[2].trigger('click'); // Click custom pill
      await flushPromises();

      const dateInputs = wrapper.findAll('input[type="date"]');
      await dateInputs[0].setValue('2025-01-15');
      await flushPromises();
      await dateInputs[1].setValue('2025-01-22');
      await flushPromises();

      // Confirm store has dates
      expect(store.startDate).toBe('2025-01-15');
      expect(store.endDate).toBe('2025-01-22');

      // Clear both date fields
      await dateInputs[0].setValue('');
      await flushPromises();
      await dateInputs[1].setValue('');
      await flushPromises();

      // Store dates should be null
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();

      // Clear date filter button should not be visible (dateFilterMode reset to null)
      expect(wrapper.find('.clear-date-filter').exists()).toBe(false);
    });

    it('should show year in button label when custom date range spans different years', async () => {
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

      // Set a cross-year date range
      const dateInputs = wrapper.findAll('input[type="date"]');
      await dateInputs[0].setValue('2025-12-30');
      await flushPromises();
      await dateInputs[1].setValue('2026-01-05');
      await flushPromises();

      // Button label should include years for both dates
      const buttonText = wrapper.find('.button-text').text();
      expect(buttonText).toContain('2025');
      expect(buttonText).toContain('2026');
    });

    it('should not show year in button label when custom date range is within same year', async () => {
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

      // Set a same-year date range
      const dateInputs = wrapper.findAll('input[type="date"]');
      await dateInputs[0].setValue('2025-01-05');
      await flushPromises();
      await dateInputs[1].setValue('2025-01-12');
      await flushPromises();

      // Button label should NOT include year
      const buttonText = wrapper.find('.button-text').text();
      expect(buttonText).not.toContain('2025');
    });
    it('should show single date label when start and end dates are the same', async () => {
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

      // Set both start and end to the same date
      const dateInputs = wrapper.findAll('input[type="date"]');
      await dateInputs[0].setValue('2026-02-24');
      await flushPromises();
      await dateInputs[1].setValue('2026-02-24');
      await flushPromises();

      // Button label should show single date (e.g. 'Feb 24'), not 'Feb 24-24'
      const buttonText = wrapper.find('.button-text').text();
      expect(buttonText).toBe('Feb 24');
      expect(buttonText).not.toContain('24-24');
    });
  });

  describe('Escape Key Behavior', () => {
    it('should close the date filter dropdown when Escape is pressed', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open the dropdown
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      // Confirm dropdown is open
      expect(wrapper.find('.date-dropdown').exists()).toBe(true);

      // Press Escape on the wrapper
      const wrapper2 = wrapper.find('.date-filter-wrapper');
      await wrapper2.trigger('keydown', { key: 'Escape' });
      await flushPromises();

      // Dropdown should now be closed
      expect(wrapper.find('.date-dropdown').exists()).toBe(false);
    });

    it('should return focus to the date filter button after closing with Escape', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      const dateFilterButton = wrapper.find('.date-filter-button');

      // Open the dropdown
      await dateFilterButton.trigger('click');
      await flushPromises();

      // Spy on focus method of the button element
      const buttonEl = dateFilterButton.element as HTMLButtonElement;
      const focusSpy = vi.spyOn(buttonEl, 'focus');

      // Press Escape on the wrapper
      const wrapperEl = wrapper.find('.date-filter-wrapper');
      await wrapperEl.trigger('keydown', { key: 'Escape' });
      await flushPromises();

      // Focus should have been called on the trigger button
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe('Clear Date Filter', () => {
    it('should not show clear date filter button when no date filter is active', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // No clear date filter button when no filter is active
      expect(wrapper.find('.clear-date-filter').exists()).toBe(false);
    });

    it('should show clear date filter button when a date filter is active', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Open date filter dropdown and click "This Week"
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week"
      await flushPromises();

      // Verify the date filter is active
      expect(store.startDate).toBeTruthy();
      expect(store.endDate).toBeTruthy();

      // Clear date filter button should now be visible
      const clearButton = wrapper.find('.clear-date-filter');
      expect(clearButton.exists()).toBe(true);
    });

    it('should clear date filter and update URL when clear button clicked', async () => {
      const store = usePublicCalendarStore();

      await router.push('/calendar/test');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Activate a date filter
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week"
      await flushPromises();

      // Confirm date filter is set
      expect(store.startDate).toBeTruthy();
      expect(store.endDate).toBeTruthy();

      // Click the clear date filter button
      const clearButton = wrapper.find('.clear-date-filter');
      expect(clearButton.exists()).toBe(true);
      await clearButton.trigger('click');
      await flushPromises();

      // Date filter should be cleared
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();

      // URL should not have date parameters
      expect(router.currentRoute.value.query.startDate).toBeUndefined();
      expect(router.currentRoute.value.query.endDate).toBeUndefined();
    });

    it('should have aria-label attribute on clear date filter button', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Activate a date filter
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week"
      await flushPromises();

      // The clear button should have an aria-label attribute present
      const clearButton = wrapper.find('.clear-date-filter');
      expect(clearButton.exists()).toBe(true);
      expect(clearButton.attributes()).toHaveProperty('aria-label');
    });

    it('should clear date filter when "Next Week" is active', async () => {
      const store = usePublicCalendarStore();

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Activate "Next Week" date filter
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[1].trigger('click'); // Click "Next Week"
      await flushPromises();

      expect(store.startDate).toBeTruthy();

      // Click clear button
      const clearButton = wrapper.find('.clear-date-filter');
      expect(clearButton.exists()).toBe(true);
      await clearButton.trigger('click');
      await flushPromises();

      // Date filter should be cleared
      expect(store.startDate).toBeNull();
      expect(store.endDate).toBeNull();
    });

    it('should hide clear button after clearing the date filter', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Activate a date filter
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week"
      await flushPromises();

      // Clear the filter
      const clearButton = wrapper.find('.clear-date-filter');
      await clearButton.trigger('click');
      await flushPromises();

      // Clear button should no longer be visible
      expect(wrapper.find('.clear-date-filter').exists()).toBe(false);
    });
  });

  describe('Clear All Filters Persistent Button', () => {
    it('should not show clear-all-filters-btn when no filters are active', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      expect(wrapper.find('.clear-all-filters-btn').exists()).toBe(false);
    });

    it('should show clear-all-filters-btn when search filter is active', async () => {
      const store = usePublicCalendarStore();
      store.setSearchQuery('yoga');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      expect(wrapper.find('.clear-all-filters-btn').exists()).toBe(true);
    });

    it('should show clear-all-filters-btn when category filter is active', async () => {
      const store = usePublicCalendarStore();
      store.setSelectedCategories(['cat-1']);

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      expect(wrapper.find('.clear-all-filters-btn').exists()).toBe(true);
    });

    it('should show clear-all-filters-btn when date filter is active and results exist', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Activate date filter
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week"
      await flushPromises();

      // Clear all filters button should be visible
      expect(wrapper.find('.clear-all-filters-btn').exists()).toBe(true);
    });

    it('should clear all filters and local state when clear-all-filters-btn clicked', async () => {
      const store = usePublicCalendarStore();
      store.setSearchQuery('yoga');

      await router.push('/calendar/test');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Confirm button is visible
      const clearAllBtn = wrapper.find('.clear-all-filters-btn');
      expect(clearAllBtn.exists()).toBe(true);

      // Click it
      await clearAllBtn.trigger('click');
      await flushPromises();

      // Store should be cleared
      expect(store.searchQuery).toBe('');
      expect(store.selectedCategoryIds).toEqual([]);
    });

    it('should hide clear-all-filters-btn after all filters are cleared', async () => {
      const store = usePublicCalendarStore();
      store.setSearchQuery('yoga');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      expect(wrapper.find('.clear-all-filters-btn').exists()).toBe(true);

      // Click clear all
      await wrapper.find('.clear-all-filters-btn').trigger('click');
      await flushPromises();

      // Button should disappear
      expect(wrapper.find('.clear-all-filters-btn').exists()).toBe(false);
    });
  });


  describe('Clear Button Dynamic Label', () => {
    beforeEach(async () => {
      // Initialize i18next with translations for label verification
      await i18next.init({
        lng: 'en',
        resources: {
          en: {
            system: {
              'public_search_filter.clear_search': 'Clear Search',
              'public_search_filter.clear_filters': 'Clear Filters',
              'public_search_filter.clear_all_filters': 'Clear All Filters',
            },
          },
        },
      });
    });

    it('should show "Clear Search" label when only search is active', async () => {
      const store = usePublicCalendarStore();
      store.setSearchQuery('yoga');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      const btn = wrapper.find('.clear-all-filters-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Clear Search');
    });

    it('should show "Clear Filters" label when only category filter is active', async () => {
      const store = usePublicCalendarStore();
      store.setSelectedCategories(['cat-1']);

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      const btn = wrapper.find('.clear-all-filters-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Clear Filters');
    });

    it('should show "Clear Filters" label when only date filter is active', async () => {
      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Activate date filter
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week"
      await flushPromises();

      const btn = wrapper.find('.clear-all-filters-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Clear Filters');
    });

    it('should show "Clear All Filters" label when both search and category filters are active', async () => {
      const store = usePublicCalendarStore();
      store.setSearchQuery('yoga');
      store.setSelectedCategories(['cat-1']);

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      const btn = wrapper.find('.clear-all-filters-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Clear All Filters');
    });

    it('should show "Clear All Filters" label when both search and date filters are active', async () => {
      const store = usePublicCalendarStore();
      store.setSearchQuery('yoga');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Also activate date filter
      const dateFilterButton = wrapper.find('.date-filter-button');
      await dateFilterButton.trigger('click');
      await flushPromises();

      const pills = wrapper.findAll('.date-pill');
      await pills[0].trigger('click'); // Click "This Week"
      await flushPromises();

      const btn = wrapper.find('.clear-all-filters-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('Clear All Filters');
    });
  });

  describe('External Clear All Filters', () => {
    it('should clear search input when store searchQuery is cleared externally', async () => {
      const store = usePublicCalendarStore();

      await router.push('/calendar/test');

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Type in search input
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('yoga classes');
      await flushPromises();

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      // Confirm search is active in both component and store
      expect((searchInput.element as HTMLInputElement).value).toBe('yoga classes');
      expect(store.searchQuery).toBe('yoga classes');

      // Simulate external clearAllFilters call (as calendar.vue does)
      store.clearAllFilters();
      await flushPromises();

      // Search input should be cleared
      expect((searchInput.element as HTMLInputElement).value).toBe('');
    });

    it('should remove search URL param when store searchQuery is cleared externally', async () => {
      const store = usePublicCalendarStore();

      await router.push({
        path: '/calendar/test',
        query: { search: 'yoga classes' },
      });

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Confirm search param is in URL
      expect(router.currentRoute.value.query.search).toBe('yoga classes');

      // Simulate external clearAllFilters call (as calendar.vue does)
      store.clearAllFilters();
      await flushPromises();

      // URL should no longer have search param
      expect(router.currentRoute.value.query.search).toBeUndefined();
    });

    it('should remove category URL params when store selectedCategoryIds is cleared externally', async () => {
      const store = usePublicCalendarStore();

      await router.push({
        path: '/calendar/test',
        query: { categories: ['cat-1', 'cat-2'] },
      });

      mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Confirm category params are in URL
      expect(router.currentRoute.value.query.categories).toEqual(['cat-1', 'cat-2']);

      // Simulate external clearAllFilters call (as calendar.vue does)
      store.clearAllFilters();
      await flushPromises();

      // URL should no longer have category params
      expect(router.currentRoute.value.query.categories).toBeUndefined();
    });

    it('should remove startDate and endDate URL params when store dates are cleared externally', async () => {
      const store = usePublicCalendarStore();

      await router.push({
        path: '/calendar/test',
        query: { startDate: '2025-01-01', endDate: '2025-01-07' },
      });

      mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Confirm date params are in URL and store is initialized
      expect(router.currentRoute.value.query.startDate).toBe('2025-01-01');
      expect(router.currentRoute.value.query.endDate).toBe('2025-01-07');
      expect(store.startDate).toBe('2025-01-01');
      expect(store.endDate).toBe('2025-01-07');

      // Simulate external clearAllFilters call (as calendar.vue does)
      store.clearAllFilters();
      await flushPromises();

      // URL should no longer have date params
      expect(router.currentRoute.value.query.startDate).toBeUndefined();
      expect(router.currentRoute.value.query.endDate).toBeUndefined();
    });

    it('should reset date filter button to unfiltered state when store dates are cleared externally', async () => {
      const store = usePublicCalendarStore();

      await router.push({
        path: '/calendar/test',
        query: { startDate: '2025-01-01', endDate: '2025-01-07' },
      });

      const wrapper = mount(SearchFilterPublic, {
        global: {
          plugins: [pinia, router, [I18NextVue, { i18next }]],
        },
      });

      await flushPromises();

      // Verify that date filter appears active (clear button should be visible)
      expect(wrapper.find('.clear-date-filter').exists()).toBe(true);

      // Simulate external clearAllFilters call (as calendar.vue does)
      store.clearAllFilters();
      await flushPromises();

      // Clear date filter button should no longer be visible
      expect(wrapper.find('.clear-date-filter').exists()).toBe(false);
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
          categories: ['Sports', 'Health'],
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
      expect(store.selectedCategoryIds).toEqual(['Sports', 'Health']);
      expect(store.startDate).toBe('2025-01-01');
      expect(store.endDate).toBe('2025-01-07');
    });

    it('should update URL when filters change', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
