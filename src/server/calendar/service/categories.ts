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
} from '@/common/exceptions/category';
import CalendarService from './calendar';
import db from '@/server/common/entity/db';

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
   * @param categoryId - The ID of the category to retrieve
   * @param calendarId - Optional calendar ID to verify category belongs to calendar
   * @throws CategoryNotFoundError if category doesn't exist or doesn't belong to the specified calendar
   */
  async getCategory(categoryId: string, calendarId?: string): Promise<EventCategory> {
    const category = await EventCategoryEntity.findByPk(categoryId, {
      include: [EventCategoryContentEntity],
    });

    if (!category) {
      throw new CategoryNotFoundError();
    }

    // Verify category belongs to the specified calendar if calendarId is provided
    if (calendarId && category.calendar_id !== calendarId) {
      throw new CategoryNotFoundError();
    }

    return category.toModel();
  }

  /**
   * Update a category with new data
   * @param account - The account performing the update
   * @param categoryId - The ID of the category to update
   * @param categoryData - The data to update
   * @param calendarId - Optional calendar ID to verify category belongs to calendar
   * @throws CategoryNotFoundError if category doesn't exist or doesn't belong to the specified calendar
   */
  async updateCategory(account: Account, categoryId: string, categoryData: Record<string,any>, calendarId?: string): Promise<EventCategory> {
    // Get category to verify it exists and verify calendar match
    const category = await this.getCategory(categoryId, calendarId);

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
    const updatedCategory = await this.getCategory(categoryId, calendarId);
    return updatedCategory;
  }

  /**
   * Delete a category and all its content
   * @param account - The account performing the deletion
   * @param categoryId - The ID of the category to delete
   * @param calendarId - Optional calendar ID to verify category belongs to calendar
   * @throws CategoryNotFoundError if category doesn't exist or doesn't belong to the specified calendar
   */
  async deleteCategory(account: Account, categoryId: string, calendarId?: string): Promise<void> {
    // Get category to verify it exists and verify calendar match
    const category = await this.getCategory(categoryId, calendarId);

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
        as: 'category', // Required because association uses alias (see event.ts line 241)
        include: [EventCategoryContentEntity],
      }],
    });

    return assignments.map(assignment => assignment.category.toModel());
  }

  /**
   * Set categories for an event (replaces all existing assignments)
   */
  async setCategoriesForEvent(account: Account, eventId: string, categoryIds: string[]): Promise<void> {
    // Get the event to verify it exists
    const event = await EventEntity.findByPk(eventId);
    if (!event) {
      throw new EventNotFoundError();
    }

    // Get calendar and verify permissions
    const calendar = await this.getCalendar(event.calendar_id);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Verify all categories exist and belong to the same calendar
    if (categoryIds.length > 0) {
      const categories = await EventCategoryEntity.findAll({
        where: { id: categoryIds },
      });

      if (categories.length !== categoryIds.length) {
        throw new CategoryNotFoundError();
      }

      // Verify all categories belong to the event's calendar
      for (const category of categories) {
        if (category.calendar_id !== event.calendar_id) {
          throw new CategoryEventCalendarMismatchError();
        }
      }
    }

    // Wrap delete-then-create in a transaction to ensure atomicity
    const transaction = await db.transaction();

    try {
      // Remove all existing assignments
      await EventCategoryAssignmentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // Create new assignments
      for (const categoryId of categoryIds) {
        await EventCategoryAssignmentEntity.create({
          id: uuidv4(),
          event_id: eventId,
          category_id: categoryId,
        }, { transaction });
      }

      await transaction.commit();
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Get all events assigned to a category
   * @param categoryId - The ID of the category
   * @param calendarId - Optional calendar ID to verify category belongs to calendar
   * @throws CategoryNotFoundError if category doesn't exist or doesn't belong to the specified calendar
   */
  async getCategoryEvents(categoryId: string, calendarId?: string): Promise<string[]> {
    // Verify category exists and belongs to calendar if calendarId provided
    if (calendarId) {
      await this.getCategory(categoryId, calendarId);
    }

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
