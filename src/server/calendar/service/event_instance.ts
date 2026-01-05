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
import CategoryService from "./categories";
import { ActivityPubActor } from "@/server/activitypub/model/base";
import { Op } from 'sequelize';

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
        include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
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
