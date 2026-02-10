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
import RemoteCalendarService from "@/server/activitypub/service/remote_calendar";
import UndoActivity from "../model/action/undo";
import { EventEntity } from "@/server/calendar/entity/event";
import CalendarInterface from "@/server/calendar/interface";
import { addToOutbox as addToOutboxHelper } from "@/server/activitypub/helper/outbox";
import {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicySettingsError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
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
   * Validate that repost policy settings are consistent
   * autoRepostReposts cannot be true if autoRepostOriginals is false
   */
  static validateRepostPolicySettings(autoRepostOriginals: boolean, autoRepostReposts: boolean): void {
    if (autoRepostReposts && !autoRepostOriginals) {
      throw new InvalidRepostPolicySettingsError();
    }
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

    // Update the repost policy if follow already exists
    if (existingFollowEntity) {
      if (existingFollowEntity.auto_repost_originals !== autoRepostOriginals ||
          existingFollowEntity.auto_repost_reposts !== autoRepostReposts) {
        existingFollowEntity.auto_repost_originals = autoRepostOriginals;
        existingFollowEntity.auto_repost_reposts = autoRepostReposts;
        await existingFollowEntity.save();
      }
      return;
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
     * user on this server shares an event from someone else
     * @param account The account performing the sharing
     * @param calendar The calendar to share to
     * @param eventUrl URL of remote event
     * @param autoPosted Whether this share was created automatically by the auto-post system
     */
  async shareEvent(account: Account, calendar: Calendar, eventUrl: string, autoPosted = false) {

    if ( ! this.calendarService.userCanModifyCalendar(account, calendar) ) {
      throw new InsufficientCalendarPermissionsError('User does not have permission to modify calendar: ' + calendar.id);
    }

    if (!eventUrl.match("^https:\/\/")) {
      throw new InvalidSharedEventUrlError('Invalid shared event url: ' + eventUrl);
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

    console.log(`[MemberService] getFeed called for calendar ID: ${calendar.id}`);

    // First, let's see what we're following (with CalendarActor details)
    const following = await FollowingCalendarEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });
    console.log(`[MemberService] This calendar is following ${following.length} remote calendars:`);
    following.forEach(f => {
      console.log(`[MemberService]   - ${f.calendarActor?.actor_uri || f.calendar_actor_id}`);
    });

    // Query events from calendars this calendar is following.
    // This includes BOTH:
    // - Remote events (calendar_id = null) tracked via EventObjectEntity.attributed_to
    // - Local events (calendar_id = UUID) from followed local calendars
    const events = await EventEntity.findAll({
      where: {
        [Op.or]: [
          // Remote events from followed remote calendars
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

    console.log(`[MemberService] Found ${events.length} events in feed`);

    // Batch fetch all shared events for these events in a single query
    const eventUrls = events.map(event =>
      event.event_source_url || `https://${config.get('domain')}/events/${event.id}`,
    );

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

    // Map events with repost status using the lookup map
    const eventsWithRepostStatus = events.map((event) => {
      const eventUrl = event.event_source_url || `https://${config.get('domain')}/events/${event.id}`;
      const sharedEvent = sharedEventMap.get(eventUrl);

      let repostStatus: 'none' | 'manual' | 'auto' = 'none';
      if (sharedEvent) {
        repostStatus = sharedEvent.auto_posted ? 'auto' : 'manual';
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

      const transformedEvent = {
        ...plainEvent,
        content: contentByLanguage,
        repostStatus,
      };

      console.log(`[MemberService] Transformed event:`, JSON.stringify(transformedEvent, null, 2));

      return transformedEvent;
    });

    console.log(`[MemberService] Returning ${eventsWithRepostStatus.length} events with content`);
    return eventsWithRepostStatus;
  }
}

export default ActivityPubService;
