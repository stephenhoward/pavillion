import { EventEmitter } from "events";
import config from 'config';
import { v4 as uuidv4 } from 'uuid';
import { Account } from "@/common/model/account";
import { CalendarEvent, CalendarEventSchedule, EventFrequency } from "@/common/model/events";
import CalendarEventInstance from "@/common/model/event_instance";
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/calendar/entity/event";
import { EventCategoryAssignmentEntity } from "@/server/calendar/entity/event_category_assignment";
import { EventCategoryEntity, EventCategoryContentEntity } from "@/server/calendar/entity/event_category";
import { EventInstanceEntity } from "@/server/calendar/entity/event_instance";
import { CalendarEntity } from "@/server/calendar/entity/calendar";
import { MediaEntity } from "@/server/media/entity/media";
import { Calendar } from "@/common/model/calendar";
import { DateTime, type Zone } from 'luxon';
import rrule from 'rrule';
import { LocationEntity, LocationContentEntity } from "@/server/calendar/entity/location";
import { LocationSpaceEntity, LocationSpaceContentEntity } from "@/server/calendar/entity/location_space";
import { EventSeriesEntity, EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import CalendarService from "./calendar";
import CategoryService from "./categories";
import EventService from "./events";
import { Op, literal, where, fn, col } from 'sequelize';
import { resolveSourceCalendars, type RepostContext } from '../helper/source_calendar';
// The AP interface module is the only door onto ActivityPub state from this
// domain (DEC-003); `EventSourceActor` is re-exported there for that reason.
import type { default as ActivityPubInterface, EventSourceActor } from '@/server/activitypub/interface';
// Type-only: the configuration module graph reaches isomorphic-dompurify,
// so the interface is injected (setConfigurationInterface) rather than built.
import type ConfigurationInterface from '@/server/configuration/interface';
import { LONGEST_DEFAULT_DATE_RANGE_MONTHS } from '@/common/utils/datePresets';
import {
  EventNotFoundError,
  InsufficientCalendarPermissionsError,
  InvalidOccurrenceDateError,
} from '@/common/exceptions/calendar';
import { createLogger } from '@/server/common/helper/logger';
import { parseByDayEntry } from '@/common/utils/recurrence-by-day';

const logger = createLogger('calendar');

/**
 * Associations eager-loaded onto the parent `EventEntity` by every
 * instance detail-path query (getEventInstanceWithDetails and the three
 * queries in findOrMaterializeInstanceWithDetails). Shared so the paths
 * cannot drift: each must yield the same detail shape, including the
 * series the public instance page links to. Sequelize deep-clones query
 * options, so reusing this array across queries is safe.
 */
const EVENT_DETAIL_INCLUDES = [
  EventContentEntity,
  { model: LocationEntity, include: [LocationContentEntity] },
  { model: LocationSpaceEntity, include: [LocationSpaceContentEntity] },
  EventScheduleEntity,
  MediaEntity,
  CalendarEntity,
  { model: EventSeriesEntity, include: [EventSeriesContentEntity] },
];

const { RRule, Weekday } = rrule;

/**
 * Default and floor of the forward generation horizon for recurring event
 * expansion, in months from "now".
 *
 * The horizon itself is the `eventInstanceMonths` service setting; this
 * constant is what that setting is floored at, and what is used when the
 * setting cannot be read. It is the longest option in DEFAULT_DATE_RANGES,
 * so a calendar's default range never runs past its materialized rows.
 *
 * Recurring rrule expansions are materialized for a rolling window of
 * [now, {@link generationWindowEnd}]. On each regeneration (event
 * create/update, or the weekly refresh) the window shifts forward and new
 * future occurrences are materialized.
 *
 * Non-recurring single occurrences (rdates) are NOT subject to this window:
 * they are always materialized 1:1 with their schedule, regardless of
 * whether the start is in the past. This preserves stable shareable public
 * URLs (per DEC-004) for one-off events, their per-event ICS downloads, and
 * their OpenGraph / Twitter card meta tags across regenerations.
 *
 * Bounded recurring schedules (those with `count` or `until`) are still
 * honored by rrule; `between()` simply intersects the bounded series with
 * the window.
 */
export const GENERATION_HORIZON_MONTHS = LONGEST_DEFAULT_DATE_RANGE_MONTHS;

/**
 * End of the generation window: `horizonMonths` from `now`, plus one day,
 * counted in UTC so the result does not depend on the server's zone.
 * A default range ends at the end of its last local day, which can fall up
 * to a day past the same instant N months on in UTC; the extra day keeps
 * that last day materialized in every timezone.
 */
export function generationWindowEnd(now: Date, horizonMonths: number): Date {
  return DateTime.fromJSDate(now, { zone: 'utc' }).plus({ months: horizonMonths, days: 1 }).toJSDate();
}

/** Events read per query by {@link EventInstanceService.refreshAllEventInstances}. */
export const REFRESH_PAGE_SIZE = 100;

/**
 * State tag for an entry in {@link UpcomingOccurrencesResult}:
 *   - 'active': produced by the rrule, no matching exclusion row
 *   - 'cancelled-shown': produced by the rrule, matching RECURRENCE-ID-style
 *     shown cancellation (isExclusion=true, hideFromPublic=false)
 *   - 'hidden': matching EXDATE-style hidden cancellation (isExclusion=true,
 *     hideFromPublic=true) — surfaced to the owner so the cancellation can
 *     be restored even though the public calendar does not show it
 */
export type UpcomingOccurrenceState = 'active' | 'cancelled-shown' | 'hidden';

/**
 * DTO returned by {@link EventInstanceService.listUpcomingOccurrences}.
 * Plain data shape — not a domain model.
 */
export interface UpcomingOccurrence {
  start: DateTime;
  state: UpcomingOccurrenceState;
  /**
   * The EventSchedule row id for cancellation entries. Null for `active`
   * entries because active occurrences are produced by the recurring rrule
   * and have no row of their own.
   */
  scheduleId: string | null;
}

export interface UpcomingOccurrencesResult {
  occurrences: UpcomingOccurrence[];
  hasMore: boolean;
}

/**
 * Parses a stored `by_day` entry (e.g. "MO", "1MO", "-1FR") into an rrule
 * Weekday instance suitable for use in `byweekday`.
 *
 * The stored format is an optional signed ordinal (1..5 or -1..-5) followed by
 * a two-letter ISO weekday code. An ordinal, when present, encodes "the Nth
 * occurrence of that weekday in the period" (used with MONTHLY/YEARLY rules to
 * express e.g. "first Monday of the month").
 *
 * Returns null for unparseable input so callers can skip malformed entries
 * rather than silently coerce them into the wrong weekday. The shared
 * {@link parseByDayEntry} validates the day code against the canonical weekday
 * set; rrule's Weekday.fromStr would otherwise silently yield Weekday(-1) for
 * unknown codes rather than throwing.
 */
function parseByDay(entry: string): InstanceType<typeof Weekday> | null {
  const parsed = parseByDayEntry(entry);
  if (!parsed) {
    return null;
  }
  const weekday = Weekday.fromStr(parsed.dayCode as any);
  return parsed.ordinal !== null ? weekday.nth(parsed.ordinal) : weekday;
}

/**
 * The wall-clock frame an event's recurrences are expanded in: the zone of
 * its {@link CalendarEvent.baseSchedule}, or UTC when it has none.
 *
 * rrule reads and steps the UTC fields of a JS Date. A "floating" date
 * carries a wall-clock time of this zone in those fields, so rrule steps
 * local time and a weekly 10:15 stays at 10:15 across a daylight-saving
 * change. rrule's own `tzid` option is not used: it takes offsets from the
 * process zone, so its results would differ between machines.
 *
 * In UTC the frame is the identity.
 */
class WallClockFrame {
  private constructor(private readonly zone: Zone | string) {}

  static of(base: CalendarEventSchedule | null): WallClockFrame {
    return new WallClockFrame(base?.startDate?.zone ?? 'UTC');
  }

  /** The wall-clock time of `dt` in this zone, as a floating date. */
  toFloating(dt: DateTime): Date {
    return dt.setZone(this.zone).setZone('utc', { keepLocalTime: true }).toJSDate();
  }

  /**
   * The instant at which a floating date's wall-clock time occurs in this
   * zone. A wall time skipped by a change (02:30 on a spring-forward night)
   * moves forward by the gap; one that occurs twice takes Luxon's default
   * offset, the earlier of the two.
   */
  fromFloating(date: Date): DateTime {
    return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(this.zone, { keepLocalTime: true });
  }
}

/**
 * Widens a floating query window so it holds every occurrence whose instant
 * lies in the requested one. Larger than any UTC offset change. Floating
 * order is not instant order around a change (a gap-shifted 02:30 lands
 * after 03:00, and the repeated hour maps two instants to one wall time),
 * so floating bounds alone can drop an in-window occurrence; the slack
 * keeps it, and the exact-instant filter afterwards restores correctness.
 */
const FLOATING_WINDOW_SLACK_MS = 2 * 24 * 60 * 60 * 1000;

/** The upper bound of an open-ended rule walk: rrule's own last year. */
const END_OF_RRULE_TIME = new Date(Date.UTC(9999, 11, 31));

/**
 * An event's occurrences, taking and returning true instants in instant
 * order. Rules and exrules are expanded by rrule in a
 * {@link WallClockFrame}. Single dates stay outside rrule and keep their
 * exact instants: one-off dates are merged in by instant (so two at the
 * same wall time in a repeated hour both survive), and exdates are matched
 * by instant, since a cancellation row stores the instant the occurrence
 * was listed at.
 */
class ZonedOccurrenceSet {
  private readonly rules: InstanceType<typeof RRule>[] = [];
  private readonly exrules: InstanceType<typeof RRule>[] = [];
  private readonly rdateInstants: Date[] = [];
  private readonly exdateMillis = new Set<number>();

  constructor(private readonly frame: WallClockFrame) {}

  addRule(rule: InstanceType<typeof RRule>, exclude: boolean): void {
    (exclude ? this.exrules : this.rules).push(rule);
  }

  addDate(date: DateTime, exclude: boolean): void {
    if (exclude) {
      this.exdateMillis.add(date.toMillis());
    }
    else {
      this.rdateInstants.push(date.toJSDate());
    }
  }

  /** Occurrences whose instant lies in [from, to]. */
  between(from: Date, to: Date): Date[] {
    const lo = new Date(this.floating(from).getTime() - FLOATING_WINDOW_SLACK_MS);
    const hi = new Date(this.floating(to).getTime() + FLOATING_WINDOW_SLACK_MS);
    const exruled = new Set(
      this.exrules.flatMap(r => r.between(lo, hi, true)).map(d => d.getTime()),
    );
    const fromRules = this.rules
      .flatMap(r => r.between(lo, hi, true))
      .filter(d => !exruled.has(d.getTime()))
      .map(d => this.frame.fromFloating(d).toJSDate());
    const fromDates = this.rdateInstants
      .filter(d => !exruled.has(this.floating(d).getTime()));
    return this.inInstantOrder([...fromRules, ...fromDates])
      .filter(d => d >= from && d <= to);
  }

  /**
   * The first occurrence strictly after `date`. Walks each rule once from
   * the slack-widened start. Once a rule yields a candidate, its later wall
   * times past that candidate plus the slack all occur after it, so the walk
   * stops there.
   */
  after(date: Date): Date | null {
    const candidates = this.rdateInstants
      .filter(d => d > date && !this.inExrule(this.floating(d)));
    const lo = new Date(this.floating(date).getTime() - FLOATING_WINDOW_SLACK_MS);
    for (const rule of this.rules) {
      let stopAfter = Infinity;
      rule.between(lo, END_OF_RRULE_TIME, true, floating => {
        if (floating.getTime() > stopAfter) return false;
        const instant = this.frame.fromFloating(floating).toJSDate();
        if (instant > date && !this.exdateMillis.has(instant.getTime()) && !this.inExrule(floating)) {
          candidates.push(instant);
          stopAfter = Math.min(stopAfter, floating.getTime() + FLOATING_WINDOW_SLACK_MS);
        }
        return true;
      });
    }
    return this.inInstantOrder(candidates)[0] ?? null;
  }

  /** One-off dates before `date` that no exdate or exrule covers. */
  oneOffsBefore(date: Date): Date[] {
    return this.inInstantOrder(this.rdateInstants
      .filter(d => d < date && !this.inExrule(this.floating(d))));
  }

  private floating(date: Date): Date {
    return this.frame.toFloating(DateTime.fromJSDate(date));
  }

  private inExrule(floating: Date): boolean {
    const ms = floating.getTime();
    return this.exrules.some(r => r.between(new Date(ms - 1), new Date(ms + 1), true).length > 0);
  }

  /** Drops exdates and duplicate instants, and sorts by instant. */
  private inInstantOrder(dates: Date[]): Date[] {
    const byMillis = new Map<number, Date>();
    for (const d of dates) {
      if (!this.exdateMillis.has(d.getTime())) byMillis.set(d.getTime(), d);
    }
    return Array.from(byMillis.values()).sort((a, b) => a.getTime() - b.getTime());
  }
}

export default class EventInstanceService {
  private eventBus: EventEmitter;
  private categoryService: CategoryService;
  private calendarService: CalendarService;
  private eventService: EventService;
  private activityPubInterface?: ActivityPubInterface;
  private configurationInterface?: ConfigurationInterface;

  constructor(eventBus: EventEmitter, eventService?: EventService) {
    this.eventBus = eventBus;
    this.calendarService = new CalendarService();
    this.categoryService = new CategoryService(this.calendarService);
    // Intra-domain dependency: EventService.listEventIdsForCalendar drives the
    // listing union under the single-producer model. Constructed locally when
    // not supplied so existing callers (and tests) keep working without wiring
    // changes; CalendarInterface injects the shared instance.
    this.eventService = eventService ?? new EventService(eventBus);
  }

  /**
   * Bind the configuration interface the generation horizon is read from.
   * Until bound, the horizon is {@link GENERATION_HORIZON_MONTHS}.
   */
  setConfigurationInterface(configurationInterface: ConfigurationInterface): void {
    this.configurationInterface = configurationInterface;
  }

  /**
   * Resolve the generation horizon in months: the `eventInstanceMonths`
   * setting, floored at {@link GENERATION_HORIZON_MONTHS}. Falls back to the
   * floor when no configuration interface is bound, or the setting is unset,
   * not a positive integer, or unreadable.
   */
  private async resolveGenerationHorizonMonths(): Promise<number> {
    if (!this.configurationInterface) {
      return GENERATION_HORIZON_MONTHS;
    }
    try {
      const months = Number(await this.configurationInterface.getSetting('eventInstanceMonths'));
      if (Number.isInteger(months) && months > 0) {
        return Math.max(months, GENERATION_HORIZON_MONTHS);
      }
    }
    catch (err) {
      logger.warn({ err }, 'Could not read eventInstanceMonths; using the default horizon');
    }
    return GENERATION_HORIZON_MONTHS;
  }

  setActivityPubInterface(apInterface: ActivityPubInterface): void {
    this.activityPubInterface = apInterface;
    // EventService.listEventIdsForCalendar requires the AP interface to be set
    // (it queries getSharedEventStatusMap). When the EventInstanceService
    // constructed its own EventService internally, propagate the AP interface
    // here so the helper can run; when CalendarInterface injected an
    // already-wired EventService, this re-setter is a harmless no-op.
    this.eventService.setActivityPubInterface(apInterface);
  }

  /**
   * Fetches the source actor — the attributed_to actor URI plus the peer's
   * cached public page URL — for a set of event IDs via the AP interface.
   * Returns an empty map if no IDs are provided or if the AP interface is not set.
   *
   * One batched interface call per request, and the AP side reads cache only:
   * every caller of this is a request-synchronous public page read.
   *
   * @param remoteEventIds - Event IDs to resolve source actors for
   * @returns Map of eventId to its source actor
   */
  private async fetchRemoteSourceActorMap(remoteEventIds: string[]): Promise<Map<string, EventSourceActor>> {
    if (remoteEventIds.length === 0 || !this.activityPubInterface) {
      return new Map<string, EventSourceActor>();
    }
    return this.activityPubInterface.getEventSourceActors(remoteEventIds);
  }

  async listEventInstances(event: CalendarEvent): Promise<CalendarEventInstance[]> {
    const eventInstances = await EventInstanceEntity.findAll({
      where: { event_id: event.id },
      include: [{
        model: EventEntity,
        include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
      }],
    });
    const instances = eventInstances.map((instanceEntity) => {
      const instance = instanceEntity.toModel();
      // Populate schedules from the eager-loaded association so the cancellation
      // check below can match without any additional DB query.
      const scheduleEntities = (instanceEntity.event?.getDataValue('schedules') ?? []) as EventScheduleEntity[];
      instance.event.schedules = scheduleEntities.map(s => s.toModel());
      return instance;
    });
    this.markShownCancellations(instances);
    return this.dropHiddenCancellations(instances);
  }

  async listEventInstancesForCalendar(calendar: Calendar): Promise<CalendarEventInstance[]> {

    // Single-producer model: instances are owned by the originating
    // calendar (Option A). Listing for a calendar is the union of every
    // visible event id (own + repost links + AP shared links), then the
    // single canonical instance row per (event_id, start_time).
    const visibleEventIds = await this.eventService.listEventIdsForCalendar(calendar);
    if (visibleEventIds.length === 0) {
      return [];
    }

    const eventInstances = await EventInstanceEntity.findAll({
      where: { event_id: { [Op.in]: visibleEventIds } },
      include: [{
        model: EventEntity,
        include: [
          EventContentEntity,
          LocationEntity,
          { model: LocationSpaceEntity, include: [LocationSpaceContentEntity] },
          EventScheduleEntity,
          MediaEntity,
          CalendarEntity,
        ],
      }],
      order: [['start_time', 'ASC'], ['id', 'ASC']],
    });

    const instances = eventInstances.map((instanceEntity) => {
      const instance = instanceEntity.toModel();
      // Populate schedules from the eager-loaded association so shown-cancellation
      // matching can run without a second DB roundtrip.
      const scheduleEntities = (instanceEntity.event?.getDataValue('schedules') ?? []) as EventScheduleEntity[];
      instance.event.schedules = scheduleEntities.map(s => s.toModel());
      return instance;
    });
    this.markShownCancellations(instances);
    // displayCalendarId is the CALLER calendar — under Option A the row's
    // calendar_id always refers to the originating calendar, not the display
    // context, so we derive display context from the calendar parameter.
    const repostContexts: RepostContext[] = eventInstances.map((entity, i) => ({
      event: instances[i].event,
      displayCalendarId: calendar.id,
      eventCalendarId: entity.event?.calendar_id ?? null,
      sourceCalendarUrlName: entity.event?.calendar?.url_name,
    }));

    // Collect remote event IDs and fetch actor URIs via AP interface
    const remoteEventIds = repostContexts
      .filter(ctx => ctx.eventCalendarId === null)
      .map(ctx => ctx.event.id);
    const remoteSourceActorMap = await this.fetchRemoteSourceActorMap(remoteEventIds);

    await resolveSourceCalendars(repostContexts, remoteSourceActorMap);
    // Filter only after source-calendar resolution: repostContexts is built
    // by index against the entity array.
    return this.dropHiddenCancellations(instances);
  };

  async getEventInstanceById(instanceId: string): Promise<CalendarEventInstance> {
    const eventInstance = await EventInstanceEntity.findOne({
      where: { id: instanceId },
      include: [{
        model: EventEntity,
        include: [
          EventContentEntity,
          LocationEntity,
          { model: LocationSpaceEntity, include: [LocationSpaceContentEntity] },
          EventScheduleEntity,
          MediaEntity,
          { model: EventSeriesEntity, include: [EventSeriesContentEntity] },
        ],
      }],
    });

    if (!eventInstance) {
      throw new Error('Event instance not found');
    }

    const instance = eventInstance.toModel();
    instance.event.categories = await this.categoryService.getEventCategories(instance.event.id, eventInstance.calendar_id);
    return instance;
  }

  /**
   * List event instances for a calendar with combined filters.
   * Each result includes an `isRecurring` boolean derived from whether the event
   * has any schedules (via a lightweight EXISTS subquery).
   *
   * @param calendar - The calendar to filter events for
   * @param options - Filter options (search, categories, startDate, endDate)
   * @returns Filtered event instances, each augmented with isRecurring on the event
   */
  async listEventInstancesWithFilters(calendar: Calendar, options: {
    search?: string;
    categories?: string[];
    startDate?: string;
    endDate?: string;
  } = {}): Promise<CalendarEventInstance[]> {
    // Single-producer model: instances are owned by the originating
    // calendar. Visibility for a calendar is the union of own + repost-link +
    // AP-share-link event ids, computed once via the EventService helper. We
    // scope the instance query by event_id IN (visible) so a single canonical
    // row per (event_id, start_time) participates regardless of display calendar.
    const visibleEventIds = await this.eventService.listEventIdsForCalendar(calendar);
    if (visibleEventIds.length === 0) {
      return [];
    }

    // Build the query for event instances
    const queryOptions: any = {
      where: { event_id: { [Op.in]: visibleEventIds } },
      order: [['start_time', 'ASC'], ['id', 'ASC']],
      include: [
        {
          model: EventEntity,
          as: 'event',
          // Lightweight isRecurring check via EXISTS subquery — avoids a full JOIN
          // on event_schedule for every row in the list view.
          attributes: {
            include: [
              [
                literal(`(SELECT EXISTS(SELECT 1 FROM event_schedule WHERE event_schedule.event_id = "event"."id"))`),
                'isRecurring',
              ],
            ],
          },
          include: [
            LocationEntity,
            { model: LocationSpaceEntity, include: [LocationSpaceContentEntity] },
            MediaEntity,
            CalendarEntity,
            // Schedules are required to mark shown-cancellation instances in-memory.
            // Load here so markShownCancellations() has no extra query to make.
            EventScheduleEntity,
            {
              model: EventCategoryAssignmentEntity,
              as: 'categoryAssignments',
              include: [{
                model: EventCategoryEntity,
                as: 'category',
                include: [EventCategoryContentEntity],
              }],
            },
          ],
        },
      ],
    };

    // Handle search parameter - search in event title/description.
    // Cap at 200 chars at the service boundary to bound query cost on
    // pathological public input. Uses parameterized Op.like via Sequelize's
    // where(fn('LOWER', col(...))) pattern so user input is bound rather than
    // interpolated into SQL — see security-playbook/database-injection.md.
    // LOWER(col) LIKE lower_pattern is dialect-neutral (Op.iLike is
    // PostgreSQL-only; the test suite uses SQLite).
    if (options.search && options.search.trim()) {
      const searchTerm = options.search.trim().substring(0, 200).toLowerCase();

      // Add content to the event include with search filter
      const eventInclude = queryOptions.include[0];
      eventInclude.include.push({
        model: EventContentEntity,
        as: 'content',
        where: {
          [Op.or]: [
            where(fn('LOWER', col('event->content.name')), {
              [Op.like]: `%${searchTerm}%`,
            }),
            where(fn('LOWER', col('event->content.description')), {
              [Op.like]: `%${searchTerm}%`,
            }),
          ],
        },
        required: true, // INNER JOIN to only include events with matching content
      });
    }
    else {
      // Always include content, but without search filter
      const eventInclude = queryOptions.include[0];
      eventInclude.include.push(EventContentEntity);
    }

    // Handle category filter — categories are UUIDs per DEC-005
    if (options.categories && options.categories.length > 0) {
      const categoryIds = options.categories;

      // Find the category assignment include in the event include
      const eventInclude = queryOptions.include[0];
      const categoryAssignmentInclude = eventInclude.include.find(
        (inc: any) => inc.model === EventCategoryAssignmentEntity || inc === EventCategoryAssignmentEntity,
      );

      if (categoryAssignmentInclude && typeof categoryAssignmentInclude === 'object') {
        categoryAssignmentInclude.where = {
          category_id: {
            [Op.in]: categoryIds,
          },
        };
        categoryAssignmentInclude.required = true;
        // Also require the event include so that Sequelize propagates the INNER JOIN
        // correctly. Without this, Sequelize may return EventInstance rows where the
        // event association is null when the nested categoryAssignments filter
        // eliminates all matching rows for that event.
        eventInclude.required = true;
      }
    }

    // Handle date range filter
    const instanceWhere: any = {};

    if (options.startDate || options.endDate) {
      if (options.startDate && options.endDate) {
        // Both start and end date provided - filter by range
        const startDateTime = DateTime.fromISO(options.startDate).startOf('day');
        const endDateTime = DateTime.fromISO(options.endDate).endOf('day');

        instanceWhere.start_time = {
          [Op.gte]: startDateTime.toJSDate(),
          [Op.lte]: endDateTime.toJSDate(),
        };
      }
      else if (options.startDate) {
        // Only start date provided - events on or after this date
        const startDateTime = DateTime.fromISO(options.startDate).startOf('day');
        instanceWhere.start_time = {
          [Op.gte]: startDateTime.toJSDate(),
        };
      }
      else if (options.endDate) {
        // Only end date provided - events on or before this date
        const endDateTime = DateTime.fromISO(options.endDate).endOf('day');
        instanceWhere.start_time = {
          [Op.lte]: endDateTime.toJSDate(),
        };
      }
    }

    if (Object.keys(instanceWhere).length > 0) {
      Object.assign(queryOptions.where, instanceWhere);
    }

    // Execute the query
    const instanceEntities = await EventInstanceEntity.findAll(queryOptions);

    // Convert entities to models and augment with isRecurring
    const mappedInstances = instanceEntities
      // Belt-and-suspenders: eventInclude.required=true should prevent null events,
      // but guard defensively since Sequelize JOIN propagation can vary by dialect.
      .filter(instanceEntity => instanceEntity.event != null)
      .map(instanceEntity => {
        const instance = instanceEntity.toModel();
        const event = instanceEntity.event;

        // Add event content
        if (event.content) {
          for (const c of event.content) {
            instance.event.addContent(c.toModel());
          }
        }

        // Add location
        if (event.location) {
          instance.event.location = event.location.toModel();
        }

        // Add media
        if (event.media) {
          instance.event.media = event.media.toModel();
        }

        // Add categories, filtered to the display calendar so reposted events
        // only show the display calendar's categories
        const categoryAssignments = event.getDataValue('categoryAssignments') as EventCategoryAssignmentEntity[] | undefined;
        if (categoryAssignments) {
          instance.event.categories = categoryAssignments
            .filter(assignment => assignment.category != null && assignment.category.calendar_id === calendar.id)
            .map(assignment => assignment.category.toModel());
        }

        // Populate schedules from the eager-loaded association so
        // markShownCancellations() below can work without a second DB roundtrip.
        const scheduleEntities = (event.getDataValue('schedules') ?? []) as EventScheduleEntity[];
        instance.event.schedules = scheduleEntities.map(s => s.toModel());

        // Attach isRecurring — read from the virtual attribute added by the EXISTS subquery.
        // Sequelize returns it as a number (0/1) in SQLite or boolean in PostgreSQL.
        const isRecurringRaw = event.getDataValue('isRecurring');
        (instance.event as any).isRecurring = Boolean(isRecurringRaw);

        return instance;
      });

    // Mark shown cancellations in-memory from the already-loaded schedules.
    this.markShownCancellations(mappedInstances);

    // Resolve source calendar information for reposted events.
    // displayCalendarId is the CALLER calendar — under Option A the instance
    // row's calendar_id refers to the originating calendar, so the display
    // context is derived from the calendar parameter.
    const validEntities = instanceEntities.filter(e => e.event != null);
    const repostContexts: RepostContext[] = validEntities.map((entity, i) => ({
      event: mappedInstances[i].event,
      displayCalendarId: calendar.id,
      eventCalendarId: entity.event?.calendar_id ?? null,
      sourceCalendarUrlName: entity.event?.calendar?.url_name,
    }));

    // Collect remote event IDs and fetch actor URIs via AP interface
    const remoteEventIds = repostContexts
      .filter(ctx => ctx.eventCalendarId === null)
      .map(ctx => ctx.event.id);
    const remoteSourceActorMap = await this.fetchRemoteSourceActorMap(remoteEventIds);

    await resolveSourceCalendars(repostContexts, remoteSourceActorMap);

    // Filter only after source-calendar resolution: repostContexts is built
    // by index against the entity array.
    return this.dropHiddenCancellations(mappedInstances);
  }

  /**
   * Get a single event instance with full schedule and location content data.
   * Used by the public detail page. Eager-loads EventScheduleEntity and
   * LocationContentEntity (nested inside LocationEntity).
   *
   * @param instanceId - The UUID of the event instance
   * @returns The event instance augmented with schedule detail and recurrence text,
   *          or null if not found
   */
  async getEventInstanceWithDetails(instanceId: string): Promise<CalendarEventInstance | null> {
    const eventInstance = await EventInstanceEntity.findOne({
      where: { id: instanceId },
      include: [{
        model: EventEntity,
        as: 'event',
        include: EVENT_DETAIL_INCLUDES,
      }],
    });

    if (!eventInstance) {
      return null;
    }

    const instance = await this.hydrateInstanceEntity(eventInstance);
    return this.isHiddenCancellation(instance) ? null : instance;
  }

  /**
   * Shared hydration: given a fully-eager-loaded EventInstanceEntity, produce
   * a CalendarEventInstance with schedules populated, shown-cancellations
   * marked, location model hydrated, categories populated, and source
   * calendar resolved. Both getEventInstanceWithDetails and
   * findOrMaterializeInstanceWithDetails delegate to this helper so the
   * detail shape is identical on both paths.
   *
   * Schedules are stripped at the public API boundary (see toPublicEventObject)
   * so they never reach the wire — populating them here is safe for both
   * internal consumers and the public detail page.
   *
   * @param displayCalendarId - Optional. When the caller knows the display
   *   calendar (e.g. the public detail handler resolved it from a `?calendar=`
   *   query param), pass its id so reposted events show that calendar's
   *   category mappings. Under the single-producer model the row's
   *   `calendar_id` is always the originating calendar, so without an explicit
   *   override repost categories on the display calendar are filtered out.
   */
  private async hydrateInstanceEntity(
    eventInstance: EventInstanceEntity,
    displayCalendarId?: string,
  ): Promise<CalendarEventInstance> {
    const instance = eventInstance.toModel();
    const event = eventInstance.event;

    const scheduleEntities = (event.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    instance.event.schedules = scheduleEntities.map((s: EventScheduleEntity) => s.toModel());

    // Mark as cancelled in-memory if a shown-cancellation schedule targets this instance.
    this.markShownCancellations([instance]);

    // Populate location with content (accessibility info)
    if (event.location) {
      instance.event.location = event.location.toModel();
    }
    if (event.space) {
      instance.event.space = event.space.toModel();
    }

    // Populate categories via the category service, filtered to the display
    // calendar so reposted events only show the display calendar's categories.
    // Caller-supplied displayCalendarId wins; otherwise fall back to the row's
    // calendar_id (the originating calendar under the single-producer model).
    instance.event.categories = await this.categoryService.getEventCategories(
      instance.event.id,
      displayCalendarId ?? eventInstance.calendar_id,
    );

    // Resolve source calendar information for reposted events
    const repostContext: RepostContext = {
      event: instance.event,
      displayCalendarId: displayCalendarId ?? eventInstance.calendar_id,
      eventCalendarId: eventInstance.event?.calendar_id ?? null,
      sourceCalendarUrlName: eventInstance.event?.calendar?.url_name,
    };
    const remoteEventIds = repostContext.eventCalendarId === null ? [instance.event.id] : [];
    const remoteSourceActorMap = await this.fetchRemoteSourceActorMap(remoteEventIds);
    await resolveSourceCalendars([repostContext], remoteSourceActorMap);

    return instance;
  }

  /**
   * Derive an occurrence's end time by applying the duration of the event's
   * {@link CalendarEvent.baseSchedule}. Returns null if that schedule has no
   * eventEndTime. Shared by generateInstances and
   * findOrMaterializeInstanceWithDetails so the two paths agree on the
   * computed end time.
   *
   * The duration is wall-clock length in the event's {@link WallClockFrame}:
   * a 22:00–03:00 event still ends at 03:00 on the night the clocks change.
   */
  private computeOccurrenceEndTime(
    event: CalendarEvent,
    startTime: DateTime,
  ): DateTime | null {
    const base = event.baseSchedule();
    if (!base?.startDate || !base.eventEndTime) {
      return null;
    }
    const frame = WallClockFrame.of(base);
    const durationMs = frame.toFloating(base.eventEndTime).getTime()
      - frame.toFloating(base.startDate).getTime();
    if (durationMs <= 0) return null;
    const floatingEnd = new Date(frame.toFloating(startTime).getTime() + durationMs);
    return frame.fromFloating(floatingEnd).setZone(startTime.zone);
  }

  /**
   * Default bound on total persisted instances per event. Used when
   * `calendar.materializationCap` is not present in application config.
   * Protects the lazy-materialization path from anonymous-write amplification
   * through the materialize-on-miss path.
   */
  private static readonly DEFAULT_MATERIALIZATION_CAP = 1000;

  /**
   * Additional pre-flight margin: an unbounded recurring schedule (no
   * UNTIL / COUNT) cannot be probed beyond the generation horizon plus this
   * many months from "now" without calling into rrule. Bounds the RRuleSet
   * walk so a far-future timestamp against an unbounded schedule is rejected
   * before any expensive expansion runs.
   */
  private static readonly UNBOUNDED_PREFLIGHT_MARGIN_MONTHS = 12;

  /**
   * Resolve the per-event materialization cap. Reads from application config
   * at `calendar.materializationCap`, falling back to
   * {@link DEFAULT_MATERIALIZATION_CAP} when unset.
   */
  private getMaterializationCap(): number {
    try {
      if (config.has('calendar.materializationCap')) {
        const value = config.get<number>('calendar.materializationCap');
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          return value;
        }
      }
    }
    catch {
      // Fall through to default on any config lookup error.
    }
    return EventInstanceService.DEFAULT_MATERIALIZATION_CAP;
  }

  /**
   * Look up an event instance by `(eventId, startTime)` with the same eager
   * loading as {@link getEventInstanceWithDetails}. On cache miss, validate
   * that `startTime` coincides with an occurrence produced by the event's
   * RRuleSet; if valid and not cancelled-hidden, materialize and persist a
   * new `EventInstanceEntity` row. Cancelled-shown occurrences return an
   * in-memory `CalendarEventInstance` with `isCancelled=true` and are not
   * persisted.
   *
   * Defensive bounds:
   *  - Pre-flight horizon check for unbounded recurring schedules (returns
   *    null before invoking rrule)
   *  - Per-event materialization cap (returns null at the cap)
   *
   * Concurrency: protected by the unique index on `(event_id, start_time)`.
   * On unique-violation during the race, the loser re-fetches the row the
   * winner inserted via the same hydration helper used for cache hits.
   *
   * @param eventId - The owning event ID
   * @param startTime - Occurrence start datetime (minute precision)
   * @param displayCalendarId - Optional display calendar id (e.g. resolved from
   *   a `?calendar=urlName` query param). Forwarded to hydration so reposted
   *   events show category mappings on the display calendar rather than the
   *   originating calendar.
   * @returns Hydrated CalendarEventInstance or null if not found / invalid
   */
  async findOrMaterializeInstanceWithDetails(
    eventId: string,
    startTime: DateTime,
    displayCalendarId?: string,
  ): Promise<CalendarEventInstance | null> {
    const startMs = startTime.toUTC().toMillis();
    const startDate = new Date(startMs);

    // 1. Cache hit via a single eager-load of the existing row.
    const cached = await EventInstanceEntity.findOne({
      where: { event_id: eventId, start_time: startDate },
      include: [{
        model: EventEntity,
        as: 'event',
        include: EVENT_DETAIL_INCLUDES,
      }],
    });
    if (cached) {
      // Short-circuit: do not re-validate against the RRuleSet. Materialized
      // rows are authoritative; a subsequent schedule edit that would now
      // reject this date does not invalidate a pre-existing bookmark. A hidden
      // cancellation is the exception: the row survives cancellation (the
      // cancel handler skips the rebuild), so it must not resolve publicly.
      const instance = await this.hydrateInstanceEntity(cached, displayCalendarId);
      return this.isHiddenCancellation(instance) ? null : instance;
    }

    // 2. Load the event with BOTH schedules and the detail-page associations
    //    in a single query. This eliminates the need for a second fetch on
    //    the cancelled-shown path — every branch from here on works from the
    //    same entity.
    const eventEntity = await EventEntity.findByPk(eventId, {
      include: EVENT_DETAIL_INCLUDES,
    });
    if (!eventEntity) {
      return null;
    }
    const event = eventEntity.toModel();
    const scheduleEntities = (eventEntity.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    event.schedules = scheduleEntities.map(s => s.toModel());

    // 3. Pre-flight guard: reject far-future probes on unbounded schedules.
    const preflightMonths = await this.resolveGenerationHorizonMonths()
      + EventInstanceService.UNBOUNDED_PREFLIGHT_MARGIN_MONTHS;
    if (this.exceedsUnboundedHorizon(event, startTime, preflightMonths)) {
      return null;
    }

    // 4. Validate occurrence membership via the RRuleSet.
    try {
      this.assertDateMatchesOccurrence(event, startTime);
    }
    catch (err) {
      if (err instanceof InvalidOccurrenceDateError) {
        return null;
      }
      throw err;
    }

    // 5. Exclusion rows.
    const exclusion = (event.schedules ?? []).find(s =>
      s.isExclusion
      && s.startDate
      && s.startDate.toUTC().toMillis() === startMs,
    );
    if (exclusion) {
      if (exclusion.hideFromPublic) {
        return null;
      }
      // Shown cancellation: build a transient in-memory instance directly
      // from the already-loaded eventEntity. No second fetch, no persistence.
      return this.buildTransientCancelledInstance(eventEntity, startTime, displayCalendarId);
    }

    // 6. Materialization cap.
    const cap = this.getMaterializationCap();
    const persistedCount = await EventInstanceEntity.count({
      where: { event_id: eventId },
    });
    if (persistedCount >= cap) {
      logger.warn(
        { eventId, persistedCount, cap },
        'materialization cap reached; refusing to persist new instance',
      );
      return null;
    }

    // 7. Materialize + persist with unique-constraint catch.
    const endTime = this.computeOccurrenceEndTime(event, startTime);
    const row = EventInstanceEntity.build({
      id: uuidv4(),
      event_id: eventId,
      calendar_id: eventEntity.calendar_id,
      start_time: startDate,
      end_time: endTime ? endTime.toJSDate() : null,
    });
    try {
      await row.save();
    }
    catch (err: any) {
      if (err?.name !== 'SequelizeUniqueConstraintError') {
        throw err;
      }
      // Fall through: winner already inserted. Re-fetch the row via the
      // same eager-load below so both racers see the identical hydrated
      // detail shape. The unique index on (event_id, start_time) is what
      // makes this branch reachable and reliable.
    }

    const persisted = await EventInstanceEntity.findOne({
      where: { event_id: eventId, start_time: startDate },
      include: [{
        model: EventEntity,
        as: 'event',
        include: EVENT_DETAIL_INCLUDES,
      }],
    });
    if (!persisted) return null;
    return this.hydrateInstanceEntity(persisted, displayCalendarId);
  }

  /**
   * Pre-flight check that bounds how far into the future an unbounded
   * recurring schedule (no UNTIL, no COUNT) can be probed before rrule is
   * called. For bounded schedules, rrule's own bounds already limit work;
   * for unbounded schedules, an attacker probing year-distant timestamps
   * would drive O(occurrences-since-dtstart) work per request.
   */
  private exceedsUnboundedHorizon(event: CalendarEvent, startTime: DateTime, preflightMonths: number): boolean {
    const now = DateTime.utc();
    const horizon = now.plus({ months: preflightMonths });
    if (startTime <= horizon) return false;

    // Only guard when at least one schedule is recurring-unbounded
    // (no COUNT, no endDate=UNTIL).
    const hasUnbounded = (event.schedules ?? []).some(s =>
      !s.isExclusion
      && s.frequency
      && !s.count
      && !s.endDate,
    );
    return hasUnbounded;
  }

  /**
   * Synthesize a cancelled in-memory instance from an already-loaded event
   * entity — no extra DB round-trip. Used for the cancelled-shown branch of
   * {@link findOrMaterializeInstanceWithDetails}.
   */
  private async buildTransientCancelledInstance(
    eventEntity: EventEntity,
    startTime: DateTime,
    displayCalendarId?: string,
  ): Promise<CalendarEventInstance> {
    const eventModel = eventEntity.toModel();
    const scheduleEntities = (eventEntity.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    eventModel.schedules = scheduleEntities.map(s => s.toModel());
    if (eventEntity.location) {
      eventModel.location = eventEntity.location.toModel();
    }
    if (eventEntity.space) {
      eventModel.space = eventEntity.space.toModel();
    }
    eventModel.categories = await this.categoryService.getEventCategories(
      eventModel.id,
      displayCalendarId ?? eventEntity.calendar_id,
    );

    const endTime = this.computeOccurrenceEndTime(eventModel, startTime);
    const instance = new CalendarEventInstance(
      `transient-${startTime.toUTC().toMillis()}`,
      eventModel,
      startTime.toUTC(),
      endTime,
    );
    instance.isCancelled = true;

    const repostContext: RepostContext = {
      event: instance.event,
      displayCalendarId: displayCalendarId ?? eventEntity.calendar_id,
      eventCalendarId: eventEntity.calendar_id ?? null,
      sourceCalendarUrlName: eventEntity.calendar?.url_name,
    };
    const remoteEventIds = repostContext.eventCalendarId === null ? [instance.event.id] : [];
    const remoteSourceActorMap = await this.fetchRemoteSourceActorMap(remoteEventIds);
    await resolveSourceCalendars([repostContext], remoteSourceActorMap);

    return instance;
  }

  /**
   * Regenerates the event's materialised instance rows from its schedules.
   *
   * Two statements, deliberately not in a transaction: on in-memory SQLite
   * the one shared connection cannot hold this rebuild's transaction while
   * the ActivityPub handlers fired by the same emit hold theirs. They are
   * ordered so either failure is safe instead:
   *
   * 1. Upsert the generated rows on the unique (event_id, start_time) index.
   *    A surviving start time keeps its row id and takes the new end time.
   *    If this fails nothing has changed.
   * 2. Prune this event's rows at or after `now` that were not generated.
   *    Rows before `now` are the event's history in listings and are never
   *    deleted. If this fails, occurrences the edit removed linger until the
   *    next rebuild; the event is never left without its future rows.
   */
  async buildEventInstances(event: CalendarEvent, now: Date = new Date()): Promise<void> {

    if ( ! event.schedules || ! event.schedules.length ) {
      const schedules = await EventScheduleEntity.findAll({
        where: { event_id: event.id },
        order: [['start_date', 'ASC']],
      });
      event.schedules = schedules.map(schedule => schedule.toModel());
    }

    const horizonMonths = await this.resolveGenerationHorizonMonths();
    const rows = this.generateInstances(event, now, horizonMonths).map(instance => ({
      ...EventInstanceEntity.fromModel(instance).get({ plain: true }),
      event_id: event.id,
    }));

    if ( rows.length ) {
      await EventInstanceEntity.bulkCreate(rows, {
        conflictAttributes: ['event_id', 'start_time'],
        updateOnDuplicate: ['calendar_id', 'end_time', 'updatedAt'],
      });
    }

    const startTimeFilter: Record<symbol, unknown> = { [Op.gte]: now };
    if ( rows.length ) {
      startTimeFilter[Op.notIn] = rows.map(row => row.start_time);
    }
    await EventInstanceEntity.destroy({
      where: { event_id: event.id, start_time: startTimeFilter },
    });
  }
  async removeEventInstances(event: CalendarEvent): Promise<void> {
    const eventInstances = await EventInstanceEntity.findAll({
      where: { event_id: event.id },
    });
    for ( let instance of eventInstances ) {
      await instance.destroy();
    }
  }

  /**
   * Loads the event and confirms the caller has editor permission on the
   * owning calendar. Returns the resolved { event, calendar } pair; throws
   * EventNotFoundError / InsufficientCalendarPermissionsError otherwise.
   *
   * Security binding: performs existence + editor-permission check BEFORE
   * populating schedules on the model, preserving auth-before-use ordering.
   * Both EventNotFoundError and InsufficientCalendarPermissionsError are
   * remapped to HTTP 404 at the handler layer (IDOR prevention).
   */
  private async loadEventForEditor(account: Account, eventId: string): Promise<{ event: CalendarEvent; calendar: Calendar }> {
    const eventEntity = await EventEntity.findByPk(eventId, {
      include: [EventScheduleEntity],
    });
    if (!eventEntity || !eventEntity.calendar_id) {
      throw new EventNotFoundError('Event not found');
    }

    const calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
    if (!calendar) {
      throw new EventNotFoundError('Event not found');
    }

    const calendars = await this.calendarService.editableCalendarsForUser(account);
    if (!calendars.some(c => c.id === calendar.id)) {
      throw new InsufficientCalendarPermissionsError(
        'Insufficient permissions to modify events in this calendar',
      );
    }

    const event = eventEntity.toModel();
    const scheduleEntities = (eventEntity.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    event.schedules = scheduleEntities.map(s => s.toModel());
    return { event, calendar };
  }

  /**
   * Core idempotent write: find-or-create / flip-in-place an exclusion
   * schedule row anchored on startDate. Returns true if a change was made,
   * false if the row already matched and nothing was written.
   */
  private async writeExclusionRow(
    eventId: string,
    startDate: Date,
    hideFromPublic: boolean,
  ): Promise<boolean> {
    const existing = await EventScheduleEntity.findOne({
      where: { event_id: eventId, start_date: startDate, is_exclusion: true },
    });
    if (existing) {
      if (existing.hide_from_public === hideFromPublic) {
        return false;
      }
      existing.hide_from_public = hideFromPublic;
      await existing.save();
      return true;
    }
    const row = EventScheduleEntity.build({
      id: uuidv4(),
      event_id: eventId,
      timezone: 'UTC',
      start_date: startDate,
      end_date: null,
      event_end_time: null,
      frequency: null,
      interval: 0,
      count: 0,
      by_day: '',
      is_exclusion: true,
      hide_from_public: hideFromPublic,
    });
    await row.save();
    return true;
  }

  /**
   * Core delete: remove an exclusion schedule row anchored on startDate.
   * Returns true if a row was removed, false if nothing matched.
   */
  private async deleteExclusionRow(eventId: string, startDate: Date): Promise<boolean> {
    const existing = await EventScheduleEntity.findOne({
      where: { event_id: eventId, start_date: startDate, is_exclusion: true },
    });
    if (!existing) return false;
    await existing.destroy();
    return true;
  }

  /**
   * Validates that startDate coincides with an actual occurrence produced by
   * the event's RRuleSet. Throws InvalidOccurrenceDateError otherwise.
   *
   * Uses a ±1ms window to accommodate tiny floating-point rounding between
   * Luxon DateTime and JS Date. Caller is expected to have already
   * truncated startDate to millisecond precision.
   */
  private assertDateMatchesOccurrence(event: CalendarEvent, startDate: DateTime): void {
    const rruleSet = this.rrules(event);
    const ms = startDate.toUTC().toMillis();
    const hits = rruleSet.between(new Date(ms - 1), new Date(ms + 1));
    if (hits.length === 0) {
      throw new InvalidOccurrenceDateError();
    }
  }

  /**
   * Date-based cancellation. Keyed by an ISO occurrence start rather than a
   * materialized instance ID — decouples the UI from the materialization
   * horizon.
   *
   * Security binding: truncates startDate to millisecond precision before
   * validating occurrence membership to avoid sub-ms drift bypassing the
   * strict-date check.
   *
   * @param account - Authenticated account (must be calendar editor)
   * @param eventId - The owning event ID
   * @param startDate - Occurrence start datetime; must match the rrule
   * @param hideFromPublic - true for EXDATE-style hidden, false for
   *                         RECURRENCE-ID-style shown cancellation
   */
  async cancelOccurrenceByDate(
    account: Account,
    eventId: string,
    startDate: DateTime,
    hideFromPublic: boolean,
  ): Promise<void> {
    const { event, calendar } = await this.loadEventForEditor(account, eventId);
    // Truncate sub-millisecond precision before strict-date validation —
    // anything finer than ms is not representable by a JS Date and cannot
    // be matched against an RRuleSet expansion.
    const truncatedStart = startDate.startOf('millisecond');
    this.assertDateMatchesOccurrence(event, truncatedStart);

    const changed = await this.writeExclusionRow(
      eventId,
      truncatedStart.toUTC().toJSDate(),
      hideFromPublic,
    );
    if (!changed) {
      logger.info(
        { calendarId: calendar.id, eventId, startDate: truncatedStart.toISO() },
        'cancelOccurrenceByDate no-op: existing cancellation matches requested mode',
      );
      return;
    }

    logger.info(
      { calendarId: calendar.id, eventId, startDate: truncatedStart.toISO() },
      'Cancelled event occurrence by date',
    );

    this.eventBus.emit('eventInstanceCancelled', {
      calendar,
      event,
      hideFromPublic,
    });
  }

  /**
   * Date-based restore. Deletes the exclusion row for the given start date
   * if one exists; silent no-op otherwise.
   *
   * Asymmetry with cancelOccurrenceByDate: restore intentionally SKIPS
   * strict-date validation. Rationale: the success criterion of "restore"
   * is "exclusion row absent for this date," which any non-matching input
   * trivially satisfies. Validating the date would only raise pointless
   * errors for input that is already in the desired state.
   *
   * @param account - Authenticated account (must be calendar editor)
   * @param eventId - The owning event ID
   * @param startDate - Occurrence start datetime for the exclusion row
   */
  async restoreOccurrenceByDate(
    account: Account,
    eventId: string,
    startDate: DateTime,
  ): Promise<void> {
    const { event, calendar } = await this.loadEventForEditor(account, eventId);

    const removed = await this.deleteExclusionRow(eventId, startDate.toUTC().toJSDate());

    logger.info(
      { calendarId: calendar.id, eventId, startDate: startDate.toISO() },
      'Restored event occurrence by date',
    );

    if (removed) {
      this.eventBus.emit('eventInstanceRestored', {
        calendar,
        event,
      });
    }
  }

  /**
   * Rebuilds the instance rows of every event against `now`, advancing each
   * event's materialised window to the generation horizon. Body of the
   * weekly `instances:refresh` worker job, and of the dev/e2e startup
   * refresh.
   *
   * Covers remote-origin events (`calendar_id` null) as well as local ones:
   * their rows are otherwise built only when the event is received.
   *
   * Calls buildEventInstances directly rather than emitting `eventUpdated`,
   * which would also reach the ActivityPub handler and announce an Update to
   * followers for what is only a local regeneration.
   *
   * Events are read in pages keyed on id. One event's failure is logged with
   * its id and counted; it does not stop the run.
   *
   * @param now - the instant the generation window is anchored at
   * @param pageSize - number of events read per query
   * @returns how many events were rebuilt and how many failed
   */
  async refreshAllEventInstances(
    now: Date = new Date(),
    pageSize: number = REFRESH_PAGE_SIZE,
  ): Promise<{ refreshed: number; failed: number }> {
    let refreshed = 0;
    let failed = 0;
    let lastId: string | null = null;

    for (;;) {
      const page: EventEntity[] = await EventEntity.findAll({
        where: lastId ? { id: { [Op.gt]: lastId } } : {},
        order: [['id', 'ASC']],
        limit: pageSize,
      });

      for (const eventEntity of page) {
        try {
          await this.buildEventInstances(eventEntity.toModel(), now);
          refreshed++;
        }
        catch (error) {
          failed++;
          logger.error({ err: error, eventId: eventEntity.id }, 'Event instance refresh failed');
        }
      }

      if (page.length < pageSize) {
        break;
      }
      lastId = page[page.length - 1].id;
    }

    return { refreshed, failed };
  }

  /**
   * Builds the occurrence set from an event's schedules, distinguishing between
   * hidden (EXDATE-style) and shown (RECURRENCE-ID-style) cancellations.
   *
   * Exclusion schedules only contribute exdate/exrule suppression to the set
   * when they are BOTH `isExclusion = true` AND `hideFromPublic = true`.
   * Shown cancellations (isExclusion = true, hideFromPublic = false) do not
   * emit exdate or rdate — their underlying occurrence is still produced by
   * the parent recurring rule, and the listing layer marks the materialized
   * instance as `isCancelled = true` instead. See
   * {@link markShownCancellations}.
   *
   * Zone convention: an event steps in its base schedule's zone. Every
   * recurrence steps wall-clock time in the {@link WallClockFrame} of the
   * event's {@link CalendarEvent.baseSchedule} — the non-exclusion schedule
   * with the earliest start, ties broken by id — whatever order the
   * schedules load in. dtstart, until and exrule starts enter that frame;
   * so does every query bound, and every result leaves it as a true
   * instant in instant order, so callers deal in instants only. A wall
   * time skipped by a change moves forward by the gap; one that occurs
   * twice takes the earlier offset. Single dates (rdates and hidden
   * one-off cancellations) keep their exact instants.
   */
  private rrules(event: CalendarEvent): ZonedOccurrenceSet {
    const frame = WallClockFrame.of(event.baseSchedule());
    const occurrences = new ZonedOccurrenceSet(frame);

    // Map our EventFrequency enum to RRule's Frequency enum
    const frequencyMap: Record<EventFrequency, number> = {
      [EventFrequency.DAILY]: RRule.DAILY,
      [EventFrequency.WEEKLY]: RRule.WEEKLY,
      [EventFrequency.MONTHLY]: RRule.MONTHLY,
      [EventFrequency.YEARLY]: RRule.YEARLY,
    };
    for (let schedule of event.schedules) {
      // Only hidden cancellations (is_exclusion=true AND hide_from_public=true)
      // contribute suppression to the rrule set. Shown cancellations are no-ops
      // here — the underlying occurrence is still produced by the parent rule
      // and is flagged as cancelled at listing time.
      const isHiddenCancellation = schedule.isExclusion && schedule.hideFromPublic;
      const isShownCancellation = schedule.isExclusion && !schedule.hideFromPublic;
      if (isShownCancellation) {
        continue;
      }

      const frequency = schedule.frequency !== null
        ? frequencyMap[schedule.frequency]
        : undefined;
      // NB: RRule.YEARLY === 0 so a truthy check would skip yearly schedules.
      // Compare against undefined explicitly so all mapped frequencies (0..3)
      // flow into the rrule branch.
      if ( frequency !== undefined ) {
        let options: Record<string,any> = {
          freq: frequency,
          interval: schedule.interval,
          dtstart: schedule.startDate ? frame.toFloating(schedule.startDate) : undefined,
        };
        if ( schedule.count ) {
          options.count = schedule.count;
        }
        else if ( schedule.endDate ) {
          options.until = frame.toFloating(schedule.endDate);
        }
        if ( schedule.byDay?.length ) {
          const weekdays = schedule.byDay
            .map(parseByDay)
            .filter((w): w is InstanceType<typeof Weekday> => w !== null);
          if (weekdays.length) {
            options.byweekday = weekdays;
          }
        }
        occurrences.addRule(new RRule(options), isHiddenCancellation);
      }
      else if (schedule.startDate) {
        occurrences.addDate(schedule.startDate, isHiddenCancellation);
      }
    }
    return occurrences;
  }

  /**
   * Mutates the given instances in-place to set `isCancelled = true` for any
   * instance whose start matches a shown-cancellation schedule
   * (is_exclusion = true, hide_from_public = false) on the parent event.
   *
   * Reads only from the event's already-loaded schedules — no additional DB
   * query. Matching is by UTC millisecond timestamp so timezone/zone handling
   * on either side does not cause a false negative.
   */
  private markShownCancellations(instances: CalendarEventInstance[]): void {
    for (const instance of instances) {
      const schedules = instance.event?.schedules;
      if (!schedules || schedules.length === 0) {
        continue;
      }
      const instanceStartMs = instance.start.toUTC().toMillis();
      for (const schedule of schedules) {
        if (
          schedule.isExclusion
          && !schedule.hideFromPublic
          && schedule.startDate
          && schedule.startDate.toUTC().toMillis() === instanceStartMs
        ) {
          instance.isCancelled = true;
          break;
        }
      }
    }
  }

  /**
   * True when the instance's start matches a hidden-cancellation schedule
   * (is_exclusion = true, hide_from_public = true) on the parent event.
   *
   * The materialized row survives a hidden cancellation because the cancel
   * handler skips the instance rebuild, so public read paths must filter it
   * in memory. Reads only the already-loaded schedules and matches by UTC
   * millisecond, like {@link markShownCancellations}.
   */
  private isHiddenCancellation(instance: CalendarEventInstance): boolean {
    const schedules = instance.event?.schedules;
    if (!schedules || schedules.length === 0) {
      return false;
    }
    const instanceStartMs = instance.start.toUTC().toMillis();
    return schedules.some(schedule =>
      schedule.isExclusion
      && schedule.hideFromPublic
      && schedule.startDate
      && schedule.startDate.toUTC().toMillis() === instanceStartMs,
    );
  }

  /**
   * Returns the instances minus any hidden cancellation
   * (see {@link isHiddenCancellation}).
   */
  private dropHiddenCancellations(instances: CalendarEventInstance[]): CalendarEventInstance[] {
    return instances.filter(instance => !this.isHiddenCancellation(instance));
  }

  /**
   * Expands the event's RRuleSet beyond the materialization horizon to return
   * a window of upcoming occurrences. Differs from {@link generateInstances} in
   * two ways:
   *   1. Does not persist — results are transient DTOs for UI consumption.
   *   2. Not bound by the generation horizon — the caller supplies the
   *      window via (afterDate, limit).
   *
   * Each occurrence is tagged with a state:
   *   - 'active': produced by the rrule, no matching exclusion row
   *   - 'cancelled-shown': produced by the rrule, matching exclusion row with
   *                        hide_from_public=false
   *   - 'hidden': matching exclusion row with hide_from_public=true (absent
   *               from the RRuleSet output but surfaced in results so the
   *               owner can see and restore it)
   *
   * Signature note: this method takes an event-first signature rather than the
   * typical `(account, ...)` pattern. The editor authorization check is
   * performed handler-side before calling this service method. See the
   * cancel-recurring-occurrence-ux plan (Task 2) for rationale.
   *
   * @param event - The recurring event; its schedules must be loaded
   * @param afterDate - Occurrences with start strictly greater than afterDate are included
   * @param limit - Maximum occurrences to return (caller-clamped to [1, 50])
   * @returns Occurrences with state flags and a hasMore indicator
   */
  async listUpcomingOccurrences(
    event: CalendarEvent,
    afterDate: DateTime,
    limit: number,
  ): Promise<UpcomingOccurrencesResult> {
    const rruleSet = this.rrules(event);

    // Pull limit + 1 to compute hasMore. `after` takes a JS Date and returns
    // the next occurrence strictly greater. Walk forward in a bounded loop.
    const produced: Date[] = [];
    let cursor = afterDate.toJSDate();
    for (let i = 0; i <= limit; i++) {
      const next = rruleSet.after(cursor);
      if (!next) break;
      produced.push(next);
      cursor = next;
    }
    const hasMoreFromRrule = produced.length > limit;
    const rruleDates = produced.slice(0, limit);

    // Collect hidden-cancellation dates after afterDate; they are not in the
    // RRuleSet output (exrule/exdate suppressed them) but we want the user to
    // see and restore them.
    const afterMs = afterDate.toMillis();
    const hiddenSchedules = (event.schedules ?? []).filter(s =>
      s.isExclusion && s.hideFromPublic && s.startDate
      && s.startDate.toMillis() > afterMs,
    );

    // Build unified set, dedupe by ms timestamp (hidden dates should never
    // appear in rruleDates, but guard defensively).
    const byMs = new Map<number, UpcomingOccurrence>();
    for (const d of rruleDates) {
      const start = DateTime.fromJSDate(d).toUTC();
      byMs.set(start.toMillis(), { start, state: 'active', scheduleId: null });
    }
    // Tag shown cancellations: the underlying rrule-produced date whose start
    // matches a shown-exclusion schedule.
    for (const schedule of event.schedules ?? []) {
      if (!schedule.isExclusion || schedule.hideFromPublic || !schedule.startDate) continue;
      const ms = schedule.startDate.toUTC().toMillis();
      if (byMs.has(ms)) {
        byMs.set(ms, {
          start: schedule.startDate.toUTC(),
          state: 'cancelled-shown',
          scheduleId: schedule.id ?? null,
        });
      }
    }
    for (const schedule of hiddenSchedules) {
      const start = schedule.startDate!.toUTC();
      byMs.set(start.toMillis(), {
        start,
        state: 'hidden',
        scheduleId: schedule.id ?? null,
      });
    }

    // Sort and truncate to `limit`. hasMore is true if the RRule produced more
    // than limit OR any hidden schedule fell outside the first `limit` slots.
    const merged = Array.from(byMs.values()).sort(
      (a, b) => a.start.toMillis() - b.start.toMillis(),
    );
    const occurrences = merged.slice(0, limit);
    const hasMore = hasMoreFromRrule || merged.length > limit;

    return { occurrences, hasMore };
  }

  /**
   * Generates event instances from the event's schedules using RRule.
   *
   * Instance materialization differentiates between two schedule kinds:
   *
   * 1. **Recurring expansions (rrule)** are materialized for a forward
   *    rolling window of [now, {@link generationWindowEnd}]. Bounded
   *    schedules (with `count` or `until`) are still honored by rrule —
   *    `between()` intersects the bounded series with the window.
   *
   * 2. **Non-recurring single occurrences (rdate)** are materialized 1:1
   *    with their schedule regardless of whether the start is in the past.
   *    This preserves stable shareable public URLs (DEC-004) for one-off
   *    events, per-event ICS downloads, and OG/Twitter card meta tags
   *    across regenerations. Hidden cancellations (exdate and exrule) still
   *    suppress past rdates the same way they suppress future ones.
   *
   * Computes instance end times by applying the duration derived from the
   * event's base schedule (see {@link computeOccurrenceEndTime}). If it has no
   * eventEndTime, instances receive null end times.
   *
   * @param event - The event containing schedules to generate instances from
   * @param now - The reference "now" for window computation
   * @param horizonMonths - The resolved generation horizon, from
   *              {@link resolveGenerationHorizonMonths}
   * @returns Array of CalendarEventInstance with computed start and end times
   */
  private generateInstances(event: CalendarEvent, now: Date, horizonMonths: number): CalendarEventInstance[] {
    const rruleSet = this.rrules(event);

    const windowEnd = generationWindowEnd(now, horizonMonths);

    // Recurring expansions + any rdates that happen to fall inside the window.
    const windowedDates = rruleSet.between(now, windowEnd);

    // Past rdates below the window's lower bound must still be materialized,
    // so that a one-off event's row (and its shareable anonymous URL) does
    // not vanish on regeneration once the event date has passed. Hidden
    // cancellations, one-off or recurring, still suppress past dates.
    const pastRdates = rruleSet.oneOffsBefore(now);

    // Union, dedupe by timestamp, and sort chronologically.
    const seen = new Set<number>();
    const allDates: Date[] = [...pastRdates, ...windowedDates]
      .filter(d => {
        const t = d.getTime();
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .sort((a, b) => a.getTime() - b.getTime());

    return allDates.map((date: Date) => {
      // Minute-truncation invariant: event_instance.start_time is stored at
      // minute precision because the public instance slug (yyyymmdd-hhmm) and
      // the findOrMaterializeInstanceWithDetails cache-hit lookup both do
      // exact equality against a minute-precise DateTime. RRule inherits
      // sub-minute precision from dtstart if present, so truncate here —
      // this is the single materialization point for every stored row.
      // Enforced by migration 0025's unique index on (event_id, start_time).
      const startDate = DateTime.fromJSDate(date).startOf('minute');
      // Duration is applied per-occurrence via the shared helper so that
      // findOrMaterializeInstanceWithDetails computes end times identically.
      const endDate = this.computeOccurrenceEndTime(event, startDate);

      return CalendarEventInstance.fromObject({
        id: uuidv4(),
        event: event,
        start: startDate,
        end: endDate,
      });
    });
  }
}
