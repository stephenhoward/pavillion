import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import CategorySelector from '@/client/components/logged_in/calendar/category-selector.vue';
import CategoryService from '@/client/service/category';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';

const routes: RouteRecordRaw[] = [
  { path: '/event', component: {}, name: 'event' },
];

/**
 * Helper to create a test category with translatable content
 */
function createTestCategory(id: string, name: string): EventCategory {
  const category = new EventCategory(id, 'calendar-123');
  category.addContent(EventCategoryContent.fromObject({
    language: 'en',
    name: name,
  }));
  return category;
}

const createWrapper = (props = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  return mountComponent(CategorySelector, router, {
    props: {
      calendarId: 'calendar-123',
      selectedCategories: [],
      ...props,
    },
  });
};

describe('CategorySelector', () => {
  let wrapper: any;
  let mockLoadCategories: any;

  const testCategories = [
    createTestCategory('cat-1', 'Music'),
    createTestCategory('cat-2', 'Sports'),
    createTestCategory('cat-3', 'Arts'),
  ];

  beforeEach(() => {
    mockLoadCategories = vi.fn().mockResolvedValue(testCategories);
    vi.spyOn(CategoryService.prototype, 'loadCategories').mockImplementation(mockLoadCategories);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe('Initialization with string IDs', () => {
    it('should accept selectedCategories as an array of string IDs', async () => {
      wrapper = createWrapper({
        selectedCategories: ['cat-1', 'cat-3'],
      });

      await nextTick();
      await nextTick();

      // The toggle chips for cat-1 and cat-3 should be selected
      const chips = wrapper.findAll('.toggle-chip');
      expect(chips.length).toBe(3);

      // cat-1 (Music) should be selected
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      expect(musicChip?.attributes('aria-checked')).toBe('true');

      // cat-2 (Sports) should NOT be selected
      const sportsChip = chips.find((c: any) => c.text() === 'Sports');
      expect(sportsChip?.attributes('aria-checked')).toBe('false');

      // cat-3 (Arts) should be selected
      const artsChip = chips.find((c: any) => c.text() === 'Arts');
      expect(artsChip?.attributes('aria-checked')).toBe('true');
    });
  });

  describe('Late prop arrival (duplicate mode race condition)', () => {
    it('should show pre-selected chips when selectedCategories prop arrives after mount', async () => {
      // Simulate duplicate mode: component mounts with empty selection, then parent
      // finishes loading the source event and updates the prop
      wrapper = createWrapper({
        selectedCategories: [],
      });

      // Wait for initial mount and category loading to complete
      await nextTick();
      await nextTick();

      // Verify initially no chips are selected
      let chips = wrapper.findAll('.toggle-chip');
      expect(chips.length).toBe(3);
      for (const chip of chips) {
        expect(chip.attributes('aria-checked')).toBe('false');
      }

      // Simulate parent updating the prop after async event loading (duplicate mode)
      await wrapper.setProps({ selectedCategories: ['cat-1', 'cat-3'] });
      await nextTick();

      // cat-1 and cat-3 should now be selected
      chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      expect(musicChip?.attributes('aria-checked')).toBe('true');

      const sportsChip = chips.find((c: any) => c.text() === 'Sports');
      expect(sportsChip?.attributes('aria-checked')).toBe('false');

      const artsChip = chips.find((c: any) => c.text() === 'Arts');
      expect(artsChip?.attributes('aria-checked')).toBe('true');
    });
  });

  describe('Toggle emits string IDs', () => {
    it('should emit categoriesChanged with an array of string IDs when a category is toggled on', async () => {
      wrapper = createWrapper({
        selectedCategories: [],
      });

      await nextTick();
      await nextTick();

      // Click on the Music chip to toggle it on
      const chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      await musicChip?.trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted[0][0]).toEqual(['cat-1']);

      // Every element should be a string, not an object
      for (const id of emitted[0][0]) {
        expect(typeof id).toBe('string');
      }
    });

    it('should emit categoriesChanged with string IDs when toggling off a selected category', async () => {
      wrapper = createWrapper({
        selectedCategories: ['cat-1', 'cat-2'],
      });

      await nextTick();
      await nextTick();

      // Click on Music chip to toggle it off
      const chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      await musicChip?.trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      // Should now only contain cat-2
      expect(emitted[0][0]).toEqual(['cat-2']);

      for (const id of emitted[0][0]) {
        expect(typeof id).toBe('string');
      }
    });

    it('should emit an empty array when all categories are toggled off', async () => {
      wrapper = createWrapper({
        selectedCategories: ['cat-1'],
      });

      await nextTick();
      await nextTick();

      // Toggle off cat-1
      const chips = wrapper.findAll('.toggle-chip');
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      await musicChip?.trigger('click');

      const emitted = wrapper.emitted('categoriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted[0][0]).toEqual([]);
    });
  });

  describe('Backward compatibility with object IDs', () => {
    it('should also accept selectedCategories as an array of objects with .id', async () => {
      wrapper = createWrapper({
        selectedCategories: [{ id: 'cat-2' }],
      });

      await nextTick();
      await nextTick();

      const chips = wrapper.findAll('.toggle-chip');
      const sportsChip = chips.find((c: any) => c.text() === 'Sports');
      expect(sportsChip?.attributes('aria-checked')).toBe('true');

      // Others should not be selected
      const musicChip = chips.find((c: any) => c.text() === 'Music');
      expect(musicChip?.attributes('aria-checked')).toBe('false');
    });
  });
});
