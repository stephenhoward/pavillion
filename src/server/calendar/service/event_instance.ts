import { EventEmitter } from "events";
import { v4 as uuidv4 } from 'uuid';
import { CalendarEvent, EventFrequency } from "@/common/model/events";
import CalendarEventInstance from "@/common/model/event_instance";
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/calendar/entity/event";
import { EventInstanceEntity } from "@/server/calendar/entity/event_instance";
import { CalendarEntity } from "@/server/calendar/entity/calendar";
import { MediaEntity } from "@/server/media/entity/media";
import { Calendar } from "@/common/model/calendar";
import { DateTime } from 'luxon';
import rrule from 'rrule';
import { LocationEntity } from "@/server/calendar/entity/location";
import { EventSeriesEntity, EventSeriesContentEntity } from '@/server/calendar/entity/event_series';
import CategoryService from "./categories";
import { ActivityPubActor } from "@/server/activitypub/model/base";
import { Op } from 'sequelize';
import { EventRepostEntity } from "@/server/calendar/entity/event_repost";
// Deliberate cross-domain import: SharedEventEntity lives in the activitypub domain
// but is needed here to find all calendars that repost an event. This follows the
// same cross-domain pattern used in events.ts for federation-related queries.
import { SharedEventEntity } from "@/server/activitypub/entity/activitypub";

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
        include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
      }],
    });

    return eventInstances.map((instance) => instance.toModel());
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

  private generateInstances(event: CalendarEvent, count: number): CalendarEventInstance[] {
    const rruleSet = this.rrules(event);

    let startToEndMatches: Record<string,DateTime> = {};
    for (let schedule of event.schedules) {
      if ( schedule.startDate && schedule.endDate ) {
        startToEndMatches[schedule.startDate.toISO()!] = schedule.endDate;
      }
    }

    return rruleSet
      .all((date: Date, i: number) => { return i < count; })
      .map((date: Date) => {
        const startDate = DateTime.fromJSDate(date);
        const endDate = ( startDate.toISO()! in startToEndMatches )
          ? startToEndMatches[startDate.toISO()!]
          : null;

        return CalendarEventInstance.fromObject({
          id: uuidv4(),
          event: event,
          start: startDate,
          end: endDate,
        });
      });
  }
}
