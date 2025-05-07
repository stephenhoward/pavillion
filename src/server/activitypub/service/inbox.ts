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


class ProcessInboxService {
  eventService: EventService;

  constructor() {
    this.eventService = new EventService();
  }

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

  // TODO: validate message sender was allowed to send this message
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

  async actorOwnsObject(message: any): Promise<boolean> {
    // TODO: implement a remote verification of the actor's ownership of the object
    // by retrieving the object from its server and checking that attributedTo.
    if ( message.actor == message.object.attributedTo ) {
      return true;
    }
    return false;
  }

  async processCreateEvent(calendar: Calendar, message: CreateActivity) {
    let existingEvent = await this.eventService.getEventById(message.object.id);
    if ( ! existingEvent ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.eventService.addRemoteEvent(message.object);
      }
    }
  }

  isLocalEvent(event: CalendarEvent): boolean {
    // TODO: implement this propely
    return event.origin === 'local';
  }

  async processUpdateEvent(calendar: Calendar, message: UpdateActivity) {
    let existingEvent = await this.eventService.getEventById(message.object.id);
    if ( existingEvent && ! this.isLocalEvent(existingEvent) ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.eventService.updateRemoteEvent(message.object);
      }
    }
  }

  async processDeleteEvent(calendar: Calendar, message: DeleteActivity) {
    let existingEvent = await this.eventService.getEventById(message.object.id);
    if ( existingEvent && ! this.isLocalEvent(existingEvent) ) {
      let ok = await this.actorOwnsObject(message);
      if ( ok ) {
        await this.eventService.deleteRemoteEvent(message.object.id);
      }
    }
  }

  async processFollowAccount(calendar: Calendar, message: any) {
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

  async processUnfollowAccount(calendar: Calendar, message: any) {
    await FollowerCalendarEntity.destroy({
      where: {
        remote_calendar_id: message.actor,
        calendar_id: calendar.id,
      },
    });
  }

  async processShareEvent(calendar: Calendar, message: any) {
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
