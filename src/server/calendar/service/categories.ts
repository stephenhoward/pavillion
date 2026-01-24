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
import { QueryTypes } from 'sequelize';

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
    // Get category to verify it exists (without calendar validation)
    const category = await this.getCategory(categoryId);

    // Verify category belongs to the specified calendar if calendarId is provided
    if (calendarId && category.calendarId !== calendarId) {
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
    const updatedCategory = await this.getCategory(categoryId, calendarId);
    return updatedCategory;
  }

  /**
   * Delete a category with optional migration or removal of event assignments
   * @param account - The account performing the deletion
   * @param categoryId - The ID of the category to delete
   * @param calendarId - Optional calendar ID to verify category belongs to calendar
   * @param action - "remove" to remove assignments, "migrate" to migrate to target category
   * @param targetCategoryId - Required when action is "migrate"
   * @returns Number of affected events
   * @throws CategoryNotFoundError if category doesn't exist or doesn't belong to the specified calendar
   */
  async deleteCategory(
    account: Account,
    categoryId: string,
    calendarId?: string,
    action?: 'remove' | 'migrate',
    targetCategoryId?: string,
  ): Promise<number> {
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

    // If migrate action, validate target category exists
    if (action === 'migrate') {
      if (!targetCategoryId) {
        throw new Error('Target category ID is required for migrate action');
      }
      // Verify target category exists and belongs to same calendar
      await this.getCategory(targetCategoryId, category.calendarId);
    }

    const transaction = await db.transaction();
    let affectedEventCount = 0;

    try {
      if (action === 'migrate' && targetCategoryId) {
        // Migration: Update all assignments to point to target category
        const [updateCount] = await EventCategoryAssignmentEntity.update(
          { category_id: targetCategoryId },
          {
            where: { category_id: categoryId },
            transaction,
          },
        );
        affectedEventCount = updateCount;

        // Remove any duplicate assignments (events that now have both old and new category)
        // This can happen if an event was already assigned to the target category
        await db.query(
          `DELETE FROM event_category_assignments
           WHERE id IN (
             SELECT a1.id
             FROM event_category_assignments a1
             INNER JOIN event_category_assignments a2
               ON a1.event_id = a2.event_id
               AND a1.category_id = a2.category_id
               AND a1.id > a2.id
           )`,
          { transaction },
        );
      }
      else {
        // Removal: Delete all event-category assignments
        affectedEventCount = await EventCategoryAssignmentEntity.destroy({
          where: { category_id: categoryId },
          transaction,
        });
      }

      // Delete all content translations
      await EventCategoryContentEntity.destroy({
        where: { category_id: categoryId },
        transaction,
      });

      // Finally, delete the category itself
      await EventCategoryEntity.destroy({
        where: { id: categoryId },
        transaction,
      });

      await transaction.commit();
      return affectedEventCount;
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Merge multiple source categories into a target category
   * @param account - The account performing the merge
   * @param calendarId - The calendar ID containing the categories
   * @param targetCategoryId - The category to merge into
   * @param sourceCategoryIds - Array of category IDs to merge from
   * @returns Object with totalAffectedEvents count
   * @throws Error if target is in source list or categories belong to different calendars
   */
  async mergeCategories(
    account: Account,
    calendarId: string,
    targetCategoryId: string,
    sourceCategoryIds: string[],
  ): Promise<{ totalAffectedEvents: number }> {
    // Validate target is not in source list
    if (sourceCategoryIds.includes(targetCategoryId)) {
      throw new Error('Target category cannot be in source categories list');
    }

    // Get calendar and verify permissions
    const calendar = await this.getCalendar(calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
    }

    // Verify target category exists and belongs to calendar
    const targetCategory = await this.getCategory(targetCategoryId, calendarId);

    // Verify all source categories exist and belong to same calendar
    const sourceCategories = await Promise.all(
      sourceCategoryIds.map(id => this.getCategory(id)),
    );

    for (const sourceCategory of sourceCategories) {
      if (sourceCategory.calendarId !== targetCategory.calendarId) {
        throw new Error('All categories must belong to the same calendar');
      }
    }

    const transaction = await db.transaction();
    let totalAffectedEvents = 0;

    try {
      // For each source category, migrate assignments and delete
      for (const sourceCategoryId of sourceCategoryIds) {
        // Update assignments to target category
        const [updateCount] = await EventCategoryAssignmentEntity.update(
          { category_id: targetCategoryId },
          {
            where: { category_id: sourceCategoryId },
            transaction,
          },
        );
        totalAffectedEvents += updateCount;

        // Remove duplicate assignments (events that already had target category)
        await db.query(
          `DELETE FROM event_category_assignments
           WHERE id IN (
             SELECT a1.id
             FROM event_category_assignments a1
             INNER JOIN event_category_assignments a2
               ON a1.event_id = a2.event_id
               AND a1.category_id = a2.category_id
               AND a1.id > a2.id
           )`,
          { transaction },
        );

        // Delete content for source category
        await EventCategoryContentEntity.destroy({
          where: { category_id: sourceCategoryId },
          transaction,
        });

        // Delete source category
        await EventCategoryEntity.destroy({
          where: { id: sourceCategoryId },
          transaction,
        });
      }

      await transaction.commit();
      return { totalAffectedEvents };
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Get event counts for all categories in a calendar
   * @param calendarId - The calendar ID
   * @returns Map of category ID to event count
   */
  async getCategoryStats(calendarId: string): Promise<Map<string, number>> {
    // Get all category IDs for this calendar
    const categories = await EventCategoryEntity.findAll({
      where: { calendar_id: calendarId },
      attributes: ['id'],
    });

    const categoryIds = categories.map(cat => cat.id);

    if (categoryIds.length === 0) {
      return new Map();
    }

    // Query to get event counts per category
    const results = await db.query<{ category_id: string; event_count: string }>(
      `SELECT category_id, COUNT(event_id) as event_count
       FROM event_category_assignments
       WHERE category_id IN (:categoryIds)
       GROUP BY category_id`,
      {
        replacements: { categoryIds },
        type: QueryTypes.SELECT,
      },
    );

    // Build map of category_id -> event_count
    const statsMap = new Map<string, number>();

    // Initialize all categories with 0 count
    for (const categoryId of categoryIds) {
      statsMap.set(categoryId, 0);
    }

    // Update with actual counts
    for (const result of results) {
      statsMap.set(result.category_id, parseInt(result.event_count, 10));
    }

    return statsMap;
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

    // Verify the event is a local event (has a calendar_id)
    if (!event.calendar_id) {
      throw new Error('Cannot assign categories to remote events');
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

    // Verify the event is a local event (has a calendar_id)
    if (!event.calendar_id) {
      throw new Error('Cannot unassign categories from remote events');
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

    // Import entities dynamically to avoid circular dependency
    const { CalendarEditorEntity } = await import('@/server/calendar/entity/calendar_editor');
    const { CalendarEditorPersonEntity } = await import('@/server/calendar/entity/calendar_editor_person');
    const { CalendarEntity } = await import('@/server/calendar/entity/calendar');

    // Check if user owns the calendar
    const calendarEntity = await CalendarEntity.findByPk(calendar.id);
    if (calendarEntity && calendarEntity.account_id === account.id) {
      return true;
    }

    // Check if user has federated editor access
    const federatedEditorRelationship = await CalendarEditorEntity.findOne({
      where: {
        calendar_id: calendar.id,
        account_id: account.id,
      },
    });

    if (federatedEditorRelationship) {
      return true;
    }

    // Check if user has local person editor access
    const localPersonEditorRelationship = await CalendarEditorPersonEntity.findOne({
      where: {
        calendar_id: calendar.id,
        account_id: account.id,
      },
    });

    return localPersonEditorRelationship !== null;
  }
}

export default CategoryService;
