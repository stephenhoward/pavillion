import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from "@/common/model/events";
import { EventLocation, validateLocationHierarchy } from "@/common/model/location";
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/calendar/entity/event";
import CalendarService from "@/server/calendar/service/calendar";
import { LocationEntity } from "@/server/calendar/entity/location";
import { MediaEntity } from "@/server/media/entity/media";
import LocationService from "@/server/calendar/service/locations";
import { EventEmitter } from 'events';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError, BulkEventsNotFoundError, MixedCalendarEventsError, CategoriesNotFoundError, LocationValidationError } from '@/common/exceptions/calendar';
import CategoryService from './categories';
import { EventCategoryEntity } from '@/server/calendar/entity/event_category';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import db from '@/server/common/entity/db';
import { Op, fn, col, where, literal } from 'sequelize';
import { ActivityPubActor } from '@/server/activitypub/model/base';

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
     * @param options - optional search and filter parameters
     * @returns a promise that resolves to the list of events
     */
  async listEvents(calendar: Calendar, options?: {
    search?: string;
    categories?: string[];
  }): Promise<CalendarEvent[]> {

    // Base query options
    const queryOptions: any = {
      where: { calendar_id: ActivityPubActor.actorUrl(calendar) },
      include: [
        LocationEntity,
        EventScheduleEntity,
        MediaEntity,
        {
          model: EventCategoryAssignmentEntity,
          as: 'categoryAssignments', // Required because association uses alias (see event.ts line 231)
          include: [{
            model: EventCategoryEntity,
            as: 'category', // Required because association uses alias (see event.ts line 241)
            include: [EventCategoryContentEntity],
          }],
        },
      ],
    };    // Handle search parameter
    if (options?.search && options.search.trim()) {
      // Use LOWER() for case-insensitive search that works on both PostgreSQL and SQLite
      // Escape single quotes in search term for SQL literal
      const searchTerm = options.search.trim().toLowerCase().replace(/'/g, "''");
      queryOptions.include.push({
        model: EventContentEntity,
        as: 'content',  // Use the association alias
        where: literal(`(LOWER(\`content\`.\`name\`) LIKE '%${searchTerm}%' OR LOWER(\`content\`.\`description\`) LIKE '%${searchTerm}%')`),
        required: true, // INNER JOIN to only include events with matching content
      });
    }
    else {
      // Always include content, but without search filter
      queryOptions.include.push(EventContentEntity);
    }

    // Handle category filter
    if (options?.categories && options.categories.length > 0) {
      // Find the category assignment include that we added above
      const categoryAssignmentInclude = queryOptions.include.find(
        (inc: any) => inc.model === EventCategoryAssignmentEntity || inc === EventCategoryAssignmentEntity,
      );

      if (categoryAssignmentInclude && typeof categoryAssignmentInclude === 'object') {
        // Add the filter to the existing category assignment include
        categoryAssignmentInclude.where = {
          category_id: {
            [Op.in]: options.categories,
          },
        };
        categoryAssignmentInclude.required = true; // INNER JOIN to only include events with matching categories
      }
    }


    const events = await EventEntity.findAll(queryOptions);

    const mappedEvents = events.map( (event) => {
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

      // Map categories from eagerly loaded data
      // Access via getDataValue since we don't have a declared property
      const categoryAssignments = event.getDataValue('categoryAssignments') as EventCategoryAssignmentEntity[] | undefined;
      if (categoryAssignments) {
        e.categories = categoryAssignments.map(assignment => assignment.category.toModel());
      }

      return e;
    });

    return mappedEvents;
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

    // Generate AP identifier for the calendar
    const calendarApIdentifier = ActivityPubActor.actorUrl(calendar);
    event.calendarId = calendarApIdentifier;

    const eventEntity = EventEntity.fromModel(event);

    if( eventParams.location ) {
      // Validate location hierarchy before processing
      const location = EventLocation.fromObject(eventParams.location);
      const validationErrors = validateLocationHierarchy(location);
      if (validationErrors.length > 0) {
        throw new LocationValidationError(validationErrors);
      }

      let locationEntity = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = locationEntity.id;
      event.location = locationEntity;
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

    // Notify media domain that media has been attached to an event
    if (eventEntity.media_id) {
      this.eventBus.emit('mediaAttachedToEvent', {
        mediaId: eventEntity.media_id,
        eventId: event.id,
      });
    }

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

    // Calendar ID is now stored as an ActivityPub URL (https://domain/o/urlName)
    // Extract the urlName from the URL and look up by that
    let calendar: Calendar | null = null;
    if (eventEntity.calendar_id.startsWith('https://')) {
      // Extract urlName from ActivityPub URL format: https://domain/o/urlName
      const match = eventEntity.calendar_id.match(/\/o\/([^\/]+)$/);
      if (match) {
        const urlName = match[1];
        calendar = await this.calendarService.getCalendarByName(urlName);
      }
    }
    else {
      // Legacy support: if it's a UUID, look up by primary key
      calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
    }

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

          // Support both 'name' and 'title' field names for API compatibility
          const name = c.name || c.title;
          await contentEntity.update({
            name: name,
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
      // Validate location hierarchy before processing
      const location = EventLocation.fromObject(eventParams.location);
      const validationErrors = validateLocationHierarchy(location);
      if (validationErrors.length > 0) {
        throw new LocationValidationError(validationErrors);
      }

      let locationEntity = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = locationEntity.id;
      event.location = locationEntity;
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
          // Convert byDay array to comma-separated string for database storage
          const byDayValue = schedule.byDay !== undefined
            ? (Array.isArray(schedule.byDay) ? schedule.byDay.join(',') : (schedule.byDay || ''))
            : scheduleEntity.by_day;

          await scheduleEntity.update({
            start_date: schedule.startDate ?? scheduleEntity.start_date,
            end_date: schedule.endDate ?? scheduleEntity.end_date,
            frequency: schedule.frequency ?? scheduleEntity.frequency,
            interval: schedule.interval ?? scheduleEntity.interval,
            count: schedule.count ?? scheduleEntity.count,
            by_day: byDayValue,
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
    let newMediaAttached = false;
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
          newMediaAttached = eventEntity.media_id !== media.id;
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

    // Notify media domain that media has been attached to an event
    if (newMediaAttached && eventEntity.media_id) {
      this.eventBus.emit('mediaAttachedToEvent', {
        mediaId: eventEntity.media_id,
        eventId: event.id,
      });
    }

    this.eventBus.emit('eventUpdated', { calendar, event });
    return event;
  }

  /**
     * Add a new event from a remote calendar
     * @param eventParams - the parameters for the new event
     * @returns a promise that resolves to the created Event
     */
  async addRemoteEvent(calendar: Calendar, eventParams:Record<string,any>): Promise<CalendarEvent> {
    console.log(`[EventService] addRemoteEvent called with eventParams:`, JSON.stringify(eventParams, null, 2));

    if ( ! eventParams.id ) {
      throw new Error('Event id is required');
    }
    // TODO: validate id is legit.
    if ( eventParams.id.match(/^https:\/\/[^\/]+\/events\/[0-9a-f-]+$/) === null ) {
      throw new Error('Invalid event id');
    }

    const event = CalendarEvent.fromObject(eventParams);
    console.log(`[EventService] Created CalendarEvent model with calendarId: ${event.calendarId}`);

    const eventEntity = EventEntity.fromModel(event);
    console.log(`[EventService] Created EventEntity with calendar_id: ${eventEntity.calendar_id}`);

    //TODO: check and validate the calendar id

    if( eventParams.location ) {
      // Todo: See if we already imported this location

      let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = location.id;
      event.location = location;
    }

    console.log(`[EventService] Saving event entity to database...`);
    await eventEntity.save();
    console.log(`[EventService] Event entity saved with ID: ${eventEntity.id}, calendar_id: ${eventEntity.calendar_id}`);

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

  /**
   * Update a remote event with new data from a federated Update activity
   * @param calendar - the local calendar receiving this update (for location context)
   * @param eventParams - the updated event parameters
   * @returns a promise that resolves to the updated Event
   */
  async updateRemoteEvent(calendar: Calendar, eventParams: Record<string,any>): Promise<CalendarEvent> {
    console.log(`[EventService] Updating remote event ${eventParams.id}`);

    const eventEntity = await EventEntity.findByPk(eventParams.id);

    if (!eventEntity) {
      throw new EventNotFoundError(`Remote event ${eventParams.id} not found for update`);
    }

    // Use the local calendar that is receiving this update (same pattern as addRemoteEvent)

    let event = eventEntity.toModel();

    // Update content translations
    if (eventParams.content) {
      for (let [language, content] of Object.entries(eventParams.content)) {
        let contentEntity = await EventContentEntity.findOne({
          where: { event_id: eventParams.id, language: language },
        });

        if (contentEntity) {
          if (!content) {
            await contentEntity.destroy();
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if (Object.keys(c).length === 0) {
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
          if (!content) {
            continue;
          }

          let c = content as Record<string,any>;
          delete c.language;

          if (Object.keys(c).length > 0) {
            event.addContent(await this.createEventContent(eventParams.id, language, c));
          }
        }
      }
    }

    // Update location
    if (eventEntity.location_id && !eventParams.location) {
      eventEntity.location_id = '';
      event.location = null;
    }
    else if (eventParams.location) {
      let locationEntity = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = locationEntity.id;
      event.location = locationEntity;
    }

    // Update schedules
    if (eventParams.schedules) {
      let existingSchedules = await EventScheduleEntity.findAll({ where: { event_id: eventParams.id } });
      let existingScheduleIds = existingSchedules.map(s => s.id);

      for (let schedule of eventParams.schedules) {
        if (schedule.id) {
          let scheduleEntity = existingSchedules.find(s => s.id === schedule.id);

          if (!scheduleEntity) {
            throw Error('Schedule not found for event');
          }

          existingScheduleIds = existingScheduleIds.filter(id => id !== schedule.id);

          const byDayValue = schedule.byDay !== undefined
            ? (Array.isArray(schedule.byDay) ? schedule.byDay.join(',') : (schedule.byDay || ''))
            : scheduleEntity.by_day;

          await scheduleEntity.update({
            start_date: schedule.startDate ?? scheduleEntity.start_date,
            end_date: schedule.endDate ?? scheduleEntity.end_date,
            frequency: schedule.frequency ?? scheduleEntity.frequency,
            interval: schedule.interval ?? scheduleEntity.interval,
            count: schedule.count ?? scheduleEntity.count,
            by_day: byDayValue,
            is_exclusion: schedule.isExclusion ?? scheduleEntity.is_exclusion,
          });
          event.addSchedule(scheduleEntity.toModel());
        }
        else {
          event.addSchedule(await this.createEventSchedule(eventParams.id, schedule));
        }
      }

      if (existingScheduleIds.length > 0) {
        await EventScheduleEntity.destroy({ where: { id: existingScheduleIds } });
      }
    }

    await eventEntity.save();

    console.log(`[EventService] Successfully updated remote event ${eventParams.id}`);
    return event;
  }

  /**
   * Delete a remote event
   * @param eventId - the ID of the event to delete
   * @returns a promise that resolves when the event is deleted
   */
  async deleteRemoteEvent(eventId: string): Promise<void> {
    console.log(`[EventService] Deleting remote event ${eventId}`);

    const eventEntity = await EventEntity.findByPk(eventId, {
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    if (!eventEntity) {
      throw new EventNotFoundError(`Remote event ${eventId} not found for deletion`);
    }

    const transaction = await db.transaction();
    try {
      // Delete related records in correct order to satisfy foreign key constraints
      await EventInstanceEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await EventCategoryAssignmentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await EventScheduleEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await EventContentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      await eventEntity.destroy({ transaction });

      await transaction.commit();

      console.log(`[EventService] Successfully deleted remote event ${eventId}`);
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {

    const event = await EventEntity.findOne({
      where: { id: eventId },
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    if ( ! event ) {
      throw new EventNotFoundError(eventId);
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

  /**
   * Delete an event
   * @param account - The account attempting to delete the event
   * @param eventId - The ID of the event to delete
   * @throws EventNotFoundError if the event doesn't exist
   * @throws InsufficientCalendarPermissionsError if the user can't modify the calendar
   */
  async deleteEvent(account: Account, eventId: string): Promise<void> {
    const eventEntity = await EventEntity.findByPk(eventId, {
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    if (!eventEntity) {
      throw new EventNotFoundError(`Event with ID ${eventId} not found`);
    }

    const calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
    if (!calendar) {
      throw new CalendarNotFoundError(`Calendar not found for event ${eventId}`);
    }

    const canModify = await this.calendarService.userCanModifyCalendar(account, calendar);
    if (!canModify) {
      throw new InsufficientCalendarPermissionsError(`User does not have permission to delete events in calendar ${calendar.urlName}`);
    }

    const transaction = await db.transaction();
    try {
      // Delete related records in correct order to satisfy foreign key constraints
      // 1. Delete event instances first
      await EventInstanceEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 2. Delete category assignments
      await EventCategoryAssignmentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 3. Delete event schedules
      await EventScheduleEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 4. Delete event content translations
      await EventContentEntity.destroy({
        where: { event_id: eventId },
        transaction,
      });

      // 5. Finally, delete the main event entity
      await eventEntity.destroy({ transaction });

      await transaction.commit();

      // Emit event for ActivityPub federation
      this.eventBus.emit('event_deleted', {
        eventId,
        calendar,
        account,
      });
    }
    catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

export default EventService;
