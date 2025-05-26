import { DateTime } from "luxon";
import { EventEmitter } from "events";
import axios from "axios";

import { Calendar } from "@/common/model/calendar";
import { ActivityPubOutboxMessageEntity, EventActivityEntity, FollowerCalendarEntity } from "@/server/activitypub/entity/activitypub";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import CreateActivity from "@/server/activitypub/model/action/create";
import UndoActivity from "@/server/activitypub/model/action/undo";
import { ActivityPubObject } from "@/server/activitypub/model/base";
import CalendarInterface from "@/server/calendar/interface";

/**
 * Service responsible for processing and distributing outgoing ActivityPub messages.
 * Handles delivery of various activity types to followers and other recipients.
 */
class ProcessOutboxService {
  calendarService: CalendarInterface;

  constructor(eventBus: EventEmitter) {
    this.calendarService = new CalendarInterface(eventBus);
  }

  /**
   * Processes all unprocessed outbox messages in batches.
   *
   * @returns {Promise<void>}
   */
  async processOutboxMessages() {

    let messages: ActivityPubOutboxMessageEntity[] = [];

    do {
      messages = await ActivityPubOutboxMessageEntity.findAll({
        where: { processedAt: null },
        order: [ ['messageTime', 'ASC'] ],
        limit: 1000,
      });

      for( const message of messages ) {
        await this.processOutboxMessage(message);
      }
    } while( messages.length > 0 );
  }

  /**
   * Processes a single outbox message, determining its type and sending it to appropriate recipients.
   *
   * @param {ActivityPubOutboxMessageEntity} message - The outbox message to process
   * @returns {Promise<void>}
   * @throws {Error} If no calendar is found for the message
   */
  async processOutboxMessage(message: ActivityPubOutboxMessageEntity) {
    let calendar = await this.calendarService.getCalendar(message.calendar_id);

    if ( ! calendar ) {
      throw new Error("No calendar found for message");
    }

    let activity = null;

    switch( message.type ) {
      case 'Create':
        activity = CreateActivity.fromObject(message.message);
        break;
      case 'Update':
        activity = UpdateActivity.fromObject(message.message);
        break;
      case 'Delete':
        activity = DeleteActivity.fromObject(message.message);
        break;
      case 'Follow':
        activity = FollowActivity.fromObject(message.message);
        break;
      case 'Announce':
        activity = AnnounceActivity.fromObject(message.message);
        break;
      case 'Undo':
        activity = UndoActivity.fromObject(message.message);
        break;
    }

    if ( activity ) {
      const recipients = await this.getRecipients(calendar, activity.object);

      for( const recipient of recipients ) {
        const inboxUrl = await this.resolveInboxUrl(recipient);

        if ( inboxUrl ) {
          axios.post(inboxUrl, activity);
        }
        else {
          console.log("skipping message to " + recipient + " because no inbox found");
        }
      }
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'ok',
      });
    }
    else {
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'bad message type',
      });
    }
  }

  /**
   * Gets a list of recipient IDs for a given calendar and object.
   * Includes followers of the calendar and calendars that have shared the specific object.
   *
   * @param {Calendar} calendar - The source calendar
   * @param {ActivityPubObject|string} object - The ActivityPub object or its ID
   * @returns {Promise<string[]>} List of recipient IDs
   */
  async getRecipients(calendar: Calendar, object: ActivityPubObject|string): Promise<string[]> {
    let recipients: string[] = [];

    const followers = await FollowerCalendarEntity.findAll({ where: { calendar_id: calendar.id } });
    for( const follower of followers ) {
      recipients.push(follower.remote_calendar_id);
    }

    const object_id = typeof object === 'string' ? object : object.id;
    const observers = await EventActivityEntity.findAll({ where: { event_id: object_id } });
    for( const observer of observers ) {
      recipients.push(observer.remote_calendar_id);
    }

    return recipients;
  }

  /**
   * Resolves the inbox URL for a remote user by fetching their profile.
   *
   * @param {string} remote_user - The remote user identifier
   * @returns {Promise<string|null>} The inbox URL if found, otherwise null
   */
  async resolveInboxUrl(remote_user: string): Promise<string|null> {

    const profileUrl = await this.fetchProfileUrl(remote_user);
    if ( profileUrl ) {
      let response = await axios.get(profileUrl);

      if ( response && response.data ) {
        return response.data.inbox;
      }
    }

    return null;
  }

  /**
   * Fetches the profile URL for a remote user using WebFinger protocol.
   *
   * @param {string} remote_user - The remote user identifier (username@domain)
   * @returns {Promise<string|null>} The profile URL if found, otherwise null
   */
  async fetchProfileUrl(remote_user: string): Promise<string|null> {
    const [username, domain] = remote_user.split('@');
    if ( username && domain ) {
      let response = await axios.get('https://' + domain + '/.well-known/webfinger?resource=acct:' + username);

      if ( response && response.data && response.data.links ) {
        const profileLink = (await response).data.links.filter((link: any) => link.rel === 'self');
        if ( profileLink.length > 0 ) {
          return profileLink[0].href;
        }
      }

    }
    return null;
  }
}

export default ProcessOutboxService;
