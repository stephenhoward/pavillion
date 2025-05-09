import { DateTime } from "luxon";
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from "events";

import CreateActivity from "@/server/activitypub/model/action/create";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowerCalendarEntity } from "@/server/activitypub/entity/activitypub";
import CalendarService from "@/server/calendar/service/calendar";
import EventService from "@/server/calendar/service/events";
import { CalendarEvent } from "@/common/model/events";
import { Calendar } from "@/common/model/calendar";

/**
 * Service responsible for processing incoming ActivityPub messages in the inbox.
 */
class ProcessInboxService {
  eventService: EventService;

  constructor() {
    this.eventService = new EventService();
  }

  /**
   * Registers event listeners for inbox message processing.
   * Events include:
   * - 'inboxMessageAdded'
   *
   * @param {EventEmitter} source - The event emitter source to listen to for inbox events
   */
  registerListeners(source: EventEmitter) {
    source.on('inboxMessageAdded', async (e) => {
      let message = await ActivityPubInboxMessageEntity.findByPk(e.id);

      if ( ! message ) {
        console.error("inbox message not found for processing");
        return;
      }
      if ( ! message.processed_time ) {
        await this.processInboxMessage(message);
      }
    });
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
    const calendar = await CalendarService.getCalendar(message.calendar_id);

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
          this.processFollowAccount(calendar, FollowActivity.fromObject(message.message) );
          break;
        case 'Announce':
          this.processShareEvent(calendar, AnnounceActivity.fromObject(message.message) );
          break;
        case 'Undo':
          let targetEntity = await ActivityPubInboxMessageEntity.findOne({
            where: { calendarId: message.calendar_id, id: message.message.object },
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
    let existingEvent = await this.eventService.getEventById(message.object.id);
    if ( ! existingEvent ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.eventService.addRemoteEvent(message.object);
      }
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
    let existingEvent = await this.eventService.getEventById(message.object.id);
    if ( existingEvent && ! this.isLocalEvent(existingEvent) ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.eventService.updateRemoteEvent(message.object);
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
    let existingEvent = await this.eventService.getEventById(message.object.id);
    if ( existingEvent && ! this.isLocalEvent(existingEvent) ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.eventService.deleteRemoteEvent(message.object.id);
      }
    }
  }

  /**
   * Processes a Follow activity by creating a new follower relationship.
   *
   * @param {Calendar} calendar - The calendar being followed
   * @param {FollowActivity} message - The Follow activity message
   * @returns {Promise<void>}
   */
  async processFollowAccount(calendar: Calendar, message: FollowActivity) {
    let existingFollow = await FollowerCalendarEntity.findOne({
      where: {
        remote_calendar_id: message.actor,
        calendar_id: calendar.id,
      },
    });

    if (!existingFollow) {
      await FollowerCalendarEntity.create({
        id: uuidv4(),
        remote_calendar_id: message.actor,
        calendar_id: calendar.id,
      });
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
    await FollowerCalendarEntity.destroy({
      where: {
        remote_calendar_id: message.actor,
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
