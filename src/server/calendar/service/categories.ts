import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { EventCategoryModel } from '@/common/model/event_category';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import CalendarService from './calendar';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';

/**
 * Service for managing event categories within calendars.
 * Handles CRUD operations for categories with multi-language support.
 */
class CategoryService {
  private calendarService: CalendarService;
  constructor(calendarService: CalendarService) {
    this.calendarService = calendarService;
  }

  /**
   * Create a new category for a calendar
   */
  async createCategory(account: Account, calendarId: string, categoryData: {
    name: string;
    language: string;
  }): Promise<EventCategoryModel> {
    // Get calendar and verify ownership/editor permissions
    const calendar = await this.calendarService.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new Error('Permission denied');
    }

    // Create the category entity
    const categoryEntity = EventCategoryEntity.build({
      id: uuidv4(),
      calendar_id: calendarId,
    });
    await categoryEntity.save();

    // Create the category content
    const contentEntity = EventCategoryContentEntity.build({
      category_id: categoryEntity.id,
      language: categoryData.language,
      name: categoryData.name,
    });
    await contentEntity.save();

    categoryEntity.content = [contentEntity]; // Attach content for toModel conversion

    return categoryEntity.toModel();
  }

  /**
   * Get all categories for a calendar
   */
  async getCategories(calendarId: string): Promise<EventCategoryModel[]> {
    const categories = await EventCategoryEntity.findAll({
      where: { calendar_id: calendarId },
      include: [EventCategoryContentEntity],
      order: [['created_at', 'ASC']],
    });

    return categories.map(category => category.toModel());
  }

  /**
   * Get a specific category by ID
   */
  async getCategory(categoryId: string): Promise<EventCategoryModel | null> {
    const category = await EventCategoryEntity.findByPk(categoryId, {
      include: [EventCategoryContentEntity],
    });

    return category ? category.toModel() : null;
  }

  /**
   * Update a category's content for a specific language
   */
  async updateCategory(account: Account, categoryId: string, updateData: {
    name: string;
    language: string;
  }): Promise<EventCategoryModel> {
    // Get category to verify it exists
    const category = await this.getCategory(categoryId);
    if (!category) {
      throw new Error('Category not found');
    }

    // Get calendar and verify ownership/editor permissions
    const calendar = await this.calendarService.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new Error('Permission denied');
    }

    // Find existing content for this language
    let contentEntity = await EventCategoryContentEntity.findOne({
      where: {
        category_id: categoryId,
        language: updateData.language,
      },
    });

    if (contentEntity) {
      // Update existing content
      contentEntity.name = updateData.name;
      await contentEntity.save();
    }
    else {
      // Create new content for this language
      const newContentEntity = EventCategoryContentEntity.build({
        category_id: categoryId,
        language: updateData.language,
        name: updateData.name,
      });
      await newContentEntity.save();
    }

    // Return updated category
    const updatedCategory = await this.getCategory(categoryId);
    if (!updatedCategory) {
      throw new Error('Failed to retrieve updated category');
    }

    return updatedCategory;
  }

  /**
   * Delete a category and all its content
   */
  async deleteCategory(account: Account, categoryId: string): Promise<void> {
    // Get category to verify it exists
    const category = await this.getCategory(categoryId);
    if (!category) {
      throw new Error('Category not found');
    }

    // Get calendar and verify ownership/editor permissions
    const calendar = await this.calendarService.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new Error('Permission denied');
    }

    // Delete all content first (due to foreign key constraints)
    await EventCategoryContentEntity.destroy({
      where: { category_id: categoryId },
    });

    // Delete the category
    await EventCategoryEntity.destroy({
      where: { id: categoryId },
    });
  }
}

export default CategoryService;
