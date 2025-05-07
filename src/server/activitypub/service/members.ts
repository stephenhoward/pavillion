import { DateTime } from "luxon";
import { EventEmitter } from "events";
import config from 'config';

import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { EventObject } from '@/server/activitypub/model/object/event';
import EventService from "@/server/calendar/service/events";
import CalendarService from "@/server/calendar/service/calendar";
import { ActivityPubOutboxMessageEntity, FollowingCalendarEntity, SharedEventEntity, AutoRepostPolicy } from "@/server/activitypub/entity/activitypub";
import UndoActivity from "../model/action/undo";
import { EventEntity } from "@/server/calendar/entity/event";

class ActivityPubService extends EventEmitter {
  eventService: EventService;

  constructor() {
    super();
    this.eventService = new EventService();
  }

  async actorUrl(calendar: Calendar): Promise<string> {
    return 'https://' + config.get('domain') + '/o/' + calendar.urlName;
  }

  registerListeners(source: EventEmitter) {
    source.on('eventCreated', async (e) => {
      let actorUrl = await this.actorUrl(e.calendar);
      this.addToOutbox(
        e.calendar,
        new CreateActivity(
          actorUrl,
          new EventObject(e.calendar, e.event),
        ),
      );
    });
    source.on('eventUpdated', async (e) => {
      let actorUrl = await this.actorUrl(e.calendar);
      this.addToOutbox(
        e.calendar,
        new UpdateActivity(
          actorUrl,
          new EventObject(e.calendar, e.event),
        ),
      );
    });
    source.on('eventDeleted', async (e) => {
      let actorUrl = await this.actorUrl(e.calendar);
      this.addToOutbox(
        e.calendar,
        new DeleteActivity(
          actorUrl,
          EventObject.eventUrl(e.calendar, e.event),
        ),
      );
    });
  }

  static isValidDomain(domain: string): boolean {
    return domain.match(/^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,}$/) !== null;
  }

  static isValidUsername(username: string): boolean {
    return username.match(/^[a-z0-9_]{3,16}$/) !== null;
  }

  static isValidOrgIdentifier(identifier: string): boolean {
    let parts = identifier.split('@');
    return parts.length === 2
            && ActivityPubService.isValidUsername(parts[0])
            && ActivityPubService.isValidDomain(parts[1]);
  }

  /**
     * Follow a calendar from another server
     * @param account The local account requesting to follow
     * @param calendar The local calendar that will follow the remote calendar
     * @param orgIdentifier The remote calendar identifier to follow
     * @param repostPolicy The auto-repost policy to use for this follow relationship
     */
  async followCalendar(account: Account, calendar: Calendar, orgIdentifier: string, repostPolicy = AutoRepostPolicy.MANUAL) {
    if (!ActivityPubService.isValidOrgIdentifier(orgIdentifier)) {
      throw new Error('Invalid remote calendar identifier: ' + orgIdentifier);
    }

    if (!CalendarService.userCanModifyCalendar(account, calendar)) {
      throw new Error('User does not have permission to modify calendar: ' + calendar.id);
    }

    // Check if we're already following this calendar
    let existingFollowEntity = await FollowingCalendarEntity.findOne({
      where: {
        remote_calendar_id: orgIdentifier,
        calendar_id: calendar.id,
      },
    });

    // Update the repost policy if follow already exists
    if (existingFollowEntity) {
      if ( existingFollowEntity.repost_policy !== repostPolicy ) {
        existingFollowEntity.repost_policy = repostPolicy;
        await existingFollowEntity.save();
      }
      return;
    }

    let actor = await this.actorUrl(calendar);
    // TODO: transform accountIdentifier into a URL (via webfinger?)
    let followActivity = new FollowActivity(actor, orgIdentifier);

    let followEntity = FollowingCalendarEntity.build({
      id: followActivity.id,
      remote_calendar_id: orgIdentifier,
      calendar_id: calendar.id,
      repost_policy: repostPolicy,
    });
    await followEntity.save();

    this.addToOutbox(calendar, followActivity);
  }

  async unfollowCalendar(account: Account, calendar: Calendar, orgIdentifier: string) {
    if (!CalendarService.userCanModifyCalendar(account, calendar)) {
      throw new Error('User does not have permission to modify calendar: ' + calendar.id);
    }

    let followings = await FollowingCalendarEntity.findAll({
      where: {
        remote_calendar_id: orgIdentifier,
        calendar_id: calendar.id,
      },
    });

    let actor = await this.actorUrl(calendar);
    for (let following of followings) {
      this.addToOutbox(calendar, new UndoActivity(actor, following.id));
      await following.destroy();
    }
  }

  /**
     * user on this server shares an event from someone else
     * @param account The account performing the sharing
     * @param calendar The calendar to share to
     * @param eventUrl URL of remote event
     */
  async shareEvent(account: Account, calendar: Calendar, eventUrl: string) {

    if ( ! CalendarService.userCanModifyCalendar(account, calendar) ) {
      throw new Error('User does not have permission to modify calendar: ' + calendar.id);
    }

    if (!eventUrl.match("^https:\/\/")) {
      throw new Error('Invalid shared event url: ' + eventUrl);
    }

    let existingShareEntity = await SharedEventEntity.findOne({
      where: {
        event_id: eventUrl,
        calendar_id: calendar.id,
      },
    });

    if (existingShareEntity) {
      return;
    }

    let actor = await this.actorUrl(calendar);
    let shareActivity = new AnnounceActivity(actor, eventUrl);

    SharedEventEntity.create({
      id: shareActivity.id,
      event_id: eventUrl,
      calendar_id: calendar.id,
    });
    this.addToOutbox(calendar, shareActivity);
  }

  /**
     * user on this server stops sharing an event from someone else
     * @param account The account performing the unsharing
     * @param calendar The calendar to remove the share from
     * @param eventUrl URL of remote event
     */
  async unshareEvent(account: Account, calendar: Calendar, eventUrl: string) {

    if (!CalendarService.userCanModifyCalendar(account, calendar)) {
      throw new Error('User does not have permission to modify calendar: ' + calendar.id);
    }

    let shares = await SharedEventEntity.findAll({
      where: {
        event_id: eventUrl,
        calendar_id: calendar.id,
      },
    });
    let actorUrl = await this.actorUrl(calendar);
    for (let share of shares) {
      this.addToOutbox(calendar, new UndoActivity(actorUrl, share.id));
      share.destroy();
    }
  }

  async addToOutbox(calendar: Calendar, message: ActivityPubActivity) {
    let calendarUrl = await this.actorUrl(calendar);

    if (calendarUrl == message.actor) {
      let messageEntity = ActivityPubOutboxMessageEntity.build({
        id: message.id,
        type: message.type,
        calendar_id: calendar.id,
        message_time: DateTime.utc(),
        message: message,
      });
      await messageEntity.save();

      this.emit('outboxMessageAdded', message);
    }
  }

  async getFeed(calendar: Calendar, page?: number, pageSize?: number) {

    return EventEntity.findAll({
      include: [{
        model: FollowingCalendarEntity,
        as: 'follows',
        required: true,
        where: {
          calendar_id: calendar.id,
        },
      }],
      limit: pageSize,
      offset: page ? page * pageSize : 0,
      order: [['start', 'DESC']],
    });
  }
}

export default ActivityPubService;
