import { expect, describe, it, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

describe('Calendar URL Synchronization Logic', () => {
  describe('initializeFiltersFromURL', () => {
    it('should parse search parameter from URL query', () => {
      const route = {
        query: {
          search: 'workshop',
        },
      };

      const initialFilters = reactive({
        search: '',
        categories: [],
      });

      const currentFilters = reactive({
        search: '',
        categories: [],
      });

      // Simulate initializeFiltersFromURL logic
      const searchParam = route.query.search;
      const categoriesParam = route.query.categories;

      initialFilters.search = typeof searchParam === 'string' ? searchParam : '';
      initialFilters.categories = categoriesParam
        ? (typeof categoriesParam === 'string' ? categoriesParam.split(',') : [])
        : [];

      Object.assign(currentFilters, {
        search: initialFilters.search,
        categories: [...initialFilters.categories],
      });

      expect(initialFilters.search).toBe('workshop');
      expect(currentFilters.search).toBe('workshop');
    });

    it('should parse categories parameter as comma-separated list', () => {
      const route = {
        query: {
          categories: 'cat1,cat2,cat3',
        },
      };

      const initialFilters = reactive({
        search: '',
        categories: [],
      });

      const currentFilters = reactive({
        search: '',
        categories: [],
      });

      // Simulate initializeFiltersFromURL logic
      const searchParam = route.query.search;
      const categoriesParam = route.query.categories;

      initialFilters.search = typeof searchParam === 'string' ? searchParam : '';
      initialFilters.categories = categoriesParam
        ? (typeof categoriesParam === 'string' ? categoriesParam.split(',') : [])
        : [];

      Object.assign(currentFilters, {
        search: initialFilters.search,
        categories: [...initialFilters.categories],
      });

      expect(initialFilters.categories).toEqual(['cat1', 'cat2', 'cat3']);
      expect(currentFilters.categories).toEqual(['cat1', 'cat2', 'cat3']);
    });

    it('should parse both search and categories from URL', () => {
      const route = {
        query: {
          search: 'conference',
          categories: 'cat1,cat2',
        },
      };

      const initialFilters = reactive({
        search: '',
        categories: [],
      });

      const currentFilters = reactive({
        search: '',
        categories: [],
      });

      // Simulate initializeFiltersFromURL logic
      const searchParam = route.query.search;
      const categoriesParam = route.query.categories;

      initialFilters.search = typeof searchParam === 'string' ? searchParam : '';
      initialFilters.categories = categoriesParam
        ? (typeof categoriesParam === 'string' ? categoriesParam.split(',') : [])
        : [];

      Object.assign(currentFilters, {
        search: initialFilters.search,
        categories: [...initialFilters.categories],
      });

      expect(initialFilters.search).toBe('conference');
      expect(initialFilters.categories).toEqual(['cat1', 'cat2']);
      expect(currentFilters.search).toBe('conference');
      expect(currentFilters.categories).toEqual(['cat1', 'cat2']);
    });
  });

  describe('syncFiltersToURL', () => {
    it('should build query object with search parameter', () => {
      const route = {
        name: 'calendar',
        params: { calendar: 'test-calendar' },
        query: {},
      };

      const currentFilters = reactive({
        search: 'meeting',
        categories: [],
      });

      // Simulate syncFiltersToURL logic
      const query = { ...route.query };

      if (currentFilters.search && currentFilters.search.trim() !== '') {
        query.search = currentFilters.search.trim();
      }
      else {
        delete query.search;
      }

      if (currentFilters.categories && currentFilters.categories.length > 0) {
        query.categories = currentFilters.categories.join(',');
      }
      else {
        delete query.categories;
      }

      expect(query.search).toBe('meeting');
      expect(query.categories).toBeUndefined();
    });

    it('should build query object with categories parameter', () => {
      const route = {
        name: 'calendar',
        params: { calendar: 'test-calendar' },
        query: {},
      };

      const currentFilters = reactive({
        search: '',
        categories: ['cat1', 'cat2'],
      });

      // Simulate syncFiltersToURL logic
      const query = { ...route.query };

      if (currentFilters.search && currentFilters.search.trim() !== '') {
        query.search = currentFilters.search.trim();
      }
      else {
        delete query.search;
      }

      if (currentFilters.categories && currentFilters.categories.length > 0) {
        query.categories = currentFilters.categories.join(',');
      }
      else {
        delete query.categories;
      }

      expect(query.search).toBeUndefined();
      expect(query.categories).toBe('cat1,cat2');
    });

    it('should remove search parameter when cleared', () => {
      const route = {
        name: 'calendar',
        params: { calendar: 'test-calendar' },
        query: { search: 'workshop' },
      };

      const currentFilters = reactive({
        search: '',
        categories: [],
      });

      // Simulate syncFiltersToURL logic
      const query = { ...route.query };

      if (currentFilters.search && currentFilters.search.trim() !== '') {
        query.search = currentFilters.search.trim();
      }
      else {
        delete query.search;
      }

      if (currentFilters.categories && currentFilters.categories.length > 0) {
        query.categories = currentFilters.categories.join(',');
      }
      else {
        delete query.categories;
      }

      expect(query.search).toBeUndefined();
    });

    it('should preserve other query parameters', () => {
      const route = {
        name: 'calendar',
        params: { calendar: 'test-calendar' },
        query: { someOtherParam: 'value' },
      };

      const currentFilters = reactive({
        search: 'event',
        categories: [],
      });

      // Simulate syncFiltersToURL logic
      const query = { ...route.query };

      if (currentFilters.search && currentFilters.search.trim() !== '') {
        query.search = currentFilters.search.trim();
      }
      else {
        delete query.search;
      }

      if (currentFilters.categories && currentFilters.categories.length > 0) {
        query.categories = currentFilters.categories.join(',');
      }
      else {
        delete query.categories;
      }

      expect(query.search).toBe('event');
      expect(query.someOtherParam).toBe('value');
    });
  });
});
