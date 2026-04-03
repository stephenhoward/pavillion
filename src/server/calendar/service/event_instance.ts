import { EventEmitter } from "events";
import { v4 as uuidv4 } from 'uuid';
import config from 'config';
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
import { ActivityPubActor } from "@/server/activitypub/model/base";
import { Op, literal } from 'sequelize';
import { EventRepostEntity } from "@/server/calendar/entity/event_repost";
import { getRecurrenceText } from '@/common/utils/recurrence-text';
// Deliberate cross-domain import: SharedEventEntity lives in the activitypub domain
// but is needed here to find all calendars that repost an event. This follows the
// same cross-domain pattern used in events.ts for federation-related queries.
import { SharedEventEntity } from "@/server/activitypub/entity/activitypub";
// Deliberate cross-domain import: EventObjectEntity is needed to resolve the
// attributed_to actor URI for remote reposted events.
import { EventObjectEntity } from "@/server/activitypub/entity/event_object";

const { RRule, RRuleSet } = rrule;

export default class EventInstanceService {
  private eventBus: EventEmitter;
  private categoryService: CategoryService;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.categoryService = new CategoryService();
  }

  async listEventInstances(event: CalendarEvent): Promise<CalendarEventInstance[]> {
    const eventInstances = await EventInstanceEntity.findAll({
      where: { event_id: event.id },
      include: [{
        model: EventEntity,
        include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
      }],
    });
    return eventInstances.map((instance) => instance.toModel());
  }

  async listEventInstancesForCalendar(calendar: Calendar): Promise<CalendarEventInstance[]> {

    const eventInstances = await EventInstanceEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [{
        model: EventEntity,
        include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity, CalendarEntity],
      }],
    });

    const instances = eventInstances.map((instance) => instance.toModel());
    await this.resolveSourceCalendars(instances, eventInstances);
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
    instance.event.categories = await this.categoryService.getEventCategories(instance.event.id);
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

        // Add categories
        const categoryAssignments = event.getDataValue('categoryAssignments') as EventCategoryAssignmentEntity[] | undefined;
        if (categoryAssignments) {
          instance.event.categories = categoryAssignments
            .filter(assignment => assignment.category != null)
            .map(assignment => assignment.category.toModel());
        }

        // Attach isRecurring — read from the virtual attribute added by the EXISTS subquery.
        // Sequelize returns it as a number (0/1) in SQLite or boolean in PostgreSQL.
        const isRecurringRaw = event.getDataValue('isRecurring');
        (instance.event as any).isRecurring = Boolean(isRecurringRaw);

        return instance;
      });

    // Resolve source calendar information for reposted events
    await this.resolveSourceCalendars(mappedInstances, instanceEntities.filter(e => e.event != null));

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

    // Attach pre-computed human-readable recurrence text
    (instance.event as any).recurrenceText = getRecurrenceText(scheduleModels);

    // Populate location with content (accessibility info)
    if (event.location) {
      instance.event.location = event.location.toModel();
    }

    // Populate categories via the category service
    instance.event.categories = await this.categoryService.getEventCategories(instance.event.id);

    // Resolve source calendar information for reposted events
    await this.resolveSourceCalendars([instance], [eventInstance]);

    return instance;
  }

  async buildEventInstances(event: CalendarEvent): Promise<void> {

    await this.removeEventInstances(event);

    if ( ! event.schedules || ! event.schedules.length ) {
      const schedules = await EventScheduleEntity.findAll({
        where: { event_id: event.id },
        order: [['start_date', 'ASC']],
      });
      event.schedules = schedules.map(schedule => schedule.toModel());
    }

    const instances = this.generateInstances(event,10);
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
  async buildRepostInstances(event: CalendarEvent, repostCalendarId: string): Promise<void> {
    await this.removeRepostInstances(event.id, repostCalendarId);
    await this.buildInstancesForCalendar(event, repostCalendarId);
  }

  /**
   * Rebuilds event instances for all local calendars that repost the given event.
   * Queries both EventRepostEntity and SharedEventEntity to find all reposters,
   * deduplicates them, filters out the original calendar, and verifies each
   * calendar still exists before rebuilding.
   *
   * @param event - The event whose repost instances should be rebuilt
   */
  async rebuildAllRepostInstances(event: CalendarEvent): Promise<void> {
    const [reposts, shares] = await Promise.all([
      EventRepostEntity.findAll({ where: { event_id: event.id } }),
      // Deliberate cross-domain query: SharedEventEntity is in the activitypub domain
      SharedEventEntity.findAll({ where: { event_id: event.id } }),
    ]);

    // Collect and deduplicate calendar IDs, filtering out the original calendar
    const repostCalendarIds = new Set<string>();
    for (const repost of reposts) {
      if (repost.calendar_id !== event.calendarId) {
        repostCalendarIds.add(repost.calendar_id);
      }
    }
    for (const share of shares) {
      if (share.calendar_id !== event.calendarId) {
        repostCalendarIds.add(share.calendar_id);
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
      const apId = ActivityPubActor.actorUrl(calendar);

      // Map both UUID and AP identifier to the calendar for lookup
      calendarMap.set(uuid, calendar);
      calendarMap.set(apId, calendar);

      // Support both UUID and AP identifier during transition
      calendarIdConditions.push(uuid, apId);
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
   * Resolves source calendar information for reposted events in a batch of instances.
   * Detects local and remote reposts, then populates isRepost and sourceCalendar
   * on each instance's event model.
   *
   * Repost detection:
   * - event.calendar_id !== null && !== instance.calendar_id -> local repost
   * - event.calendar_id === null -> remote repost (federated event)
   *
   * @param instances - Model instances to augment (mutated in place)
   * @param entities - Corresponding entity instances for reading calendar_id and eager-loaded calendar
   */
  private async resolveSourceCalendars(
    instances: CalendarEventInstance[],
    entities: EventInstanceEntity[],
  ): Promise<void> {
    // Build a map from instance ID to entity for quick lookup
    const entityMap = new Map<string, EventInstanceEntity>();
    for (const entity of entities) {
      entityMap.set(entity.id, entity);
    }

    // Collect remote event IDs that need EventObjectEntity lookup
    const remoteEventIds: string[] = [];

    for (const instance of instances) {
      const entity = entityMap.get(instance.id);
      if (!entity) continue;

      const eventCalendarId = entity.event?.calendar_id ?? instance.event.calendarId;
      const instanceCalendarId = entity.calendar_id;

      if (eventCalendarId === null) {
        // Remote repost - will resolve via EventObjectEntity below
        instance.event.isRepost = true;
        remoteEventIds.push(instance.event.id);
      }
      else if (eventCalendarId !== instanceCalendarId) {
        // Local repost - resolve from eager-loaded CalendarEntity
        instance.event.isRepost = true;
        const calendar = entity.event?.calendar;
        if (calendar) {
          const domain: string = config.get('domain');
          instance.event.sourceCalendar = {
            urlName: calendar.url_name,
            host: domain,
            url: `/view/${calendar.url_name}`,
          };
        }
      }
      // else: not a repost, defaults are already correct (isRepost=false, sourceCalendar=null)
    }

    // Batch-resolve remote reposts via EventObjectEntity
    if (remoteEventIds.length > 0) {
      const eventObjects = await EventObjectEntity.findAll({
        where: { event_id: { [Op.in]: remoteEventIds } },
      });

      const objectMap = new Map<string, EventObjectEntity>();
      for (const obj of eventObjects) {
        objectMap.set(obj.event_id, obj);
      }

      for (const instance of instances) {
        if (instance.event.isRepost && instance.event.sourceCalendar === null) {
          const eventObject = objectMap.get(instance.event.id);
          if (eventObject?.attributed_to) {
            const parsed = this.parseAttributedToUri(eventObject.attributed_to);
            if (parsed) {
              instance.event.sourceCalendar = parsed;
            }
          }
        }
      }
    }
  }

  /**
   * Parses an ActivityPub attributed_to URI to extract source calendar information.
   * Expected format: https://{host}/calendars/{urlName}
   *
   * @param uri - The attributed_to URI to parse
   * @returns Source calendar info or null if parsing fails
   */
  private parseAttributedToUri(uri: string): { urlName: string; host: string; url: string } | null {
    try {
      const url = new URL(uri);
      // Remove trailing slash and split path segments
      const segments = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);

      // Expected pattern: /calendars/{urlName}
      const calendarIndex = segments.indexOf('calendars');
      if (calendarIndex === -1 || calendarIndex + 1 >= segments.length) {
        return null;
      }

      const urlName = segments[calendarIndex + 1];
      return {
        urlName,
        host: url.host,
        url: `${url.protocol}//${url.host}/view/${urlName}`,
      };
    }
    catch {
      // Malformed URI - return null gracefully
      return null;
    }
  }

  /**
   * Creates event instances with the calendar_id overridden to the given calendar.
   * Loads schedules from DB if not already populated on the event.
   *
   * @param event - The event to generate instances for
   * @param calendarId - The calendar ID to assign to the generated instances
   */
  private async buildInstancesForCalendar(event: CalendarEvent, calendarId: string): Promise<void> {
    if (!event.schedules || !event.schedules.length) {
      const schedules = await EventScheduleEntity.findAll({
        where: { event_id: event.id },
        order: [['start_date', 'ASC']],
      });
      event.schedules = schedules.map(schedule => schedule.toModel());
    }

    const instances = this.generateInstances(event, 10);
    for (const instance of instances) {
      const instanceEntity = EventInstanceEntity.fromModel(instance);
      instanceEntity.event_id = event.id;
      // Override calendar_id to the reposting calendar instead of the event's original calendar
      instanceEntity.calendar_id = calendarId;
      await instanceEntity.save();
    }
  }

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
          options.byweekday = schedule.byDay.map(day => parseInt(day));
        }
        const rule = new RRule(options);
        if ( schedule.isExclusion ) {
          rruleSet.exrule(rule);
        }
        else {
          rruleSet.rrule(rule);
        }
      }
      else {
        if (schedule.startDate) {
          if ( schedule.isExclusion ) {
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
   * Generates event instances from the event's schedules using RRule.
   * Computes instance end times by applying the duration derived from the first
   * non-exclusion schedule's eventEndTime. If no eventEndTime is set, instances
   * receive null end times.
   *
   * @param event - The event containing schedules to generate instances from
   * @param count - Maximum number of instances to generate
   * @returns Array of CalendarEventInstance with computed start and end times
   */
  private generateInstances(event: CalendarEvent, count: number): CalendarEventInstance[] {
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

    return rruleSet
      .all((date: Date, i: number) => { return i < count; })
      .map((date: Date) => {
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
