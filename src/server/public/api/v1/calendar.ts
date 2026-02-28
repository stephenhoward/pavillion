import express, { Request, Response, Application } from 'express';
import PublicCalendarInterface from '../../interface';
import { SeriesNotFoundError } from '@/common/exceptions/series';

export default class CalendarRoutes {
  service: PublicCalendarInterface;

  constructor(internalAPI: PublicCalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendar/:urlName', this.getCalendar.bind(this));
    router.get('/calendar/:urlName/categories', this.listCategories.bind(this));
    router.get('/calendar/:urlName/series', this.listSeries.bind(this));
    router.get('/calendar/:urlName/series/:seriesUrlName', this.getSeries.bind(this));
    router.get('/calendar/:calendar/events', this.listInstances.bind(this));
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
        errorName: 'CalendarNotFoundError',
      });
    }
  }

  async listCategories(req: Request, res: Response) {
    const calendarName = req.params.urlName;

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
        errorName: 'CalendarNotFoundError',
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

  async listSeries(req: Request, res: Response) {
    const calendarName = req.params.urlName;

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
        errorName: 'CalendarNotFoundError',
      });
      return;
    }

    try {
      const seriesWithCounts = await this.service.listSeriesForCalendar(calendar);
      res.json(
        seriesWithCounts.map(({ series, eventCount }) => ({
          ...series.toObject(),
          eventCount,
        })),
      );
    }
    catch {
      res.status(500).json({
        "error": "Failed to retrieve series",
      });
    }
  }

  async getSeries(req: Request, res: Response) {
    const calendarName = req.params.urlName;
    const seriesUrlName = req.params.seriesUrlName;

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
        errorName: 'CalendarNotFoundError',
      });
      return;
    }

    try {
      const series = await this.service.getSeriesByUrlName(calendar.id, seriesUrlName);

      // Parse pagination parameters with server-enforced limits
      const DEFAULT_LIMIT = 20;
      const MAX_LIMIT = 100;

      let limit = DEFAULT_LIMIT;
      let offset = 0;

      if (req.query.limit && typeof req.query.limit === 'string') {
        const parsedLimit = parseInt(req.query.limit, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          limit = Math.min(parsedLimit, MAX_LIMIT);
        }
      }

      if (req.query.offset && typeof req.query.offset === 'string') {
        const parsedOffset = parseInt(req.query.offset, 10);
        if (!isNaN(parsedOffset) && parsedOffset >= 0) {
          offset = parsedOffset;
        }
      }

      const { events, total } = await this.service.getSeriesEvents(series.id, calendar.id, limit, offset);

      res.json({
        ...series.toObject(),
        events: events.map(event => event.toObject()),
        pagination: {
          total,
          limit,
          offset,
        },
      });
    }
    catch (error: any) {
      if (error instanceof SeriesNotFoundError || error.name === 'SeriesNotFoundError') {
        res.status(404).json({
          "error": "series not found",
          errorName: 'SeriesNotFoundError',
        });
      }
      else {
        res.status(500).json({
          "error": "Failed to retrieve series",
        });
      }
    }
  }

  async listInstances(req: Request, res: Response) {
    const calendarName = req.params.calendar;
    if ( !req.params.calendar ) {
      res.status(400).json({
        "error": "missing calendar name",
        errorName: 'ValidationError',
      });
      return;
    }

    const calendar = await this.service.getCalendarByName(calendarName);
    if (!calendar) {
      res.status(404).json({
        "error": "calendar not found",
        errorName: 'CalendarNotFoundError',
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

      // Handle categories parameter (can be array or single value)
      // Note: Store sends 'categories' (plural) via params.append('categories', id)
      if (req.query.categories) {
        if (Array.isArray(req.query.categories)) {
          options.categories = req.query.categories
            .filter(c => typeof c === 'string' && c.trim().length > 0)
            .map(c => (c as string).trim());
        }
        else if (typeof req.query.categories === 'string') {
          const categoryId = req.query.categories.trim();
          if (categoryId.length > 0) {
            options.categories = [categoryId];
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
          errorName: 'ValidationError',
        });
      }
      else if (error.message === 'Invalid category IDs provided') {
        res.status(400).json({
          "error": "Invalid category IDs provided",
          errorName: 'ValidationError',
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
        errorName: 'EventNotFoundError',
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
        errorName: 'NotFoundError',
      });
    }
  }

}
