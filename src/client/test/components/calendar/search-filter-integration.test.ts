import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import { mountComponent } from '@/client/test/lib/vue';
import SearchFilter from '@/client/components/logged_in/calendar/SearchFilter.vue';
import EventService from '@/client/service/event';
import CategoryService from '@/client/service/category';

/**
 * Integration Tests: SearchFilter Component
 *
 * Tests critical integration points for search and category filtering:
 * - URL parameters populate filter state (URL → State)
 * - Filter changes emit events with correct structure (State → API)
 * - Debouncing prevents excessive API calls
 */

const routes: RouteRecordRaw[] = [
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
];

const createWrapper = (props = {}, routeQuery = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  // Set initial route with query parameters
  router.push({
    name: 'calendar',
    params: { calendar: 'test-calendar' },
    query: routeQuery,
  });

  return mountComponent(SearchFilter, router, {
    props: {
      calendarId: 'test-calendar',
      ...props,
    },
  });
};

describe('SearchFilter Integration Tests', () => {
  let sandbox: sinon.SinonSandbox;
  let categoryServiceStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Mock CategoryService to prevent API calls
    categoryServiceStub = sandbox.stub(CategoryService.prototype, 'loadCategories');
    categoryServiceStub.resolves([
      {
        id: 'cat1',
        content: () => ({ name: 'Category 1' }),
      },
      {
        id: 'cat2',
        content: () => ({ name: 'Category 2' }),
      },
    ]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('URL Parameter to Filter State Flow', () => {
    it('should populate search field from URL search parameter', async () => {
      const wrapper = createWrapper(
        { initialFilters: { search: 'workshop', categories: [] } },
        { search: 'workshop' },
      );

      await nextTick();
      await vi.waitFor(() => wrapper.vm);

      const searchInput = wrapper.find('#event-search');
      expect(searchInput.element.value).toBe('workshop');
    });

    it('should select categories from URL categories parameter', async () => {
      const wrapper = createWrapper(
        { initialFilters: { search: '', categories: ['cat1', 'cat2'] } },
        { categories: 'cat1,cat2' },
      );

      await nextTick();
      await vi.waitFor(() => wrapper.vm);

      // Wait for categories to load
      await vi.waitFor(() => {
        return wrapper.findAll('.category-option').length > 0;
      }, { timeout: 1000 });

      const selectedCategories = wrapper.findAll('.category-option.selected');
      expect(selectedCategories.length).toBe(2);
    });

    it('should initialize both search and categories from URL parameters', async () => {
      const wrapper = createWrapper(
        { initialFilters: { search: 'conference', categories: ['cat1'] } },
        { search: 'conference', categories: 'cat1' },
      );

      await nextTick();
      await vi.waitFor(() => wrapper.vm);

      const searchInput = wrapper.find('#event-search');
      expect(searchInput.element.value).toBe('conference');

      // Wait for categories to load
      await vi.waitFor(() => {
        return wrapper.findAll('.category-option').length > 0;
      }, { timeout: 1000 });

      const selectedCategories = wrapper.findAll('.category-option.selected');
      expect(selectedCategories.length).toBe(1);
    });
  });

  describe('Filter State to Event Emission Flow', () => {
    it('should emit filtersChanged event with search parameter when user types', async () => {
      const wrapper = createWrapper();

      await nextTick();

      const searchInput = wrapper.find('#event-search');
      await searchInput.setValue('meeting');

      // Wait for debounce (300ms)
      await new Promise(resolve => setTimeout(resolve, 350));

      const emitted = wrapper.emitted('filtersChanged');
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toEqual({
        search: 'meeting',
      });
    });

    it('should emit filtersChanged event with categories when category selected', async () => {
      const wrapper = createWrapper();

      await nextTick();

      // Wait for categories to load
      await vi.waitFor(() => {
        return wrapper.findAll('.category-option').length > 0;
      }, { timeout: 1000 });

      const firstCategory = wrapper.findAll('.category-option')[0];
      await firstCategory.trigger('click');

      const emitted = wrapper.emitted('filtersChanged');
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toEqual({
        categories: ['cat1'],
      });
    });

    it('should emit filtersChanged with both search and categories', async () => {
      const wrapper = createWrapper();

      await nextTick();

      // Add search term
      const searchInput = wrapper.find('#event-search');
      await searchInput.setValue('workshop');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      // Wait for categories to load
      await vi.waitFor(() => {
        return wrapper.findAll('.category-option').length > 0;
      }, { timeout: 1000 });

      // Select category
      const firstCategory = wrapper.findAll('.category-option')[0];
      await firstCategory.trigger('click');

      const emitted = wrapper.emitted('filtersChanged');
      expect(emitted).toBeTruthy();

      // Find the last emission with both filters
      const lastEmission = emitted![emitted!.length - 1][0];
      expect(lastEmission).toHaveProperty('search', 'workshop');
      expect(lastEmission).toHaveProperty('categories');
      expect(lastEmission.categories).toContain('cat1');
    });
  });

  describe('Debouncing Behavior', () => {
    it('should debounce search input and not emit immediately', async () => {
      const wrapper = createWrapper();

      await nextTick();

      const searchInput = wrapper.find('#event-search');
      await searchInput.setValue('test');

      // Check emissions before debounce timeout
      const emittedBefore = wrapper.emitted('filtersChanged');
      expect(emittedBefore).toBeFalsy(); // Should not have emitted yet

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      const emittedAfter = wrapper.emitted('filtersChanged');
      expect(emittedAfter).toBeTruthy(); // Should have emitted after debounce
    });

    it('should reset debounce timer when user continues typing', async () => {
      const wrapper = createWrapper();

      await nextTick();

      const searchInput = wrapper.find('#event-search');

      // Type first character
      await searchInput.setValue('w');
      await new Promise(resolve => setTimeout(resolve, 150));

      // Type second character (should reset timer)
      await searchInput.setValue('wo');
      await new Promise(resolve => setTimeout(resolve, 150));

      // Type third character (should reset timer again)
      await searchInput.setValue('wor');

      // At this point, only 300ms total have passed but timer was reset
      // Check that no emission happened yet
      const emittedBefore = wrapper.emitted('filtersChanged');
      expect(emittedBefore).toBeFalsy();

      // Wait for full debounce from last keystroke
      await new Promise(resolve => setTimeout(resolve, 350));

      const emittedAfter = wrapper.emitted('filtersChanged');
      expect(emittedAfter).toBeTruthy();
      expect(emittedAfter![0][0]).toEqual({ search: 'wor' });
    });
  });

  describe('Clear Filters Behavior', () => {
    it('should emit empty filters when clear all is clicked', async () => {
      const wrapper = createWrapper(
        { initialFilters: { search: 'test', categories: ['cat1'] } },
      );

      await nextTick();
      await vi.waitFor(() => wrapper.vm);

      // Wait for clear button to appear
      await vi.waitFor(() => {
        return wrapper.find('.clear-all-filters').exists();
      }, { timeout: 1000 });

      const clearButton = wrapper.find('.clear-all-filters');
      await clearButton.trigger('click');

      const emitted = wrapper.emitted('filtersChanged');
      expect(emitted).toBeTruthy();

      // Should emit empty object (no filters)
      const lastEmission = emitted![emitted!.length - 1][0];
      expect(lastEmission).toEqual({});
    });

    it('should clear search field when clear search button clicked', async () => {
      const wrapper = createWrapper(
        { initialFilters: { search: 'test', categories: [] } },
      );

      await nextTick();

      const clearButton = wrapper.find('.clear-search');
      expect(clearButton.exists()).toBe(true);

      await clearButton.trigger('click');

      const searchInput = wrapper.find('#event-search');
      expect(searchInput.element.value).toBe('');

      const emitted = wrapper.emitted('filtersChanged');
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toEqual({});
    });
  });
});
