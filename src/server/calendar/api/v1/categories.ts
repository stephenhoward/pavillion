import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';
import { CalendarNotFoundError, EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  CategoryNotFoundError,
  CategoryAssignmentNotFoundError,
  CategoryAlreadyAssignedError,
  CategoryEventCalendarMismatchError,
} from '@/common/exceptions/category';

class CategoryRoutes {
  private service: CalendarInterface;

  constructor(internalAPI: CalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();

    // Category management routes
    router.get('/calendars/:calendarId/categories', this.getCategories.bind(this));
    router.post('/calendars/:calendarId/categories', ExpressHelper.loggedInOnly, this.createCategory.bind(this));
    router.get('/categories/:categoryId', this.getCategory.bind(this));
    router.post('/calendars/:calendarId/categories/:categoryId', ExpressHelper.loggedInOnly, this.updateCategory.bind(this));
    router.delete('/categories/:categoryId', ExpressHelper.loggedInOnly, this.deleteCategory.bind(this));

    // Category assignment routes
    router.post('/events/:eventId/categories/:categoryId', ExpressHelper.loggedInOnly, this.assignCategoryToEvent.bind(this));
    router.delete('/events/:eventId/categories/:categoryId', ExpressHelper.loggedInOnly, this.unassignCategoryFromEvent.bind(this));
    router.get('/events/:eventId/categories', this.getEventCategories.bind(this));
    router.get('/categories/:categoryId/events', this.getCategoryEvents.bind(this));

    app.use(routePrefix, router);
  }

  /**
   * Get all categories for a calendar
   * GET /api/v1/calendars/:calendarId/categories
   */
  async getCategories(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId } = req.params;

      const categories = await this.service.getCategories(calendarId);
      res.json(categories.map((category) => category.toObject()));
    }
    catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Create a new category for a calendar
   * POST /api/v1/calendars/:calendarId/categories
   */
  async createCategory(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for category creation. Not logged in?",
        });
        return;
      }

      const category = await this.service.createCategory(account, calendarId, req.body);

      res.status(201).json(category.toObject());
    }
    catch (error) {
      console.error('Error creating category:', error);

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", "errorName": "CalendarNotFoundError" });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", "errorName": "InsufficientCalendarPermissionsError" });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Get a specific category
   * GET /api/v1/categories/:categoryId
   */
  async getCategory(req: Request, res: Response): Promise<void> {
    try {
      const { categoryId } = req.params;

      const category = await this.service.getCategory(categoryId);
      if (!category) {
        res.status(404).json({ "error": "Category not found", "errorName": "CategoryNotFoundError" });
        return;
      }

      res.json(category.toObject());
    }
    catch (error) {
      console.error('Error fetching category:', error);
      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Update a category's content for a specific language
   * PUT /api/v1/categories/:categoryId
   */
  async updateCategory(req: Request, res: Response): Promise<void> {
    try {
      const { categoryId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for category update. Not logged in?",
        });
        return;
      }

      const category = await this.service.updateCategory(account, categoryId, req.body);

      res.json(category.toObject());
    }
    catch (error) {
      console.error('Error updating category:', error);

      if (error instanceof CategoryNotFoundError) {
        res.status(404).json({ "error": "Category not found", "errorName": "CategoryNotFoundError" });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", "errorName": "CalendarNotFoundError" });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", "errorName": "InsufficientCalendarPermissionsError" });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Delete a category
   * DELETE /api/v1/categories/:categoryId
   */
  async deleteCategory(req: Request, res: Response): Promise<void> {
    try {
      const { categoryId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for category deletion. Not logged in?",
        });
        return;
      }

      await this.service.deleteCategory(account, categoryId);
      res.status(204).send();
    }
    catch (error) {
      console.error('Error deleting category:', error);

      if (error instanceof CategoryNotFoundError) {
        res.status(404).json({ "error": "Category not found", "errorName": "CategoryNotFoundError" });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", "errorName": "CalendarNotFoundError" });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", "errorName": "InsufficientCalendarPermissionsError" });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Assign a category to an event
   * POST /api/v1/events/:eventId/categories/:categoryId
   */
  async assignCategoryToEvent(req: Request, res: Response): Promise<void> {
    try {
      const { eventId, categoryId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for category assignment. Not logged in?",
        });
        return;
      }

      const assignment = await this.service.assignCategoryToEvent(account, eventId, categoryId);
      res.status(201).json(assignment.toObject());
    }
    catch (error) {
      console.error('Error assigning category to event:', error);

      if (error instanceof CategoryNotFoundError) {
        res.status(404).json({ "error": "Category not found", "errorName": "CategoryNotFoundError" });
        return;
      }

      if (error instanceof EventNotFoundError) {
        res.status(404).json({ "error": "Event not found", "errorName": "EventNotFoundError" });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", "errorName": "CalendarNotFoundError" });
        return;
      }

      if (error instanceof CategoryEventCalendarMismatchError) {
        res.status(400).json({ "error": "Event and category must belong to the same calendar", "errorName": "CategoryEventCalendarMismatchError" });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", "errorName": "InsufficientCalendarPermissionsError" });
        return;
      }

      if (error instanceof CategoryAlreadyAssignedError) {
        res.status(409).json({ "error": "Category is already assigned to this event", "errorName": "CategoryAlreadyAssignedError" });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Remove a category assignment from an event
   * DELETE /api/v1/events/:eventId/categories/:categoryId
   */
  async unassignCategoryFromEvent(req: Request, res: Response): Promise<void> {
    try {
      const { eventId, categoryId } = req.params;
      const account = req.user as Account;

      if (!account) {
        res.status(400).json({
          "error": "missing account for category unassignment. Not logged in?",
        });
        return;
      }

      await this.service.unassignCategoryFromEvent(account, eventId, categoryId);
      res.status(204).send();
    }
    catch (error) {
      console.error('Error removing category assignment:', error);

      if (error instanceof CategoryNotFoundError) {
        res.status(404).json({ "error": "Category not found", "errorName": "CategoryNotFoundError" });
        return;
      }

      if (error instanceof EventNotFoundError) {
        res.status(404).json({ "error": "Event not found", "errorName": "EventNotFoundError" });
        return;
      }

      if (error instanceof CalendarNotFoundError) {
        res.status(404).json({ "error": "Calendar not found", "errorName": "CalendarNotFoundError" });
        return;
      }

      if (error instanceof CategoryEventCalendarMismatchError) {
        res.status(400).json({ "error": "Event and category must belong to the same calendar", "errorName": "CategoryEventCalendarMismatchError" });
        return;
      }

      if (error instanceof InsufficientCalendarPermissionsError) {
        res.status(403).json({ "error": "Permission denied", "errorName": "InsufficientCalendarPermissionsError" });
        return;
      }

      if (error instanceof CategoryAssignmentNotFoundError) {
        res.status(404).json({ "error": "Category assignment not found", "errorName": "CategoryAssignmentNotFoundError" });
        return;
      }

      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Get all categories assigned to an event
   * GET /api/v1/events/:eventId/categories
   */
  async getEventCategories(req: Request, res: Response): Promise<void> {
    try {
      const { eventId } = req.params;

      const categories = await this.service.getEventCategories(eventId);
      res.json(categories.map(category => category.toObject()));
    }
    catch (error) {
      console.error('Error fetching event categories:', error);
      res.status(500).json({ "error": "Internal server error" });
    }
  }

  /**
   * Get all events assigned to a category
   * GET /api/v1/categories/:categoryId/events
   */
  async getCategoryEvents(req: Request, res: Response): Promise<void> {
    try {
      const { categoryId } = req.params;

      const eventIds = await this.service.getCategoryEvents(categoryId);
      res.json(eventIds);
    }
    catch (error) {
      console.error('Error fetching category events:', error);
      res.status(500).json({ "error": "Internal server error" });
    }
  }
}

export default CategoryRoutes;
