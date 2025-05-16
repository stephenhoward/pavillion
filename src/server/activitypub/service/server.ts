import { EventEmitter } from "events";
import config from 'config';

import { Calendar } from "@/common/model/calendar";
import { WebFingerResponse } from "@/server/activitypub/model/webfinger";
import { UserProfileResponse } from "@/server/activitypub/model/userprofile";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import { ActivityPubInboxMessageEntity, FollowerCalendarEntity } from "@/server/activitypub/entity/activitypub";
import CalendarService from "@/server/calendar/service/calendar";


class ActivityPubService extends EventEmitter {

  constructor() {
    super();
  }

  /**
     * parse the webfinger resource format into username and domain
     * @param resource
     * @returns { username, domain}
     */
  parseWebFingerResource(resource: string): { username: string, domain: string } {
    resource = resource.replace('acct:', '');
    let parts = resource.split('@');

    if ( parts.length === 2 && parts[0].length > 0 && parts[1].length > 0 ) {
      return { username: parts[0], domain: parts[1] };
    }

    return { username: '', domain: '' };
  }

  /**
     * Generate a webfinger response for the provided username
     * @param urlName
     * @param domain
     * @returns WebFingerResponse message
     */
  async lookupWebFinger(urlName: string, domain: string): Promise<WebFingerResponse|null> {
    let calendar = await CalendarService.getCalendarByName(urlName);

    if ( calendar && domain === config.get('domain') ) {
      return new WebFingerResponse(calendar.urlName, config.get('domain'));
    }

    return null;
  }

  /**
     * Generate an actor message for the provided username
     * @param calendarName
     * @param domain
     * @returns UserProfileResponse message
     */
  async lookupUserProfile(calendarName: string): Promise<UserProfileResponse|null> {
    let calendar = await CalendarService.getCalendarByName(calendarName);

    console.log(calendar);
    if ( calendar ) {
      return new UserProfileResponse(calendar.urlName, config.get('domain'));
    }

    return null;
  }

  /**
     * Record a new follower for a local calendar
     * @param remoteCalendarId The remote calendar identifier
     * @param localCalendar The local calendar being followed
     * @param followActivityId The ID of the follow activity
     */
  async addFollower(remoteCalendarId: string, localCalendar: Calendar, followActivityId: string) {
    // Check if this follower already exists
    let existingFollower = await FollowerCalendarEntity.findOne({
      where: {
        remote_calendar_id: remoteCalendarId,
        calendar_id: localCalendar.id,
      },
    });

    if (existingFollower) {
      return; // Already following
    }

    // Create new follower record
    let followerEntity = FollowerCalendarEntity.build({
      id: followActivityId,
      remote_calendar_id: remoteCalendarId,
      calendar_id: localCalendar.id,
    });

    await followerEntity.save();
  }

  /**
     * Remove a follower from a local calendar
     * @param remoteCalendarId The remote calendar identifier
     * @param localCalendar The local calendar being unfollowed
     */
  async removeFollower(remoteCalendarId: string, localCalendar: Calendar) {
    let followers = await FollowerCalendarEntity.findAll({
      where: {
        remote_calendar_id: remoteCalendarId,
        calendar_id: localCalendar.id,
      },
    });

    for (let follower of followers) {
      await follower.destroy();
    }
  }

  /**
     * Add provided message to the calendar's inbox
     * @param calendar
     * @param message
     * @returns null
     */
  // TODO permissions? block lists? rate limiting?
  async addToInbox(calendar: Calendar, message: ActivityPubActivity ): Promise<null> {
    let foundCalendar = await CalendarService.getCalendar(calendar.id);

    if ( foundCalendar === null ) {
      throw new Error('Account not found');
    }

    let messageEntity = await ActivityPubInboxMessageEntity.findByPk(message.id);
    if ( ! messageEntity ) {
      messageEntity = ActivityPubInboxMessageEntity.build({
        id: message.id,
        calendar_id: calendar.id,
        type: message.type,
        message_time: message.published,
        message: message,
      });
      await messageEntity.save();
    }

    this.emit('inboxMessageAdded', { calendar_id: calendar.id, id: messageEntity.id });

    return null;
  }

  /**
     *
     * @param calendar Retrieve messages from the outbox of the provided calendar
     * @param limit
     * @returns a list of ActivityPubMessage objects
     */
  // TODO: implement date ranges or other limits
  async readOutbox(calendar: Calendar): Promise<ActivityPubActivity[]> {
    let messageEntities = await ActivityPubInboxMessageEntity.findAll({
      where: { calendar_id: calendar.id },
      order: [['created_at', 'DESC']],
    });

    return messageEntities.map( (message) => message.toModel() );
  }

}

export default ActivityPubService;
