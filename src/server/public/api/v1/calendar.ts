import express, { Request, Response, Application } from 'express';
import PublicCalendarInterface from '../../interface';
import { SeriesNotFoundError } from '@/common/exceptions/series';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { logError } from '@/server/common/helper/error-logger';
import { CalendarEventSchedule } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { getRecurrenceSummary } from '@/common/utils/recurrence-text';
import { parseInstanceSlug } from '@/common/utils/instance-slug';
import { publicEventInstanceByIp, publicCalendarListByIp } from '@/server/common/middleware/rate-limiters';
import ExpressHelper from '@/server/common/helper/express';

/**
 * Shapes a Calendar.toObject() result for public responses.
 *
 * Responsibilities:
 *   - Strips internal fields not intended for anonymous public consumers.
 *     Currently drops `listed` (an admin-discovery flag — knowing whether
 *     a calendar is hidden from the /view/ index is not the public's
 *     business; the calendar is reachable by direct URL regardless).
 *   - Projects `defaultEventImage` to `{ id, mimeType }` only — internal
 *     fields like originalFilename, fileSize, status, sha256, calendarId,
 *     and storageFilename are removed.
 *
 * Allow-list / strip-by-name posture matches the toPublicEventObject helper
 * below so future additions to Calendar.toObject() do not silently leak
 * through this surface.
 */
function toPublicCalendarObject(calendarObj: Record<string, any>): Record<string, any> {
  // Drop `listed` (admin-discovery flag) via destructure-and-discard; the
  // ESLint config treats leading-underscore names as intentionally unused.
  const { listed: _listed, ...rest } = calendarObj; // eslint-disable-line @typescript-eslint/no-unused-vars
  if (!rest.defaultEventImage) return rest;
  return {
    ...rest,
    defaultEventImage: {
      id: rest.defaultEventImage.id,
      mimeType: rest.defaultEventImage.mimeType,
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
 *   - Projects `space` to `{ content }` only — the internal `id` (an AP
 *     identity hint used for inbound dedup) and `placeId` (an internal FK)
 *     have no Tier 1 anonymous-public use case and are stripped here.
 *     Authenticated calendar-editor APIs may still expose the full shape;
 *     this projection is strictly the public surface.
 *   - Projects `location` to address-display fields plus `content` only.
 *     Drops `originUri` (an AP-dedup identity hint, server-internal),
 *     `id` (parallels the space projection — AP identity hint with no
 *     Tier 1 use case), and `spaces[]` (unused on the public surface — the
 *     event's chosen sub-space is carried independently on `event.space`,
 *     so the array is an internal leak vector for nested originUri/clientId).
 *     Absent / null location collapses to `location: null` so the public
 *     contract stays stable.
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

  // Project space to { content } only. Drops id, placeId, and originUri
  // (all internal identifiers / AP-dedup hints with no public use case).
  // `space` may be omitted on the input object (older callers) or explicitly
  // null; both collapse to `space: null` so the public contract stays stable.
  if (publicObj.space) {
    publicObj.space = { content: publicObj.space.content };
  }
  else {
    publicObj.space = null;
  }

  // Project location to address-display fields + content only. Drops:
  //   - `originUri` (AP-dedup identity hint, server-internal)
  //   - `id` (parallels the space projection — AP identity hint with no
  //     Tier 1 use case)
  //   - `spaces[]` (unused on the public surface — `event.space` carries the
  //     selected sub-space; the array is an internal leak vector for nested
  //     originUri / clientId on each space row)
  // Allow-list, not delete-by-name, so future additions to
  // EventLocation.toObject() do not silently leak. Absent / null location
  // collapses to `location: null` so the public contract stays stable.
  if (publicObj.location) {
    const loc = publicObj.location;
    publicObj.location = {
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      postalCode: loc.postalCode,
      country: loc.country,
      content: loc.content,
    };
  }
  else {
    publicObj.location = null;
  }

  return publicObj;
}

/**
 * Shapes an instance object for public consumption via an explicit
 * allow-list. Prevents future additions to CalendarEventInstance.toObject()
 * from silently leaking internal fields (e.g., row UUID, calendarId,
 * internal flags) through the public surface.
 *
 * Allow-listed fields: id, start, end, isCancelled, event (shaped via
 * toPublicEventObject).
 */
function toPublicInstanceObject(instance: CalendarEventInstance): Record<string, any> {
  const obj = instance.toObject();
  return {
    id: obj.id,
    start: obj.start,
    end: obj.end,
    isCancelled: obj.isCancelled,
    event: toPublicEventObject(obj.event),
  };
}

export default class CalendarRoutes {
  private service: PublicCalendarInterface;

  constructor(internalAPI: PublicCalendarInterface) {
    this.service = internalAPI;
  }

  installHandlers(app: Application, routePrefix: string): void {
    const router = express.Router();
    router.get('/calendars', publicCalendarListByIp, this.listPublicCalendars.bind(this));
    router.get('/calendar/:urlName', this.getCalendar.bind(this));
    router.get('/calendar/:urlName/categories', this.listCategories.bind(this));
    router.get('/calendar/:urlName/series', this.listSeries.bind(this));
    router.get('/calendar/:urlName/series/:seriesUrlName', this.getSeries.bind(this));
    router.get('/calendar/:calendar/events', this.listInstances.bind(this));
    router.get('/events/:id', this.getEvent.bind(this));
    router.get(
      '/events/:eventId/instances/:startTime',
      publicEventInstanceByIp,
      this.getEventInstance.bind(this),
    );
    app.use(routePrefix, router);
  }

  /**
   * GET /api/public/v1/calendars — list listed calendars for the /view/
   * discovery landing page.
   *
   * Returns a bare array of `{ id, urlName, content[], lastEventActivity }`
   * built field-by-field via an explicit allow-list projection. This is
   * deliberately NOT `Calendar.toObject()` passthrough — `toObject()`
   * exposes `widgetAllowedDomain`, `publicUrl`, `defaultEventImage`,
   * `defaultEventImageId`, `languages`, `defaultDateRange`, and `listed`,
   * none of which the discovery surface needs and several of which leak
   * server/operator-internal configuration. Future additions to
   * `Calendar.toObject()` must NOT silently appear here.
   *
   * Response shape per row:
   *   - id: string (UUID)
   *   - urlName: string
   *   - content: Array<{ language, name, description }>
   *   - lastEventActivity: ISO 8601 string | null
   *
   * No success-path logging (privacy/logging standard). Error path uses
   * logError so operational signal is preserved without leaking PII into
   * the success log stream.
   */
  async listPublicCalendars(req: Request, res: Response) {
    try {
      const rows = await this.service.listPublicCalendars();
      const body = rows.map(({ calendar, lastEventActivity }) => ({
        id: calendar.id,
        urlName: calendar.urlName,
        content: calendar.getLanguages().map((language) => {
          const c = calendar.content(language);
          return {
            language: c.language,
            name: c.name,
            description: c.description,
          };
        }),
        lastEventActivity: lastEventActivity ? lastEventActivity.toISOString() : null,
      }));
      res.json(body);
    }
    catch (error) {
      logError(error, 'Error in listPublicCalendars');
      res.status(500).json({
        "error": "Failed to retrieve calendars",
      });
    }
  }

  async getCalendar(req: Request, res: Response) {

    const calendar = await this.service.getCalendarByName(req.params.urlName);
    if (calendar) {
      const calendarObj = calendar.toObject();
      res.json(toPublicCalendarObject(calendarObj));
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
      // Parse optional query parameters for filtering. Mirrors the parsing
      // pattern in listInstances so eventCount can be windowed to match the
      // visible event list when the sidebar is filtered.
      const options: {
        startDate?: string;
        endDate?: string;
        search?: string;
      } = {};

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

      if (req.query.search && typeof req.query.search === 'string') {
        const searchTerm = req.query.search.trim();
        if (searchTerm.length > 0) {
          options.search = searchTerm;
        }
      }

      const categoriesWithCounts = await this.service.listCategoriesForCalendar(calendar, options);

      res.json(
        categoriesWithCounts.map(({ category, eventCount }) => {
          return {
            ...category.toObject(),
            eventCount,
          };
        }),
      );
    }
    catch (error: any) {
      logError(error, 'Error in listCategories');

      if (error.message === 'Invalid date format') {
        res.status(400).json({
          "error": "Invalid date format. Please use YYYY-MM-DD format.",
          errorName: 'ValidationError',
        });
      }
      else {
        res.status(500).json({
          "error": "Failed to retrieve categories",
        });
      }
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

    // UUID validation on :id — reject malformed/path-traversal attempts before
    // any service call. Responds 404 (not 400) to avoid leaking whether a
    // particular id format is recognized versus valid-but-unknown.
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(404).json({
        "error": "event not found",
        errorName: 'EventNotFoundError',
      });
      return;
    }

    try {
      // Optional `?calendar=<urlName>` scopes category mappings to the display
      // calendar. Without this, reposted events would expose the originating
      // calendar's categories instead of the calendar the visitor is viewing.
      const displayCalendarId = await this.resolveDisplayCalendarId(req.query.calendar);

      // getEventById throws EventNotFoundError for unknown ids — catch below.
      const event = await this.service.getEventById(eventId, displayCalendarId);
      res.json(toPublicEventObject(event.toObject()));
    }
    catch (error) {
      if (error instanceof EventNotFoundError) {
        res.status(404).json({
          "error": "event not found",
          errorName: 'EventNotFoundError',
        });
        return;
      }
      logError(error, 'Error in getEvent');
      res.status(500).json({
        "error": "Failed to retrieve event",
      });
    }
  }

  /**
   * Resolve a `?calendar=<urlName>` query param to a calendar id, or undefined.
   * Silently ignores unknown / malformed values so a bad query string never
   * 404s the detail page; the handler simply falls back to the originating
   * calendar's categories (the prior behavior).
   */
  private async resolveDisplayCalendarId(rawCalendar: unknown): Promise<string | undefined> {
    if (typeof rawCalendar !== 'string') return undefined;
    const urlName = rawCalendar.trim();
    if (!urlName) return undefined;
    const calendar = await this.service.getCalendarByName(urlName);
    return calendar?.id;
  }

  async getEventInstance(req: Request, res: Response) {
    const { eventId, startTime: slug } = req.params;

    // UUID validation on :eventId — reject malformed/path-traversal attempts
    // before any service call. Responds 404 (not 400) to avoid leaking whether
    // a particular id format is recognized versus valid-but-unknown.
    if (!ExpressHelper.isValidUUID(eventId)) {
      res.status(404).json({
        "error": "instance not found",
        errorName: 'NotFoundError',
      });
      return;
    }

    // Slug validation — reject unparseable timestamp slugs, including legacy
    // UUID-shaped params from the pre-DEC-006 route. parseInstanceSlug returns
    // null for any non-yyyyMMdd-HHmm structure or out-of-bounds year.
    const startTime = parseInstanceSlug(slug);
    if (!startTime) {
      res.status(404).json({
        "error": "instance not found",
        errorName: 'NotFoundError',
      });
      return;
    }

    try {
      // Optional `?calendar=<urlName>` scopes category mappings to the display
      // calendar so reposted events show the reposting calendar's categories.
      const displayCalendarId = await this.resolveDisplayCalendarId(req.query.calendar);

      const instance = await this.service.findOrMaterializeInstanceWithDetails(
        eventId,
        startTime,
        displayCalendarId,
      );
      if (!instance) {
        res.status(404).json({
          "error": "instance not found",
          errorName: 'NotFoundError',
        });
        return;
      }
      res.json(toPublicInstanceObject(instance));
    }
    catch (error) {
      logError(error, 'Error in getEventInstance');
      res.status(500).json({
        "error": "Failed to retrieve event instance",
      });
    }
  }

}
