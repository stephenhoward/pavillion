import express, { Request, Response, Application } from 'express';
import PublicCalendarInterface from '../../interface';
import { SeriesNotFoundError } from '@/common/exceptions/series';
import { logError } from '@/server/common/helper/error-logger';
import { CalendarEventSchedule } from '@/common/model/events';
import { getRecurrenceSummary } from '@/common/utils/recurrence-text';

/**
 * Strips sensitive fields from a defaultEventImage object for public responses.
 * Only id and mimeType are exposed; internal fields like originalFilename,
 * fileSize, status, sha256, calendarId, and storageFilename are removed.
 */
function stripDefaultEventImage(calendarObj: Record<string, any>): Record<string, any> {
  if (!calendarObj.defaultEventImage) return calendarObj;
  return {
    ...calendarObj,
    defaultEventImage: {
      id: calendarObj.defaultEventImage.id,
      mimeType: calendarObj.defaultEventImage.mimeType,
    },
  };
}

/**
 * Shapes a raw event object (from CalendarEvent.toObject()) for public consumption.
 *
 * Responsibilities:
 *   - Removes `schedules[]` so internal recurrence-row details (including
 *     hideFromPublic and isException cancellation metadata) cannot leak.
 *   - Removes the legacy English-only `recurrenceText` field if present.
 *   - Adds `isRecurring: boolean`, derived from whether the event has any
 *     non-exclusion schedule with a frequency.
 *   - Adds `recurrenceSummary: { key, params } | null` so the presentation
 *     layer can render a localized recurrence phrase.
 *   - Projects `media` to `{ id, mimeType }` only — internal fields such as
 *     calendarId, sha256, originalFilename, fileSize, and status are removed.
 *
 * CalendarEventSchedule.toObject() on the shared model remains the full
 * authenticated shape; shaping here is strictly the public API layer's
 * responsibility (per DEC-003 domain boundaries and DEC-004 privacy-first).
 */
function toPublicEventObject(eventObj: Record<string, any>): Record<string, any> {
  const rawSchedules = Array.isArray(eventObj.schedules) ? eventObj.schedules : [];

  // Rehydrate schedules into model instances so getRecurrenceSummary can read
  // typed fields (frequency, interval, byDay, isExclusion) regardless of the
  // caller having already passed a plain object or a model instance.
  const scheduleModels: CalendarEventSchedule[] = rawSchedules.map((s: any) =>
    s instanceof CalendarEventSchedule ? s : CalendarEventSchedule.fromObject(s),
  );
  const summary = getRecurrenceSummary(scheduleModels);
  const isRecurring = summary !== null;

  // Strip schedules and recurrenceText from the output; build a fresh object
  // so downstream spread/mutation cannot reintroduce internal fields.
  const publicObj: Record<string, any> = {
    ...eventObj,
    isRecurring,
    recurrenceSummary: summary,
  };
  delete publicObj.schedules;
  delete publicObj.recurrenceText;

  if (publicObj.media) {
    publicObj.media = {
      id: publicObj.media.id,
      mimeType: publicObj.media.mimeType,
    };
  }

  return publicObj;
}

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
      const calendarObj = calendar.toObject();
      res.json(stripDefaultEventImage(calendarObj));
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
        events: events.map(event => toPublicEventObject(event.toObject())),
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

      res.json(instances.map((instance) => {
        const obj = instance.toObject();
        return {
          ...obj,
          event: toPublicEventObject(obj.event),
        };
      }));
    }
    catch (error: any) {
      // Log the full error for debugging
      logError(error, 'Error in listInstances');

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
      res.json(toPublicEventObject(event.toObject()));
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
      const obj = instance.toObject();
      res.json({
        ...obj,
        event: toPublicEventObject(obj.event),
      });
    }
    else {
      res.status(404).json({
        "error": "instance not found",
        errorName: 'NotFoundError',
      });
    }
  }

}
