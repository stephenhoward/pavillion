import { EventEmitter } from "events";
import config from 'config';
import axios from 'axios';

import { Op } from 'sequelize';
import { Account } from "@/common/model/account";
import { Calendar } from "@/common/model/calendar";
import { FollowingCalendar, FollowerCalendar } from "@/common/model/follow";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { FollowingCalendarEntity, FollowerCalendarEntity, SharedEventEntity } from "@/server/activitypub/entity/activitypub";
import { CalendarActorEntity } from "@/server/activitypub/entity/calendar_actor";
import { EventObjectEntity } from "@/server/activitypub/entity/event_object";
import RemoteCalendarService from "@/server/activitypub/service/remote_calendar";
import UndoActivity from "../model/action/undo";
import { EventEntity } from "@/server/calendar/entity/event";
import CalendarInterface from "@/server/calendar/interface";
import { EventObject } from "@/server/activitypub/model/object/event";
import { addToOutbox as addToOutboxHelper } from "@/server/activitypub/helper/outbox";
import {
  InvalidRemoteCalendarIdentifierError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
  AlreadyFollowingError,
} from '@/common/exceptions/activitypub';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

/**
 * Converts an ActivityPub actor URI to a human-readable calendar@domain format.
 * Example: https://alpha.federation.local/calendars/my_calendar -> my_calendar@alpha.federation.local
 *
 * @param actorUri The full ActivityPub actor URI
 * @returns The calendar identifier in calendar@domain format, or the original URI if parsing fails
 */
function actorUriToIdentifier(actorUri: string): string {
  try {
    const url = new URL(actorUri);
    const domain = url.hostname;
    // Extract calendar name from path (e.g., /calendars/my_calendar -> my_calendar)
    const pathParts = url.pathname.split('/').filter(part => part.length > 0);
    if (pathParts.length >= 2 && pathParts[0] === 'calendars') {
      return `${pathParts[1]}@${domain}`;
    }
    // Fallback: return the full URI if we can't parse it
    return actorUri;
  }
  catch {
    return actorUri;
  }
}

class ActivityPubService {
  calendarService: CalendarInterface;
  remoteCalendarService: RemoteCalendarService;

  constructor(
    private eventBus: EventEmitter,
  ) {
    this.calendarService = new CalendarInterface(eventBus);
    this.remoteCalendarService = new RemoteCalendarService();
  }

  async actorUrl(calendar: Calendar): Promise<string> {
    return 'https://' + config.get('domain') + '/calendars/' + calendar.urlName;
  }

  static isValidDomain(domain: string): boolean {
    return domain.match(/^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,}$/) !== null;
  }

  static isValidUsername(username: string): boolean {
    return username.match(/^[a-z0-9_]{3,24}$/) !== null;
  }

  static isValidOrgIdentifier(identifier: string): boolean {
    let parts = identifier.split('@');
    return parts.length === 2
            && ActivityPubService.isValidUsername(parts[0])
            && ActivityPubService.isValidDomain(parts[1]);
  }

  /**
   * Validate that repost policy settings are consistent.
   *
   * Note: Previously enforced that autoRepostReposts required autoRepostOriginals,
   * but this constraint was removed to allow more flexible policy configurations.
   * Users may want to auto-repost only shared content (reposts) without auto-reposting
   * original events, which is a valid use case.
   */
  static validateRepostPolicySettings(_autoRepostOriginals: boolean, _autoRepostReposts: boolean): void {
    // No validation constraints - allow any combination of policy settings
  }

  /**
     * Follow a calendar from another server
     * @param account The local account requesting to follow
     * @param calendar The local calendar that will follow the remote calendar
     * @param orgIdentifier The remote calendar identifier to follow
     * @param autoRepostOriginals Whether to auto-repost original events from the followed calendar
     * @param autoRepostReposts Whether to auto-repost shared events from the followed calendar
     */
  async followCalendar(
    account: Account,
    calendar: Calendar,
    orgIdentifier: string,
    autoRepostOriginals: boolean = false,
    autoRepostReposts: boolean = false,
  ) {
    if (!ActivityPubService.isValidOrgIdentifier(orgIdentifier)) {
      throw new InvalidRemoteCalendarIdentifierError('Invalid remote calendar identifier: ' + orgIdentifier);
    }

    if (!(await this.calendarService.userCanModifyCalendar(account, calendar))) {
      throw new InsufficientCalendarPermissionsError('User does not have permission to modify calendar: ' + calendar.id);
    }

    // Validate repost policy settings
    ActivityPubService.validateRepostPolicySettings(autoRepostOriginals, autoRepostReposts);

    // Prevent self-follows
    const localDomain = config.get('domain') as string;
    const selfIdentifier = `${calendar.urlName}@${localDomain}`;
    if (orgIdentifier === selfIdentifier) {
      throw new SelfFollowError('A calendar cannot follow itself');
    }

    // Resolve the ActivityPub actor URL from the WebFinger identifier first
    const remoteProfile = await this.lookupRemoteCalendar(orgIdentifier);
    const remoteActorUrl = remoteProfile.actorUrl;

    // Get or create CalendarActorEntity
    // For LOCAL calendars (those with calendarId), create with actor_type='local'
    // For REMOTE calendars, use the remote calendar service
    let remoteCalendar;
    if (remoteProfile.calendarId) {
      // This is a local calendar - find or create with actor_type='local'
      const existing = await CalendarActorEntity.findOne({
        where: {
          actor_uri: remoteActorUrl,
          actor_type: 'local',
        },
      });

      if (existing) {
        remoteCalendar = existing.toModel();
      }
      else {
        const created = await CalendarActorEntity.create({
          actor_type: 'local',
          calendar_id: remoteProfile.calendarId,
          actor_uri: remoteActorUrl,
          remote_domain: null,
          private_key: null,
        });
        remoteCalendar = created.toModel();
      }
    }
    else {
      // This is a remote calendar - use the remote calendar service
      remoteCalendar = await this.remoteCalendarService.findOrCreateByActorUri(remoteActorUrl);

      // Update cached metadata from the profile we just fetched
      await this.remoteCalendarService.updateMetadata(remoteActorUrl, {
        displayName: remoteProfile.name,
      });
    }

    // Check if we're already following this calendar (using the CalendarActorEntity UUID)
    let existingFollowEntity = await FollowingCalendarEntity.findOne({
      where: {
        calendar_actor_id: remoteCalendar.id,
        calendar_id: calendar.id,
      },
    });

    // Throw if a follow relationship already exists — do not silently modify it
    if (existingFollowEntity) {
      throw new AlreadyFollowingError('Already following this calendar');
    }

    let actor = await this.actorUrl(calendar);

    console.log(`[MemberService] Following ${orgIdentifier} with ActivityPub URL: ${remoteActorUrl}`);

    // Create Follow activity targeting the remote calendar's actor URL
    let followActivity = new FollowActivity(actor, remoteActorUrl);

    let followEntity = FollowingCalendarEntity.build({
      id: followActivity.id,
      calendar_actor_id: remoteCalendar.id,  // Store the CalendarActorEntity UUID
      calendar_id: calendar.id,
      auto_repost_originals: autoRepostOriginals,
      auto_repost_reposts: autoRepostReposts,
    });
    await followEntity.save();

    this.addToOutbox(calendar, followActivity);
  }

  async unfollowCalendar(account: Account, calendar: Calendar, orgIdentifier: string) {
    if (!(await this.calendarService.userCanModifyCalendar(account, calendar))) {
      throw new InsufficientCalendarPermissionsError('User does not have permission to modify calendar: ' + calendar.id);
    }

    // The orgIdentifier could be a WebFinger identifier (username@domain) or an AP URL
    // First, try to resolve it to an AP URL if it's a WebFinger identifier
    let remoteActorUrl = orgIdentifier;
    if (ActivityPubService.isValidOrgIdentifier(orgIdentifier)) {
      const remoteProfile = await this.lookupRemoteCalendar(orgIdentifier);
      remoteActorUrl = remoteProfile.actorUrl;
    }

    // Find the CalendarActorEntity by actor URI (works for both local and remote calendars)
    const calendarActor = await CalendarActorEntity.findOne({
      where: {
        actor_uri: remoteActorUrl,
      },
    });

    if (!calendarActor) {
      // No calendar actor found, nothing to unfollow
      return;
    }

    let followings = await FollowingCalendarEntity.findAll({
      where: {
        calendar_actor_id: calendarActor.id,
        calendar_id: calendar.id,
      },
    });

    let actor = await this.actorUrl(calendar);
    for (let following of followings) {
      // Create Undo activity and explicitly set the recipient to the AP actor URL
      const undoActivity = new UndoActivity(actor, following.id);
      undoActivity.to = [calendarActor.actor_uri];

      this.addToOutbox(calendar, undoActivity);
      await following.destroy();
    }
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
    const followEntity = await FollowingCalendarEntity.findOne({
      where: {
        id: followId,
        calendar_id: calendar.id,
      },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });

    if (!followEntity) {
      throw new FollowRelationshipNotFoundError('Follow relationship not found: ' + followId);
    }

    const actorUri = followEntity.calendarActor?.actor_uri;
    if (!actorUri) {
      throw new FollowRelationshipNotFoundError('Calendar actor not found for follow relationship: ' + followId);
    }

    await this.unfollowCalendar(account, calendar, actorUri);
  }

  /**
     * user on this server shares an event from someone else
     * @param account The account performing the sharing
     * @param calendar The calendar to share to
     * @param eventUrl URL of remote event
     * @param autoPosted Whether this share was created automatically by the auto-post system
     * @param categoryIds Optional local category IDs to assign to the shared event
     */
  async shareEvent(
    account: Account,
    calendar: Calendar,
    eventUrl: string,
    autoPosted = false,
    categoryIds?: string[],
  ) {

    if ( ! this.calendarService.userCanModifyCalendar(account, calendar) ) {
      throw new InsufficientCalendarPermissionsError('User does not have permission to modify calendar: ' + calendar.id);
    }

    if (!eventUrl.match("^https:\/\/")) {
      throw new InvalidSharedEventUrlError('Invalid shared event url: ' + eventUrl);
    }

    // Resolve AP URL to local event UUID for consistent storage
    // First try to find by ap_id (handles remote events and properly-formed local URLs)
    let eventObject = await EventObjectEntity.findOne({
      where: { ap_id: eventUrl },
    });

    // If not found, this may be a local same-instance event URL.
    // Extract a UUID from the URL and look up the local event to get its canonical AP URL.
    let canonicalEventUrl = eventUrl;
    let extractedLocalEventId: string | null = null;  // UUID extracted from URL for local events

    if (!eventObject) {
      const uuidMatch = eventUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (uuidMatch) {
        const candidateId = uuidMatch[1];
        const localEvent = await this.calendarService.getEventById(candidateId);
        if (localEvent?.calendarId) {
          extractedLocalEventId = candidateId;  // keep the UUID as fallback
          const localCalendar = await this.calendarService.getCalendar(localEvent.calendarId);
          if (localCalendar) {
            canonicalEventUrl = EventObject.eventUrl(localCalendar, localEvent);
            // Try EventObjectEntity lookup again with canonical URL
            eventObject = await EventObjectEntity.findOne({
              where: { ap_id: canonicalEventUrl },
            });
          }
        }
      }
    }

    const localEventId = eventObject?.event_id || extractedLocalEventId || canonicalEventUrl;

    let existingShareEntity = await SharedEventEntity.findOne({
      where: {
        event_id: localEventId,
        calendar_id: calendar.id,
      },
    });

    if (existingShareEntity) {
      return;
    }

    let actor = await this.actorUrl(calendar);
    let shareActivity = new AnnounceActivity(actor, canonicalEventUrl);

    await SharedEventEntity.create({
      id: shareActivity.id,
      event_id: localEventId,
      calendar_id: calendar.id,
      auto_posted: autoPosted,
    });
    this.addToOutbox(calendar, shareActivity);

    // Assign categories to the shared event if provided and the event has a local UUID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (categoryIds && categoryIds.length > 0 && UUID_REGEX.test(localEventId)) {
      await this.calendarService.categoryMappingService.assignManualRepostCategories(localEventId, categoryIds);
    }
  }

  /**
     * user on this server stops sharing an event from someone else
     * @param account The account performing the unsharing
     * @param calendar The calendar to remove the share from
     * @param eventUrl URL of remote event
     */
  async unshareEvent(account: Account, calendar: Calendar, eventUrl: string) {

    if (!this.calendarService.userCanModifyCalendar(account, calendar)) {
      throw new InsufficientCalendarPermissionsError('User does not have permission to modify calendar: ' + calendar.id);
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
   * @returns Array of FollowingCalendar objects with human-readable calendarActorId
   */
  async getFollowing(calendar: Calendar): Promise<FollowingCalendar[]> {
    const entities = await FollowingCalendarEntity.findAll({
      where: {
        calendar_id: calendar.id,
      },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });
    return entities.map(entity => {
      // Convert actor_uri to human-readable calendar@domain format
      const calendarActorId = entity.calendarActor
        ? actorUriToIdentifier(entity.calendarActor.actor_uri)
        : entity.calendar_actor_id;
      return new FollowingCalendar(
        entity.id,
        calendarActorId,
        entity.calendar_id,
        entity.auto_repost_originals,
        entity.auto_repost_reposts,
        entity.calendar_actor_id,
      );
    });
  }

  /**
   * Get list of calendars that are following this calendar
   * @param calendar The calendar whose followers to retrieve
   * @returns Array of FollowerCalendar objects with human-readable calendarActorId
   */
  async getFollowers(calendar: Calendar): Promise<FollowerCalendar[]> {
    const entities = await FollowerCalendarEntity.findAll({
      where: {
        calendar_id: calendar.id,
      },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });
    return entities.map(entity => {
      // Convert actor_uri to human-readable calendar@domain format
      const calendarActorId = entity.calendarActor
        ? actorUriToIdentifier(entity.calendarActor.actor_uri)
        : entity.calendar_actor_id;
      return new FollowerCalendar(
        entity.id,
        calendarActorId,
        entity.calendar_id,
      );
    });
  }

  /**
   * Update the auto-repost policy for a follow relationship
   * @param calendar The local calendar that owns the follow relationship
   * @param followId The ID of the follow relationship to update
   * @param autoRepostOriginals Whether to auto-repost original events
   * @param autoRepostReposts Whether to auto-repost shared events
   */
  async updateFollowPolicy(
    calendar: Calendar,
    followId: string,
    autoRepostOriginals: boolean,
    autoRepostReposts: boolean,
  ): Promise<void> {
    // Validate policy settings
    ActivityPubService.validateRepostPolicySettings(autoRepostOriginals, autoRepostReposts);

    const followEntity = await FollowingCalendarEntity.findOne({
      where: {
        id: followId,
        calendar_id: calendar.id,
      },
    });

    if (!followEntity) {
      throw new FollowRelationshipNotFoundError('Follow relationship not found: ' + followId);
    }

    followEntity.auto_repost_originals = autoRepostOriginals;
    followEntity.auto_repost_reposts = autoRepostReposts;
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
      throw new InvalidRemoteCalendarIdentifierError('Invalid calendar identifier format');
    }

    const [username, domain] = identifier.split('@');
    const localDomain = config.get('domain') as string;

    // Check if this is a local calendar
    if (domain === localDomain) {
      const calendar = await this.calendarService.getCalendarByName(username);
      if (!calendar) {
        throw new RemoteCalendarNotFoundError(`Calendar "${username}" not found`);
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
        throw new RemoteDomainUnreachableError(`Could not connect to ${domain}`);
      }
      if (error.response?.status === 404) {
        throw new RemoteCalendarNotFoundError(`Calendar "${username}" not found on ${domain}`);
      }
      throw new RemoteProfileFetchError(`Failed to lookup calendar: ${error.message}`);
    }

    // Find the ActivityPub actor URL from WebFinger links
    const actorLink = webfingerResponse.data.links?.find(
      (link: any) => link.rel === 'self' && link.type === 'application/activity+json',
    );

    if (!actorLink || !actorLink.href) {
      throw new ActivityPubNotSupportedError('Calendar does not support ActivityPub federation');
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
      throw new RemoteProfileFetchError(`Failed to fetch calendar profile: ${error.message}`);
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
    await addToOutboxHelper(this.eventBus, calendar, message);
  }

  async getFeed(calendar: Calendar, page?: number, pageSize?: number) {
    const defaultPageSize = pageSize || 20;

    // Query events from calendars this calendar is following.
    // This includes BOTH:
    // - Remote events (calendar_id = null) tracked via EventObjectEntity.attributed_to
    // - Local events (calendar_id = UUID) from followed local calendars
    const events = await EventEntity.findAll({
      where: {
        [Op.or]: [
          // Remote events originally authored by followed remote calendars
          {
            calendar_id: null,
            id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT eo.event_id FROM ap_event_object eo
                  JOIN calendar_actor ca ON eo.attributed_to = ca.actor_uri AND ca.actor_type = 'remote'
                  JOIN ap_following f ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = '${calendar.id}')`,
              ),
            },
          },
          // Remote events announced/shared by followed remote calendars
          {
            calendar_id: null,
            id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT eo.event_id FROM ap_event_object eo
                  JOIN ap_event_activity ea ON eo.ap_id = ea.event_id AND ea.type = 'share'
                  JOIN calendar_actor ca ON ea.calendar_actor_id = ca.id AND ca.actor_type = 'remote'
                  JOIN ap_following f ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = '${calendar.id}')`,
              ),
            },
          },
          // Local events from followed local calendars
          {
            calendar_id: {
              [Op.in]: EventEntity.sequelize!.literal(
                `(SELECT ca.calendar_id FROM ap_following f
                  JOIN calendar_actor ca ON f.calendar_actor_id = ca.id
                  WHERE f.calendar_id = '${calendar.id}'
                    AND ca.actor_type = 'local'
                    AND ca.calendar_id IS NOT NULL)`,
              ),
            },
          },
        ],
      },
      include: [
        {
          association: 'content',
          required: false,
        },
        {
          association: 'schedules',
          required: false,
        },
      ],
      limit: defaultPageSize,
      offset: page ? page * defaultPageSize : 0,
      order: [['createdAt', 'DESC']],
    });

    // Batch fetch all shared events for these events in a single query
    const eventUrls = events.map(event => {
      const rawSourceUrl = event.event_source_url as string | null;
      return rawSourceUrl?.startsWith('https://') ? rawSourceUrl : `https://${config.get('domain')}/events/${event.id}`;
    });

    const sharedEvents = await SharedEventEntity.findAll({
      where: {
        event_id: eventUrls,
        calendar_id: calendar.id,
      },
    });

    // Build a lookup map for O(1) access
    const sharedEventMap = new Map(
      sharedEvents.map(shared => [shared.event_id, shared]),
    );

    // Batch fetch EventObjectEntity records to resolve source calendar actor URIs
    // for remote events (calendar_id = null).
    const remoteEventIds = events
      .filter(event => event.calendar_id === null)
      .map(event => event.id);

    const eventObjects = remoteEventIds.length > 0
      ? await EventObjectEntity.findAll({
        where: { event_id: remoteEventIds },
      })
      : [];

    // Build a map from event_id -> attributed_to (actor_uri) for remote events
    const eventActorMap = new Map(
      eventObjects.map(eo => [eo.event_id, eo.attributed_to]),
    );

    // Build a map from local calendar_id -> actor_uri for local events in the feed
    // Only needed when there are local events (calendar_id != null)
    const localCalendarIds = [...new Set(
      events
        .filter(event => event.calendar_id !== null)
        .map(event => event.calendar_id as string),
    )];

    const localCalendarActors = localCalendarIds.length > 0
      ? await CalendarActorEntity.findAll({
        where: {
          calendar_id: localCalendarIds,
          actor_type: 'local',
        },
      })
      : [];

    // Build a map from calendar_id -> actor_uri for local calendars
    const localCalendarActorMap = new Map(
      localCalendarActors.map(ca => [ca.calendar_id as string, ca.actor_uri]),
    );

    // Map events with repost status and source calendar actor ID using the lookup maps
    const eventsWithRepostStatus = events.map((event) => {
      const rawSourceUrl = event.event_source_url as string | null;
      const eventUrl = rawSourceUrl?.startsWith('https://') ? rawSourceUrl : `https://${config.get('domain')}/events/${event.id}`;
      const sharedEvent = sharedEventMap.get(eventUrl);

      let repostStatus: 'none' | 'manual' | 'auto' = 'none';
      if (sharedEvent) {
        repostStatus = sharedEvent.auto_posted ? 'auto' : 'manual';
      }

      // Resolve the source calendar actor URI and convert to human-readable identifier
      let sourceCalendarActorId: string | null = null;
      if (event.calendar_id === null) {
        // Remote event: look up actor_uri from EventObjectEntity
        const actorUri = eventActorMap.get(event.id);
        if (actorUri) {
          sourceCalendarActorId = actorUriToIdentifier(actorUri);
        }
      }
      else {
        // Local event: look up actor_uri from CalendarActorEntity
        const actorUri = localCalendarActorMap.get(event.calendar_id);
        if (actorUri) {
          sourceCalendarActorId = actorUriToIdentifier(actorUri);
        }
      }

      // Transform content array to object keyed by language
      const plainEvent = event.get({ plain: true }) as any;
      const contentByLanguage: Record<string, any> = {};

      if (plainEvent.content && Array.isArray(plainEvent.content)) {
        plainEvent.content.forEach((c: any) => {
          contentByLanguage[c.language] = {
            title: c.name || c.title || '',  // Support both field names for API compatibility
            name: c.name || c.title || '',   // Include both for compatibility
            description: c.description,
          };
        });
      }

      // Transform schedules from Sequelize plain object format (snake_case Date fields)
      // to the format expected by CalendarEventSchedule.fromObject() (camelCase ISO strings).
      // The Sequelize plain object has start_date/end_date as JS Date objects; the model
      // expects start/end as ISO string values (matching EventScheduleEntity.toModel()).
      const schedules = Array.isArray(plainEvent.schedules)
        ? plainEvent.schedules.map((s: any) => ({
          id: s.id,
          start: s.start_date ? new Date(s.start_date).toISOString() : null,
          end: s.end_date ? new Date(s.end_date).toISOString() : null,
          frequency: s.frequency,
          interval: s.interval,
          count: s.count,
          byDay: s.by_day ? s.by_day.split(',') : [],
          isException: s.is_exclusion,
        }))
        : [];

      const transformedEvent = {
        ...plainEvent,
        content: contentByLanguage,
        schedules,
        repostStatus,
        sourceCalendarActorId,
        eventSourceUrl: eventUrl,
      };

      return transformedEvent;
    });

    return eventsWithRepostStatus;
  }
}

export default ActivityPubService;
