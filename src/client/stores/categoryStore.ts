import { defineStore } from 'pinia';
import { EventCategory } from '@/common/model/event_category';

export const useCategoryStore = defineStore('categories', {
  state: () => {
    return {
      categories: {} as Record<string,EventCategory[]>,
    };
  },
  actions: {
    /**
     * Adds a new calendar category to the store.
     *
     * @param {string} calendarId - The ID of the calendar to which the category belongs
     * @param {EventCategory} category - The category to add to the store
     */
    addCategory(calendarId: string, category: EventCategory) {
      if (!this.categories[calendarId]) {
        this.categories[calendarId] = [];
      }
      this.categories[calendarId].push(category);
    },

    /**
     * Updates an existing category in the store or adds it if not found.
     *
     * @param {string} calendarId - The ID of the calendar to which the category belongs
     * @param {EventCategory} category - The category to update or add
     */
    updateCategory(calendarId: string, category: EventCategory) {
      if (!this.categories[calendarId]) {
        this.categories[calendarId] = [];
      }
      const index = this.categories[calendarId].findIndex((e: EventCategory) => e.id === category.id );
      if ( index >= 0 ) {
        this.categories[calendarId][index] = category;
      }
      else {
        this.addCategory(calendarId, category);
      }
    },
    /**
     * Set categories in the store
     * @param calendarId - The ID of the calendar to which the categories belong
     * @param categories - The categories to set in the store
     */
    setCategoriesForCalendar(calendarId: string, categories: EventCategory[]) {
      this.categories[calendarId] = categories;
    },

    /**
     * Remove a category from the store
     * @param calendarId - The ID of the calendar to which the category belongs
     * @param categoryId - The ID of the category to remove
     */
    removeCategory(calendarId: string, categoryId: string) {
      if (this.categories[calendarId]) {
        this.categories[calendarId] = this.categories[calendarId].filter(
          (category: EventCategory) => category.id !== categoryId,
        );
      }
    },
  },
});
