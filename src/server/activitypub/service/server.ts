import { EventEmitter } from "events";
import config from 'config';

import { Calendar } from "@/common/model/calendar";
import { WebFingerResponse } from "@/server/activitypub/model/webfinger";
import { UserProfileResponse } from "@/server/activitypub/model/userprofile";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import { ActivityPubInboxMessageEntity, FollowerCalendarEntity } from "@/server/activitypub/entity/activitypub";
import CalendarInterface from "@/server/calendar/interface";
import AccountsInterface from "@/server/accounts/interface";
import CalendarActorService from "@/server/activitypub/service/calendar_actor";


export default class ActivityPubService {
  private eventBus: EventEmitter;
  public calendarService: CalendarInterface;
  public accountsService: AccountsInterface;
  private calendarActorService: CalendarActorService;

  constructor( eventBus: EventEmitter, calendarInterface: CalendarInterface, accountsInterface: AccountsInterface ) {
    this.eventBus = eventBus;
    this.calendarService = calendarInterface;
    this.accountsService = accountsInterface;
    this.calendarActorService = new CalendarActorService();
  }

  /**
   * Parse WebFinger resource format into type, name, and domain
   *
   * Supports two formats:
   * - @user@domain - Person actor (user)
   * - calendar@domain - Group actor (calendar)
   *
   * @param resource - WebFinger resource string (e.g., "acct:@alice@example.com" or "community@example.com")
   * @returns { type: 'user' | 'calendar' | 'unknown', name: string, domain: string }
   */
  parseWebFingerResource(resource: string): { type: 'user' | 'calendar' | 'unknown', name: string, domain: string } {
    // Remove acct: prefix if present
    resource = resource.replace('acct:', '');

    // Check if empty
    if (!resource || resource.length === 0) {
      return { type: 'unknown', name: '', domain: '' };
    }

    // User handle: starts with @
    // Format: @username@domain or @username@domain (without acct:)
    if (resource.startsWith('@')) {
      // Remove leading @
      const withoutAt = resource.substring(1);
      const parts = withoutAt.split('@');

      if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
        return { type: 'user', name: parts[0], domain: parts[1] };
      }

      return { type: 'unknown', name: '', domain: '' };
    }

    // Calendar handle: no @ prefix
    // Format: calendar@domain
    const parts = resource.split('@');

    if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
      return { type: 'calendar', name: parts[0], domain: parts[1] };
    }

    return { type: 'unknown', name: '', domain: '' };
  }

  /**
   * Generate a webfinger response for the provided name and type
   *
   * @param name - Username or calendar URL name
   * @param domain - Domain of the resource
   * @param type - Resource type ('user' or 'calendar')
   * @returns WebFingerResponse message or null if not found
   */
  async lookupWebFinger(name: string, domain: string, type: 'user' | 'calendar'): Promise<WebFingerResponse|null> {
    console.log('[WebFinger] Lookup request:', { name, domain, type, configDomain: config.get('domain') });

    // Only respond for our domain
    if (domain !== config.get('domain')) {
      console.log('[WebFinger] Domain mismatch, returning null');
      return null;
    }

    if (type === 'user') {
      console.log('[WebFinger] Looking up user:', name);
      const account = await this.accountsService.getAccountByUsername(name);
      console.log('[WebFinger] Account found:', account ? 'yes' : 'no');
      if (account) {
        return new WebFingerResponse(name, domain, 'user');
      }
    }
    else if (type === 'calendar') {
      console.log('[WebFinger] Looking up calendar:', name);
      const calendar = await this.calendarService.getCalendarByName(name);
      console.log('[WebFinger] Calendar found:', calendar ? 'yes' : 'no');
      if (calendar) {
        return new WebFingerResponse(calendar.urlName, domain, 'calendar');
      }
    }

    console.log('[WebFinger] Returning null - not found');
    return null;
  }

  /**
     * Generate an actor message for the provided username
     * @param calendarName
     * @param domain
     * @returns UserProfileResponse message
     */
  async lookupUserProfile(calendarName: string): Promise<UserProfileResponse|null> {
    let calendar = await this.calendarService.getCalendarByName(calendarName);

    if ( calendar ) {
      // Get the public key from CalendarActorEntity
      const publicKey = await this.calendarActorService.getPublicKeyByUrlName(calendarName);
      return new UserProfileResponse(calendar.urlName, config.get('domain'), publicKey || undefined);
    }

    return null;
  }

  /**
     * Record a new follower for a local calendar
     * @param calendarActorId The calendar actor ID (UUID of CalendarActorEntity)
     * @param localCalendar The local calendar being followed
     * @param followActivityId The ID of the follow activity
     */
  async addFollower(calendarActorId: string, localCalendar: Calendar, followActivityId: string) {
    // Check if this follower already exists
    let existingFollower = await FollowerCalendarEntity.findOne({
      where: {
        calendar_actor_id: calendarActorId,
        calendar_id: localCalendar.id,
      },
    });

    if (existingFollower) {
      return; // Already following
    }

    // Create new follower record
    let followerEntity = FollowerCalendarEntity.build({
      id: followActivityId,
      calendar_actor_id: calendarActorId,
      calendar_id: localCalendar.id,
    });

    await followerEntity.save();
  }

  /**
     * Remove a follower from a local calendar
     * @param calendarActorId The calendar actor ID (UUID of CalendarActorEntity)
     * @param localCalendar The local calendar being unfollowed
     */
  async removeFollower(calendarActorId: string, localCalendar: Calendar) {
    let followers = await FollowerCalendarEntity.findAll({
      where: {
        calendar_actor_id: calendarActorId,
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
    let foundCalendar = await this.calendarService.getCalendar(calendar.id);

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

    this.eventBus.emit('inboxMessageAdded', { calendar_id: calendar.id, id: messageEntity.id });

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
