import { EventEmitter } from 'events';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import { UserProfileResponse } from '@/server/activitypub/model/userprofile';
import { FollowingCalendar, FollowerCalendar } from '@/common/model/follow';
import ActivityPubMemberService from '@/server/activitypub/service/members';
import ActivityPubServerService from '@/server/activitypub/service/server';
import ProcessInboxService from '../service/inbox';
import ProcessOutboxService from '../service/outbox';
import { ActivityPubOutboxMessageEntity, ActivityPubInboxMessageEntity, FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { CalendarActorEntity, CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ModerationInterface from '@/server/moderation/interface';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

/**
 * Implementation of the ActivityPub internal API interface
 * Aggregates functionality from both member and server services
 */
export default class ActivityPubInterface {
  private memberService: ActivityPubMemberService;
  private serverService: ActivityPubServerService;
  private inboxSerivce: ProcessInboxService;
  private outboxService: ProcessOutboxService;
  private calendarInterface: CalendarInterface;
  private eventBus: EventEmitter;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    moderationInterface?: ModerationInterface,
  ) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.memberService = new ActivityPubMemberService(eventBus, calendarInterface);
    this.serverService = new ActivityPubServerService(eventBus, calendarInterface, accountsInterface);
    this.inboxSerivce = new ProcessInboxService(eventBus, this.calendarInterface, moderationInterface);
    this.outboxService = new ProcessOutboxService(eventBus);
  }

  async actorUrl(calendar: Calendar): Promise<string> {
    return this.memberService.actorUrl(calendar);
  }

  async followCalendar(
    account: Account,
    calendar: Calendar,
    orgIdentifier: string,
    autoRepostOriginals: boolean = false,
    autoRepostReposts: boolean = false,
  ): Promise<void> {
    return this.memberService.followCalendar(account, calendar, orgIdentifier, autoRepostOriginals, autoRepostReposts);
  }

  async unfollowCalendar(account: Account, calendar: Calendar, orgIdentifier: string): Promise<void> {
    return this.memberService.unfollowCalendar(account, calendar, orgIdentifier);
  }

  /**
   * Unfollow a calendar by follow relationship ID.
   * Resolves the actor URI from the follow entity and delegates to unfollowCalendar.
   *
   * @param account The account performing the unfollow
   * @param calendar The local calendar that owns the follow relationship
   * @param followId The ID of the follow relationship to remove
   */
  async unfollowCalendarById(account: Account, calendar: Calendar, followId: string): Promise<void> {
    return this.memberService.unfollowCalendarById(account, calendar, followId);
  }

  /**
   * Share (repost) an event to a calendar.
   *
   * @param account The account performing the sharing
   * @param calendar The calendar to share to
   * @param eventUrl The ActivityPub URL of the event to share
   * @param autoPosted Whether this share was created automatically by the auto-post system
   * @param categoryIds Optional local category IDs to assign to the shared event
   */
  async shareEvent(
    account: Account,
    calendar: Calendar,
    eventUrl: string,
    autoPosted: boolean = false,
    categoryIds?: string[],
  ): Promise<void> {
    return this.memberService.shareEvent(account, calendar, eventUrl, autoPosted, categoryIds);
  }

  async unshareEvent(account: Account, calendar: Calendar, eventUrl: string): Promise<void> {
    return this.memberService.unshareEvent(account, calendar, eventUrl);
  }

  async addToOutbox(calendar: Calendar, message: ActivityPubActivity): Promise<void> {
    return this.memberService.addToOutbox(calendar, message);
  }

  async addToInbox(calendar: Calendar, message: ActivityPubActivity): Promise<null> {
    return this.serverService.addToInbox(calendar, message);
  }

  async readOutbox(calendarId: string, cursor?: Date, limit?: number): Promise<{ items: ActivityPubOutboxMessageEntity[], totalItems: number }> {
    return this.serverService.readOutbox(calendarId, cursor, limit);
  }

  parseWebFingerResource(resource: string): { type: 'user' | 'calendar' | 'unknown'; name: string; domain: string } {
    return this.serverService.parseWebFingerResource(resource);
  }

  async lookupWebFinger(urlName: string, domain: string, type: 'user' | 'calendar'): Promise<WebFingerResponse | null> {
    return this.serverService.lookupWebFinger(urlName, domain, type);
  }

  async lookupUserProfile(calendarName: string): Promise<UserProfileResponse | null> {
    return this.serverService.lookupUserProfile(calendarName);
  }

  async addFollower(calendarActorId: string, localCalendar: Calendar, followActivityId: string): Promise<void> {
    return this.serverService.addFollower(calendarActorId, localCalendar, followActivityId);
  }

  async removeFollower(calendarActorId: string, localCalendar: Calendar): Promise<void> {
    return this.serverService.removeFollower(calendarActorId, localCalendar);
  }

  async getFeed(calendar: Calendar, page?: number, pageSize?: number): Promise<Record<string, any>[]> {
    return this.memberService.getFeed(calendar, page, pageSize);
  }

  async getFollowing(calendar: Calendar): Promise<FollowingCalendar[]> {
    return this.memberService.getFollowing(calendar);
  }

  async getFollowers(calendar: Calendar): Promise<FollowerCalendar[]> {
    return this.memberService.getFollowers(calendar);
  }

  async updateFollowPolicy(
    calendar: Calendar,
    followId: string,
    autoRepostOriginals: boolean,
    autoRepostReposts: boolean,
  ): Promise<void> {
    return this.memberService.updateFollowPolicy(calendar, followId, autoRepostOriginals, autoRepostReposts);
  }

  async lookupRemoteCalendar(identifier: string): Promise<{
    name: string;
    description?: string;
    domain: string;
    actorUrl: string;
    calendarId?: string;
  }> {
    return this.memberService.lookupRemoteCalendar(identifier);
  }

  isValidDomain(domain: string): boolean {
    return ActivityPubMemberService.isValidDomain(domain);
  }

  isValidUsername(username: string): boolean {
    return ActivityPubMemberService.isValidUsername(username);
  }

  isValidOrgIdentifier(identifier: string): boolean {
    return ActivityPubMemberService.isValidOrgIdentifier(identifier);
  }

  async processOutboxMessage(message: ActivityPubOutboxMessageEntity): Promise<void> {
    await this.outboxService.processOutboxMessage(message);
  }

  async processInboxMessage(message: ActivityPubInboxMessageEntity): Promise<void> {
    await this.inboxSerivce.processInboxMessage(message);
  }

  /**
   * Deletes processed inbox messages older than the configured retention period.
   * Delegates to the inbox service cleanup method.
   *
   * @param retentionDays - Number of days to retain processed messages (defaults to config value)
   * @param batchSize - Maximum number of messages to delete per run (defaults to config value)
   * @returns Number of messages deleted
   */
  async cleanupProcessedInboxMessages(retentionDays?: number, batchSize?: number): Promise<number> {
    return this.inboxSerivce.cleanupProcessedInboxMessages(retentionDays, batchSize);
  }

  /**
   * Checks if an actor URI is a Person actor (vs calendar actor)
   */
  isPersonActorUri(actorUri: string): boolean {
    return actorUri.includes('/users/');
  }

  /**
   * Process a Person actor activity synchronously
   * Used for cross-instance editor operations where immediate response is needed
   */
  async processPersonActorActivity(
    calendar: Calendar,
    activity: CreateActivity | UpdateActivity | DeleteActivity,
  ): Promise<CalendarEvent | null> {
    return this.inboxSerivce.processPersonActorActivity(calendar, activity);
  }

  /**
   * Invalidates the authorization cache entry for a specific calendar and actor.
   * Should be called when editor membership changes to ensure immediate effect.
   *
   * @param calendarId - The calendar ID
   * @param actorUri - The Person actor URI
   */
  invalidateAuthorizationCache(calendarId: string, actorUri: string): void {
    this.inboxSerivce.invalidateAuthorizationCache(calendarId, actorUri);
  }

  /**
   * Looks up the ActivityPub actor URI that owns a given event.
   * Returns the attributed_to field from the EventObjectEntity, which is
   * the authoritative source for the calendar actor that created/owns the event.
   *
   * @param eventId - The local event UUID
   * @returns The actor URI string, or null if no AP identity exists for this event
   */
  async getEventSourceActorUri(eventId: string): Promise<string | null> {
    const eventObject = await EventObjectEntity.findOne({ where: { event_id: eventId } });
    return eventObject?.attributed_to ?? null;
  }

  /**
   * Finds the CalendarActor for a given calendar ID.
   * Checks remote_calendar_id first (for remote calendars whose UUID was sent
   * in an Add activity), then falls back to calendar_id (for local actors).
   *
   * @param calendarId - The calendar UUID to look up
   * @returns The CalendarActor model, or null if not found
   */
  async findCalendarActorByCalendarId(calendarId: string): Promise<CalendarActor | null> {
    const byRemoteId = await CalendarActorEntity.findOne({
      where: { remote_calendar_id: calendarId },
    });
    if (byRemoteId) {
      return byRemoteId.toModel();
    }

    const byLocalId = await CalendarActorEntity.findOne({
      where: { calendar_id: calendarId },
    });
    return byLocalId?.toModel() ?? null;
  }

  /**
   * Gets the IDs of all events shared (reposted) to a given calendar.
   *
   * @param calendarId - The calendar UUID
   * @returns Array of event ID strings
   */
  async getSharedEventIds(calendarId: string): Promise<string[]> {
    const sharedEvents = await SharedEventEntity.findAll({
      where: { calendar_id: calendarId },
      attributes: ['event_id'],
    });
    return sharedEvents.map((se) => se.event_id);
  }

  /**
   * Gets the IDs of all calendars that have shared (reposted) a given event.
   *
   * @param eventId - The event UUID
   * @returns Array of calendar ID strings
   */
  async getCalendarIdsForSharedEvent(eventId: string): Promise<string[]> {
    const sharedEvents = await SharedEventEntity.findAll({
      where: { event_id: eventId },
    });
    return sharedEvents.map((se) => se.calendar_id);
  }

  /**
   * Gets the ActivityPub actor URI for a user account.
   *
   * @param accountId - The account UUID
   * @returns The actor URI string, or null if no user actor exists
   */
  async getUserActorUri(accountId: string): Promise<string | null> {
    const userActor = await UserActorEntity.findOne({
      where: { account_id: accountId },
    });
    return userActor?.actor_uri ?? null;
  }

  /**
   * Finds a user actor by its ActivityPub URI.
   *
   * @param actorUri - The ActivityPub actor URI to look up
   * @returns Plain object with id and actorUri, or null if not found
   */
  async findUserActorByUri(actorUri: string): Promise<{ id: string; actorUri: string } | null> {
    const userActor = await UserActorEntity.findOne({
      where: { actor_uri: actorUri },
    });
    if (!userActor) {
      return null;
    }
    return { id: userActor.id, actorUri: userActor.actor_uri };
  }

  /**
   * Finds or creates a remote user actor entity.
   * Used when processing federation activities from remote Person actors.
   *
   * @param actorUri - The remote actor's ActivityPub URI
   * @param preferredUsername - The remote actor's preferred username
   * @param domain - The remote actor's domain
   * @param publicKey - Optional public key for HTTP signature verification
   * @returns Object with the actor's id
   */
  async findOrCreateRemoteUserActor(
    actorUri: string,
    preferredUsername: string,
    domain: string,
    publicKey?: string,
  ): Promise<{ id: string }> {
    const [entity] = await UserActorEntity.findOrCreate({
      where: { actor_uri: actorUri },
      defaults: {
        id: uuidv4(),
        actor_type: 'remote',
        account_id: null,
        actor_uri: actorUri,
        remote_username: preferredUsername,
        remote_domain: domain,
        public_key: publicKey || null,
        private_key: null,
      },
    });
    return { id: entity.id };
  }

  /**
   * Validates that a calendar actor exists and is in the following list for a calendar.
   * Throws if the actor is not found or is not being followed.
   *
   * @param calendarId - The calendar UUID
   * @param actorId - The calendar actor UUID
   * @returns The CalendarActor model
   * @throws Error if actor not found or not in following list
   */
  async getActorInFollowing(calendarId: string, actorId: string): Promise<CalendarActor> {
    const actor = await CalendarActorEntity.findByPk(actorId);
    if (!actor) {
      throw new Error('actor not found');
    }

    const follow = await FollowingCalendarEntity.findOne({
      where: { calendar_actor_id: actorId, calendar_id: calendarId },
    });
    if (!follow) {
      throw new Error('actor is not in the following list for this calendar');
    }

    return actor.toModel();
  }

  /**
   * Batch-resolves the source actor URIs for a set of event IDs.
   * Returns a map from event ID to the attributed_to actor URI.
   *
   * @param eventIds - Array of event UUIDs to look up
   * @returns Map from event ID to attributed_to actor URI
   */
  async getEventSourceActorUris(eventIds: string[]): Promise<Map<string, string>> {
    if (eventIds.length === 0) {
      return new Map();
    }

    const eventObjects = await EventObjectEntity.findAll({
      where: { event_id: { [Op.in]: eventIds } },
    });

    const result = new Map<string, string>();
    for (const obj of eventObjects) {
      if (obj.attributed_to) {
        result.set(obj.event_id, obj.attributed_to);
      }
    }
    return result;
  }

  /**
   * Performs local auto-repost for same-instance calendar follows.
   *
   * When a local calendar creates or reposts an event, this finds all local
   * calendars that follow it with the appropriate auto-repost policy enabled,
   * and creates SharedEventEntity records + emits eventReposted for each.
   *
   * Uses breadth-first traversal with a visited set to safely handle
   * cascading multi-hop chains and prevent infinite loops from circular
   * follow graphs. The cascade is bounded by MAX_LOCAL_REPOST_DEPTH.
   *
   * The AP outbox pipeline handles remote followers; this method handles local
   * followers directly to avoid the HTTP-to-self roundtrip.
   *
   * @param calendar - The calendar that owns or is reposting the event
   * @param event - The event to auto-repost
   * @param isOriginal - true if this is the event's originating calendar, false if reposting
   */
  async performLocalAutoReposts(calendar: Calendar, event: CalendarEvent, isOriginal: boolean): Promise<void> {
    const MAX_LOCAL_REPOST_DEPTH = 10;
    const visited = new Set<string>();

    // BFS queue: each entry is [calendar to check for followers, isOriginal flag]
    const queue: Array<{ calendar: Calendar; isOriginal: boolean }> = [
      { calendar, isOriginal },
    ];
    // The source calendar is already "visited" — don't repost back to it
    visited.add(calendar.id);

    let depth = 0;
    while (queue.length > 0 && depth < MAX_LOCAL_REPOST_DEPTH) {
      const batch = queue.splice(0, queue.length);
      depth++;

      for (const entry of batch) {
        const newReposts = await this.processLocalAutoRepostLevel(entry.calendar, event, entry.isOriginal, visited);
        // Queue newly reposted calendars for cascade (as reposts, not originals)
        for (const repostCalendar of newReposts) {
          queue.push({ calendar: repostCalendar, isOriginal: false });
        }
      }
    }

    if (queue.length > 0) {
      logger.warn({
        eventId: event.id,
        depth: MAX_LOCAL_REPOST_DEPTH,
        remainingCalendars: queue.length,
      }, '[LOCAL-AUTO-REPOST] Cascade depth limit reached');
    }
  }

  /**
   * Processes a single level of local auto-repost: finds eligible followers
   * of the given calendar and creates SharedEventEntity records for each.
   * Returns the Calendar objects for newly reposted calendars (for BFS cascade).
   */
  private async processLocalAutoRepostLevel(
    calendar: Calendar,
    event: CalendarEvent,
    isOriginal: boolean,
    visited: Set<string>,
  ): Promise<Calendar[]> {
    const calendarActor = await CalendarActorEntity.findOne({
      where: { calendar_id: calendar.id, actor_type: 'local' },
    });

    if (!calendarActor) {
      return [];
    }

    const policyField = isOriginal ? 'auto_repost_originals' : 'auto_repost_reposts';
    const follows = await FollowingCalendarEntity.findAll({
      where: {
        calendar_actor_id: calendarActor.id,
        [policyField]: true,
      },
    });

    const newReposts: Calendar[] = [];

    for (const follow of follows) {
      const followerCalendarId = follow.calendar_id;

      // Skip already-visited calendars (cycle prevention + dedup)
      if (visited.has(followerCalendarId)) {
        continue;
      }
      visited.add(followerCalendarId);

      // Skip self-repost (event's own calendar)
      if (followerCalendarId === event.calendarId) {
        continue;
      }

      // Duplicate check against DB (in case of prior AP-path repost)
      const existing = await SharedEventEntity.findOne({
        where: { event_id: event.id, calendar_id: followerCalendarId },
      });
      if (existing) {
        continue;
      }

      await SharedEventEntity.create({
        id: uuidv4(),
        event_id: event.id,
        calendar_id: followerCalendarId,
        auto_posted: true,
      });

      logger.info({
        eventId: event.id,
        sourceCalendarId: calendar.id,
        repostCalendarId: followerCalendarId,
        isOriginal,
      }, '[LOCAL-AUTO-REPOST] Created local auto-repost');

      // Emit eventReposted so event instances are built by the calendar domain.
      // NOTE: The AP event handler does NOT listen for eventReposted — this
      // emission is consumed only by the calendar domain for building instances.
      // The multi-hop cascade is handled by the BFS loop in performLocalAutoReposts,
      // not by re-entering through the event bus. If AP ever needs to react to
      // eventReposted, it must not call performLocalAutoReposts again, as the
      // visited set and depth limit are scoped to a single invocation.
      const repostCalendar = await this.calendarInterface.getCalendar(followerCalendarId);
      if (repostCalendar) {
        this.eventBus.emit('eventReposted', { event, calendar: repostCalendar });
        newReposts.push(repostCalendar);
      }
    }

    return newReposts;
  }
}
