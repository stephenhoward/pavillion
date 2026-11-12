import express, { Request, Response, Application } from 'express';
import PublicCalendarInterface from '../../interface';
import { SeriesNotFoundError } from '@/common/exceptions/series';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { logError } from '@/server/common/helper/error-logger';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import { EventSeries } from '@/common/model/event_series';
import { EventCategory } from '@/common/model/event_category';
import { getRecurrenceSummary } from '@/common/utils/recurrence-text';
import { parseInstanceSlug } from '@/common/utils/instance-slug';
import { limitPublicEventInstanceByIp, limitPublicCalendarListByIp } from '@/server/common/middleware/rate-limiters';
import ExpressHelper from '@/server/common/helper/express';

/**
 * Per-language content fields each projection serves to anonymous callers.
 *
 * Content maps are allow-listed field by field, the same as root fields, so a
 * field added to a `*Content` model reaches the public API only by being named
 * here. `imageAlt` is public on purpose. `language` is carried on every row.
 * The projection test compares each list to the model's `toObject()` keys, so a
 * new content field fails that test until it is classified here.
 */
export const PUBLIC_CONTENT_FIELDS = {
  calendar: ['language', 'name', 'description', 'imageAlt'],
  series: ['language', 'name', 'description', 'imageAlt'],
  category: ['language', 'name'],
  event: ['language', 'title', 'name', 'description', 'accessibilityInfo', 'imageAlt'],
  location: ['language', 'accessibilityInfo'],
  space: ['language', 'name', 'accessibilityInfo'],
} as const;

/**
 * Projects a `{ [language]: contentRow }` map through a field allow-list.
 * Fields outside the list are dropped; a row that is not an object (a
 * dropped-language tombstone) is omitted; an absent map stays absent.
 */
function projectContent(
  content: Record<string, any> | null | undefined,
  fields: readonly string[],
): Record<string, any> | null | undefined {
  if (!content || typeof content !== 'object') {
    return content;
  }
  const projected: Record<string, any> = {};
  for (const [language, row] of Object.entries(content)) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    projected[language] = Object.fromEntries(
      fields.filter(field => field in row).map(field => [field, row[field]]),
    );
  }
  return projected;
}

/**
 * Shapes a raw Calendar object for public consumption via an explicit
 * allow-list. Accepts either a model instance (and calls `.toObject()`
 * internally) or an already-serialized plain object — same shape contract
 * as `toPublicSeriesObject` and `toPublicCategoryObject` below.
 *
 * Allow-listed fields: id, urlName, publicUrl, description, languages,
 * defaultDateRange, content, plus a projected `defaultEventImage`.
 *
 * Dropped from the calendar root:
 *   - `listed` — owner-discovery flag; knowing whether a calendar is hidden
 *     from the /discover index is not the public's business.
 *   - `widgetAllowedDomain` — embed-policy config. The widget HTML shell's
 *     frame-ancestors header necessarily carries it (DEC-020); that bounded
 *     exception does not license adding it to any JSON projection.
 *   - `defaultEventImageId` — internal FK; the projected
 *     `defaultEventImage.id` already carries the identifier callers need.
 *
 * Nested `defaultEventImage` → `{ id, mimeType }`; absent collapses to null.
 *
 * Per DEC-003 the canonical `Calendar.toObject()` shape stays full because
 * authenticated calendar/owner APIs legitimately need the FKs and embed
 * config; per DEC-004 the privacy boundary is a property of the audience
 * (Tier 1 anonymous public).
 *
 * Why allow-list (not delete-by-name): future additions to
 * `Calendar.toObject()` must not reach anonymous callers without a change
 * here. That holds for `content` too: its per-language fields are
 * allow-listed through `PUBLIC_CONTENT_FIELDS`, and the projection test fails
 * when a content model gains a field that list does not classify.
 */
export function toPublicCalendarObject(calendar: Calendar | Record<string, any>): Record<string, any> {
  const obj = calendar instanceof Calendar ? calendar.toObject() : calendar;
  const defaultEventImage = obj.defaultEventImage
    ? { id: obj.defaultEventImage.id, mimeType: obj.defaultEventImage.mimeType }
    : null;
  return {
    id: obj.id,
    urlName: obj.urlName,
    publicUrl: obj.publicUrl,
    description: obj.description,
    languages: obj.languages,
    defaultDateRange: obj.defaultDateRange,
    defaultEventImage,
    content: projectContent(obj.content, PUBLIC_CONTENT_FIELDS.calendar),
  };
}

/**
 * Shapes a raw EventSeries object for public consumption via an explicit
 * allow-list. Accepts either a model instance (and calls `.toObject()`
 * internally) or an already-serialized plain object — this mirrors the
 * shape of `toPublicInstanceObject` below and lets `toPublicEventObject`
 * pass nested series shapes through transparently.
 *
 * Allow-listed fields: id, urlName, mediaFocalPointX, mediaFocalPointY,
 * mediaZoom, content, plus `media` → `{ id, mimeType }` (the same nested
 * shape `toPublicEventObject` emits; `null` when the series has no image).
 * Drops the internal FKs `calendarId` and `mediaId`.
 *
 * Per DEC-003 the canonical `EventSeries.toObject()` shape is unchanged;
 * the privacy boundary is a property of the audience, not the data
 * (authenticated APIs need the full shape for cross-resource navigation).
 */
export function toPublicSeriesObject(series: EventSeries | Record<string, any>): Record<string, any> {
  const obj = series instanceof EventSeries ? series.toObject() : series;
  return {
    id: obj.id,
    urlName: obj.urlName,
    media: obj.media ? { id: obj.media.id, mimeType: obj.media.mimeType } : null,
    mediaFocalPointX: obj.mediaFocalPointX,
    mediaFocalPointY: obj.mediaFocalPointY,
    mediaZoom: obj.mediaZoom,
    content: projectContent(obj.content, PUBLIC_CONTENT_FIELDS.series),
  };
}

/**
 * Shapes a raw EventCategory object for public consumption via an explicit
 * allow-list. Accepts either a model instance (and calls `.toObject()`
 * internally) or an already-serialized plain object.
 *
 * Allow-listed fields: id (DEC-005 — category.id is the public identifier
 * within a calendar context), content. Drops the internal FK `calendarId`.
 *
 * `eventCount` is not part of this projection — it is a service-supplied
 * aggregate, not a property of the category. The `listCategories` handler
 * augments the projection with `eventCount` from its service tuple; the
 * nested `event.categories[]` path has no use for a count and does not
 * include one. This mirrors `toPublicSeriesObject` which is also count-free.
 *
 * Per DEC-003 the canonical `EventCategory.toObject()` shape is unchanged.
 */
export function toPublicCategoryObject(category: EventCategory | Record<string, any>): Record<string, any> {
  const obj = category instanceof EventCategory ? category.toObject() : category;
  return {
    id: obj.id,
    content: projectContent(obj.content, PUBLIC_CONTENT_FIELDS.category),
  };
}

/**
 * Shapes a raw event object (from CalendarEvent.toObject()) for public
 * consumption via an explicit, file-uniform allow-list.
 *
 * Why allow-list (not delete-by-name): future additions to
 * `CalendarEvent.toObject()` (and the nested `*.toObject()` shapes it
 * composes) must not reach anonymous callers without a change here, including
 * the per-language fields of every nested content map (`PUBLIC_CONTENT_FIELDS`).
 *
 * Why in the public domain (not on the model): authenticated calendar/owner
 * APIs legitimately need the full shape — `calendarId`, `locationId`,
 * `spaceId`, `mediaId` are required for cross-resource navigation. Per
 * DEC-003 the canonical `*.toObject()` shape stays full; per DEC-004 the
 * privacy boundary is a property of the audience (Tier 1 anonymous public).
 *
 * Event root allow-list:
 *   id, date, repostStatus, isRepost (deprecated; derived here from
 *   repostStatus for wire-contract stability), sourceCalendar, mediaFocalPointX,
 *   mediaFocalPointY, mediaZoom, eventSourceUrl, externalUrl, urlPrompt,
 *   isRecurring, recurrenceSummary, singleOccurrenceStart, content, plus
 *   projected location, space, media, series, categories.
 *
 * Dropped from the event root: calendarId, locationId, spaceId, mediaId
 * (internal FKs), schedules (cancellation / hide-from-public metadata),
 * recurrenceText (legacy English-only field).
 *
 * Nested-object projections (all allow-listed, all bound to the public
 * audience's minimum need):
 *   - `media` → `{ id, mimeType }`.
 *   - `space` → `{ content }`; absent/null collapses to `null`.
 *   - `location` → address-display fields + `content`; drops `originUri`,
 *     `id`, and `spaces[]`; absent/null collapses to `null`.
 *   - `series` → via `toPublicSeriesObject`; absent/null collapses to `null`.
 *   - `categories[]` → via `toPublicCategoryObject` for each row.
 *
 * `isRecurring` and `recurrenceSummary` are computed here (not carried from
 * the model) so the model can keep the full authenticated payload while
 * presentation receives a localized-summary intent.
 *
 * `singleOccurrenceStart` is computed here too: the UTC ISO start of an event
 * with exactly one non-exclusion schedule that does not recur, else null. It
 * lets the site send a dated link outdated by a time change to the event's
 * current date. That start is already public through the calendar listing,
 * and exclusion rows never contribute to it, so it reveals no cancellation.
 */
export function toPublicEventObject(eventObj: Record<string, any>): Record<string, any> {
  const rawSchedules = Array.isArray(eventObj.schedules) ? eventObj.schedules : [];

  // Rehydrate schedules into model instances so getRecurrenceSummary can read
  // typed fields (frequency, interval, byDay, isExclusion) regardless of the
  // caller having already passed a plain object or a model instance.
  const scheduleModels: CalendarEventSchedule[] = rawSchedules.map((s: any) =>
    s instanceof CalendarEventSchedule ? s : CalendarEventSchedule.fromObject(s),
  );
  const summary = getRecurrenceSummary(scheduleModels);
  const isRecurring = summary !== null;
  const singleOccurrenceStart = singleOccurrenceStartOf(scheduleModels);

  // Project media to { id, mimeType } only — internal fields such as
  // calendarId, sha256, originalFilename, fileSize, and status are removed.
  const media = eventObj.media
    ? { id: eventObj.media.id, mimeType: eventObj.media.mimeType }
    : null;

  // Project space to { content } only. Drops id, placeId, and originUri.
  // Absent / null space collapses to `null` so the public contract stays stable.
  const space = eventObj.space ? { content: projectContent(eventObj.space.content, PUBLIC_CONTENT_FIELDS.space) } : null;

  // Project location to address-display fields + content only. Drops
  // `originUri` (AP-dedup identity hint), `id` (parallels the space projection),
  // and `spaces[]` (the event's chosen sub-space is carried on `event.space`;
  // the array is an internal leak vector for nested originUri / clientId).
  let location: Record<string, any> | null = null;
  if (eventObj.location) {
    const loc = eventObj.location;
    location = {
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      postalCode: loc.postalCode,
      country: loc.country,
      content: projectContent(loc.content, PUBLIC_CONTENT_FIELDS.location),
    };
  }

  const series = eventObj.series ? toPublicSeriesObject(eventObj.series) : null;
  const categories = Array.isArray(eventObj.categories)
    ? eventObj.categories.map((c: Record<string, any>) => toPublicCategoryObject(c))
    : [];

  // Explicit allow-list build, not a spread-then-delete: future additions to
  // CalendarEvent.toObject() must fail loudly here.
  return {
    id: eventObj.id,
    date: eventObj.date,
    repostStatus: eventObj.repostStatus,
    // Deprecated wire field retained for external public-API consumers.
    // CalendarEvent no longer carries isRepost; derive it here so the
    // public contract is unchanged. Removing it is a separate, deliberate
    // public-API change.
    isRepost: eventObj.repostStatus !== 'none',
    sourceCalendar: eventObj.sourceCalendar,
    mediaFocalPointX: eventObj.mediaFocalPointX,
    mediaFocalPointY: eventObj.mediaFocalPointY,
    mediaZoom: eventObj.mediaZoom,
    eventSourceUrl: eventObj.eventSourceUrl,
    externalUrl: eventObj.externalUrl,
    urlPrompt: eventObj.urlPrompt,
    isRecurring,
    recurrenceSummary: summary,
    singleOccurrenceStart,
    content: projectContent(eventObj.content, PUBLIC_CONTENT_FIELDS.event),
    location,
    space,
    media,
    series,
    categories,
  };
}

/**
 * The UTC ISO start of an event whose only non-exclusion schedule does not
 * recur, else null. The schedule is chosen by `CalendarEvent.baseScheduleOf`,
 * the one rule for an event's base schedule (DEC-023).
 */
function singleOccurrenceStartOf(schedules: CalendarEventSchedule[]): string | null {
  if (schedules.filter(s => !s.isExclusion).length !== 1) {
    return null;
  }
  const base = CalendarEvent.baseScheduleOf(schedules);
  if (!base?.startDate || base.frequency) {
    return null;
  }
  return base.startDate.toUTC().toISO();
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
    router.get('/calendars', limitPublicCalendarListByIp, this.listPublicCalendars.bind(this));
    router.get('/calendar/:urlName', this.getCalendar.bind(this));
    router.get('/calendar/:urlName/categories', this.listCategories.bind(this));
    router.get('/calendar/:urlName/series', this.listSeries.bind(this));
    router.get('/calendar/:urlName/series/:seriesUrlName', this.getSeries.bind(this));
    router.get('/calendar/:calendar/events', this.listInstances.bind(this));
    router.get('/events/:id', this.getEvent.bind(this));
    router.get(
      '/events/:eventId/instances/:startTime',
      limitPublicEventInstanceByIp,
      this.getEventInstance.bind(this),
    );
    app.use(routePrefix, router);
  }

  /**
   * GET /api/public/v1/calendars — list listed calendars for the /discover
   * landing page.
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
      res.json(toPublicCalendarObject(calendar));
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
        categoriesWithCounts.map(({ category, eventCount }) => ({
          ...toPublicCategoryObject(category),
          eventCount,
        })),
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
          ...toPublicSeriesObject(series),
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
        ...toPublicSeriesObject(series),
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

      res.json(instances.map(toPublicInstanceObject));
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
      // Optional `?calendar=<urlName>` names the display calendar: it scopes
      // category mappings (reposted events show the reposting calendar's
      // categories) and binds the response to events that calendar shows.
      const display = await this.resolveDisplayCalendar(req.query.calendar, eventId);
      if (!display.visible) {
        res.status(404).json({
          "error": "event not found",
          errorName: 'EventNotFoundError',
        });
        return;
      }
      const displayCalendarId = display.calendarId;

      // getEventById throws EventNotFoundError for unknown ids — catch below.
      // Caveat: on this single-event path repostStatus / isRepost are
      // non-authoritative (always 'none' / false) — getEventById does not
      // consult SharedEventEntity. Authoritative repost status comes only from
      // the feed / list paths. A future feature needing repost provenance here
      // must wire SharedEventEntity into getEventById or resolve it here.
      const event = await this.service.getEventById(eventId, displayCalendarId);

      // Optional `?sameDayAs=<instance slug>` asks for the event's only
      // occurrence on that slug's local day, so the site can send a dated
      // link outdated by a time change to the occurrence that replaced it.
      // An absent or unparseable slug answers null, as does a day with no
      // occurrence or several.
      const sameDayAs = typeof req.query.sameDayAs === 'string'
        ? parseInstanceSlug(req.query.sameDayAs)
        : null;
      const sameDayOccurrence = sameDayAs
        ? await this.service.findSameDayOccurrence(event, sameDayAs)
        : null;

      res.json({
        ...toPublicEventObject(event.toObject()),
        sameDayOccurrenceStart: sameDayOccurrence?.toUTC().toISO() ?? null,
      });
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
   * Resolve a `?calendar=<urlName>` query param against the requested event.
   *
   * When `?calendar=` is supplied, the response is 404 unless the event is
   * visible on that calendar (DEC-020: the widget for calendar A renders only
   * events A owns or reposts). Absent or blank → visible with no display
   * calendar; a known calendar that owns or reposts the event → visible with
   * its id; an unknown calendar or a non-member → not visible.
   */
  private async resolveDisplayCalendar(
    rawCalendar: unknown,
    eventId: string,
  ): Promise<{ visible: true; calendarId?: string } | { visible: false }> {
    if (typeof rawCalendar !== 'string') return { visible: true };
    const urlName = rawCalendar.trim();
    if (!urlName) return { visible: true };
    const calendar = await this.service.getCalendarByName(urlName);
    if (!calendar) return { visible: false };
    if (!await this.service.isEventVisibleOnCalendar(eventId, calendar.id)) {
      return { visible: false };
    }
    return { visible: true, calendarId: calendar.id };
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
      // Optional `?calendar=<urlName>` names the display calendar — see
      // resolveDisplayCalendar. Checked before materializing, so a non-member
      // request never writes an instance row.
      const display = await this.resolveDisplayCalendar(req.query.calendar, eventId);
      if (!display.visible) {
        res.status(404).json({
          "error": "instance not found",
          errorName: 'NotFoundError',
        });
        return;
      }
      const displayCalendarId = display.calendarId;

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
