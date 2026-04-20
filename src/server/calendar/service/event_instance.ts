import { EventEmitter } from "events";
import { v4 as uuidv4 } from 'uuid';
import { CalendarEvent, EventFrequency } from "@/common/model/events";
import CalendarEventInstance from "@/common/model/event_instance";
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/calendar/entity/event";
import { EventCategoryAssignmentEntity } from "@/server/calendar/entity/event_category_assignment";
import { EventCategoryEntity, EventCategoryContentEntity } from "@/server/calendar/entity/event_category";
import { EventInstanceEntity } from "@/server/calendar/entity/event_instance";
import { CalendarEntity } from "@/server/calendar/entity/calendar";
import { MediaEntity } from "@/server/media/entity/media";
import { Calendar } from "@/common/model/calendar";
import { DateTime, Duration } from 'luxon';
import rrule from 'rrule';
import { LocationEntity, LocationContentEntity } from "@/server/calendar/entity/location";
import { EventSeriesEntity, EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import CategoryService from "./categories";
import { Op, literal } from 'sequelize';
import { EventRepostEntity } from "@/server/calendar/entity/event_repost";
import { getRecurrenceText } from '@/common/utils/recurrence-text';
import { resolveSourceCalendars, type RepostContext } from '../helper/source_calendar';
import type ActivityPubInterface from '@/server/activitypub/interface';

const { RRule, RRuleSet, Weekday, ALL_WEEKDAYS } = rrule;

/**
 * Forward generation window for recurring event expansion, in months from
 * "now".
 *
 * Recurring rrule expansions are materialized for a rolling window of
 * [now, now + HORIZON]. On each regeneration (e.g. event create/update) the
 * window shifts forward, so past recurring occurrences drop out and new
 * future ones are materialized.
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
export const GENERATION_HORIZON_MONTHS = 6;

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
 * rather than silently coerce them into the wrong weekday. Note: rrule's
 * Weekday.fromStr silently yields Weekday(-1) for unknown codes rather than
 * throwing, so we explicitly validate the day code against ALL_WEEKDAYS.
 */
function parseByDay(entry: string): InstanceType<typeof Weekday> | null {
  const match = entry.match(/^(-?\d+)?([A-Z]{2})$/);
  if (!match) {
    return null;
  }
  const [, ordinal, dayCode] = match;
  if (!ALL_WEEKDAYS.includes(dayCode as any)) {
    return null;
  }
  const weekday = Weekday.fromStr(dayCode as any);
  return ordinal ? weekday.nth(parseInt(ordinal, 10)) : weekday;
}

export default class EventInstanceService {
  private eventBus: EventEmitter;
  private categoryService: CategoryService;
  private activityPubInterface?: ActivityPubInterface;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.categoryService = new CategoryService();
  }

  setActivityPubInterface(apInterface: ActivityPubInterface): void {
    this.activityPubInterface = apInterface;
  }

  /**
   * Fetches remote actor URIs for a set of event IDs via the AP interface.
   * Returns an empty map if no IDs are provided or if the AP interface is not set.
   *
   * @param remoteEventIds - Event IDs to resolve actor URIs for
   * @returns Map of eventId to attributed_to actor URI
   */
  private async fetchRemoteActorUriMap(remoteEventIds: string[]): Promise<Map<string, string>> {
    if (remoteEventIds.length === 0 || !this.activityPubInterface) {
      return new Map<string, string>();
    }
    return this.activityPubInterface.getEventSourceActorUris(remoteEventIds);
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
    return instances;
  }

  async listEventInstancesForCalendar(calendar: Calendar): Promise<CalendarEventInstance[]> {

    const eventInstances = await EventInstanceEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [{
        model: EventEntity,
        include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity, CalendarEntity],
      }],
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
    const repostContexts: RepostContext[] = eventInstances.map((entity, i) => ({
      event: instances[i].event,
      displayCalendarId: entity.calendar_id,
      eventCalendarId: entity.event?.calendar_id ?? null,
      sourceCalendarUrlName: entity.event?.calendar?.url_name,
    }));

    // Collect remote event IDs and fetch actor URIs via AP interface
    const remoteEventIds = repostContexts
      .filter(ctx => ctx.eventCalendarId === null)
      .map(ctx => ctx.event.id);
    const remoteActorUriMap = await this.fetchRemoteActorUriMap(remoteEventIds);

    await resolveSourceCalendars(repostContexts, remoteActorUriMap);
    return instances;
  };

  async getEventInstanceById(instanceId: string): Promise<CalendarEventInstance> {
    const eventInstance = await EventInstanceEntity.findOne({
      where: { id: instanceId },
      include: [{
        model: EventEntity,
        include: [
          EventContentEntity,
          LocationEntity,
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
    // Build the query for event instances
    // Scope on instance.calendar_id (not event.calendar_id) so reposted events
    // are included — repost instances have the reposter's calendar_id.
    const queryOptions: any = {
      where: { calendar_id: calendar.id },
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

    // Handle search parameter - search in event title/description
    if (options.search && options.search.trim()) {
      const searchTerm = options.search.trim().toLowerCase().replace(/'/g, "''");

      // Add content to the event include with search filter
      const eventInclude = queryOptions.include[0];
      eventInclude.include.push({
        model: EventContentEntity,
        as: 'content',
        where: literal(`(LOWER("event->content"."name") LIKE '%${searchTerm}%' OR LOWER("event->content"."description") LIKE '%${searchTerm}%')`),
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

    // Resolve source calendar information for reposted events
    const validEntities = instanceEntities.filter(e => e.event != null);
    const repostContexts: RepostContext[] = validEntities.map((entity, i) => ({
      event: mappedInstances[i].event,
      displayCalendarId: entity.calendar_id,
      eventCalendarId: entity.event?.calendar_id ?? null,
      sourceCalendarUrlName: entity.event?.calendar?.url_name,
    }));

    // Collect remote event IDs and fetch actor URIs via AP interface
    const remoteEventIds = repostContexts
      .filter(ctx => ctx.eventCalendarId === null)
      .map(ctx => ctx.event.id);
    const remoteActorUriMap = await this.fetchRemoteActorUriMap(remoteEventIds);

    await resolveSourceCalendars(repostContexts, remoteActorUriMap);

    return mappedInstances;
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
        include: [
          EventContentEntity,
          {
            model: LocationEntity,
            include: [LocationContentEntity],
          },
          EventScheduleEntity,
          MediaEntity,
          CalendarEntity,
        ],
      }],
    });

    if (!eventInstance) {
      return null;
    }

    const instance = eventInstance.toModel();
    const event = eventInstance.event;

    // Populate schedules on the model so recurrence text can be computed
    const scheduleEntities = (event.getDataValue('schedules') ?? []) as EventScheduleEntity[];
    const scheduleModels = scheduleEntities.map((s: EventScheduleEntity) => s.toModel());
    instance.event.schedules = scheduleModels;

    // Mark as cancelled in-memory if a shown-cancellation schedule targets this instance.
    this.markShownCancellations([instance]);

    // Attach pre-computed human-readable recurrence text
    (instance.event as any).recurrenceText = getRecurrenceText(scheduleModels);

    // Populate location with content (accessibility info)
    if (event.location) {
      instance.event.location = event.location.toModel();
    }

    // Populate categories via the category service, filtered to the display calendar
    // so reposted events only show the display calendar's categories
    instance.event.categories = await this.categoryService.getEventCategories(instance.event.id, eventInstance.calendar_id);

    // Resolve source calendar information for reposted events
    const repostContext: RepostContext = {
      event: instance.event,
      displayCalendarId: eventInstance.calendar_id,
      eventCalendarId: eventInstance.event?.calendar_id ?? null,
      sourceCalendarUrlName: eventInstance.event?.calendar?.url_name,
    };
    const remoteEventIds = repostContext.eventCalendarId === null ? [instance.event.id] : [];
    const remoteActorUriMap = await this.fetchRemoteActorUriMap(remoteEventIds);

    await resolveSourceCalendars([repostContext], remoteActorUriMap);

    return instance;
  }

  async buildEventInstances(event: CalendarEvent, now: Date = new Date()): Promise<void> {

    await this.removeEventInstances(event);

    if ( ! event.schedules || ! event.schedules.length ) {
      const schedules = await EventScheduleEntity.findAll({
        where: { event_id: event.id },
        order: [['start_date', 'ASC']],
      });
      event.schedules = schedules.map(schedule => schedule.toModel());
    }

    const instances = this.generateInstances(event, now);
    for ( let instance of instances ) {
      const instanceEntity = EventInstanceEntity.fromModel(instance);
      instanceEntity.event_id = event.id;
      await instanceEntity.save();
    }
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
   * Removes all event instances for a specific (event, reposter calendar) pair.
   * Uses Sequelize bulk-destroy for efficient targeted deletion by compound key.
   *
   * @param eventId - The event ID whose repost instances should be removed
   * @param calendarId - The reposting calendar ID
   */
  async removeRepostInstances(eventId: string, calendarId: string): Promise<void> {
    if (!eventId || !calendarId) {
      return;
    }

    await EventInstanceEntity.destroy({
      where: {
        event_id: eventId,
        calendar_id: calendarId,
      },
    });
  }

  /**
   * Builds event instances for a reposting calendar. Idempotent: removes any
   * existing repost instances for this (event, calendar) pair, then recreates
   * them from the event's schedules.
   *
   * @param event - The event to create instances for
   * @param repostCalendarId - The calendar ID that is reposting the event
   */
  async buildRepostInstances(event: CalendarEvent, repostCalendarId: string, now: Date = new Date()): Promise<void> {
    await this.removeRepostInstances(event.id, repostCalendarId);
    await this.buildInstancesForCalendar(event, repostCalendarId, now);
  }

  /**
   * Rebuilds event instances for all local calendars that repost the given event.
   * Queries EventRepostEntity and the AP interface to find all reposters,
   * deduplicates them, filters out the original calendar, and verifies each
   * calendar still exists before rebuilding.
   *
   * @param event - The event whose repost instances should be rebuilt
   */
  async rebuildAllRepostInstances(event: CalendarEvent): Promise<void> {
    const [reposts, shareCalendarIds] = await Promise.all([
      EventRepostEntity.findAll({ where: { event_id: event.id } }),
      this.activityPubInterface
        ? this.activityPubInterface.getCalendarIdsForSharedEvent(event.id)
        : Promise.resolve([] as string[]),
    ]);

    // Collect and deduplicate calendar IDs, filtering out the original calendar
    const repostCalendarIds = new Set<string>();
    for (const repost of reposts) {
      if (repost.calendar_id !== event.calendarId) {
        repostCalendarIds.add(repost.calendar_id);
      }
    }
    for (const calId of shareCalendarIds) {
      if (calId !== event.calendarId) {
        repostCalendarIds.add(calId);
      }
    }

    // Rebuild instances for each reposting calendar that still exists
    for (const calendarId of repostCalendarIds) {
      const calendar = await CalendarEntity.findByPk(calendarId);
      if (!calendar) {
        continue;
      }
      await this.buildRepostInstances(event, calendarId);
    }
  }

  // TODO: retrieving all events won't scale. Need a paging/incremental strategy
  async refreshAllEventInstances() {
    // Get all local calendars and build a map of calendar ID -> Calendar
    const localCalendars = await CalendarEntity.findAll();
    const calendarMap = new Map<string, Calendar>();
    const calendarIdConditions: string[] = [];

    for (const calendarEntity of localCalendars) {
      const calendar = calendarEntity.toModel();
      const uuid = calendar.id;

      // Map UUID to the calendar for lookup
      calendarMap.set(uuid, calendar);
      calendarIdConditions.push(uuid);

      // Also map the AP actor URL for transition support
      if (this.activityPubInterface) {
        const apId = await this.activityPubInterface.actorUrl(calendar);
        calendarMap.set(apId, calendar);
        calendarIdConditions.push(apId);
      }
    }

    // Only get events for local calendars (not remote federated events)
    // Query supports both UUID and AP identifier calendar IDs during transition
    const events = await EventEntity.findAll({
      where: {
        calendar_id: {
          [Op.in]: calendarIdConditions,
        },
      },
    });

    // Emit eventUpdated for each local event to rebuild instances
    for (const event of events) {
      const calendar = calendarMap.get(event.calendar_id);
      if (calendar) {
        this.eventBus.emit('eventUpdated', {
          calendar: calendar,
          event: event.toModel(),
        });
      }
    }
  }

  /**
   * Creates event instances with the calendar_id overridden to the given calendar.
   * Loads schedules from DB if not already populated on the event.
   *
   * @param event - The event to generate instances for
   * @param calendarId - The calendar ID to assign to the generated instances
   */
  private async buildInstancesForCalendar(event: CalendarEvent, calendarId: string, now: Date = new Date()): Promise<void> {
    if (!event.schedules || !event.schedules.length) {
      const schedules = await EventScheduleEntity.findAll({
        where: { event_id: event.id },
        order: [['start_date', 'ASC']],
      });
      event.schedules = schedules.map(schedule => schedule.toModel());
    }

    const instances = this.generateInstances(event, now);
    for (const instance of instances) {
      const instanceEntity = EventInstanceEntity.fromModel(instance);
      instanceEntity.event_id = event.id;
      // Override calendar_id to the reposting calendar instead of the event's original calendar
      instanceEntity.calendar_id = calendarId;
      await instanceEntity.save();
    }
  }

  /**
   * Builds an RRuleSet from an event's schedules, distinguishing between
   * hidden (EXDATE-style) and shown (RECURRENCE-ID-style) cancellations.
   *
   * Exclusion schedules only contribute exdate/exrule suppression to the set
   * when they are BOTH `isExclusion = true` AND `hideFromPublic = true`.
   * Shown cancellations (isExclusion = true, hideFromPublic = false) do not
   * emit exdate or rdate — their underlying occurrence is still produced by
   * the parent recurring rule, and the listing layer marks the materialized
   * instance as `isCancelled = true` instead. See
   * {@link markShownCancellations}.
   */
  private rrules(event: CalendarEvent): any {
    const rruleSet = new RRuleSet();

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
      if ( frequency ) {
        let options: Record<string,any> = {
          freq: frequency,
          interval: schedule.interval,
          dtstart: schedule.startDate?.toJSDate(),
        };
        if ( schedule.count ) {
          options.count = schedule.count;
        }
        else if ( schedule.endDate ) {
          options.until = schedule.endDate?.toJSDate();
        }
        if ( schedule.byDay?.length ) {
          const weekdays = schedule.byDay
            .map(parseByDay)
            .filter((w): w is InstanceType<typeof Weekday> => w !== null);
          if (weekdays.length) {
            options.byweekday = weekdays;
          }
        }
        const rule = new RRule(options);
        if ( isHiddenCancellation ) {
          rruleSet.exrule(rule);
        }
        else {
          rruleSet.rrule(rule);
        }
      }
      else {
        if (schedule.startDate) {
          if ( isHiddenCancellation ) {
            rruleSet.exdate(schedule.startDate.toJSDate());
          }
          else {
            rruleSet.rdate(schedule.startDate.toJSDate());
          }
        }
      }
    }
    return rruleSet;
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
   * Generates event instances from the event's schedules using RRule.
   *
   * Instance materialization differentiates between two schedule kinds:
   *
   * 1. **Recurring expansions (rrule)** are materialized for a forward
   *    rolling window of [now, now + GENERATION_HORIZON_MONTHS]. Bounded
   *    schedules (with `count` or `until`) are still honored by rrule —
   *    `between()` intersects the bounded series with the window.
   *
   * 2. **Non-recurring single occurrences (rdate)** are materialized 1:1
   *    with their schedule regardless of whether the start is in the past.
   *    This preserves stable shareable public URLs (DEC-004) for one-off
   *    events, per-event ICS downloads, and OG/Twitter card meta tags
   *    across regenerations. Exclusion dates (exdate) still suppress
   *    past rdates the same way they suppress future ones.
   *
   * Computes instance end times by applying the duration derived from the
   * first non-exclusion schedule's eventEndTime. If no eventEndTime is set,
   * instances receive null end times.
   *
   * @param event - The event containing schedules to generate instances from
   * @param now - The reference "now" for window computation. Defaults to the
   *              current wall clock; tests may inject a fixed value for
   *              determinism.
   * @returns Array of CalendarEventInstance with computed start and end times
   */
  private generateInstances(event: CalendarEvent, now: Date = new Date()): CalendarEventInstance[] {
    const rruleSet = this.rrules(event);

    // Compute duration from the first non-exclusion schedule that has both
    // startDate and eventEndTime. This duration is applied to every generated
    // instance so recurring occurrences inherit the correct event length.
    let duration: Duration | null = null;
    for (const schedule of event.schedules) {
      if (!schedule.isExclusion && schedule.startDate && schedule.eventEndTime) {
        duration = schedule.eventEndTime.diff(schedule.startDate);
        break;
      }
    }

    const windowEnd = DateTime.fromJSDate(now)
      .plus({ months: GENERATION_HORIZON_MONTHS })
      .toJSDate();

    // Recurring expansions + any rdates that happen to fall inside the window.
    const windowedDates = rruleSet.between(now, windowEnd, true);

    // Past rdates below the window's lower bound must still be materialized,
    // so that a one-off event's row (and its shareable anonymous URL) does
    // not vanish on regeneration once the event date has passed. Apply
    // exdates the same way rrule would have — past exclusions still suppress.
    const exdateTimes = new Set(rruleSet.exdates().map((d: Date) => d.getTime()));
    const nowTime = now.getTime();
    const pastRdates = rruleSet
      .rdates()
      .filter((d: Date) => d.getTime() < nowTime && !exdateTimes.has(d.getTime()));

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
      const startDate = DateTime.fromJSDate(date);
      const endDate = duration ? startDate.plus(duration) : null;

      return CalendarEventInstance.fromObject({
        id: uuidv4(),
        event: event,
        start: startDate,
        end: endDate,
      });
    });
  }
}
