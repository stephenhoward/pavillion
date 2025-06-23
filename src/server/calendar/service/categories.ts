import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { EventCategoryModel } from '@/common/model/event_category';
import { EventCategoryAssignmentModel } from '@/common/model/event_category_assignment';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventEntity } from '@/server/calendar/entity/event';
import CalendarService from './calendar';
import { CalendarNotFoundError, EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  CategoryNotFoundError,
  CategoryAssignmentNotFoundError,
  CategoryAlreadyAssignedError,
  CategoryEventCalendarMismatchError,
  CategoryUpdateFailedError,
} from '@/common/exceptions/category';

/**
 * Service for managing event categories within calendars.
 * Handles CRUD operations for categories with multi-language support,
 * and manages category assignments to events.
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
      throw new InsufficientCalendarPermissionsError();
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
      throw new CategoryNotFoundError();
    }

    // Get calendar and verify ownership/editor permissions
    const calendar = await this.calendarService.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError();
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
    const calendar = await this.calendarService.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
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
    const calendar = await this.calendarService.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
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
    const calendar = await this.calendarService.getCalendar(category.calendarId);
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
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
  async getEventCategories(eventId: string): Promise<EventCategoryModel[]> {
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
}

export default CategoryService;
