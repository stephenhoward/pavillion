import express, { Request, Response, Application } from 'express';
import PublicCalendarInterface from '../../interface';

export default class CalendarRoutes {
  service: PublicCalendarInterface;

  constructor(internalAPI: PublicCalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars/:urlName', this.getCalendar.bind(this));
    router.get('/calendars/:urlName/categories', this.listCategories.bind(this));
    router.get('/calendars/:calendar/events', this.listInstances.bind(this));
    router.get('/events/:id', this.getEvent.bind(this));
    router.get('/instances/:id', this.getEventInstance.bind(this));
    app.use(routePrefix, router);
  }

  async getCalendar(req: Request, res: Response) {

    const calendar = await this.service.getCalendarByName(req.params.urlName);
    if (calendar) {
      res.json(calendar.toObject());
    }
    else {
      res.status(404).json({
        "error": "calendar not found",
      });
    }
  }

  async listCategories(req: Request, res: Response) {
    const calendarName = req.params.urlName;

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
      });
      return;
    }

    try {
      const categoriesWithCounts = await this.service.listCategoriesForCalendar(calendar);
      res.json(
        categoriesWithCounts.map(({ category, eventCount }) => {
          return {
            ...category.toObject(),
            eventCount,
          };
        }),
      );
    }
    catch {
      res.status(500).json({
        "error": "Failed to retrieve categories",
      });
    }
  }

  async listInstances(req: Request, res: Response) {
    const calendarName = req.params.calendar;
    if ( !req.params.calendar ) {
      res.status(400).json({
        "error": "missing calendar name",
      });
      return;
    }

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
      });
      return;
    }

    try {
      // Parse query parameters for filtering
      const options: {
        search?: string;
        categories?: string[];
        startDate?: string;
        endDate?: string;
      } = {};

      // Handle search parameter
      if (req.query.search && typeof req.query.search === 'string') {
        const searchTerm = req.query.search.trim();
        if (searchTerm.length > 0) {
          options.search = searchTerm;
        }
      }

      // Handle category parameter (can be array or single value)
      // Note: Store sends 'category' (singular) via params.append('category', name)
      if (req.query.category) {
        if (Array.isArray(req.query.category)) {
          options.categories = req.query.category
            .filter(c => typeof c === 'string' && c.trim().length > 0)
            .map(c => (c as string).trim());
        }
        else if (typeof req.query.category === 'string') {
          const categoryName = req.query.category.trim();
          if (categoryName.length > 0) {
            options.categories = [categoryName];
          }
        }
      }

      // Handle date range parameters
      if (req.query.startDate && typeof req.query.startDate === 'string') {
        const startDate = req.query.startDate.trim();
        if (startDate.length > 0) {
          options.startDate = startDate;
        }
      }

      if (req.query.endDate && typeof req.query.endDate === 'string') {
        const endDate = req.query.endDate.trim();
        if (endDate.length > 0) {
          options.endDate = endDate;
        }
      }

      let instances;

      // Check if any filters are provided
      if (options.search || options.categories || options.startDate || options.endDate) {
        instances = await this.service.listEventInstancesWithFilters(calendar, options);
      }
      else {
        instances = await this.service.listEventInstances(calendar);
      }

      res.json(instances.map((instance) => instance.toObject()));
    }
    catch (error: any) {
      // Log the full error for debugging
      console.error('Error in listInstances:', error);

      // Handle specific error types
      if (error.message === 'Invalid date format') {
        res.status(400).json({
          "error": "Invalid date format. Please use YYYY-MM-DD format.",
        });
      }
      else if (error.message === 'Invalid category IDs provided') {
        res.status(400).json({
          "error": "Invalid category IDs provided",
        });
      }
      else {
        res.status(500).json({
          "error": "Failed to retrieve events",
          "details": error.message,
        });
      }
    }
  }

  async getEvent(req: Request, res: Response) {
    const eventId = req.params.id;
    const event = await this.service.getEventById(eventId);
    if ( event ) {
      res.json(event.toObject());
    }
    else {
      res.status(404).json({
        "error": "event not found",
      });
    }
  }

  async getEventInstance(req: Request, res: Response) {
    const instanceId = req.params.id;
    const instance = await this.service.getEventInstanceById(instanceId);
    if ( instance ) {
      res.json(instance.toObject());
    }
    else {
      res.status(404).json({
        "error": "instance not found",
      });
    }
  }

}
