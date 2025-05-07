import { DateTime } from "luxon";
import { EventEmitter } from "events";
import axios from "axios";

import { Calendar } from "@/common/model/calendar";
import CalendarService from "@/server/calendar/service/calendar";
import { ActivityPubOutboxMessageEntity, EventActivityEntity, FollowerCalendarEntity } from "@/server/activitypub/entity/activitypub";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import CreateActivity from "@/server/activitypub/model/action/create";
import UndoActivity from "@/server/activitypub/model/action/undo";
import { ActivityPubObject } from "@/server/activitypub/model/base";


class ProcessOutboxService {

  constructor() {

  }

  registerListeners(source: EventEmitter) {
    source.on('outboxMessageAdded', async (e) => {
      let message = await ActivityPubOutboxMessageEntity.findByPk(e.id);
      if ( message ) {
        await this.processOutboxMessage(message);
      }
      else {
        console.error("outbox message not found for processing");
      }
    });
  }

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

  async processOutboxMessage(message: ActivityPubOutboxMessageEntity) {
    let calendar = await CalendarService.getCalendar(message.calendar_id);

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
