import express, { Request, Response, Application } from 'express';

import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';
import CalendarInterface from '../../interface';

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
    router.put('/categories/:categoryId', ExpressHelper.loggedInOnly, this.updateCategory.bind(this));
    router.delete('/categories/:categoryId', ExpressHelper.loggedInOnly, this.deleteCategory.bind(this));

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
      res.json({ categories });
    }
    catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Create a new category for a calendar
   * POST /api/v1/calendars/:calendarId/categories
   */
  async createCategory(req: Request, res: Response): Promise<void> {
    try {
      const { calendarId } = req.params;
      const { name, language } = req.body;
      const account = req.user as Account;

      if (!name || !language) {
        res.status(400).json({
          error: 'Name and language are required',
        });
        return;
      }

      const category = await this.service.createCategory(account, calendarId, {
        name,
        language,
      });

      res.status(201).json({ category });
    }
    catch (error) {
      console.error('Error creating category:', error);
      res.status(500).json({ error: 'Internal server error' });
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
        res.status(404).json({ error: 'Category not found' });
        return;
      }

      res.json({ category });
    }
    catch (error) {
      console.error('Error fetching category:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update a category's content for a specific language
   * PUT /api/v1/categories/:categoryId
   */
  async updateCategory(req: Request, res: Response): Promise<void> {
    try {
      const { categoryId } = req.params;
      const { name, language } = req.body;
      const account = req.user as Account;

      if (!name || !language) {
        res.status(400).json({
          error: 'Name and language are required',
        });
        return;
      }

      const category = await this.service.updateCategory(account, categoryId, {
        name,
        language,
      });

      res.json({ category });
    }
    catch (error) {
      console.error('Error updating category:', error);
      res.status(500).json({ error: 'Internal server error' });
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

      await this.service.deleteCategory(account, categoryId);
      res.status(204).send();
    }
    catch (error) {
      console.error('Error deleting category:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export default CategoryRoutes;
