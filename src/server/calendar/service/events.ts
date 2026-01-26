import { v4 as uuidv4 } from 'uuid';
import config from 'config';
import axios from 'axios';

import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { RemoteCalendarAccessEntity } from "@/server/calendar/entity/remote_calendar_access";
import { UserActorEntity } from "@/server/activitypub/entity/user_actor";
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
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import db from '@/server/common/entity/db';
import { Op, literal } from 'sequelize';

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
   * Retrieves events for the provided calendar.
   * Returns events that are either:
   * - Owned by the calendar (calendar_id matches)
   * - Reposted by the calendar (via EventRepostEntity)
   *
   * @param calendar - the calendar to retrieve events for
   * @param options - optional search and filter parameters
   * @returns a promise that resolves to the list of events
   */
  async listEvents(calendar: Calendar, options?: {
    search?: string;
    categories?: string[];
  }): Promise<CalendarEvent[]> {

    // Get event IDs that are reposted by this calendar
    const reposts = await EventRepostEntity.findAll({
      where: { calendar_id: calendar.id },
      attributes: ['event_id'],
    });
    const repostedEventIds = reposts.map(r => r.event_id);

    // Query events owned by calendar OR reposted by calendar
    const queryOptions: any = {
      where: {
        [Op.or]: [
          { calendar_id: calendar.id },
          ...(repostedEventIds.length > 0 ? [{ id: { [Op.in]: repostedEventIds } }] : []),
        ],
      },
      include: [
        LocationEntity,
        EventScheduleEntity,
        MediaEntity,
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
    };

    // Handle search parameter
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

  generateEventId(): string {
    return uuidv4();
  }

  generateEventUrl(eventId: string): string {
    const domain = config.get('domain');
    return 'https://' + domain + '/events/' + eventId;
  }

  /**
   * Creates an event on a remote calendar by sending an ActivityPub Create activity
   *
   * @param account - The local account creating the event
   * @param remoteAccess - The RemoteCalendarAccessEntity with remote calendar info
   * @param eventParams - The parameters for the new event
   * @returns A promise that resolves to the created event (from remote response)
   */
  private async createRemoteEvent(
    account: Account,
    remoteAccess: RemoteCalendarAccessEntity,
    eventParams: Record<string, any>,
  ): Promise<CalendarEvent> {
    // Get the local user's actor for signing the activity
    const userActor = await UserActorEntity.findOne({
      where: { account_id: account.id },
    });

    if (!userActor) {
      throw new InsufficientCalendarPermissionsError('User does not have an ActivityPub identity configured');
    }

    const localDomain = config.get<string>('domain');
    const eventId = this.generateEventId();

    // Build the ActivityPub Create activity
    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: userActor.actor_uri,
      to: [remoteAccess.remote_calendar_actor_uri],
      object: {
        type: 'Event',
        id: `https://${localDomain}/events/${eventId}`,
        name: eventParams.content?.en?.name || eventParams.name || 'Untitled Event',
        summary: eventParams.content?.en?.description || eventParams.description || '',
        startTime: this.buildIsoDateTime(eventParams.start_date, eventParams.start_time),
        endTime: this.buildIsoDateTime(eventParams.end_date, eventParams.end_time),
        attributedTo: userActor.actor_uri,
        calendarId: remoteAccess.remote_calendar_id,
        eventParams: eventParams,
      },
    };

    // Send to the remote calendar's inbox
    const inboxUrl = remoteAccess.remote_calendar_inbox_url;
    if (!inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    console.log(`[EVENTS] Sending Create activity to remote calendar: ${inboxUrl}`);

    try {
      const response = await axios.post(inboxUrl, createActivity, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });

      console.log(`[EVENTS] Remote calendar accepted Create activity (status: ${response.status})`);

      // The remote calendar should return the created event as JSON
      if (response.data && typeof response.data === 'object' && response.data.id) {
        // Use the event data returned by the remote calendar
        const event = CalendarEvent.fromObject(response.data);
        return event;
      }

      // Fallback: construct a local representation of the event if no response data
      const event = new CalendarEvent(
        eventId,
        remoteAccess.remote_calendar_id,
        this.generateEventUrl(eventId),
        false,
      );

      // Add content from params
      if (eventParams.content) {
        for (const [language, content] of Object.entries(eventParams.content)) {
          const contentObj = content as any;
          event.addContent(new CalendarEventContent(language, contentObj.name || '', contentObj.description || ''));
        }
      }

      return event;
    }
    catch (error: any) {
      console.error(`[EVENTS] Failed to create event on remote calendar: ${error.message}`);
      if (error.response?.status === 403) {
        throw new InsufficientCalendarPermissionsError('You are not authorized to create events on this calendar');
      }
      throw new Error(`Failed to create event on remote calendar: ${error.message}`);
    }
  }

  /**
   * Helper to build ISO date-time string from date and time parts
   */
  private buildIsoDateTime(date: string, time?: string): string {
    if (!date) return '';
    if (time) {
      return `${date}T${time}:00`;
    }
    return `${date}T00:00:00`;
  }

  /**
   * Updates an event on a remote calendar by sending an ActivityPub Update activity
   *
   * @param account - The local account updating the event
   * @param remoteAccess - The RemoteCalendarAccessEntity with remote calendar info
   * @param eventId - The ID of the event to update
   * @param eventParams - The updated event parameters
   * @returns A promise that resolves to the updated event
   */
  private async updateRemoteEventViaActivityPub(
    account: Account,
    remoteAccess: RemoteCalendarAccessEntity,
    eventId: string,
    eventParams: Record<string, any>,
  ): Promise<CalendarEvent> {
    // Get the local user's actor for signing the activity
    const userActor = await UserActorEntity.findOne({
      where: { account_id: account.id },
    });

    if (!userActor) {
      throw new InsufficientCalendarPermissionsError('User does not have an ActivityPub identity configured');
    }

    const localDomain = config.get<string>('domain');

    // Build the ActivityPub Update activity
    // Include the local event ID in eventParams so the remote can look it up
    const eventParamsWithId = { ...eventParams, id: eventId };

    const updateActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Update',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: userActor.actor_uri,
      to: [remoteAccess.remote_calendar_actor_uri],
      object: {
        type: 'Event',
        id: `https://${localDomain}/events/${eventId}`,
        name: eventParams.content?.en?.name || eventParams.name || 'Untitled Event',
        summary: eventParams.content?.en?.description || eventParams.description || '',
        startTime: this.buildIsoDateTime(eventParams.start_date, eventParams.start_time),
        endTime: this.buildIsoDateTime(eventParams.end_date, eventParams.end_time),
        attributedTo: userActor.actor_uri,
        calendarId: remoteAccess.remote_calendar_id,
        eventParams: eventParamsWithId,
      },
    };

    // Send to the remote calendar's inbox
    const inboxUrl = remoteAccess.remote_calendar_inbox_url;
    if (!inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    console.log(`[EVENTS] Sending Update activity to remote calendar: ${inboxUrl}`);

    try {
      const response = await axios.post(inboxUrl, updateActivity, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });

      console.log(`[EVENTS] Remote calendar accepted Update activity (status: ${response.status})`);

      // Construct a local representation of the updated event
      const event = new CalendarEvent(
        eventId,
        remoteAccess.remote_calendar_id,
        this.generateEventUrl(eventId),
        false,
      );

      // Add content from params
      if (eventParams.content) {
        for (const [language, content] of Object.entries(eventParams.content)) {
          const contentObj = content as any;
          event.addContent(new CalendarEventContent(language, contentObj.name || '', contentObj.description || ''));
        }
      }

      return event;
    }
    catch (error: any) {
      console.error(`[EVENTS] Failed to update event on remote calendar: ${error.message}`);
      if (error.response?.status === 403) {
        throw new InsufficientCalendarPermissionsError('You are not authorized to update events on this calendar');
      }
      throw new Error(`Failed to update event on remote calendar: ${error.message}`);
    }
  }

  /**
   * Deletes an event on a remote calendar by sending an ActivityPub Delete activity
   *
   * @param account - The local account deleting the event
   * @param remoteAccess - The RemoteCalendarAccessEntity with remote calendar info
   * @param eventId - The ID of the event to delete
   * @returns A promise that resolves when the delete is complete
   */
  private async deleteRemoteEventViaActivityPub(
    account: Account,
    remoteAccess: RemoteCalendarAccessEntity,
    eventId: string,
  ): Promise<void> {
    // Get the local user's actor for signing the activity
    const userActor = await UserActorEntity.findOne({
      where: { account_id: account.id },
    });

    if (!userActor) {
      throw new InsufficientCalendarPermissionsError('User does not have an ActivityPub identity configured');
    }

    const localDomain = config.get<string>('domain');

    // Build the ActivityPub Delete activity
    // Include the local event ID so the remote can look it up
    const deleteActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Delete',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: userActor.actor_uri,
      to: [remoteAccess.remote_calendar_actor_uri],
      object: {
        type: 'Tombstone',
        id: `https://${localDomain}/events/${eventId}`,
        formerType: 'Event',
        calendarId: remoteAccess.remote_calendar_id,
        eventId: eventId,
      },
    };

    // Send to the remote calendar's inbox
    const inboxUrl = remoteAccess.remote_calendar_inbox_url;
    if (!inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    console.log(`[EVENTS] Sending Delete activity to remote calendar: ${inboxUrl}`);

    try {
      const response = await axios.post(inboxUrl, deleteActivity, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });

      console.log(`[EVENTS] Remote calendar accepted Delete activity (status: ${response.status})`);
    }
    catch (error: any) {
      console.error(`[EVENTS] Failed to delete event on remote calendar: ${error.message}`);
      if (error.response?.status === 403) {
        throw new InsufficientCalendarPermissionsError('You are not authorized to delete events on this calendar');
      }
      throw new Error(`Failed to delete event on remote calendar: ${error.message}`);
    }
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

    // Check if this is a local calendar
    if (calendar) {
      if (!calendars.some(c => c.id == calendar.id)) {
        throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
      }
      // Continue with local event creation below
    }
    else {
      // Calendar not found locally - check if it's a remote calendar we have access to
      const remoteAccess = await RemoteCalendarAccessEntity.findOne({
        where: {
          account_id: account.id,
          remote_calendar_id: eventParams.calendarId,
        },
      });

      if (remoteAccess) {
        // This is a remote calendar - delegate to remote event creation
        return this.createRemoteEvent(account, remoteAccess, eventParams);
      }

      throw new CalendarNotFoundError('Calendar for event does not exist');
    }

    eventParams.id = this.generateEventId();
    eventParams.calendarId = calendar.id;

    const event = CalendarEvent.fromObject(eventParams);
    if ( calendar.urlName.length > 0 ) {
      event.eventSourceUrl = '/' + calendar.urlName + '/' + event.id;
    }
    else {
      event.eventSourceUrl = '';
    }

    const eventEntity = EventEntity.fromModel(event);

    // Handle locationId (reference to existing location)
    if (eventParams.locationId) {
      // Validate that location exists and belongs to this calendar
      const location = await this.locationService.getLocationById(calendar, eventParams.locationId);
      if (!location) {
        throw new Error('Location not found or does not belong to this calendar');
      }

      eventEntity.location_id = eventParams.locationId;
      event.locationId = eventParams.locationId;
      event.location = location;
    }
    // Fallback to embedded location object (for backward compatibility)
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

    // If event not found locally, check if this is a remote event the user can update
    if (!eventEntity) {
      // Check if the user has remote calendar access for the specified calendarId
      if (eventParams.calendarId) {
        const remoteAccess = await RemoteCalendarAccessEntity.findOne({
          where: {
            account_id: account.id,
            remote_calendar_id: eventParams.calendarId,
          },
        });

        if (remoteAccess) {
          // This is a remote calendar event - delegate to remote update
          return this.updateRemoteEventViaActivityPub(account, remoteAccess, eventId, eventParams);
        }
      }
      throw new EventNotFoundError('Event not found');
    }

    // Remote events stored locally (calendar_id is null) cannot be updated through this method
    if (!eventEntity.calendar_id) {
      throw new InsufficientCalendarPermissionsError('Cannot update remote events through this method');
    }

    const calendar = await this.calendarService.getCalendar(eventEntity.calendar_id);
    if ( ! calendar ) {
      throw new CalendarNotFoundError('Calendar for event does not exist');
    }

    const calendars = await this.calendarService.editableCalendarsForUser(account);
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

    // Handle locationId (reference to existing location) if present
    if (eventParams.hasOwnProperty('locationId')) {
      if (eventParams.locationId === null) {
        // Clear the location
        eventEntity.location_id = null;
        event.locationId = null;
        event.location = null;
      } else {
        // Validate that location exists and belongs to this calendar
        const location = await this.locationService.getLocationById(calendar, eventParams.locationId);
        if (!location) {
          throw new Error('Location not found or does not belong to this calendar');
        }

        eventEntity.location_id = eventParams.locationId;
        event.locationId = eventParams.locationId;
        event.location = location;
      }
    }
    // Fallback to embedded location object (for backward compatibility)
    else if ( eventEntity.location_id && ! eventParams.location ) {
      eventEntity.location_id = null;
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
   * Add a new event from a remote calendar.
   * Remote events have calendar_id = null since they don't belong to a local calendar.
   * The AP origin information is tracked separately in EventObjectEntity.
   *
   * @param calendar - the local calendar context (used for location storage)
   * @param eventParams - the parameters for the new event
   * @returns a promise that resolves to the created Event
   */
  async addRemoteEvent(calendar: Calendar, eventParams:Record<string,any>): Promise<CalendarEvent> {
    if ( ! eventParams.id ) {
      throw new Error('Event id is required');
    }
    // Validate event id format
    // Accept: UUID only, or full URL formats
    if ( eventParams.id.match(/^([0-9a-f-]+|https:\/\/[^\/]+(\/calendars\/[^\/]+)?\/events\/[0-9a-f-]+)$/) === null ) {
      throw new Error('Invalid event id');
    }

    // If calendarId is explicitly provided (e.g., from a cross-instance editor),
    // preserve it. Otherwise, set to null for traditional remote federated events.
    if (!eventParams.calendarId) {
      eventParams.calendarId = null;
    }

    const event = CalendarEvent.fromObject(eventParams);
    const eventEntity = EventEntity.fromModel(event);

    if( eventParams.location ) {
      let location = await this.locationService.findOrCreateLocation(calendar, eventParams.location);
      eventEntity.location_id = location.id;
      event.location = location;
    }

    await eventEntity.save();

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
   * Update a remote event with new data from a federated Update activity.
   * This is called when receiving an Update activity via ActivityPub.
   *
   * @param calendar - the local calendar receiving this update (for location context)
   * @param eventParams - the updated event parameters
   * @returns a promise that resolves to the updated Event
   */
  async updateRemoteEvent(calendar: Calendar, eventParams: Record<string,any>): Promise<CalendarEvent> {

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
      eventEntity.location_id = null;
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

    return event;
  }

  /**
   * Delete a remote event.
   * This is called when receiving a Delete activity via ActivityPub.
   *
   * @param eventId - the ID of the event to delete
   * @returns a promise that resolves when the event is deleted
   */
  async deleteRemoteEvent(eventId: string): Promise<void> {
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
      // 1. Validate that all events exist
      const events = await EventEntity.findAll({
        where: { id: eventIds },
        transaction,
      });

      if (events.length !== eventIds.length) {
        throw new BulkEventsNotFoundError('Some events were not found or you do not have permission to modify them');
      }

      // 2. Verify all events belong to same local calendar (remote events not supported)
      const calendarIds = [...new Set(events.map(event => event.calendar_id))];

      // Check for remote events (calendar_id is null)
      if (calendarIds.includes(null)) {
        throw new MixedCalendarEventsError('Cannot bulk assign categories to remote events');
      }

      if (calendarIds.length > 1) {
        throw new MixedCalendarEventsError('All events must belong to the same calendar');
      }

      const calendarId = calendarIds[0] as string;
      const calendar = await this.calendarService.getCalendar(calendarId);

      if (!calendar) {
        throw new CalendarNotFoundError('Calendar not found for events');
      }

      // 3. Validate categories exist and belong to the same calendar
      const categories = await EventCategoryEntity.findAll({
        where: {
          id: categoryIds,
          calendar_id: calendarId,  // Use UUID, not AP URL
        },
        transaction,
      });

      if (categories.length !== categoryIds.length) {
        throw new CategoriesNotFoundError('Some categories were not found in the calendar');
      }

      // 4. Check user has permission to modify events (do this AFTER data validation)
      // All events are in the same calendar (validated above), so just check permission for that calendar
      const userCalendars = await this.calendarService.editableCalendarsForUser(account);
      const hasPermission = userCalendars.some(cal => cal.id === calendarId);
      if (!hasPermission) {
        throw new InsufficientCalendarPermissionsError('Insufficient permissions to modify events in this calendar');
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
   * @param calendarId - Optional calendar ID, required for remote calendar events
   * @throws EventNotFoundError if the event doesn't exist
   * @throws InsufficientCalendarPermissionsError if the user can't modify the calendar
   */
  async deleteEvent(account: Account, eventId: string, calendarId?: string): Promise<void> {
    const eventEntity = await EventEntity.findByPk(eventId, {
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    });

    // If event not found locally, check if this is a remote event the user can delete
    if (!eventEntity) {
      // Check if the user has remote calendar access for the specified calendarId
      if (calendarId) {
        const remoteAccess = await RemoteCalendarAccessEntity.findOne({
          where: {
            account_id: account.id,
            remote_calendar_id: calendarId,
          },
        });

        if (remoteAccess) {
          // This is a remote calendar event - delegate to remote delete
          await this.deleteRemoteEventViaActivityPub(account, remoteAccess, eventId);
          return;
        }
      }
      throw new EventNotFoundError(`Event with ID ${eventId} not found`);
    }

    // Remote events stored locally (calendar_id is null) cannot be deleted through this method
    if (!eventEntity.calendar_id) {
      throw new InsufficientCalendarPermissionsError('Cannot delete remote events through this method - use deleteRemoteEvent');
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
