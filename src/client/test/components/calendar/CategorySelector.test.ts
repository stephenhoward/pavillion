import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createRouter, createWebHistory, Router } from 'vue-router';
import { createPinia, Pinia } from 'pinia';
import CategorySelector from '@/client/components/logged_in/calendar/CategorySelector.vue';
import { EventCategory } from '@/common/model/event_category';
import { mountComponent } from '@/client/test/lib/vue';

/**
 * Create a mock EventCategory with content
 */
function createMockCategory(id: string, calendarId: string, name: string): EventCategory {
  const category = new EventCategory(id, calendarId);
  category.addContent({ language: 'en', name });
  return category;
}

const CALENDAR_ID = 'calendar-123';

function buildMockCategories(): EventCategory[] {
  return [
    createMockCategory('cat-aaa-111', CALENDAR_ID, 'Music'),
    createMockCategory('cat-bbb-222', CALENDAR_ID, 'Sports'),
    createMockCategory('cat-ccc-333', CALENDAR_ID, 'Art'),
  ];
}

// Mock CategoryService
vi.mock('@/client/service/category', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadCategories: vi.fn().mockImplementation(() => Promise.resolve(buildMockCategories())),
  })),
}));

let router: Router;
let pinia: Pinia;

beforeEach(async () => {
  router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/', component: { template: '<div/>' } }],
  });
  await router.push('/');
  await router.isReady();
  pinia = createPinia();
});

describe('CategorySelector', () => {

  describe('categoriesChanged emit', () => {

    it('should emit an array of string IDs when a category is toggled on', async () => {
      const wrapper = mountComponent(CategorySelector, router, {
        pinia,
        props: {
          calendarId: CALENDAR_ID,
          selectedCategories: [],
        },
      });

      await flushPromises();

      // Find the toggle chips (buttons with role="switch")
      const chips = wrapper.findAll('button[role="switch"]');
      expect(chips.length).toBe(3);

      // Click the first category chip ("Music")
      await chips[0].trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted!.length).toBe(1);

      const payload = emitted![0][0] as string[];
      // The payload should be an array of string IDs, not objects
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toEqual(['cat-aaa-111']);
      // Each element must be a string, not an object
      payload.forEach((item) => {
        expect(typeof item).toBe('string');
      });
    });

    it('should emit multiple string IDs when multiple categories are toggled', async () => {
      const wrapper = mountComponent(CategorySelector, router, {
        pinia,
        props: {
          calendarId: CALENDAR_ID,
          selectedCategories: [],
        },
      });

      await flushPromises();

      const chips = wrapper.findAll('button[role="switch"]');
      expect(chips.length).toBe(3);

      // Toggle first and third categories
      await chips[0].trigger('click');
      await chips[2].trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted!.length).toBe(2);

      // Second emit should have both IDs
      const payload = emitted![1][0] as string[];
      expect(payload).toEqual(['cat-aaa-111', 'cat-ccc-333']);
      payload.forEach((item) => {
        expect(typeof item).toBe('string');
      });
    });

    it('should remove an ID when a selected category is toggled off', async () => {
      const wrapper = mountComponent(CategorySelector, router, {
        pinia,
        props: {
          calendarId: CALENDAR_ID,
          selectedCategories: ['cat-aaa-111', 'cat-bbb-222'],
        },
      });

      await flushPromises();

      const chips = wrapper.findAll('button[role="switch"]');
      expect(chips.length).toBe(3);

      // Toggle off the first category
      await chips[0].trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();

      const payload = emitted![0][0] as string[];
      expect(payload).toEqual(['cat-bbb-222']);
      payload.forEach((item) => {
        expect(typeof item).toBe('string');
      });
    });
  });

  describe('selectedCategories prop initialization', () => {

    it('should accept an array of string IDs as the selectedCategories prop', async () => {
      const wrapper = mountComponent(CategorySelector, router, {
        pinia,
        props: {
          calendarId: CALENDAR_ID,
          selectedCategories: ['cat-aaa-111', 'cat-ccc-333'],
        },
      });

      await flushPromises();

      // The first and third chips should be selected (aria-checked="true")
      const chips = wrapper.findAll('button[role="switch"]');
      expect(chips.length).toBe(3);
      expect(chips[0].attributes('aria-checked')).toBe('true');
      expect(chips[1].attributes('aria-checked')).toBe('false');
      expect(chips[2].attributes('aria-checked')).toBe('true');
    });
  });
});
