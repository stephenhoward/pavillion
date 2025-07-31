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
      let instances;

      // Check if category filtering is requested
      if (req.query.categories && typeof req.query.categories === 'string') {
        const categoryIds = req.query.categories.split(',').map(id => id.trim()).filter(id => id.length > 0);
        instances = await this.service.listEventInstancesWithCategoryFilter(calendar, categoryIds);
      }
      else {
        instances = await this.service.listEventInstances(calendar);
      }

      res.json(instances.map((instance) => instance.toObject()));
    }
    catch (error: any) {
      if (error.message === 'Invalid category IDs provided') {
        res.status(400).json({
          "error": "Invalid category IDs provided",
        });
      }
      else {
        res.status(500).json({
          "error": "Failed to retrieve events",
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
