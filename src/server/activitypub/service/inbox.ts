import { DateTime } from "luxon";
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from "events";
import axios from "axios";

import CreateActivity from "@/server/activitypub/model/action/create";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AcceptActivity from "@/server/activitypub/model/action/accept";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowerCalendarEntity, FollowingCalendarEntity } from "@/server/activitypub/entity/activitypub";
import { EventObjectEntity } from "@/server/activitypub/entity/event_object";
import RemoteCalendarService from "@/server/activitypub/service/remote_calendar";
import { ActivityPubActor } from "@/server/activitypub/model/base";
import CalendarInterface from "@/server/calendar/interface";
import { CalendarEvent } from "@/common/model/events";
import { Calendar } from "@/common/model/calendar";
import { addToOutbox } from "@/server/activitypub/helper/outbox";
import { CalendarEditorRemoteEntity } from "@/server/calendar/entity/calendar_editor_remote";

/**
 * Service responsible for processing incoming ActivityPub messages in the inbox.
 */
class ProcessInboxService {
  calendarInterface: CalendarInterface;
  eventBus: EventEmitter;
  remoteCalendarService: RemoteCalendarService;

  constructor(eventBus: EventEmitter, calendarInterface: CalendarInterface) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.remoteCalendarService = new RemoteCalendarService();
  }

  /**
   * Processes all unprocessed inbox messages in batches.
   *
   * @returns {Promise<void>}
   */
  async processInboxMessages() {

    let messages: ActivityPubInboxMessageEntity[] = [];

    // TODO: messageTime based cursor, perhaps, so we don't keep reprocessing the same messages if they never get processed
    do {
      messages = await ActivityPubInboxMessageEntity.findAll({
        where: { processedAt: null },
        order: [ ['messageTime', 'ASC'] ],
        limit: 1000,
      });

      for( const message of messages ) {
        await this.processInboxMessage(message);
      }
    } while( messages.length > 0 );
  }

  /**
   * Processes a single inbox message based on its type.
   *
   * @param {ActivityPubInboxMessageEntity} message - The message entity to process
   * @returns {Promise<void>}
   */
  async processInboxMessage(message: ActivityPubInboxMessageEntity ) {
    const calendar = await this.calendarInterface.getCalendar(message.calendar_id);

    try {
      if ( ! calendar ) {
        throw new Error("No calendar found for inbox");
      }
      switch( message.type ) {
        case 'Create':
          await this.processCreateEvent(calendar, CreateActivity.fromObject(message.message) );
          break;
        case 'Update':
          this.processUpdateEvent(calendar, UpdateActivity.fromObject(message.message) );
          break;
        case 'Delete':
          this.processDeleteEvent(calendar, DeleteActivity.fromObject(message.message) );
          break;
        case 'Follow':
          await this.processFollowAccount(calendar, FollowActivity.fromObject(message.message) );
          break;
        case 'Accept':
          await this.processAcceptActivity(calendar, AcceptActivity.fromObject(message.message) );
          break;
        case 'Announce':
          this.processShareEvent(calendar, AnnounceActivity.fromObject(message.message) );
          break;
        case 'Undo':
          let targetEntity = await ActivityPubInboxMessageEntity.findOne({
            where: { calendar_id: message.calendar_id, id: message.message.object },
          });

          if ( targetEntity ) {

            switch( targetEntity.type ) {
              case 'Follow':
                this.processUnfollowAccount(calendar, targetEntity);
                break;
              case 'Announce':
                this.processUnshareEvent(calendar, targetEntity);
                break;
            }
          }
          else {
            throw new Error('Undo target not found');
          }
          break;
        default:
          throw new Error('bad message type');
      }
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'ok',
      });
    }
    catch (e) {
      console.error('Error processing message', e);
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'error',
      });
    }
  }

  /**
   * Verifies that an actor owns the object they're trying to modify.
   *
   * @param {any} message - The message containing actor and object information
   * @returns {Promise<boolean>} True if the actor owns the object, false otherwise
   */
  async actorOwnsObject(message: any): Promise<boolean> {
    // TODO: implement a remote verification of the actor's ownership of the object
    // by retrieving the object from its server and checking that attributedTo.
    return message.actor === message.object.attributedTo;
  }

  /**
   * Processes a Create activity by creating a new event if it doesn't exist.
   * Handles both:
   * - Create from calendar actors (federated event sharing)
   * - Create from Person actors (remote editors creating events)
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {CreateActivity} message - The Create activity message
   * @returns {Promise<void>}
   */
  async processCreateEvent(calendar: Calendar, message: CreateActivity): Promise<CalendarEvent | null> {
    const apObjectId = message.object.id;
    const actorUri = message.actor;

    // Check if we already have this AP object by looking up EventObjectEntity
    const existingApObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    if (existingApObject) {
      // Event already exists, skip
      return null;
    }

    // Check if this is from a Person actor (remote editor) vs a calendar actor
    const isPersonActor = await this.isPersonActorUri(actorUri);

    if (isPersonActor) {
      // Verify the Person is an authorized editor of this calendar
      const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);

      if (!isAuthorizedEditor) {
        console.warn(`[INBOX] Person actor ${actorUri} is not authorized to create events on calendar ${calendar.urlName}`);
        throw new Error('Actor is not an authorized editor of this calendar');
      }

      console.log(`[INBOX] Processing Create from authorized remote editor: ${actorUri}`);
    }
    else {
      // Traditional calendar-to-calendar federation - verify ownership
      const ok = await this.actorOwnsObject(message);
      if (!ok) {
        console.warn(`[INBOX] Actor ownership verification failed for event ${apObjectId}`);
        return null;
      }
    }

    // Generate a new UUID for the local event record
    const localEventId = uuidv4();

    // Create the event
    const eventParams = {
      ...message.object,
      id: localEventId,
      event_source_url: apObjectId,
      calendarId: calendar.id,
    };

    // For Person actor creates, use the full event params from the object
    if (isPersonActor && message.object.eventParams) {
      Object.assign(eventParams, message.object.eventParams);
      eventParams.id = localEventId;
      eventParams.calendarId = calendar.id;
    }

    const createdEvent = await this.calendarInterface.addRemoteEvent(calendar, eventParams);

    // Create EventObjectEntity to track the AP identity
    await EventObjectEntity.create({
      event_id: localEventId,
      ap_id: apObjectId,
      attributed_to: actorUri,
    });

    console.log(`[INBOX] Created event ${localEventId} from ${isPersonActor ? 'Person' : 'Calendar'} actor ${actorUri}`);

    return createdEvent;
  }

  /**
   * Processes a Person actor activity synchronously and returns the result.
   * Used by the API layer for cross-instance editor operations.
   *
   * @param calendar - The calendar receiving the activity
   * @param activity - The activity to process (Create, Update, Delete)
   * @returns The created/updated event or null
   */
  async processPersonActorActivity(
    calendar: Calendar,
    activity: CreateActivity | UpdateActivity | DeleteActivity,
  ): Promise<CalendarEvent | null> {
    const actorUri = activity.actor;

    // Verify this is from a Person actor
    const isPersonActor = await this.isPersonActorUri(actorUri);
    if (!isPersonActor) {
      throw new Error('Activity is not from a Person actor');
    }

    // Verify the Person is an authorized editor
    const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);
    if (!isAuthorizedEditor) {
      throw new Error('Actor is not an authorized editor of this calendar');
    }

    switch (activity.type) {
      case 'Create':
        return this.processCreateEvent(calendar, activity as CreateActivity);
      case 'Update':
        return this.processUpdateEvent(calendar, activity as UpdateActivity);
      case 'Delete':
        await this.processDeleteEvent(calendar, activity as DeleteActivity);
        return null;
      default:
        throw new Error(`Unsupported activity type: ${(activity as any).type}`);
    }
  }

  /**
   * Checks if an actor URI is likely a Person actor (user) vs a calendar actor
   * Person actors typically have /users/ in the path
   *
   * @param actorUri - The actor URI to check
   * @returns True if this appears to be a Person actor
   */
  private async isPersonActorUri(actorUri: string): Promise<boolean> {
    return actorUri.includes('/users/');
  }

  /**
   * Checks if a Person actor is an authorized remote editor of a calendar
   *
   * @param calendarId - The calendar ID
   * @param actorUri - The Person actor URI
   * @returns True if authorized
   */
  private async isAuthorizedRemoteEditor(calendarId: string, actorUri: string): Promise<boolean> {
    const editor = await CalendarEditorRemoteEntity.findOne({
      where: {
        calendar_id: calendarId,
        actor_uri: actorUri,
      },
    });
    return editor !== null;
  }

  /**
   * Determines if an event originated from the local server.
   * Local events have a non-null calendar_id, while remote events have null.
   *
   * @param {CalendarEvent} event - The event to check
   * @returns {boolean} True if the event is local, false otherwise
   */
  isLocalEvent(event: CalendarEvent): boolean {
    return event.isLocal();
  }

  /**
   * Processes an Update activity by updating the local copy of a remote event.
   * Handles both:
   * - Update from calendar actors (federated event sharing)
   * - Update from Person actors (remote editors updating events)
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {UpdateActivity} message - The Update activity message
   * @returns {Promise<CalendarEvent | null>}
   */
  async processUpdateEvent(calendar: Calendar, message: UpdateActivity): Promise<CalendarEvent | null> {
    const apObjectId = message.object.id;
    const actorUri = message.actor;

    // Look up the local event by its AP ID
    let apObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    let existingEvent: CalendarEvent | null = null;

    if (apObject) {
      existingEvent = await this.calendarInterface.getEventById(apObject.event_id);
    }

    // For Person actor updates, also try looking up by local event ID
    // (the object.id path may contain the local event ID instead of the original AP ID)
    if (!existingEvent && message.object.eventParams?.id) {
      const localEventId = message.object.eventParams.id;
      existingEvent = await this.calendarInterface.getEventById(localEventId);

      // If found, also try to find the corresponding AP object
      if (existingEvent && !apObject) {
        apObject = await EventObjectEntity.findOne({
          where: { event_id: localEventId },
        });
      }
    }

    if (!existingEvent) {
      // Event not found - can't update
      console.warn(`[INBOX] Update activity for unknown event: ${apObjectId}`);
      return null;
    }

    // Check if this is from a Person actor (remote editor) vs a calendar actor
    const isPersonActor = await this.isPersonActorUri(actorUri);

    if (isPersonActor) {
      // Verify the Person is an authorized editor of this calendar
      const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);

      if (!isAuthorizedEditor) {
        console.warn(`[INBOX] Person actor ${actorUri} is not authorized to update events on calendar ${calendar.urlName}`);
        throw new Error('Actor is not an authorized editor of this calendar');
      }

      console.log(`[INBOX] Processing Update from authorized remote editor: ${actorUri}`);
    }
    else {
      // Traditional calendar-to-calendar federation
      if (this.isLocalEvent(existingEvent)) {
        // Can't update local events via federation from calendar actors
        return null;
      }

      const ok = await this.actorOwnsObject(message);
      if (!ok) {
        return null;
      }
    }

    // Create event params with local UUID for database
    const eventParams = {
      ...message.object,
      id: apObject.event_id,
      event_source_url: apObjectId,
    };

    // For Person actor updates, use the full event params from the object
    if (isPersonActor && message.object.eventParams) {
      Object.assign(eventParams, message.object.eventParams);
      eventParams.id = apObject.event_id;
    }

    const updatedEvent = await this.calendarInterface.updateRemoteEvent(calendar, eventParams);

    console.log(`[INBOX] Updated event ${apObject.event_id} from ${isPersonActor ? 'Person' : 'Calendar'} actor ${actorUri}`);

    return updatedEvent;
  }

  /**
   * Processes a Delete activity by deleting the local copy of an event.
   * Handles both:
   * - Delete from calendar actors (federated event sharing)
   * - Delete from Person actors (remote editors deleting events)
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {DeleteActivity} message - The Delete activity message
   * @returns {Promise<void>}
   */
  async processDeleteEvent(calendar: Calendar, message: DeleteActivity) {
    const apObjectId = message.object.id;
    const actorUri = message.actor;

    // Look up the local event by its AP ID
    let apObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    let existingEvent: CalendarEvent | null = null;
    let eventIdToDelete: string | null = null;

    if (apObject) {
      existingEvent = await this.calendarInterface.getEventById(apObject.event_id);
      eventIdToDelete = apObject.event_id;
    }

    // For Person actor deletes, also try looking up by local event ID
    // (the object.id path may contain the local event ID instead of the original AP ID)
    if (!existingEvent && message.object.eventId) {
      const localEventId = message.object.eventId;
      existingEvent = await this.calendarInterface.getEventById(localEventId);
      eventIdToDelete = localEventId;

      // If found, also try to find the corresponding AP object
      if (existingEvent && !apObject) {
        apObject = await EventObjectEntity.findOne({
          where: { event_id: localEventId },
        });
      }
    }

    if (!existingEvent || !eventIdToDelete) {
      // Event not found - nothing to delete
      console.warn(`[INBOX] Delete activity for unknown event: ${apObjectId}`);
      return;
    }

    // Check if this is from a Person actor (remote editor) vs a calendar actor
    const isPersonActor = await this.isPersonActorUri(actorUri);

    if (isPersonActor) {
      // Verify the Person is an authorized editor of this calendar
      const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);

      if (!isAuthorizedEditor) {
        console.warn(`[INBOX] Person actor ${actorUri} is not authorized to delete events on calendar ${calendar.urlName}`);
        throw new Error('Actor is not an authorized editor of this calendar');
      }

      console.log(`[INBOX] Processing Delete from authorized remote editor: ${actorUri}`);
    }
    else {
      // Traditional calendar-to-calendar federation
      if (this.isLocalEvent(existingEvent)) {
        // Can't delete local events via federation from calendar actors
        return;
      }

      const ok = await this.actorOwnsObject(message);
      if (!ok) {
        return;
      }
    }

    await this.calendarInterface.deleteRemoteEvent(eventIdToDelete);

    // Also delete the EventObjectEntity record if it exists
    if (apObject) {
      await apObject.destroy();
    }

    console.log(`[INBOX] Deleted event ${eventIdToDelete} from ${isPersonActor ? 'Person' : 'Calendar'} actor ${actorUri}`);
  }

  /**
   * Processes a Follow activity by creating a new follower relationship
   * and queuing an Accept activity for asynchronous delivery.
   *
   * @param {Calendar} calendar - The calendar being followed
   * @param {FollowActivity} message - The Follow activity message
   * @returns {Promise<void>}
   */
  async processFollowAccount(calendar: Calendar, message: FollowActivity) {
    console.log(`[INBOX] Processing Follow activity from ${message.actor} for calendar ${calendar.urlName}`);

    // Get or create RemoteCalendarEntity for the follower
    const remoteCalendar = await this.remoteCalendarService.findOrCreateByActorUri(message.actor);

    let existingFollow = await FollowerCalendarEntity.findOne({
      where: {
        remote_calendar_id: remoteCalendar.id,
        calendar_id: calendar.id,
      },
    });

    if (!existingFollow) {
      console.log(`[INBOX] Creating new follower relationship for ${message.actor}`);

      // Create the follower relationship
      await FollowerCalendarEntity.create({
        id: uuidv4(),
        remote_calendar_id: remoteCalendar.id,
        calendar_id: calendar.id,
      });

      console.log(`[INBOX] Follower relationship created successfully`);

      // Queue Accept activity for asynchronous delivery
      const actorUrl = ActivityPubActor.actorUrl(calendar);
      const acceptActivity = new AcceptActivity(actorUrl, message);

      console.log(`[INBOX] Queueing Accept activity to ${message.actor}`);

      await addToOutbox(this.eventBus, calendar, acceptActivity);

      console.log(`[INBOX] Accept activity queued for delivery`);
    }
    else {
      console.log(`[INBOX] Follow relationship already exists for ${message.actor}, skipping`);
    }
  }

  /**
   * Processes an Accept activity received in response to a Follow request.
   * Confirms the follow relationship on the initiating side.
   *
   * @param {Calendar} calendar - The calendar that initiated the Follow
   * @param {AcceptActivity} message - The Accept activity message
   * @returns {Promise<void>}
   */
  async processAcceptActivity(calendar: Calendar, message: AcceptActivity) {
    console.log(`[INBOX] Processing Accept activity from ${message.actor} for calendar ${calendar.urlName}`);

    // The Accept activity's object should be the original Follow activity
    const followObject = message.object;

    // Verify this Accept corresponds to a Follow we sent
    if (followObject && typeof followObject === 'object' && followObject.type === 'Follow') {
      const followActivity = followObject as FollowActivity;

      console.log(`[INBOX] Accept confirms Follow of ${followActivity.object}`);

      // Find the RemoteCalendarEntity for the remote calendar we're following
      const remoteActorUrl = followActivity.object as string;
      const remoteCalendar = await this.remoteCalendarService.getByActorUri(remoteActorUrl);

      if (!remoteCalendar) {
        console.warn(`[INBOX] No RemoteCalendarEntity found for ${remoteActorUrl}, Accept may be for unknown follow`);
        return;
      }

      // Find the corresponding FollowingCalendarEntity record
      const followingRecord = await FollowingCalendarEntity.findOne({
        where: {
          remote_calendar_id: remoteCalendar.id,
          calendar_id: calendar.id,
        },
      });

      if (followingRecord) {
        // The follow relationship is now confirmed
        // In the future, we could add a "confirmed" status field
        // For now, the existence of the record means it's active
        console.log(`[INBOX] Follow relationship confirmed for calendar ${calendar.id} following ${followActivity.object}`);
      }
      else {
        console.warn(`[INBOX] No FollowingCalendarEntity found for ${followActivity.object}, Accept may be for unknown follow`);
      }
    }
    else {
      console.warn(`[INBOX] Accept activity does not contain valid Follow object`);
    }
  }

  /**
   * Processes an Unfollow action (via Undo) by removing a follower relationship.
   *
   * @param {Calendar} calendar - The calendar being unfollowed
   * @param {any} message - The message containing the unfollow information
   * @returns {Promise<void>}
   */
  // TODO: proper message type
  async processUnfollowAccount(calendar: Calendar, message: any) {
    // Extract the actor from the original Follow activity message
    const actor = typeof message.message === 'object' ? message.message.actor : message.actor;

    // Find the RemoteCalendarEntity for this actor
    const remoteCalendar = await this.remoteCalendarService.getByActorUri(actor);
    if (!remoteCalendar) {
      console.warn(`[INBOX] No RemoteCalendarEntity found for ${actor}, cannot unfollow`);
      return;
    }

    await FollowerCalendarEntity.destroy({
      where: {
        remote_calendar_id: remoteCalendar.id,
        calendar_id: calendar.id,
      },
    });
  }

  /**
   * Processes an Announce (Share) activity for an event.
   *
   * @param {Calendar} calendar - The calendar context for the share
   * @param {AnnounceActivity} message - The Announce activity message
   * @returns {Promise<void>}
   */
  async processShareEvent(calendar: Calendar, message: AnnounceActivity) {
    // Extract event URL from the object (either a string URL or an object with id)
    const apObjectId = typeof message.object === 'string' ? message.object : message.object.id;

    // Check if we already have this AP object
    let apObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    // If event doesn't exist locally, fetch and store it
    if (!apObject) {
      try {
        // Fetch the event object from the remote server
        const response = await axios.get(apObjectId, {
          timeout: 10000,
          headers: {
            'Accept': 'application/activity+json, application/ld+json',
          },
        });

        if (response && response.data) {
          // Generate a new UUID for the local event record
          const localEventId = uuidv4();

          // Determine the attributed_to from the fetched object or the announcer
          const attributedTo = response.data.attributedTo || message.actor;

          // Store the event locally with null calendar_id (remote event)
          const eventParams = {
            ...response.data,
            id: localEventId,
            event_source_url: apObjectId,
          };

          await this.calendarInterface.addRemoteEvent(calendar, eventParams);

          // Create EventObjectEntity to track the AP identity
          apObject = await EventObjectEntity.create({
            event_id: localEventId,
            ap_id: apObjectId,
            attributed_to: attributedTo,
          });
        }
      }
      catch (error: any) {
        console.error(`[INBOX] Failed to fetch or store remote event ${apObjectId}:`, error.message);
        return;
      }
    }

    // Track the Announce activity - use RemoteCalendarEntity reference
    const sharerRemoteCalendar = await this.remoteCalendarService.findOrCreateByActorUri(message.actor);

    const existingShare = await EventActivityEntity.findOne({
      where: {
        event_id: apObjectId,
        remote_calendar_id: sharerRemoteCalendar.id,
        type: 'share',
      },
    });

    if (!existingShare) {
      await EventActivityEntity.create({
        event_id: apObjectId,
        remote_calendar_id: sharerRemoteCalendar.id,
        type: 'share',
      });
    }
  }

  /**
   * Processes an Unshare action (via Undo) for an event.
   *
   * @param {Calendar} calendar - The calendar context for the unshare
   * @param {any} message - The message containing the unshare information
   * @returns {Promise<void>}
   */
  // TODO: proper message type
  async processUnshareEvent(calendar: Calendar, message: any) {
    // Extract event ID from the object (either a string URL or an object with id)
    const eventId = typeof message.object === 'string' ? message.object : message.object.id;

    // Extract the actor from the original Announce activity message
    const actor = typeof message.message === 'object' ? message.message.actor : message.actor;

    // Find the RemoteCalendarEntity for this actor
    const remoteCalendar = await this.remoteCalendarService.getByActorUri(actor);
    if (!remoteCalendar) {
      console.warn(`[INBOX] No RemoteCalendarEntity found for ${actor}, cannot unshare`);
      return;
    }

    let existingShare = await EventActivityEntity.findOne({
      where: {
        event_id: eventId,
        remote_calendar_id: remoteCalendar.id,
        type: 'share',
      },
    });
    if ( existingShare ) {
      existingShare.destroy();
      // IF it's a event local to this server, send to all followers and sharers
    };
  }
}

export default ProcessInboxService;
