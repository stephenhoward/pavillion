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
import ActivityPubServerService, { InboxAuthContext, InboxRowInput } from '@/server/activitypub/service/server';
import ProcessInboxService from '../service/inbox';
import ProcessOutboxService from '../service/outbox';
import FederationPublisher, {
  FederationEventInput,
  FederationRemoteUserActor,
} from '@/server/activitypub/service/federation_publisher';
import { ActivityPubOutboxMessageEntity, ActivityPubInboxMessageEntity, FollowingCalendarEntity, SharedEventEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { CalendarActorEntity, CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';

export type { InboxAuthContext, InboxRowInput } from '@/server/activitypub/service/server';
import ModerationInterface from '@/server/moderation/interface';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';

/**
 * Implementation of the ActivityPub internal API interface
 * Aggregates functionality from both member and server services
 */
export default class ActivityPubInterface {
  private memberService: ActivityPubMemberService;
  private serverService: ActivityPubServerService;
  private inboxService: ProcessInboxService;
  private outboxService: ProcessOutboxService;
  private federationPublisher: FederationPublisher;
  private calendarInterface: CalendarInterface;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    moderationInterface?: ModerationInterface,
  ) {
    this.calendarInterface = calendarInterface;
    this.memberService = new ActivityPubMemberService(eventBus, calendarInterface);
    this.serverService = new ActivityPubServerService(eventBus, calendarInterface, accountsInterface);
    this.inboxService = new ProcessInboxService(eventBus, this.calendarInterface, moderationInterface);
    this.outboxService = new ProcessOutboxService(eventBus, this.inboxService);
    this.federationPublisher = new FederationPublisher(eventBus, calendarInterface, this.outboxService);
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

  /**
   * AP-internal transport primitive: enqueues a pre-built ActivityPub activity
   * onto a calendar's outbox so the worker signs it and fans it out to every
   * configured recipient asynchronously.
   *
   * **Non-AP callers should NOT use this method.** Use the typed publish/send
   * methods instead, which own activity construction inside the AP domain:
   *   - `publishEventCreate` / `publishEventUpdate` / `publishEventDelete`
   *     for event lifecycle activities.
   *   - `sendEditorInvite` for Add(remoteUserActor) editor invites.
   *
   * This method remains exposed because AP-internal services (members service
   * for follow/unfollow/share/unshare, inbox forwarding for announce/accept)
   * legitimately enqueue activities they have already constructed.
   *
   * @param calendar The calendar that owns the outbox.
   * @param message The activity to enqueue for delivery.
   */
  async addToOutbox(calendar: Calendar, message: ActivityPubActivity): Promise<void> {
    return this.memberService.addToOutbox(calendar, message);
  }

  /**
   * AP-internal transport primitive: escape hatch for synchronous signed
   * federation delivery. Used when the AP domain needs to read the remote
   * response body (currently only Create(Event) delivery qualifies, because
   * the local CalendarEvent model is built from the remote echo).
   *
   * **Non-AP callers should NOT use this method.** Use `publishEventCreate`
   * instead — it owns activity construction, signing-actor resolution, and
   * the synchronous response handling inside the AP domain.
   *
   * The signing actor URI must equal `activity.actor` so the keyId is valid
   * at the receiver. The activity is JSON-stringified once and the same
   * bytes are used for both the SHA-256 Digest header and the HTTP body.
   *
   * Errors:
   *   - Network / TLS / timeout / signing failure  -> throws FederationDeliveryError
   *   - Non-2xx HTTP response                       -> resolves with `{ status, data: null }`
   *   - 202 Accepted with empty body                -> resolves with `{ status: 202, data: null }`
   *   - 2xx with body                               -> resolves with `{ status, data: <parsed JSON> }`
   *
   * Callers MUST guard `data?.id` (or whatever response field they consume).
   *
   * @param signingActorUri The actor URI used to sign the request. Must equal `activity.actor`.
   * @param activity The ActivityPub activity to deliver.
   * @param inboxUrl The remote inbox URL to POST to.
   */
  async deliverActivitySigned(
    signingActorUri: string,
    activity: Record<string, any>,
    inboxUrl: string,
  ): Promise<{ status: number; data: any }> {
    return this.outboxService.deliverActivitySigned(signingActorUri, activity, inboxUrl);
  }

  /**
   * Publishes a Create(Event) activity to a remote calendar synchronously.
   * The AP domain owns activity construction, signing-actor resolution, and
   * remote response handling; the caller passes typed domain inputs and
   * receives the local CalendarEvent built from the remote echo.
   *
   * Use this when creating an event on a remote (federated) calendar. Errors
   * are mapped to `InsufficientCalendarPermissionsError` on 403 from the
   * remote inbox; other non-2xx responses surface as a generic Error.
   *
   * @param account The local account creating the event.
   * @param event The event input (eventId + raw eventParams).
   * @param remoteCalendarActor The remote calendar's CalendarActor.
   * @returns The created CalendarEvent (from remote response).
   */
  async publishEventCreate(
    account: Account,
    event: FederationEventInput,
    remoteCalendarActor: CalendarActor,
  ): Promise<CalendarEvent> {
    return this.federationPublisher.publishEventCreate(account, event, remoteCalendarActor);
  }

  /**
   * Publishes an Update(Event) activity to a remote calendar via the outbox
   * (fire-and-forget). The AP domain owns activity construction and outbox
   * anchor resolution; the caller passes typed domain inputs.
   *
   * @param account The local account updating the event.
   * @param event The event input (eventId + raw eventParams).
   * @param remoteCalendarActor The remote calendar's CalendarActor.
   */
  async publishEventUpdate(
    account: Account,
    event: FederationEventInput,
    remoteCalendarActor: CalendarActor,
  ): Promise<void> {
    return this.federationPublisher.publishEventUpdate(account, event, remoteCalendarActor);
  }

  /**
   * Publishes a Delete(Tombstone) activity to a remote calendar via the
   * outbox (fire-and-forget). The AP domain owns activity construction and
   * outbox anchor resolution; the caller passes the local event id.
   *
   * @param account The local account deleting the event.
   * @param eventId The local event id to delete.
   * @param remoteCalendarActor The remote calendar's CalendarActor.
   */
  async publishEventDelete(
    account: Account,
    eventId: string,
    remoteCalendarActor: CalendarActor,
  ): Promise<void> {
    return this.federationPublisher.publishEventDelete(account, eventId, remoteCalendarActor);
  }

  /**
   * Sends an Add(remoteUserActor) editor-invite activity from a local
   * calendar to a remote user actor via the outbox (fire-and-forget). The
   * activity is signed by the calendar actor (per pv-dyyw signing table)
   * and anchored on the calendar's own outbox.
   *
   * @param calendar The local calendar inviting the editor.
   * @param remoteUserActor The remote user actor being invited.
   */
  async sendEditorInvite(
    calendar: Calendar,
    remoteUserActor: FederationRemoteUserActor,
  ): Promise<void> {
    return this.federationPublisher.sendEditorInvite(calendar, remoteUserActor);
  }

  /**
   * Sends a Remove(remoteUserActor) editor-revoke activity from a local
   * calendar to a remote user actor via the outbox (fire-and-forget). The
   * activity is signed by the calendar actor (per pv-dyyw signing table)
   * and anchored on the calendar's own outbox. Symmetric with
   * `sendEditorInvite`: Add/Remove is the AS2 §8.13 pair for
   * collection-membership management.
   *
   * @param calendar The local calendar revoking the editor.
   * @param remoteUserActorUri The remote user actor URI whose editor
   *   access is being revoked.
   */
  async sendEditorRevoke(
    calendar: Calendar,
    remoteUserActorUri: string,
  ): Promise<void> {
    return this.federationPublisher.sendEditorRevoke(calendar, remoteUserActorUri);
  }

  async addToInbox(calendar: Calendar, message: ActivityPubActivity, auth: InboxAuthContext): Promise<null> {
    return this.serverService.addToInbox(calendar, message, auth);
  }

  /**
   * Deferred inbox write that does NOT emit `inboxMessageAdded`. The caller
   * must drain the inbox afterwards via {@link processInboxMessages}. See
   * {@link ActivityPubServerService.enqueueInboxRow}.
   */
  async enqueueInboxRow(input: InboxRowInput): Promise<{ created: boolean }> {
    return this.serverService.enqueueInboxRow(input);
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
    await this.inboxService.processInboxMessage(message);
  }

  /**
   * Drains the inbox by processing all unprocessed messages in chronological
   * order (`messageTime ASC` over `processedAt: null`). Used by the follow
   * backfill worker to flush inserted messages after pagination completes.
   *
   * @returns {Promise<void>}
   */
  async processInboxMessages(): Promise<void> {
    return this.inboxService.processInboxMessages();
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
    return this.inboxService.cleanupProcessedInboxMessages(retentionDays, batchSize);
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
    return this.inboxService.processPersonActorActivity(calendar, activity);
  }

  /**
   * Invalidates the authorization cache entry for a specific calendar and actor.
   * Should be called when editor membership changes to ensure immediate effect.
   *
   * @param calendarId - The calendar ID
   * @param actorUri - The Person actor URI
   */
  invalidateAuthorizationCache(calendarId: string, actorUri: string): void {
    this.inboxService.invalidateAuthorizationCache(calendarId, actorUri);
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
   * Gets a map of shared event IDs to their repost status ('auto' or 'manual')
   * for a given calendar. Derived from SharedEventEntity.auto_posted.
   *
   * Events NOT present in the returned map are not shared via SharedEventEntity
   * for the given calendar and their repost status must be determined by other
   * means (e.g., ownership or legacy EventRepostEntity).
   *
   * @param calendarId - The calendar UUID
   * @returns Map from event_id (UUID string) to 'auto' | 'manual'
   */
  async getSharedEventStatusMap(calendarId: string): Promise<Map<string, 'auto' | 'manual'>> {
    return this.memberService.getSharedEventStatusMap(calendarId);
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
}
