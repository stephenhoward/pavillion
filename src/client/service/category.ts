import axios from 'axios';
import { EventCategory } from '@/common/model/event_category';
import { CategoryNotFoundError } from '@/common/exceptions/category';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { UnauthenticatedError, UnknownError, EmptyValueError } from '@/common/exceptions';
import { useCategoryStore } from '@/client/stores/categoryStore';
import ModelService from '@/client/service/models';

const errorMap = {
  CategoryNotFoundError,
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  UnauthenticatedError,
  UnknownError,
  EmptyValueError,
};

function handleError(error: unknown): never {
  console.error('Category service error:', error);

  // Type guard to ensure error is the expected shape
  if (error && typeof error === 'object' && 'response' in error &&
      error.response && typeof error.response === 'object' && 'data' in error.response) {

    const responseData = error.response.data as Record<string, unknown>;
    const errorName = responseData.errorName as string;

    if (errorName && errorName in errorMap) {
      const ErrorClass = errorMap[errorName as keyof typeof errorMap];
      throw new ErrorClass();
    }
  }

  throw new UnknownError();
}

export default class CategoryService {
  store: ReturnType<typeof useCategoryStore>;

  /**
   * Constructor that accepts an event store instance
   * @param store The event store to use (defaults to useEventStore())
   */
  constructor(store: ReturnType<typeof useCategoryStore> = useCategoryStore()) {
    this.store = store;
  }

  /**
   * Load all categories for a specific calendar
   * @param calendarId - The ID of the calendar
   * @returns Promise<Array<EventCategory>> The list of categories
   */
  async loadCategories(calendarId: string): Promise<Array<EventCategory>> {
    try {
      const categories = await ModelService.listModels(`/api/v1/calendars/${calendarId}/categories`);
      const calendarCategories = categories.map(event => EventCategory.fromObject(event));
      this.store.setCategoriesForCalendar(calendarId,calendarCategories);
      return calendarCategories;
    }
    catch (error) {
      console.error('Error loading calendar categories:', error);
      throw error;
    }
  }

  /**
   * Save a category (create new or update existing)
   * @param category - The category object with content for all languages
   * @returns Promise<EventCategoryModel> The saved category
   */
  async saveCategory(category: EventCategory): Promise<EventCategory> {
    const isNew = !category.id;
    const calendarId = category.calendarId;

    if (!calendarId) {
      throw new Error('Category must have a calendarId');
    }

    try {
      let savedCategory: EventCategory;
      const url = `/api/v1/calendars/${category.calendarId}/categories`;

      if (isNew) {
        const responseData = await ModelService.createModel(category, url);
        savedCategory = EventCategory.fromObject(responseData);
        this.store.addCategory(calendarId,savedCategory);
      }
      else {
        // Update existing category
        const responseData = await ModelService.updateModel(category, url);
        savedCategory = EventCategory.fromObject(responseData);
        this.store.updateCategory(calendarId,savedCategory);
      }

      return savedCategory;
    }
    catch (error: unknown) {
      handleError(error);
    }
  }

  /**
   * Get a specific category by ID
   * @param categoryId - The ID of the category
   * @returns Promise<EventCategoryModel> The category
   */
  async getCategory(categoryId: string): Promise<EventCategory> {
    try {
      const response = await axios.get(`/api/v1/categories/${categoryId}`);
      return EventCategory.fromObject(response.data);
    }
    catch (error: unknown) {
      handleError(error);
    }
  }

  /**
   * Delete a category
   * @param categoryId - The ID of the category to delete
   * @param calendarId - The ID of the calendar (optional, for store cleanup)
   * @returns Promise<void>
   */
  async deleteCategory(categoryId: string, calendarId?: string): Promise<void> {
    try {
      await axios.delete(`/api/v1/categories/${categoryId}`);

      // If calendarId is provided, remove from store
      if (calendarId) {
        this.store.removeCategory(calendarId, categoryId);
      }
    }
    catch (error: unknown) {
      handleError(error);
    }
  }

  /**
   * Get all categories assigned to a specific event
   * @param eventId - The ID of the event
   * @returns Promise<Array<EventCategoryModel>> The list of categories assigned to the event
   */
  async getEventCategories(eventId: string): Promise<Array<EventCategory>> {
    try {
      const encodedEventId = encodeURIComponent(eventId);
      const categories = await ModelService.listModels(`/api/v1/events/${encodedEventId}/categories`);
      const eventCategories = categories.map(event => EventCategory.fromObject(event));
      return eventCategories;
    }
    catch (error) {
      console.error('Error loading event categories:', error);
      throw error;
    }
  }

  /**
   * Assign a category to an event
   * @param eventId - The ID of the event
   * @param categoryId - The ID of the category
   * @returns Promise<void>
   */
  async assignCategoryToEvent(eventId: string, categoryId: string): Promise<void> {
    try {
      const encodedEventId = encodeURIComponent(eventId);
      await axios.post(`/api/v1/events/${encodedEventId}/categories/${categoryId}`);
    }
    catch (error: unknown) {
      handleError(error);
    }
  }

  /**
   * Assign multiple categories to an event
   * @param eventId - The ID of the event
   * @param categoryIds - Array of category IDs to assign
   * @returns Promise<void>
   */
  async assignCategoriesToEvent(eventId: string, categoryIds: string[]): Promise<void> {
    try {
      // First, get current categories to compare
      const currentCategories = await this.getEventCategories(eventId);
      const currentCategoryIds = currentCategories.map(cat => cat.id);

      // Determine which categories to add and which to remove
      const categoriesToAdd = categoryIds.filter(id => !currentCategoryIds.includes(id));
      const categoriesToRemove = currentCategoryIds.filter(id => !categoryIds.includes(id));

      // Add new categories
      for (const categoryId of categoriesToAdd) {
        await this.assignCategoryToEvent(eventId, categoryId);
      }

      // Remove old categories
      for (const categoryId of categoriesToRemove) {
        await this.unassignCategoryFromEvent(eventId, categoryId);
      }
    }
    catch (error: unknown) {
      handleError(error);
    }
  }

  /**
   * Unassign a category from an event
   * @param eventId - The ID of the event
   * @param categoryId - The ID of the category
   * @returns Promise<void>
   */
  async unassignCategoryFromEvent(eventId: string, categoryId: string): Promise<void> {
    try {
      const encodedEventId = encodeURIComponent(eventId);
      await axios.delete(`/api/v1/events/${encodedEventId}/categories/${categoryId}`);
    }
    catch (error: unknown) {
      handleError(error);
    }
  }
}
