import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from "@/common/model/events";
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/calendar/entity/event";
import CalendarService from "@/server/calendar/service/calendar";
import { LocationEntity } from "@/server/calendar/entity/location";
import { MediaEntity } from "@/server/media/entity/media";
import LocationService from "@/server/calendar/service/locations";
import { EventEmitter } from 'events';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError, BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError } from '@/common/exceptions/calendar';
import CategoryService from './categories';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import db from '@/server/common/entity/db';

/**
 * Service class for managing events
 *
 * @remarks
 * Use this class to manage the lifecycle of events in the system
 */
class EventService {
  private locationService: LocationService;
  private calendarService: CalendarService;
  private categoryService: CategoryService;
  private eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.locationService = new LocationService();
    this.calendarService = new CalendarService();
    this.categoryService = new CategoryService();
    this.eventBus = eventBus;
  }

  /**
     * retrieves the events for the provided calendar
     * @param calendar - the calendar to retrieve events for
     * @returns a promise that resolves to the list of events
     */
  async listEvents(calendar: Calendar): Promise<CalendarEvent[]> {

    const events = await EventEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    return events.map( (event) => {
      let e = event.toModel();
      if ( event.content ) {
        for ( let c of event.content ) {
          e.addContent( c.toModel() );
        }
      }
      if ( event.location ) {
        e.location = event.location.toModel();
      }
      if ( event.schedules ) {
        for ( let s of event.schedules ) {
          e.addSchedule( s.toModel() );
        }
      }

      return e;
    });
  }

  generateEventUrl(): string {
    const domain = config.get('domain');
    return 'https://' + domain + '/events/' + uuidv4();
  }

  /**
     * Creates a new event for the provided account
     * @param account - account the event belongs to
     * @param eventParams - the parameters for the new event
     * @returns a promise that resolves to the created Event
     */
  async createEvent(account: Account, eventParams:Record<string,any>): Promise<CalendarEvent> {

    const calendar = await this.calendarService.getCalendar(eventParams.calendarId);
    const calendars = await this.calendarService.editableCalendarsForUser(account);
    if ( ! calendar ) {
      throw new CalendarNotFoundError('Calendar for event does not exist');
    }
    if ( ! calendars.some(c => c.id == calendar.id) ) {
      throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
    }

    eventParams.id = this.generateEventUrl();

    const event = CalendarEvent.fromObject(eventParams);
    if ( calendar.urlName.length > 0 ) {
      event.eventSourceUrl = '/' + calendar.urlName + '/' + event.id;
    }
    else {
      event.eventSourceUrl = '';
    }
    const eventEntity = EventEntity.fromModel(event);

    if( eventParams.location ) {

      let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = location.id;
      event.location = location;
    }

    // Handle media attachment
    if (eventParams.mediaId) {
      // Verify the media belongs to the same calendar
      const media = await MediaEntity.findOne({
        where: {
          id: eventParams.mediaId,
          calendar_id: calendar.id,
        },
      });

      if (media) {
        eventEntity.media_id = media.id;
        event.media = media.toModel();
      }
    }

    await eventEntity.save();

    if ( eventParams.content ) {
      for( let [language,content] of Object.entries(eventParams.content) ) {
        event.addContent(await this.createEventContent(event.id, language, content as Record<string,any>));
      }
    }

    if ( eventParams.schedules ) {
      event.schedules = []; // "fromObject" auto-creates schedules, but we need to create them in the db
      for( let schedule of eventParams.schedules ) {
        event.addSchedule(await this.createEventSchedule(event.id, schedule as Record<string,any>));
      }
    }

    this.eventBus.emit('eventCreated', { calendar, event });
    return event;
  }

  async createEventSchedule(eventId: string, scheduleParams: Record<string,any>): Promise<CalendarEventSchedule> {
    const schedule = CalendarEventSchedule.fromObject(scheduleParams);

    schedule.id = uuidv4();
    const scheduleEntity = EventScheduleEntity.fromModel(schedule);
    scheduleEntity.event_id = eventId;
    await scheduleEntity.save();

    return schedule;
  }

  async createEventContent(eventId: string, language: string, contentParams: Record<string,any>): Promise<CalendarEventContent> {
    contentParams.language = language;
    const content = CalendarEventContent.fromObject(contentParams);

    const contentEntity = EventContentEntity.fromModel(content);
    contentEntity.id = uuidv4();
    contentEntity.event_id = eventId;
    await contentEntity.save();

    return content;
  }

  /**
     * updates the event with the provided id
     * @param eventId - the id of the event to update
     * @param eventParams - the parameters and values to update for the event
     * @returns a promise that resolves to the Event
     */
  async updateEvent(account: Account, eventId: string, eventParams:Record<string,any>): Promise<CalendarEvent> {
    const eventEntity = await EventEntity.findByPk(eventId);

    if ( ! eventEntity ) {
      throw new EventNotFoundError('Event not found');
    }
    const calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
    const calendars = await this.calendarService.editableCalendarsForUser(account);
    if ( ! calendar ) {
      throw new CalendarNotFoundError('Calendar for event does not exist');
    }
    if ( ! calendars.some(c => c.id == calendar.id) ) {
      throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
    }

    let event = eventEntity.toModel();

    if ( eventParams.content ) {
      for( let [language,content] of Object.entries(eventParams.content) ) {
        let contentEntity = await EventContentEntity.findOne({
          where: { event_id: eventId, language: language },
        });

        if ( contentEntity ) {

          if ( ! content ) {
            await contentEntity.destroy();
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if ( Object.keys(c).length === 0 ) {
            await contentEntity.destroy();
            continue;
          }

          await contentEntity.update({
            name: c.name,
            description: c.description,
          });
          event.addContent(contentEntity.toModel());
        }
        else {
          if ( !content ) {
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if ( Object.keys(c).length > 0 ) {
            event.addContent(await this.createEventContent(eventId, language, c));
          }
        }
      }
    }

    if ( eventEntity.location_id && ! eventParams.location ) {
      eventEntity.location_id = '';
      event.location = null;
    }
    else if( eventParams.location ) {

      let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = location.id;
      event.location = location;
    }

    if ( eventParams.schedules ) {
      let existingSchedules = await EventScheduleEntity.findAll({ where: { event_id: eventId } });
      let existingScheduleIds = existingSchedules.map( s => s.id );

      for( let schedule of eventParams.schedules ) {

        if ( schedule.id ) {
          let scheduleEntity = existingSchedules.find( s => s.id === schedule.id );

          if ( ! scheduleEntity ) {
            throw Error ('Schedule not found for event');
          }

          existingScheduleIds = existingScheduleIds.filter( id => id !== schedule.id );
          // TODO: validate schedule data so we don't store junk
          await scheduleEntity.update({
            start_date: schedule.startDate ?? scheduleEntity.start_date,
            end_date: schedule.endDate ?? scheduleEntity.end_date,
            frequency: schedule.frequency ?? scheduleEntity.frequency,
            interval: schedule.interval ?? scheduleEntity.interval,
            count: schedule.count ?? scheduleEntity.count,
            by_day: schedule.byDay ?? scheduleEntity.by_day,
            is_exclusion: schedule.isExclusion ?? scheduleEntity.is_exclusion,
          });
          event.addSchedule(scheduleEntity.toModel());
        }
        else {
          event.addSchedule(await this.createEventSchedule(eventId, schedule));
        }
      }

      if ( existingScheduleIds.length > 0 ) {
        await EventScheduleEntity.destroy({ where: { id: existingScheduleIds } });
      }
    }

    // Handle media updates
    if (eventParams.hasOwnProperty('mediaId')) {
      if (eventParams.mediaId) {
        // Verify the media belongs to the same calendar
        const media = await MediaEntity.findOne({
          where: {
            id: eventParams.mediaId,
            calendar_id: calendar.id,
          },
        });

        if (media) {
          eventEntity.media_id = media.id;
          event.media = media.toModel();
        }
      }
      else {
        // Remove media if mediaId is null/empty
        eventEntity.media_id = '';
        event.media = null;
      }
    }

    await eventEntity.save();

    this.eventBus.emit('eventUpdated', { calendar, event });
    return event;
  }

  /**
     * Add a new event from a remote calendar
     * @param eventParams - the parameters for the new event
     * @returns a promise that resolves to the created Event
     */
  async addRemoteEvent(calendar: Calendar, eventParams:Record<string,any>): Promise<CalendarEvent> {

    if ( ! eventParams.id ) {
      throw new Error('Event id is required');
    }
    // TODO: validate id is legit.
    if ( eventParams.id.match(/^https:\/\/[^\/]+\/events\/[0-9a-f-]+$/) === null ) {
      throw new Error('Invalid event id');
    }

    const event = CalendarEvent.fromObject(eventParams);
    const eventEntity = EventEntity.fromModel(event);

    //TODO: check and validate the calendar id

    if( eventParams.location ) {
      // Todo: See if we already imported this location

      let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = location.id;
      event.location = location;
    }

    eventEntity.save();

    if ( eventParams.content ) {
      for( let [language,content] of Object.entries(eventParams.content) ) {
        event.addContent(await this.createEventContent(event.id, language, content as Record<string,any>));
      }
    }

    if ( eventParams.schedules ) {
      for( let schedule of eventParams.schedules ) {
        event.addSchedule(await this.createEventSchedule(event.id, schedule as Record<string,any>));
      }
    }

    return event;
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {

    const event = await EventEntity.findOne({
      where: { id: eventId },
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    if ( ! event ) {
      throw new Error('Event not found');
    }

    let e = event.toModel();
    if ( event.content ) {
      for ( let c of event.content ) {
        e.addContent( c.toModel() );
      }
    }
    if ( event.location ) {
      e.location = event.location.toModel();
    }
    if ( event.schedules ) {
      for ( let s of event.schedules ) {
        e.addSchedule( s.toModel() );
      }
    }
    if ( event.media ) {
      e.media = event.media.toModel();
    }

    e.categories = await this.categoryService.getEventCategories(event.id);

    return e;
  }

  /**
   * Assign categories to multiple events at once
   * @param account - the account performing the operation
   * @param eventIds - array of event IDs to assign categories to
   * @param categoryIds - array of category IDs to assign
   * @returns promise that resolves to updated events with their categories
   */
  async bulkAssignCategories(
    account: Account,
    eventIds: string[],
    categoryIds: string[],
  ): Promise<CalendarEvent[]> {
    const transaction = await db.transaction();

    try {
      // 1. Validate that all events exist and user has permission
      const events = await EventEntity.findAll({
        where: { id: eventIds },
        transaction,
      });

      if (events.length !== eventIds.length) {
        throw new BulkEventsNotFoundError('Some events were not found or you do not have permission to modify them');
      }

      // 2. Check user has permission to modify all events
      const userCalendars = await this.calendarService.editableCalendarsForUser(account);
      const userCalendarIds = userCalendars.map(cal => cal.id);

      // Verify all events belong to calendars user can edit
      const unauthorizedEvents = events.filter(event => !userCalendarIds.includes(event.calendar_id));
      if (unauthorizedEvents.length > 0) {
        throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify some events');
      }

      // 3. Verify all events belong to same calendar (simplifies category validation)
      const calendarIds = [...new Set(events.map(event => event.calendar_id))];
      if (calendarIds.length > 1) {
        throw new MixedCalendarEventsError('All events must belong to the same calendar');
      }

      const calendarId = calendarIds[0];

      // 4. Validate categories exist and belong to the same calendar
      const categories = await EventCategoryEntity.findAll({
        where: {
          id: categoryIds,
          calendar_id: calendarId,
        },
        transaction,
      });

      if (categories.length !== categoryIds.length) {
        throw new CategoriesNotFoundError('Some categories were not found in the calendar');
      }

      // 5. Get existing assignments to avoid duplicates
      const existingAssignments = await EventCategoryAssignmentEntity.findAll({
        where: {
          event_id: eventIds,
          category_id: categoryIds,
        },
        transaction,
      });

      // 6. Create assignments, avoiding duplicates
      const assignmentsToCreate = [];

      for (const eventId of eventIds) {
        for (const categoryId of categoryIds) {
          // Check if this assignment already exists
          const existingAssignment = existingAssignments.find(
            assignment => assignment.event_id === eventId && assignment.category_id === categoryId,
          );

          if (!existingAssignment) {
            assignmentsToCreate.push({
              id: uuidv4(),
              event_id: eventId,
              category_id: categoryId,
            });
          }
        }
      }

      // 7. Bulk create all new assignments
      if (assignmentsToCreate.length > 0) {
        await EventCategoryAssignmentEntity.bulkCreate(assignmentsToCreate, { transaction });
      }

      await transaction.commit();

      // 8. Return updated events with their categories
      const updatedEvents = [];
      for (const eventId of eventIds) {
        const updatedEvent = await this.getEventById(eventId);
        updatedEvents.push(updatedEvent);
      }

      return updatedEvents;
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

}

export default EventService;
