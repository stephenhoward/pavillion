import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventEntity } from '@/server/calendar/entity/event';
import { CalendarNotFoundError, EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  CategoryNotFoundError,
  CategoryAssignmentNotFoundError,
  CategoryAlreadyAssignedError,
  CategoryEventCalendarMismatchError,
  CategoryUpdateFailedError,
} from '@/common/exceptions/category';
import CalendarService from './calendar';

/**
 * Service for managing event categories within calendars.
 * Handles CRUD operations for categories with multi-language support,
 * and manages category assignments to events.
 */
class CategoryService {
  constructor(private calendarService?: CalendarService) {
    // calendarService is optional for backward compatibility but recommended for proper dependency injection
  }

  /**
   * Create a new category for a calendar
   */
  async createCategory(account: Account, calendarId: string, categoryData: Record<string,any>): Promise<EventCategory> {
    // Get calendar and verify ownership/editor permissions
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Create the category entity
    const categoryEntity = EventCategoryEntity.build({
      id: uuidv4(),
      calendar_id: calendarId,
    });
    await categoryEntity.save();

    const category = categoryEntity.toModel();

    if ( categoryData.content ) {
      for( let [language,content] of Object.entries(categoryData.content) ) {
        category.addContent(await this.createCategoryContent(category.id, language, content as Record<string,any>));
      }
    }

    return category;
  }

  /**
   * Create category content for a specific language
   */
  private async createCategoryContent(categoryId: string, language: string, content: Record<string, any>): Promise<EventCategoryContent> {
    // Create the category content
    const contentEntity = EventCategoryContentEntity.build({
      category_id: categoryId,
      language: language,
      name: content.name,
    });
    await contentEntity.save();

    return contentEntity.toModel();
  }


  /**
   * Get all categories for a calendar
   */
  async getCategories(calendarId: string): Promise<EventCategory[]> {
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
  async getCategory(categoryId: string): Promise<EventCategory | null> {
    const category = await EventCategoryEntity.findByPk(categoryId, {
      include: [EventCategoryContentEntity],
    });

    return category ? category.toModel() : null;
  }

  /**
   * Update a category with new data
   */
  async updateCategory(account: Account, categoryId: string, categoryData: Record<string,any>): Promise<EventCategory> {
    // Get category to verify it exists
    const category = await this.getCategory(categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }

    // Get calendar and verify ownership/editor permissions
    const calendar = await this.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Handle content updates
    if (categoryData.content) {
      for (let [language, content] of Object.entries(categoryData.content)) {
        let contentEntity = await EventCategoryContentEntity.findOne({
          where: { category_id: categoryId, language: language },
        });

        if (contentEntity) {
          if (!content) {
            // Delete content if null/undefined is passed
            await contentEntity.destroy();
            continue;
          }

          let c = content as Record<string,any>;

          if (!c.name || Object.keys(c).length === 0) {
            // Delete content if empty or no name
            await contentEntity.destroy();
            continue;
          }

          // Update existing content
          contentEntity.name = c.name;
          await contentEntity.save();
        }
        else {
          if (!content) {
            // Skip if no content to create
            continue;
          }

          let c = content as Record<string,any>;

          if (c.name && Object.keys(c).length > 0) {
            // Create new content for this language
            await this.createCategoryContent(categoryId, language, c);
          }
        }
      }
    }

    // Return updated category
    const updatedCategory = await this.getCategory(categoryId);
    if (!updatedCategory) {
      throw new CategoryUpdateFailedError();
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
      throw new CategoryNotFoundError();
    }

    // Get calendar and verify ownership/editor permissions
    const calendar = await this.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
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

  /**
   * Assign a category to an event
   */
  async assignCategoryToEvent(account: Account, eventId: string, categoryId: string): Promise<EventCategoryAssignmentModel> {
    // Get the category to verify it exists and get calendar info
    const category = await this.getCategory(categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }

    // Get the event to verify it exists and matches the calendar
    const event = await EventEntity.findByPk(eventId);
    if (!event) {
      throw new EventNotFoundError();
    }

    // Verify the event belongs to the same calendar as the category
    if (event.calendar_id !== category.calendarId) {
      throw new CategoryEventCalendarMismatchError();
    }

    // Get calendar and verify permissions
    const calendar = await this.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Check if assignment already exists
    const existingAssignment = await EventCategoryAssignmentEntity.findOne({
      where: {
        event_id: eventId,
        category_id: categoryId,
      },
    });

    if (existingAssignment) {
      throw new CategoryAlreadyAssignedError();
    }

    // Create the assignment
    const assignmentEntity = EventCategoryAssignmentEntity.build({
      id: uuidv4(),
      event_id: eventId,
      category_id: categoryId,
    });
    await assignmentEntity.save();

    return assignmentEntity.toModel();
  }

  /**
   * Remove a category assignment from an event
   */
  async unassignCategoryFromEvent(account: Account, eventId: string, categoryId: string): Promise<void> {
    // Get the category to verify it exists and get calendar info
    const category = await this.getCategory(categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }

    // Get the event to verify it exists
    const event = await EventEntity.findByPk(eventId);
    if (!event) {
      throw new EventNotFoundError();
    }

    // Verify the event belongs to the same calendar as the category
    if (event.calendar_id !== category.calendarId) {
      throw new CategoryEventCalendarMismatchError();
    }

    // Get calendar and verify permissions
    const calendar = await this.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Find and delete the assignment
    const deletedCount = await EventCategoryAssignmentEntity.destroy({
      where: {
        event_id: eventId,
        category_id: categoryId,
      },
    });

    if (deletedCount === 0) {
      throw new CategoryAssignmentNotFoundError();
    }
  }

  /**
   * Get all categories assigned to an event
   */
  async getEventCategories(eventId: string): Promise<EventCategory[]> {
    const assignments = await EventCategoryAssignmentEntity.findAll({
      where: { event_id: eventId },
      include: [{
        model: EventCategoryEntity,
        include: [EventCategoryContentEntity],
      }],
    });

    return assignments.map(assignment => assignment.category.toModel());
  }

  /**
   * Get all events assigned to a category
   */
  async getCategoryEvents(categoryId: string): Promise<string[]> {
    const assignments = await EventCategoryAssignmentEntity.findAll({
      where: { category_id: categoryId },
      attributes: ['event_id'],
    });

    return assignments.map(assignment => assignment.event_id);
  }

  /**
   * Get a calendar by ID - internal helper method
   */
  private async getCalendar(id: string): Promise<import('@/common/model/calendar').Calendar | null> {
    if (this.calendarService) {
      return await this.calendarService.getCalendar(id);
    }

    // Fallback to direct entity access if no service injected
    const { CalendarEntity } = await import('@/server/calendar/entity/calendar');
    const calendarEntity = await CalendarEntity.findByPk(id);
    return calendarEntity ? calendarEntity.toModel() : null;
  }

  /**
   * Check if a user can modify a calendar - internal helper method
   */
  private async userCanModifyCalendar(account: Account, calendar: import('@/common/model/calendar').Calendar): Promise<boolean> {
    if (this.calendarService) {
      return await this.calendarService.userCanModifyCalendar(account, calendar);
    }

    // Fallback to direct implementation if no service injected
    if (account.hasRole('admin')) {
      return true;
    }

    // Import CalendarEditorEntity dynamically to avoid circular dependency
    const { CalendarEditorEntity } = await import('@/server/calendar/entity/calendar_editor');
    const { CalendarEntity } = await import('@/server/calendar/entity/calendar');

    // Check if user owns the calendar
    const calendarEntity = await CalendarEntity.findByPk(calendar.id);
    if (calendarEntity && calendarEntity.account_id === account.id) {
      return true;
    }

    // Check if user has editor access
    const editorRelationship = await CalendarEditorEntity.findOne({
      where: {
        calendar_id: calendar.id,
        account_id: account.id,
      },
    });

    return editorRelationship !== null;
  }
}

export default CategoryService;
