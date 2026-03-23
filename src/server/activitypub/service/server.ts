import { EventEmitter } from "events";
import config from 'config';

import { createLogger } from '@/server/common/helper/logger';
import { Calendar } from "@/common/model/calendar";
import { WebFingerResponse } from "@/server/activitypub/model/webfinger";
import { UserProfileResponse } from "@/server/activitypub/model/userprofile";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity, FollowerCalendarEntity } from "@/server/activitypub/entity/activitypub";
import CalendarInterface from "@/server/calendar/interface";
import AccountsInterface from "@/server/accounts/interface";
import CalendarActorService from "@/server/activitypub/service/calendar_actor";


const logger = createLogger('activitypub');

export default class ActivityPubService {
  private eventBus: EventEmitter;
  public calendarService: CalendarInterface;
  public accountsService: AccountsInterface;
  private calendarActorService: CalendarActorService;

  constructor( eventBus: EventEmitter, calendarInterface: CalendarInterface, accountsInterface: AccountsInterface ) {
    this.eventBus = eventBus;
    this.calendarService = calendarInterface;
    this.accountsService = accountsInterface;
    this.calendarActorService = new CalendarActorService(calendarInterface);
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
    logger.info({ name, domain, type, configDomain: config.get('domain') }, 'WebFinger lookup request');

    // Only respond for our domain
    if (domain !== config.get('domain')) {
      logger.info({ domain }, 'WebFinger domain mismatch, returning null');
      return null;
    }

    if (type === 'user') {
      logger.info({ name }, 'WebFinger looking up user');
      const account = await this.accountsService.getAccountByUsername(name);
      logger.info({ name, found: !!account }, 'WebFinger account lookup result');
      if (account) {
        return new WebFingerResponse(name, domain, 'user');
      }
    }
    else if (type === 'calendar') {
      logger.info({ name }, 'WebFinger looking up calendar');
      const calendar = await this.calendarService.getCalendarByName(name);
      logger.info({ name, found: !!calendar }, 'WebFinger calendar lookup result');
      if (calendar) {
        return new WebFingerResponse(calendar.urlName, domain, 'calendar');
      }
    }

    logger.info('WebFinger returning null - not found');
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
   * Add provided message to the calendar's inbox.
   * Rate limiting, HTTP signature auth, and blocked-instance checks are handled
   * upstream: see inbox POST middleware in api/v1/server.ts and
   * InboxService.processInboxMessage() for block-list filtering.
   * @param calendar
   * @param message
   * @returns null
   */
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
   * Retrieve paginated outbox messages for a calendar.
   * Returns only public activity types (Announce, Update, Delete) that were
   * successfully processed.
   *
   * @param calendarId - The calendar ID to query
   * @param cursor - Optional ISO 8601 timestamp cursor for paging (exclusive upper bound)
   * @param limit - Page size (default 20)
   * @returns Object with items array and totalItems count
   */
  async readOutbox(calendarId: string, cursor?: Date, limit: number = 20): Promise<{ items: ActivityPubOutboxMessageEntity[], totalItems: number }> {
    const publicTypes = ['Announce', 'Update', 'Delete'];
    const where: Record<string, any> = {
      calendar_id: calendarId,
      type: publicTypes,
      processed_status: 'ok',
    };

    if (cursor) {
      const { Op } = await import('sequelize');
      where.message_time = { [Op.lt]: cursor };
    }

    const [items, totalItems] = await Promise.all([
      ActivityPubOutboxMessageEntity.findAll({
        where,
        order: [['message_time', 'DESC']],
        limit,
      }),
      ActivityPubOutboxMessageEntity.count({
        where: {
          calendar_id: calendarId,
          type: publicTypes,
          processed_status: 'ok',
        },
      }),
    ]);

    return { items, totalItems };
  }

}
