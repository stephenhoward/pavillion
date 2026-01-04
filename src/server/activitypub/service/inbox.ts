import { DateTime } from "luxon";
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from "events";

import CreateActivity from "@/server/activitypub/model/action/create";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AcceptActivity from "@/server/activitypub/model/action/accept";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowerCalendarEntity, FollowingCalendarEntity } from "@/server/activitypub/entity/activitypub";
import { ActivityPubActor } from "@/server/activitypub/model/base";
import CalendarInterface from "@/server/calendar/interface";
import { CalendarEvent } from "@/common/model/events";
import { Calendar } from "@/common/model/calendar";
import { addToOutbox } from "@/server/activitypub/helper/outbox";

/**
 * Service responsible for processing incoming ActivityPub messages in the inbox.
 */
class ProcessInboxService {
  calendarInterface: CalendarInterface;
  eventBus: EventEmitter;

  constructor(eventBus: EventEmitter, calendarInterface: CalendarInterface) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
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
    console.log(`[INBOX] Verifying actor ownership:`);
    console.log(`[INBOX]   message.actor: ${message.actor}`);
    console.log(`[INBOX]   message.object.attributedTo: ${message.object.attributedTo}`);
    console.log(`[INBOX]   message.object:`, JSON.stringify(message.object, null, 2));

    if ( message.actor == message.object.attributedTo ) {
      return true;
    }
    return false;
  }

  /**
   * Processes a Create activity by creating a new event if it doesn't exist.
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {CreateActivity} message - The Create activity message
   * @returns {Promise<void>}
   */
  async processCreateEvent(calendar: Calendar, message: CreateActivity) {
    console.log(`[INBOX] Processing Create activity for event ${message.object.id}`);
    console.log(`[INBOX] Event from actor: ${message.actor}`);

    let existingEvent = null;
    try {
      existingEvent = await this.calendarInterface.getEventById(message.object.id);
    }
    catch {
      // Event not found - this is expected for new events
    }

    if ( ! existingEvent ) {
      console.log(`[INBOX] Event ${message.object.id} does not exist locally, creating...`);

      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        // Set calendarId to the remote calendar's AP identifier (from message.actor)
        const eventParams = {
          ...message.object,
          calendarId: message.actor,
        };
        console.log(`[INBOX] Calling addRemoteEvent with calendarId: ${message.actor}`);
        await this.calendarInterface.addRemoteEvent(calendar, eventParams);
        console.log(`[INBOX] Successfully created remote event ${message.object.id}`);
      }
      else {
        console.warn(`[INBOX] Actor ownership verification failed for event ${message.object.id}`);
      }
    }
    else {
      console.log(`[INBOX] Event ${message.object.id} already exists, skipping create`);
    }
  }

  /**
   * Determines if an event originated from the local server.
   *
   * @param {CalendarEvent} event - The event to check
   * @returns {boolean} True if the event is local, false otherwise
   */
  isLocalEvent(event: CalendarEvent): boolean {
    // TODO: implement this propely
    return event.origin === 'local';
  }

  /**
   * Processes an Update activity by updating the local copy of a remote event.
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {UpdateActivity} message - The Update activity message
   * @returns {Promise<void>}
   */
  async processUpdateEvent(calendar: Calendar, message: UpdateActivity) {
    let existingEvent = await this.calendarInterface.getEventById(message.object.id);
    if ( existingEvent && ! this.isLocalEvent(existingEvent) ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.calendarInterface.updateRemoteEvent(calendar, message.object);
      }
    }
  }

  /**
   * Processes a Delete activity by deleting the local copy of a remote event.
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {DeleteActivity} message - The Delete activity message
   * @returns {Promise<void>}
   */
  async processDeleteEvent(calendar: Calendar, message: DeleteActivity) {
    let existingEvent = await this.calendarInterface.getEventById(message.object.id);
    if ( existingEvent && ! this.isLocalEvent(existingEvent) ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.calendarInterface.deleteRemoteEvent(message.object.id);
      }
    }
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

    let existingFollow = await FollowerCalendarEntity.findOne({
      where: {
        remote_calendar_id: message.actor,
        calendar_id: calendar.id,
      },
    });

    if (!existingFollow) {
      console.log(`[INBOX] Creating new follower relationship for ${message.actor}`);

      // Create the follower relationship
      await FollowerCalendarEntity.create({
        id: uuidv4(),
        remote_calendar_id: message.actor,
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

      // Find the corresponding FollowingCalendarEntity record
      // The follow.object is the remote calendar we're following
      const followingRecord = await FollowingCalendarEntity.findOne({
        where: {
          remote_calendar_id: followActivity.object as string,
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

    await FollowerCalendarEntity.destroy({
      where: {
        remote_calendar_id: actor,
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
    let existingShare = await EventActivityEntity.findOne({
      where: {
        event_id: message.object.id,
        calendar_id: calendar.id,
        type: 'share',
      },
    });

    if ( ! existingShare ) {
      EventActivityEntity.create({
        event_id: message.object.id,
        calendar_id: calendar.id,
        type: 'share',
      });
      // IF it's a event local to this server, send to all followers and sharers
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
    let existingShare = await EventActivityEntity.findOne({
      where: {
        event_id: message.object.id,
        calendar_id: calendar.id,
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
