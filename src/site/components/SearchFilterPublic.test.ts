import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import SearchFilterPublic from './SearchFilterPublic.vue';
import { usePublicCalendarStore } from '../stores/publicCalendarStore';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

describe('SearchFilterPublic', () => {
  let wrapper: VueWrapper | null = null;
  let store: ReturnType<typeof usePublicCalendarStore>;
  let router: Router;

  beforeEach(async () => {
    // Create fresh Pinia instance for each test
    setActivePinia(createPinia());
    store = usePublicCalendarStore();

    // Create router
    router = createRouter({
      history: createMemoryHistory(),
      routes: routes,
    });

    // Push to test route before mounting
    await router.push('/test');

    // Set up mock categories using EventCategoryContent constructor
    const category1 = new EventCategory('cat-1', 'calendar-1');
    const content1 = new EventCategoryContent('en', 'Music');
    category1.addContent(content1);

    const category2 = new EventCategory('cat-2', 'calendar-1');
    const content2 = new EventCategoryContent('en', 'Arts');
    category2.addContent(content2);

    store.availableCategories = [category1, category2];
    store.currentCalendarUrlName = 'test-calendar';
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  const mountComponent = async () => {
    wrapper = mount(SearchFilterPublic, {
      global: {
        plugins: [
          router,
          [I18NextVue, { i18next }],
        ],
      },
    });

    // Wait for component to be ready
    await wrapper.vm.$nextTick();
    return wrapper;
  };

  it('should update store when search input changes (with debounce)', async () => {
    await mountComponent();

    const searchInput = wrapper!.find('input[type="text"]');
    expect(searchInput.exists()).toBe(true);

    // Type into search input
    await searchInput.setValue('yoga');

    // Initially, store should not be updated (debounce)
    expect(store.searchQuery).toBe('');

    // Wait for debounce timeout (300ms)
    await new Promise(resolve => setTimeout(resolve, 350));

    // After debounce, store should be updated
    expect(store.searchQuery).toBe('yoga');
  });

  it('should update store when category is selected', async () => {
    await mountComponent();

    // Test store update directly
    store.toggleCategory('Music');

    // Store should be updated
    expect(store.selectedCategoryNames).toContain('Music');
  });

  it('should set correct date range when "This Week" button is clicked', async () => {
    await mountComponent();

    // Mock reloadWithFilters to prevent API calls
    const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

    // Find all mode buttons and select the first one (This Week)
    const modeButtons = wrapper!.findAll('.mode-btn');
    expect(modeButtons.length).toBe(3);
    const thisWeekButton = modeButtons[0];

    await thisWeekButton.trigger('click');
    await wrapper!.vm.$nextTick();

    // Store should have date range set
    expect(store.startDate).toBeTruthy();
    expect(store.endDate).toBeTruthy();

    // Verify dates are in correct format
    expect(store.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Verify button has active class
    expect(thisWeekButton.classes()).toContain('active');

    reloadSpy.mockRestore();
  });

  it('should set correct date range when "Next Week" button is clicked', async () => {
    await mountComponent();

    // Mock reloadWithFilters to prevent API calls
    const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

    // Find all mode buttons and select the second one (Next Week)
    const modeButtons = wrapper!.findAll('.mode-btn');
    expect(modeButtons.length).toBe(3);
    const nextWeekButton = modeButtons[1];

    await nextWeekButton.trigger('click');
    await wrapper!.vm.$nextTick();

    // Store should have date range set
    expect(store.startDate).toBeTruthy();
    expect(store.endDate).toBeTruthy();

    // Verify next week dates are valid ISO format
    expect(store.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Verify button has active class
    expect(nextWeekButton.classes()).toContain('active');

    reloadSpy.mockRestore();
  });

  it('should update store when manual date range is entered', async () => {
    await mountComponent();

    // Mock reloadWithFilters to prevent API calls
    const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

    // Date inputs should not be visible initially
    let startDateInput = wrapper!.find('input#start-date');
    expect(startDateInput.exists()).toBe(false);

    // Click Custom button to show date inputs
    const modeButtons = wrapper!.findAll('.mode-btn');
    const customButton = modeButtons[2];
    await customButton.trigger('click');
    await wrapper!.vm.$nextTick();

    // Now date inputs should be visible
    startDateInput = wrapper!.find('input#start-date');
    const endDateInput = wrapper!.find('input#end-date');

    expect(startDateInput.exists()).toBe(true);
    expect(endDateInput.exists()).toBe(true);
    expect(customButton.classes()).toContain('active');

    // Set manual dates
    await startDateInput.setValue('2025-11-15');
    await startDateInput.trigger('change');
    await wrapper!.vm.$nextTick();

    await endDateInput.setValue('2025-11-21');
    await endDateInput.trigger('change');
    await wrapper!.vm.$nextTick();

    // Store should be updated
    expect(store.startDate).toBe('2025-11-15');
    expect(store.endDate).toBe('2025-11-21');

    reloadSpy.mockRestore();
  });

  it('should clear all filters when "Clear all filters" button is clicked', async () => {
    // Set up some filters first
    store.setSearchQuery('test');
    store.setSelectedCategories(['Music', 'Arts']);
    store.setDateRange('2025-11-15', '2025-11-21');

    await mountComponent();

    // Mock reloadWithFilters to prevent API calls
    const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

    // Find clear all button
    const clearButton = wrapper!.find('button.clear-all-filters');
    expect(clearButton.exists()).toBe(true);

    await clearButton.trigger('click');
    await wrapper!.vm.$nextTick();

    // All filters should be cleared
    expect(store.searchQuery).toBe('');
    expect(store.selectedCategoryNames).toEqual([]);
    expect(store.startDate).toBeNull();
    expect(store.endDate).toBeNull();

    reloadSpy.mockRestore();
  });

  it('should show "Clear all filters" button only when filters are active', async () => {
    await mountComponent();

    // Mock reloadWithFilters to prevent API calls
    const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

    // Initially no filters, button should not be visible
    let clearButton = wrapper!.find('button.clear-all-filters');
    expect(clearButton.exists()).toBe(false);

    // Add a filter
    const searchInput = wrapper!.find('input[type="text"]');
    await searchInput.setValue('test');
    await new Promise(resolve => setTimeout(resolve, 350)); // Wait for debounce

    await wrapper!.vm.$nextTick();

    // Now button should be visible
    clearButton = wrapper!.find('button.clear-all-filters');
    expect(clearButton.exists()).toBe(true);

    reloadSpy.mockRestore();
  });

  it('should trigger reloadWithFilters when any filter changes', async () => {
    const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

    await mountComponent();

    // Change search
    const searchInput = wrapper!.find('input[type="text"]');
    await searchInput.setValue('test');
    await new Promise(resolve => setTimeout(resolve, 350));

    expect(reloadSpy).toHaveBeenCalled();

    reloadSpy.mockClear();

    // Click Custom button to show date inputs
    const modeButtons = wrapper!.findAll('.mode-btn');
    const customButton = modeButtons[2];
    await customButton.trigger('click');
    await wrapper!.vm.$nextTick();

    // Change date
    const startDateInput = wrapper!.find('input#start-date');
    await startDateInput.setValue('2025-11-15');
    await startDateInput.trigger('change');
    await wrapper!.vm.$nextTick();

    expect(reloadSpy).toHaveBeenCalled();

    reloadSpy.mockRestore();
  });

  it('should show/hide date inputs based on Custom button selection', async () => {
    await mountComponent();

    // Date inputs should not be visible initially
    let dateInputs = wrapper!.find('.date-inputs');
    expect(dateInputs.exists()).toBe(false);

    // Click Custom button
    const modeButtons = wrapper!.findAll('.mode-btn');
    const customButton = modeButtons[2];
    await customButton.trigger('click');
    await wrapper!.vm.$nextTick();

    // Date inputs should now be visible
    dateInputs = wrapper!.find('.date-inputs');
    expect(dateInputs.exists()).toBe(true);
    expect(customButton.classes()).toContain('active');

    // Click This Week button
    const thisWeekButton = modeButtons[0];
    await thisWeekButton.trigger('click');
    await wrapper!.vm.$nextTick();

    // Date inputs should be hidden again
    dateInputs = wrapper!.find('.date-inputs');
    expect(dateInputs.exists()).toBe(false);
    expect(thisWeekButton.classes()).toContain('active');
    expect(customButton.classes()).not.toContain('active');
  });

  it('should toggle off date filter when clicking active button', async () => {
    await mountComponent();

    // Mock reloadWithFilters to prevent API calls
    const reloadSpy = vi.spyOn(store, 'reloadWithFilters').mockResolvedValue();

    const modeButtons = wrapper!.findAll('.mode-btn');
    const thisWeekButton = modeButtons[0];

    // First click - activate This Week
    await thisWeekButton.trigger('click');
    await wrapper!.vm.$nextTick();

    expect(store.startDate).toBeTruthy();
    expect(store.endDate).toBeTruthy();
    expect(thisWeekButton.classes()).toContain('active');

    // Second click - toggle off (clear filter)
    await thisWeekButton.trigger('click');
    await wrapper!.vm.$nextTick();

    expect(store.startDate).toBeNull();
    expect(store.endDate).toBeNull();
    expect(thisWeekButton.classes()).not.toContain('active');

    reloadSpy.mockRestore();
  });
});
