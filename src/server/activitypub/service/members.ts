import { DateTime } from "luxon";
import { EventEmitter } from "events";
import config from 'config';
import axios from 'axios';

import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { FollowingCalendar, FollowerCalendar, AutoRepostPolicy } from "@/common/model/follow";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { ActivityPubOutboxMessageEntity, FollowingCalendarEntity, FollowerCalendarEntity, SharedEventEntity } from "@/server/activitypub/entity/activitypub";
import UndoActivity from "../model/action/undo";
import { EventEntity } from "@/server/calendar/entity/event";
import CalendarInterface from "@/server/calendar/interface";

class ActivityPubService {
  calendarService: CalendarInterface;

  constructor(
    private eventBus: EventEmitter,
  ) {
    this.calendarService = new CalendarInterface(eventBus);
  }

  async actorUrl(calendar: Calendar): Promise<string> {
    return 'https://' + config.get('domain') + '/o/' + calendar.urlName;
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

    if (!this.calendarService.userCanModifyCalendar(account, calendar)) {
      throw new Error('User does not have permission to modify calendar: ' + calendar.id);
    }

    // Prevent self-follows
    const localDomain = config.get('domain') as string;
    const selfIdentifier = `${calendar.urlName}@${localDomain}`;
    if (orgIdentifier === selfIdentifier) {
      throw new Error('A calendar cannot follow itself');
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
    if (!this.calendarService.userCanModifyCalendar(account, calendar)) {
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
     * @param autoPosted Whether this share was created automatically by the auto-post system
     */
  async shareEvent(account: Account, calendar: Calendar, eventUrl: string, autoPosted = false) {

    if ( ! this.calendarService.userCanModifyCalendar(account, calendar) ) {
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
      auto_posted: autoPosted,
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

    if (!this.calendarService.userCanModifyCalendar(account, calendar)) {
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

  /**
   * Get list of calendars that this calendar is following
   * @param calendar The calendar whose followings to retrieve
   * @returns Array of FollowingCalendarEntity objects
   */
  async getFollowing(calendar: Calendar): Promise<FollowingCalendar[]> {
    const entities = await FollowingCalendarEntity.findAll({
      where: {
        calendar_id: calendar.id,
      },
    });
    return entities.map(entity => entity.toModel());
  }

  /**
   * Get list of calendars that are following this calendar
   * @param calendar The calendar whose followers to retrieve
   * @returns Array of FollowerCalendarEntity objects
   */
  async getFollowers(calendar: Calendar): Promise<FollowerCalendar[]> {
    const entities = await FollowerCalendarEntity.findAll({
      where: {
        calendar_id: calendar.id,
      },
    });
    return entities.map(entity => entity.toModel());
  }

  /**
   * Update the auto-repost policy for a follow relationship
   * @param calendar The local calendar that owns the follow relationship
   * @param followId The ID of the follow relationship to update
   * @param policy The new auto-repost policy
   */
  async updateFollowPolicy(calendar: Calendar, followId: string, policy: AutoRepostPolicy): Promise<void> {
    // Validate policy is a valid AutoRepostPolicy value
    const validPolicies = [AutoRepostPolicy.MANUAL, AutoRepostPolicy.ORIGINAL, AutoRepostPolicy.ALL];
    if (!validPolicies.includes(policy)) {
      throw new Error('Invalid repost policy: ' + policy);
    }

    const followEntity = await FollowingCalendarEntity.findOne({
      where: {
        id: followId,
        calendar_id: calendar.id,
      },
    });

    if (!followEntity) {
      throw new Error('Follow relationship not found: ' + followId);
    }

    followEntity.repost_policy = policy;
    await followEntity.save();
  }

/**
   * Lookup a remote calendar by identifier using WebFinger protocol
   * @param identifier The remote calendar identifier (username@domain)
   * @returns Preview information for the remote calendar
   */
  async lookupRemoteCalendar(identifier: string): Promise<{
    name: string;
    description?: string;
    domain: string;
    actorUrl: string;
    calendarId?: string;
  }> {
    if (!ActivityPubService.isValidOrgIdentifier(identifier)) {
      throw new Error('Invalid calendar identifier format');
    }

    const [username, domain] = identifier.split('@');
    const localDomain = config.get('domain') as string;

    // Check if this is a local calendar
    if (domain === localDomain) {
      const calendar = await this.calendarService.getCalendarByName(username);
      if (!calendar) {
        throw new Error(`Calendar "${username}" not found`);
      }

      return {
        name: calendar.content('en').title || username,
        description: calendar.content('en').description || undefined,
        domain: localDomain,
        actorUrl: await this.actorUrl(calendar),
        calendarId: calendar.id,
      };
    }

    // Perform WebFinger lookup for remote calendars
    const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${identifier}`;
    let webfingerResponse;

    try {
      webfingerResponse = await axios.get(webfingerUrl, { timeout: 10000 });
    }
    catch (error: any) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error(`Could not connect to ${domain}`);
      }
      if (error.response?.status === 404) {
        throw new Error(`Calendar "${username}" not found on ${domain}`);
      }
      throw new Error(`Failed to lookup calendar: ${error.message}`);
    }

    // Find the ActivityPub actor URL from WebFinger links
    const actorLink = webfingerResponse.data.links?.find(
      (link: any) => link.rel === 'self' && link.type === 'application/activity+json',
    );

    if (!actorLink || !actorLink.href) {
      throw new Error('Calendar does not support ActivityPub federation');
    }

    const actorUrl = actorLink.href;

    // Fetch the actor profile
    let profileResponse;
    try {
      profileResponse = await axios.get(actorUrl, {
        headers: {
          'Accept': 'application/activity+json',
        },
        timeout: 10000,
      });
    }
    catch (error: any) {
      throw new Error(`Failed to fetch calendar profile: ${error.message}`);
    }

    const profile = profileResponse.data;

    return {
      name: profile.name || profile.preferredUsername || username,
      description: profile.summary || undefined,
      domain,
      actorUrl,
    };
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

      this.eventBus.emit('outboxMessageAdded', message);
    }
  }

  async getFeed(calendar: Calendar, page?: number, pageSize?: number) {
    const defaultPageSize = pageSize || 20;

    const events = await EventEntity.findAll({
      include: [{
        model: FollowingCalendarEntity,
        as: 'follows',
        required: true,
        where: {
          calendar_id: calendar.id,
        },
      }],
      limit: defaultPageSize,
      offset: page ? page * defaultPageSize : 0,
      order: [['start', 'DESC']],
    });

    // Batch fetch all shared events for these events in a single query
    const eventUrls = events.map(event =>
      event.event_url || `https://${config.get('domain')}/events/${event.id}`
    );

    const sharedEvents = await SharedEventEntity.findAll({
      where: {
        event_id: eventUrls,
        calendar_id: calendar.id,
      },
    });

    // Build a lookup map for O(1) access
    const sharedEventMap = new Map(
      sharedEvents.map(shared => [shared.event_id, shared])
    );

    // Map events with repost status using the lookup map
    const eventsWithRepostStatus = events.map((event) => {
      const eventUrl = event.event_url || `https://${config.get('domain')}/events/${event.id}`;
      const sharedEvent = sharedEventMap.get(eventUrl);

      let repostStatus: 'none' | 'manual' | 'auto' = 'none';
      if (sharedEvent) {
        repostStatus = sharedEvent.auto_posted ? 'auto' : 'manual';
      }

      return {
        ...event.get({ plain: true }),
        repostStatus,
      };
    });

    return eventsWithRepostStatus;
  }
}

export default ActivityPubService;
