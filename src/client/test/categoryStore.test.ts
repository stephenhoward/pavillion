import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCategoryStore } from '@/client/stores/categoryStore';
import { EventCategory } from '@/common/model/event_category';

describe('CategoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('addCategory', () => {
    it('should add a category to the store', () => {
      const store = useCategoryStore();
      const category = new EventCategory('category-1', 'calendar-123');
      category.addContent({
        language: 'en',
        name: 'Technology',
      });

      store.addCategory('calendar-123', category);

      expect(store.categories['calendar-123']).toHaveLength(1);
      expect(store.categories['calendar-123'][0]).toStrictEqual(category);
    });

    it('should create calendar array if it does not exist', () => {
      const store = useCategoryStore();
      const category = new EventCategory('category-1', 'new-calendar');

      store.addCategory('new-calendar', category);

      expect(store.categories['new-calendar']).toBeDefined();
      expect(store.categories['new-calendar']).toHaveLength(1);
    });
  });

  describe('updateCategory', () => {
    it('should update an existing category', () => {
      const store = useCategoryStore();
      const originalCategory = new EventCategory('category-1', 'calendar-123');
      originalCategory.addContent({
        language: 'en',
        name: 'Technology',
      });

      store.addCategory('calendar-123', originalCategory);

      const updatedCategory = new EventCategory('category-1', 'calendar-123');
      updatedCategory.addContent({
        language: 'en',
        name: 'Updated Technology',
      });

      store.updateCategory('calendar-123', updatedCategory);

      expect(store.categories['calendar-123']).toHaveLength(1);
      expect(store.categories['calendar-123'][0]).toStrictEqual(updatedCategory);
      expect(store.categories['calendar-123'][0].content('en').name).toBe('Updated Technology');
    });

    it('should add category if it does not exist', () => {
      const store = useCategoryStore();
      const category = new EventCategory('category-1', 'calendar-123');
      category.addContent({
        language: 'en',
        name: 'New Category',
      });

      store.updateCategory('calendar-123', category);

      expect(store.categories['calendar-123']).toHaveLength(1);
      expect(store.categories['calendar-123'][0]).toStrictEqual(category);
    });
  });

  describe('setCategoriesForCalendar', () => {
    it('should set categories for a calendar', () => {
      const store = useCategoryStore();
      const category1 = new EventCategory('category-1', 'calendar-123');
      const category2 = new EventCategory('category-2', 'calendar-123');
      const categories = [category1, category2];

      store.setCategoriesForCalendar('calendar-123', categories);

      expect(store.categories['calendar-123']).toHaveLength(2);
      expect(store.categories['calendar-123']).toStrictEqual(categories);
    });

    it('should replace existing categories', () => {
      const store = useCategoryStore();
      const oldCategory = new EventCategory('old-category', 'calendar-123');
      store.addCategory('calendar-123', oldCategory);

      const newCategories = [
        new EventCategory('category-1', 'calendar-123'),
        new EventCategory('category-2', 'calendar-123'),
      ];

      store.setCategoriesForCalendar('calendar-123', newCategories);

      expect(store.categories['calendar-123']).toHaveLength(2);
      expect(store.categories['calendar-123']).toStrictEqual(newCategories);
      expect(store.categories['calendar-123']).not.toContain(oldCategory);
    });
  });

  describe('removeCategory', () => {
    it('should remove a category by ID', () => {
      const store = useCategoryStore();
      const category1 = new EventCategory('category-1', 'calendar-123');
      const category2 = new EventCategory('category-2', 'calendar-123');

      store.addCategory('calendar-123', category1);
      store.addCategory('calendar-123', category2);

      expect(store.categories['calendar-123']).toHaveLength(2);

      store.removeCategory('calendar-123', 'category-1');

      expect(store.categories['calendar-123']).toHaveLength(1);
      expect(store.categories['calendar-123'][0]).toStrictEqual(category2);
    });

    it('should handle removing from non-existent calendar', () => {
      const store = useCategoryStore();

      // Should not throw error
      store.removeCategory('non-existent-calendar', 'category-1');

      expect(store.categories['non-existent-calendar']).toBeUndefined();
    });

    it('should handle removing non-existent category', () => {
      const store = useCategoryStore();
      const category = new EventCategory('category-1', 'calendar-123');
      store.addCategory('calendar-123', category);

      store.removeCategory('calendar-123', 'non-existent-category');

      expect(store.categories['calendar-123']).toHaveLength(1);
      expect(store.categories['calendar-123'][0]).toStrictEqual(category);
    });
  });
});
