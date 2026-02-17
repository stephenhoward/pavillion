import { DateTime } from "luxon";
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from "events";
import axios from "axios";
import { logError } from '@/server/common/helper/error-logger';
import { logActivityRejection } from '../helper/rejection-logger';

import CreateActivity from "@/server/activitypub/model/action/create";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AcceptActivity from "@/server/activitypub/model/action/accept";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowerCalendarEntity, FollowingCalendarEntity, SharedEventEntity } from "@/server/activitypub/entity/activitypub";
import { EventObjectEntity } from "@/server/activitypub/entity/event_object";
import RemoteCalendarService from "@/server/activitypub/service/remote_calendar";
import { ActivityPubActor } from "@/server/activitypub/model/base";
import CalendarInterface from "@/server/calendar/interface";
import ModerationInterface from "@/server/moderation/interface";
import { CalendarEvent } from "@/common/model/events";
import { ReportCategory } from "@/common/model/report";
import { Calendar } from "@/common/model/calendar";
import { addToOutbox } from "@/server/activitypub/helper/outbox";
import { UserActorEntity } from "@/server/activitypub/entity/user_actor";
import { ReportEntity } from "@/server/moderation/entity/report";
import { CalendarMemberEntity } from "@/server/calendar/entity/calendar_member";
import { fetchRemoteObject } from "@/server/activitypub/helper/remote-fetch";

/**
 * Cache entry for authorization results
 */
interface AuthorizationCacheEntry {
  authorized: boolean;
  expiresAt: number;
}

/**
 * LRU cache for authorization results with automatic expiration.
 * Extends Map to provide LRU eviction when size limit is reached.
 */
class AuthorizationLRUCache {
  private cache: Map<string, { value: AuthorizationCacheEntry, accessOrder: number }> = new Map();
  private accessCounter: number = 0;
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 1000, ttlMs: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  set(key: string, value: AuthorizationCacheEntry): void {
    // If key exists, remove it first to update access order
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add new entry with current access order
    this.cache.set(key, { value, accessOrder: ++this.accessCounter });

    // Evict oldest entries if we exceeded max size
    if (this.cache.size > this.maxSize) {
      this.evictOldest();
    }
  }

  get(key: string): AuthorizationCacheEntry | undefined {
    const item = this.cache.get(key);
    if (!item) {
      return undefined;
    }

    // Update access order for LRU
    this.cache.delete(key);
    item.accessOrder = ++this.accessCounter;
    this.cache.set(key, item);

    return item.value;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.accessCounter = 0;
  }

  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  entries(): IterableIterator<[string, { value: AuthorizationCacheEntry, accessOrder: number }]> {
    return this.cache.entries();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics for monitoring
   * @returns Object with cache size, max size, and utilization percentage
   */
  getStats(): { size: number; maxSize: number; utilization: number } {
    const utilization = this.maxSize > 0 ? (this.cache.size / this.maxSize) * 100 : 0;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: Math.round(utilization * 100) / 100, // Round to 2 decimal places
    };
  }

  /**
   * Evict the least recently used entries to maintain max size
   */
  private evictOldest(): void {
    const entriesToRemove = this.cache.size - this.maxSize;
    if (entriesToRemove <= 0) {
      return;
    }

    // Find entries with oldest access order
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].accessOrder - b[1].accessOrder);

    for (let i = 0; i < entriesToRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
  }
}

/**
 * Service responsible for processing incoming ActivityPub messages in the inbox.
 *
 * This service includes an in-memory cache for remote editor authorization checks
 * to improve performance by avoiding redundant database queries. Cache entries
 * are stored in an LRU cache with a maximum size of 1000 entries and a 5-minute TTL.
 *
 * The service also filters incoming content from blocked instances via the
 * ModerationInterface, rejecting activities early in the processing pipeline.
 */
class ProcessInboxService {
  calendarInterface: CalendarInterface;
  moderationInterface?: ModerationInterface;
  eventBus: EventEmitter;
  remoteCalendarService: RemoteCalendarService;

  /**
   * LRU cache for remote editor authorization checks.
   * Key format: `${calendarId}:${actorUri}`
   * Value: { authorized: boolean }
   * Max size: 1000 entries with LRU eviction
   */
  private authorizationCache: AuthorizationLRUCache;

  /**
   * Cache TTL in milliseconds (5 minutes)
   */
  private readonly CACHE_TTL = 5 * 60 * 1000;

  /**
   * Maximum cache size (number of entries)
   */
  private readonly CACHE_MAX_SIZE = 1000;

  constructor(eventBus: EventEmitter, calendarInterface: CalendarInterface, moderationInterface?: ModerationInterface) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.moderationInterface = moderationInterface;
    this.remoteCalendarService = new RemoteCalendarService();
    this.authorizationCache = new AuthorizationLRUCache(this.CACHE_MAX_SIZE, this.CACHE_TTL);
  }

  /**
   * Extracts the domain from an actor URI.
   * Handles various ActivityPub URI formats.
   *
   * @param actorUri - The actor URI to parse
   * @returns The domain name (hostname) or empty string if parsing fails
   */
  private extractDomainFromActorUri(actorUri: string): string {
    try {
      const url = new URL(actorUri);
      return url.hostname;
    }
    catch {
      return '';
    }
  }

  /**
   * Extracts the domain from an actor URI for logging purposes.
   * Returns 'unknown' for invalid URIs.
   *
   * @param actorUri - The actor URI to parse
   * @returns The domain name or 'unknown'
   */
  private extractDomain(actorUri: string): string {
    try {
      const url = new URL(actorUri);
      return url.hostname;
    }
    catch {
      return 'unknown';
    }
  }

  /**
   * Processes all unprocessed inbox messages in batches.
   *
   * @returns {Promise<void>}
   */
  async processInboxMessages() {

    let messages: ActivityPubInboxMessageEntity[] = [];

    // TODO: messageTime based cursor, perhaps, so we don't keep reprocessing the same messages if they never get processed
    do {
      messages = await ActivityPubInboxMessageEntity.findAll({
        where: { processedAt: null },
        order: [ ['messageTime', 'ASC'] ],
        limit: 1000,
      });

      for( const message of messages ) {
        await this.processInboxMessage(message);
      }
    } while( messages.length > 0 );
  }

  /**
   * Processes a single inbox message based on its type.
   * Checks if the source instance is blocked before processing.
   *
   * @param {ActivityPubInboxMessageEntity} message - The message entity to process
   * @returns {Promise<void>}
   */
  async processInboxMessage(message: ActivityPubInboxMessageEntity ) {
    const calendar = await this.calendarInterface.getCalendar(message.calendar_id);

    try {
      if ( ! calendar ) {
        throw new Error("No calendar found for inbox");
      }

      // Extract actor from the message to check if the source instance is blocked
      const actorUri = (message.message as any)?.actor;
      if (actorUri && this.moderationInterface) {
        const domain = this.extractDomainFromActorUri(actorUri);

        if (domain) {
          const isBlocked = await this.moderationInterface.isInstanceBlocked(domain);

          if (isBlocked) {
            console.log(`[INBOX] Rejected activity from blocked instance: ${domain} (actor: ${actorUri})`);

            // Log the rejection
            logActivityRejection({
              rejection_type: 'blocked_instance',
              activity_type: message.type || 'unknown',
              actor_uri: actorUri,
              actor_domain: domain,
              calendar_id: calendar.id,
              calendar_url_name: calendar.urlName,
              reason: `Activity rejected from blocked instance: ${domain}`,
              message_id: message.id,
            });

            // Mark message as processed with 'blocked' status
            await message.update({
              processed_time: DateTime.now().toJSDate(),
              processed_status: 'blocked',
            });

            return;
          }
        }
      }

      switch( message.type ) {
        case 'Create':
          {
            const activity = CreateActivity.fromObject(message.message);
            if (!activity) {
              const actorUri = (message.message as any)?.actor || 'unknown';
              logActivityRejection({
                rejection_type: 'parse_failure',
                activity_type: 'Create',
                actor_uri: actorUri,
                actor_domain: this.extractDomain(actorUri),
                calendar_id: calendar.id,
                calendar_url_name: calendar.urlName,
                reason: 'Failed to parse Create activity',
                message_id: message.id,
              });
              throw new Error('Failed to parse Create activity');
            }
            await this.processCreateEvent(calendar, activity);
          }
          break;
        case 'Update':
          {
            const activity = UpdateActivity.fromObject(message.message);
            if (!activity) {
              const actorUri = (message.message as any)?.actor || 'unknown';
              logActivityRejection({
                rejection_type: 'parse_failure',
                activity_type: 'Update',
                actor_uri: actorUri,
                actor_domain: this.extractDomain(actorUri),
                calendar_id: calendar.id,
                calendar_url_name: calendar.urlName,
                reason: 'Failed to parse Update activity',
                message_id: message.id,
              });
              throw new Error('Failed to parse Update activity');
            }
            await this.processUpdateEvent(calendar, activity);
          }
          break;
        case 'Delete':
          {
            const activity = DeleteActivity.fromObject(message.message);
            if (!activity) {
              const actorUri = (message.message as any)?.actor || 'unknown';
              logActivityRejection({
                rejection_type: 'parse_failure',
                activity_type: 'Delete',
                actor_uri: actorUri,
                actor_domain: this.extractDomain(actorUri),
                calendar_id: calendar.id,
                calendar_url_name: calendar.urlName,
                reason: 'Failed to parse Delete activity',
                message_id: message.id,
              });
              throw new Error('Failed to parse Delete activity');
            }
            await this.processDeleteEvent(calendar, activity);
          }
          break;
        case 'Follow':
          {
            const activity = FollowActivity.fromObject(message.message);
            if (!activity) {
              const actorUri = (message.message as any)?.actor || 'unknown';
              logActivityRejection({
                rejection_type: 'parse_failure',
                activity_type: 'Follow',
                actor_uri: actorUri,
                actor_domain: this.extractDomain(actorUri),
                calendar_id: calendar.id,
                calendar_url_name: calendar.urlName,
                reason: 'Failed to parse Follow activity',
                message_id: message.id,
              });
              throw new Error('Failed to parse Follow activity');
            }
            await this.processFollowAccount(calendar, activity);
          }
          break;
        case 'Accept':
          {
            const activity = AcceptActivity.fromObject(message.message);
            if (!activity) {
              const actorUri = (message.message as any)?.actor || 'unknown';
              logActivityRejection({
                rejection_type: 'parse_failure',
                activity_type: 'Accept',
                actor_uri: actorUri,
                actor_domain: this.extractDomain(actorUri),
                calendar_id: calendar.id,
                calendar_url_name: calendar.urlName,
                reason: 'Failed to parse Accept activity',
                message_id: message.id,
              });
              throw new Error('Failed to parse Accept activity');
            }
            await this.processAcceptActivity(calendar, activity);
          }
          break;
        case 'Announce':
          {
            const activity = AnnounceActivity.fromObject(message.message);
            if (!activity) {
              const actorUri = (message.message as any)?.actor || 'unknown';
              logActivityRejection({
                rejection_type: 'parse_failure',
                activity_type: 'Announce',
                actor_uri: actorUri,
                actor_domain: this.extractDomain(actorUri),
                calendar_id: calendar.id,
                calendar_url_name: calendar.urlName,
                reason: 'Failed to parse Announce activity',
                message_id: message.id,
              });
              throw new Error('Failed to parse Announce activity');
            }
            await this.processShareEvent(calendar, activity);
          }
          break;
        case 'Flag':
          {
            await this.processFlagActivity(calendar, message.message);
          }
          break;
        case 'Undo':
          if (!message.message || typeof message.message !== 'object' || !message.message.object) {
            const actorUri = (message.message as any)?.actor || 'unknown';
            logActivityRejection({
              rejection_type: 'invalid_object',
              activity_type: 'Undo',
              actor_uri: actorUri,
              actor_domain: this.extractDomain(actorUri),
              calendar_id: calendar.id,
              calendar_url_name: calendar.urlName,
              reason: 'Invalid Undo activity: missing message object',
              message_id: message.id,
            });
            throw new Error('Invalid Undo activity: missing message object');
          }

          let targetEntity = await ActivityPubInboxMessageEntity.findOne({
            where: { calendar_id: message.calendar_id, id: message.message.object },
          });

          if ( targetEntity ) {

            switch( targetEntity.type ) {
              case 'Follow':
                await this.processUnfollowAccount(calendar, targetEntity);
                break;
              case 'Announce':
                await this.processUnshareEvent(calendar, targetEntity);
                break;
            }
          }
          else {
            throw new Error('Undo target not found');
          }
          break;
        default:
          throw new Error('bad message type');
      }
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'ok',
      });
    }
    catch (e) {
      logError(e, `Error processing inbox message for calendar ${message.calendar_id}`);
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'error',
      });
    }
  }


  /**
   * Processes a Flag activity by creating a federated report.
   * Extracts event information from the object URI, parses category from hashtags,
   * and creates a Report with reporterType='federation'.
   *
   * @param calendar - The calendar receiving the flag
   * @param message - The Flag activity message
   * @returns Promise<void>
   */
  async processFlagActivity(calendar: Calendar, message: any): Promise<void> {
    if (!this.moderationInterface) {
      console.warn('[INBOX] processFlagActivity called but moderationInterface not available');
      return;
    }

    if (!message || !message.object) {
      console.warn('[INBOX] Flag activity missing object');
      return;
    }

    // Extract event ID from object URI
    const objectUri = typeof message.object === 'string' ? message.object : message.object.id;
    if (!objectUri) {
      console.warn('[INBOX] Flag activity object missing id');
      return;
    }

    // Parse event ID from URI (last path segment)
    const eventIdMatch = objectUri.match(/\/events\/([a-f0-9-]+)$/i);
    if (!eventIdMatch) {
      console.warn(`[INBOX] Could not parse event ID from object URI: ${objectUri}`);
      return;
    }
    const eventId = eventIdMatch[1];

    // Look up the event to verify it exists
    const event = await this.calendarInterface.getEventById(eventId);
    if (!event || !event.calendarId) {
      console.warn(`[INBOX] Flag activity references unknown event: ${eventId}`);
      return;
    }

    // Extract category from hashtags
    let category: ReportCategory = ReportCategory.OTHER;
    if (message.tag && Array.isArray(message.tag)) {
      for (const tag of message.tag) {
        if (tag.type === 'Hashtag' && tag.name) {
          const categoryName = tag.name.replace(/^#/, '');
          if (Object.values(ReportCategory).includes(categoryName as ReportCategory)) {
            category = categoryName as ReportCategory;
            break;
          }
        }
      }
    }

    // Extract domain from actor URI
    const actorUri = message.actor;
    const domain = this.extractDomainFromActorUri(actorUri);

    // Create report via ModerationInterface
    try {
      const report = await this.moderationInterface.receiveRemoteReport({
        eventId: event.id,
        category,
        description: message.content || '',
        forwardedFromInstance: domain,
        forwardedReportId: message.id,
      });

      console.log(`[INBOX] Created federation report ${report.id} for event ${eventId} from ${domain}`);

      // Emit domain event
      this.eventBus.emit('reportReceived', { report });
    }
    catch (error) {
      logError(error, `[INBOX] Failed to create federation report for event ${eventId}`);
      throw error;
    }
  }

  /**
   * Verifies that an actor owns the object they're trying to modify by fetching
   * the object from its origin server and checking the attributedTo field.
   *
   * This provides security against spoofed activities where an attacker claims
   * to own an object they don't actually control.
   *
   * @param {any} message - The message containing actor and object information
   * @returns {Promise<boolean>} True if the actor owns the object, false otherwise
   */
  async actorOwnsObject(message: any): Promise<boolean> {
    // Get the object URI - could be a string or an object with id
    const objectUri = typeof message.object === 'string'
      ? message.object
      : message.object?.id;

    if (!objectUri) {
      console.warn('[INBOX] actorOwnsObject: No object URI found in message');
      return false;
    }

    // Fetch the object from its origin server
    const remoteObject = await fetchRemoteObject(objectUri);

    if (!remoteObject) {
      console.warn(`[INBOX] actorOwnsObject: Failed to fetch remote object from ${objectUri}`);
      return false;
    }

    // Get the attributedTo from the fetched object
    const attributedTo = remoteObject.attributedTo;

    if (!attributedTo) {
      console.warn(`[INBOX] actorOwnsObject: No attributedTo found on remote object ${objectUri}`);
      return false;
    }

    // attributedTo can be a string or an array of strings
    const actorUri = message.actor;

    if (Array.isArray(attributedTo)) {
      // Check if the actor is in the array
      return attributedTo.some((attr) => {
        // Each element could be a string URI or an object with id
        if (typeof attr === 'string') {
          return attr === actorUri;
        }
        if (typeof attr === 'object' && attr !== null && 'id' in attr) {
          return (attr as { id: string }).id === actorUri;
        }
        return false;
      });
    }

    // attributedTo is a single value
    if (typeof attributedTo === 'string') {
      return attributedTo === actorUri;
    }

    // attributedTo could be an object with an id
    if (typeof attributedTo === 'object' && attributedTo !== null && 'id' in attributedTo) {
      return (attributedTo as { id: string }).id === actorUri;
    }

    console.warn(`[INBOX] actorOwnsObject: Unexpected attributedTo format on remote object ${objectUri}`);
    return false;
  }

  /**
   * Processes a Create activity by creating a new event if it doesn't exist.
   * Handles both:
   * - Create from calendar actors (federated event sharing)
   * - Create from Person actors (remote editors creating events)
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {CreateActivity} message - The Create activity message
   * @returns {Promise<void>}
   */
  async processCreateEvent(calendar: Calendar, message: CreateActivity): Promise<CalendarEvent | null> {
    if (!message.object || !message.object.id) {
      console.warn(`[INBOX] Create activity missing object or object.id`);
      logActivityRejection({
        rejection_type: 'invalid_object',
        activity_type: 'Create',
        actor_uri: message.actor,
        actor_domain: this.extractDomain(message.actor),
        calendar_id: calendar.id,
        calendar_url_name: calendar.urlName,
        reason: 'Create activity missing object or object.id',
      });
      return null;
    }

    const apObjectId = message.object.id;
    const actorUri = message.actor;

    // Check if we already have this AP object by looking up EventObjectEntity
    const existingApObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    if (existingApObject) {
      // Event already exists, skip
      return null;
    }

    // Check if this is from a Person actor (remote editor) vs a calendar actor
    const isPersonActor = await this.isPersonActorUri(actorUri);

    if (isPersonActor) {
      // Verify the Person is an authorized editor of this calendar
      const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);

      if (!isAuthorizedEditor) {
        console.warn(`[INBOX] Person actor ${actorUri} is not authorized to create events on calendar ${calendar.urlName}`);
        logActivityRejection({
          rejection_type: 'unauthorized_editor',
          activity_type: 'Create',
          actor_uri: actorUri,
          actor_domain: this.extractDomain(actorUri),
          calendar_id: calendar.id,
          calendar_url_name: calendar.urlName,
          reason: `Person actor is not an authorized editor of calendar ${calendar.urlName}`,
        });
        throw new Error('Actor is not an authorized editor of this calendar');
      }

      console.log(`[INBOX] Processing Create from authorized remote editor: ${actorUri}`);
    }
    else {
      // Traditional calendar-to-calendar federation - verify ownership
      const ok = await this.actorOwnsObject(message);
      if (!ok) {
        console.warn(`[INBOX] Actor ownership verification failed for event ${apObjectId}`);
        logActivityRejection({
          rejection_type: 'ownership_verification_failed',
          activity_type: 'Create',
          actor_uri: actorUri,
          actor_domain: this.extractDomain(actorUri),
          calendar_id: calendar.id,
          calendar_url_name: calendar.urlName,
          reason: `Actor ownership verification failed for event ${apObjectId}`,
        });
        return null;
      }
    }

    // Atomically find or create the EventObjectEntity to avoid race conditions
    const localEventId = uuidv4();
    const [, created] = await EventObjectEntity.findOrCreate({
      where: { ap_id: apObjectId },
      defaults: {
        event_id: localEventId,
        ap_id: apObjectId,
        attributed_to: actorUri,
      },
    });

    if (!created) {
      // Another concurrent request already created this record, skip
      return null;
    }

    // Create the event
    // calendarId is intentionally omitted for calendar-actor federation;
    // addRemoteEvent will set it to null for remote federated events
    const eventParams: Record<string, any> = {
      ...message.object,
      id: localEventId,
      event_source_url: apObjectId,
    };

    // For Person actor creates, use the full event params from the object
    if (isPersonActor) {
      if (message.object.eventParams) {
        Object.assign(eventParams, message.object.eventParams);
        eventParams.id = localEventId;
      }
      eventParams.calendarId = calendar.id;
    }

    const createdEvent = await this.calendarInterface.addRemoteEvent(calendar, eventParams);

    console.log(`[INBOX] Created event ${localEventId} from ${isPersonActor ? 'Person' : 'Calendar'} actor ${actorUri}`);

    // Check for auto-repost (skip if Person actor or no event created)
    if (!isPersonActor && createdEvent) {
      await this.checkAndPerformAutoRepost(calendar, actorUri, apObjectId, true);
    }

    return createdEvent;
  }

  /**
   * Checks auto-repost policy and performs automatic repost if conditions are met.
   * Enforces loop prevention and security guards.
   *
   * @param calendar - The local calendar receiving the event
   * @param sourceActorUri - The actor URI of the event source
   * @param eventApId - The ActivityPub ID of the event
   * @param isOriginal - True for Create activities, false for Announce activities
   * @returns Promise<void>
   */
  private async checkAndPerformAutoRepost(
    calendar: Calendar,
    sourceActorUri: string,
    eventApId: string,
    isOriginal: boolean,
  ): Promise<void> {
    console.log('[AUTO-REPOST] Called with:', { calendarId: calendar.id, sourceActorUri, eventApId, isOriginal });

    // Find CalendarActorEntity for sourceActorUri
    const remoteCalendar = await this.remoteCalendarService.findOrCreateByActorUri(sourceActorUri);

    // Find FollowingCalendarEntity
    const follow = await FollowingCalendarEntity.findOne({
      where: {
        calendar_actor_id: remoteCalendar.id,
        calendar_id: calendar.id,
      },
    });

    if (!follow) {
      console.log('[AUTO-REPOST] Skip: Not following source', { sourceActorUri, calendarId: calendar.id });
      // Not following this source, skip
      return;
    }

    console.log('[AUTO-REPOST] Follow found:', {
      followId: follow.id,
      autoRepostOriginals: follow.auto_repost_originals,
      autoRepostReposts: follow.auto_repost_reposts,
      isOriginal,
    });

    // Check policy
    const shouldRepost = isOriginal ? follow.auto_repost_originals : follow.auto_repost_reposts;
    console.log('[AUTO-REPOST] Policy check:', { shouldRepost, isOriginal, policy: isOriginal ? 'originals' : 'reposts' });
    if (!shouldRepost) {
      console.log('[AUTO-REPOST] Skip: Policy disabled');
      return;
    }

    // SECURITY: Verify EventObjectEntity.attributed_to matches sourceActorUri
    const eventObject = await EventObjectEntity.findOne({
      where: { ap_id: eventApId },
    });

    if (!eventObject) {
      console.warn(`[INBOX] Auto-repost skipped: EventObjectEntity not found for ${eventApId}`);
      return;
    }

    // For original events (Create), verify the actor owns the event.
    // For reposts (Announce), the sharer intentionally differs from the original author.
    if (isOriginal && eventObject.attributed_to !== sourceActorUri) {
      console.warn(`[AUTO-REPOST] Skip: attributed_to mismatch - expected ${sourceActorUri}, got ${eventObject.attributed_to}`);
      return;
    }

    console.log('[AUTO-REPOST] Attribution verified:', { attributed_to: eventObject.attributed_to });

    // LOOP GUARD: Never repost own events
    const localActorUrl = ActivityPubActor.actorUrl(calendar);
    if (eventObject.attributed_to === localActorUrl) {
      console.log('[AUTO-REPOST] Skip: Loop prevention - event originated from this calendar');
      return;
    }

    // LOOP GUARD: Check SharedEventEntity for duplicates
    const existingShare = await SharedEventEntity.findOne({
      where: {
        event_id: eventObject.event_id,  // Query by local UUID, not AP URL
        calendar_id: calendar.id,
      },
    });

    if (existingShare) {
      console.log('[AUTO-REPOST] Skip: Already shared', { existingShareId: existingShare.id, autoPosted: existingShare.auto_posted });
      // Already shared, skip
      return;
    }
    console.log('[AUTO-REPOST] Creating SharedEventEntity and adding to outbox...');

    // Create SharedEventEntity with auto_posted: true
    const announceActivity = new AnnounceActivity(localActorUrl, eventApId);
    await SharedEventEntity.create({
      id: announceActivity.id,
      event_id: eventObject.event_id,  // Use local event UUID, not AP URL
      calendar_id: calendar.id,
      auto_posted: true,
    });

    // Add to outbox
    await addToOutbox(this.eventBus, calendar, announceActivity);

    console.log(`[AUTO-REPOST] ✅ SUCCESS: Auto-reposted event ${eventApId} from ${sourceActorUri} (isOriginal: ${isOriginal})`);
  }

  /**
   * Processes a Person actor activity synchronously and returns the result.
   * Used by the API layer for cross-instance editor operations.
   *
   * @param calendar - The calendar receiving the activity
   * @param activity - The activity to process (Create, Update, Delete)
   * @returns The created/updated event or null
   */
  async processPersonActorActivity(
    calendar: Calendar,
    activity: CreateActivity | UpdateActivity | DeleteActivity,
  ): Promise<CalendarEvent | null> {
    const actorUri = activity.actor;

    // Verify this is from a Person actor
    const isPersonActor = await this.isPersonActorUri(actorUri);
    if (!isPersonActor) {
      throw new Error('Activity is not from a Person actor');
    }

    // Verify the Person is an authorized editor
    const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);
    if (!isAuthorizedEditor) {
      throw new Error('Actor is not an authorized editor of this calendar');
    }

    switch (activity.type) {
      case 'Create':
        return this.processCreateEvent(calendar, activity as CreateActivity);
      case 'Update':
        return this.processUpdateEvent(calendar, activity as UpdateActivity);
      case 'Delete':
        await this.processDeleteEvent(calendar, activity as DeleteActivity);
        return null;
      default:
        throw new Error(`Unsupported activity type: ${(activity as any).type}`);
    }
  }

  /**
   * Checks if an actor URI is likely a Person actor (user) vs a calendar actor
   * Person actors typically have /users/ in the path
   *
   * @param actorUri - The actor URI to check
   * @returns True if this appears to be a Person actor
   */
  private async isPersonActorUri(actorUri: string): Promise<boolean> {
    return actorUri.includes('/users/');
  }

  /**
   * Checks if a Person actor is an authorized remote editor of a calendar.
   * Uses UserActorEntity + CalendarMemberEntity to look up membership.
   * Results are cached for 5 minutes to improve performance.
   *
   * @param calendarId - The calendar ID
   * @param actorUri - The Person actor URI
   * @returns True if authorized
   */
  private async isAuthorizedRemoteEditor(calendarId: string, actorUri: string): Promise<boolean> {
    const cacheKey = `${calendarId}:${actorUri}`;
    const now = Date.now();

    // Check cache first
    const cached = this.authorizationCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.authorized;
    }

    // Cache miss or expired - perform database lookup
    // First, find the UserActorEntity by actor_uri
    const userActor = await UserActorEntity.findOne({
      where: { actor_uri: actorUri },
    });

    if (!userActor) {
      // Cache negative result
      this.authorizationCache.set(cacheKey, {
        authorized: false,
        expiresAt: now + this.CACHE_TTL,
      });
      return false;
    }

    // Then, check if there's a CalendarMemberEntity for this actor and calendar
    const membership = await CalendarMemberEntity.findOne({
      where: {
        calendar_id: calendarId,
        user_actor_id: userActor.id,
      },
    });

    const authorized = membership !== null;

    // Cache the result
    this.authorizationCache.set(cacheKey, {
      authorized,
      expiresAt: now + this.CACHE_TTL,
    });

    return authorized;
  }

  /**
   * Invalidates the authorization cache for a specific calendar and actor.
   * This should be called when membership changes.
   *
   * @param calendarId - The calendar ID
   * @param actorUri - The Person actor URI
   */
  invalidateAuthorizationCache(calendarId: string, actorUri: string): void {
    const cacheKey = `${calendarId}:${actorUri}`;
    this.authorizationCache.delete(cacheKey);
  }

  /**
   * Invalidates all authorization cache entries for a specific calendar.
   * This should be called when calendar membership changes significantly.
   *
   * @param calendarId - The calendar ID
   */
  invalidateCalendarAuthorizationCache(calendarId: string): void {
    for (const key of this.authorizationCache.keys()) {
      if (key.startsWith(`${calendarId}:`)) {
        this.authorizationCache.delete(key);
      }
    }
  }

  /**
   * Clears all expired entries from the authorization cache.
   * This can be called periodically to prevent unbounded cache growth.
   */
  clearExpiredAuthorizationCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.authorizationCache.entries()) {
      if (entry.expiresAt <= now) {
        this.authorizationCache.delete(key);
      }
    }
  }

  /**
   * Clears the entire authorization cache.
   * Useful for testing or when a full cache reset is needed.
   */
  clearAuthorizationCache(): void {
    this.authorizationCache.clear();
  }

  /**
   * Get authorization cache statistics for monitoring.
   * @returns Object with cache size, max size, and utilization percentage
   */
  getAuthorizationCacheStats(): { size: number; maxSize: number; utilization: number } {
    return this.authorizationCache.getStats();
  }

  /**
   * Determines if an event originated from the local server.
   * Local events have a non-null calendar_id, while remote events have null.
   *
   * @param {CalendarEvent} event - The event to check
   * @returns {boolean} True if the event is local, false otherwise
   */
  isLocalEvent(event: CalendarEvent): boolean {
    return event.isLocal();
  }

  /**
   * Processes an Update activity by updating the local copy of a remote event.
   * Handles both:
   * - Update from calendar actors (federated event sharing)
   * - Update from Person actors (remote editors updating events)
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {UpdateActivity} message - The Update activity message
   * @returns {Promise<CalendarEvent | null>}
   */
  async processUpdateEvent(calendar: Calendar, message: UpdateActivity): Promise<CalendarEvent | null> {
    if (!message.object || !message.object.id) {
      console.warn(`[INBOX] Update activity missing object or object.id`);
      logActivityRejection({
        rejection_type: 'invalid_object',
        activity_type: 'Update',
        actor_uri: message.actor,
        actor_domain: this.extractDomain(message.actor),
        calendar_id: calendar.id,
        calendar_url_name: calendar.urlName,
        reason: 'Update activity missing object or object.id',
      });
      return null;
    }

    const apObjectId = message.object.id;
    const actorUri = message.actor;

    // Look up the local event by its AP ID
    let apObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    let existingEvent: CalendarEvent | null = null;

    if (apObject) {
      existingEvent = await this.calendarInterface.getEventById(apObject.event_id);
    }

    // For Person actor updates, also try looking up by local event ID
    // (the object.id path may contain the local event ID instead of the original AP ID)
    if (!existingEvent && message.object.eventParams?.id) {
      const localEventId = message.object.eventParams.id;
      existingEvent = await this.calendarInterface.getEventById(localEventId);

      // If found, also try to find the corresponding AP object
      if (existingEvent && !apObject) {
        apObject = await EventObjectEntity.findOne({
          where: { event_id: localEventId },
        });
      }
    }

    if (!existingEvent) {
      // Event not found - can't update
      console.warn(`[INBOX] Update activity for unknown event: ${apObjectId}`);
      return null;
    }

    // Check if this is from a Person actor (remote editor) vs a calendar actor
    const isPersonActor = await this.isPersonActorUri(actorUri);

    if (isPersonActor) {
      // Verify the Person is an authorized editor of this calendar
      const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);

      if (!isAuthorizedEditor) {
        console.warn(`[INBOX] Person actor ${actorUri} is not authorized to update events on calendar ${calendar.urlName}`);
        logActivityRejection({
          rejection_type: 'unauthorized_editor',
          activity_type: 'Update',
          actor_uri: actorUri,
          actor_domain: this.extractDomain(actorUri),
          calendar_id: calendar.id,
          calendar_url_name: calendar.urlName,
          reason: `Person actor is not an authorized editor of calendar ${calendar.urlName}`,
        });
        throw new Error('Actor is not an authorized editor of this calendar');
      }

      console.log(`[INBOX] Processing Update from authorized remote editor: ${actorUri}`);
    }
    else {
      // Traditional calendar-to-calendar federation
      if (this.isLocalEvent(existingEvent)) {
        // Can't update local events via federation from calendar actors
        return null;
      }

      const ok = await this.actorOwnsObject(message);
      if (!ok) {
        logActivityRejection({
          rejection_type: 'ownership_verification_failed',
          activity_type: 'Update',
          actor_uri: actorUri,
          actor_domain: this.extractDomain(actorUri),
          calendar_id: calendar.id,
          calendar_url_name: calendar.urlName,
          reason: `Actor ownership verification failed for event ${apObjectId}`,
        });
        return null;
      }
    }

    // Create event params with local UUID for database
    const eventParams = {
      ...message.object,
      id: apObject.event_id,
      event_source_url: apObjectId,
    };

    // For Person actor updates, use the full event params from the object
    if (isPersonActor && message.object.eventParams) {
      Object.assign(eventParams, message.object.eventParams);
      eventParams.id = apObject.event_id;
    }

    const updatedEvent = await this.calendarInterface.updateRemoteEvent(calendar, eventParams);

    console.log(`[INBOX] Updated event ${apObject.event_id} from ${isPersonActor ? 'Person' : 'Calendar'} actor ${actorUri}`);

    return updatedEvent;
  }

  /**
   * Processes a Delete activity by deleting the local copy of an event.
   * Handles both:
   * - Delete from calendar actors (federated event sharing)
   * - Delete from Person actors (remote editors deleting events)
   *
   * @param {Calendar} calendar - The calendar context for the event
   * @param {DeleteActivity} message - The Delete activity message
   * @returns {Promise<void>}
   */
  async processDeleteEvent(calendar: Calendar, message: DeleteActivity) {
    if (!message.object || !message.object.id) {
      console.warn(`[INBOX] Delete activity missing object or object.id`);
      logActivityRejection({
        rejection_type: 'invalid_object',
        activity_type: 'Delete',
        actor_uri: message.actor,
        actor_domain: this.extractDomain(message.actor),
        calendar_id: calendar.id,
        calendar_url_name: calendar.urlName,
        reason: 'Delete activity missing object or object.id',
      });
      return;
    }

    const apObjectId = message.object.id;
    const actorUri = message.actor;

    // Look up the local event by its AP ID
    let apObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    let existingEvent: CalendarEvent | null = null;
    let eventIdToDelete: string | null = null;

    if (apObject) {
      existingEvent = await this.calendarInterface.getEventById(apObject.event_id);
      eventIdToDelete = apObject.event_id;
    }

    // For Person actor deletes, also try looking up by local event ID
    // (the object.id path may contain the local event ID instead of the original AP ID)
    if (!existingEvent && message.object.eventId) {
      const localEventId = message.object.eventId;
      existingEvent = await this.calendarInterface.getEventById(localEventId);
      eventIdToDelete = localEventId;

      // If found, also try to find the corresponding AP object
      if (existingEvent && !apObject) {
        apObject = await EventObjectEntity.findOne({
          where: { event_id: localEventId },
        });
      }
    }

    if (!existingEvent || !eventIdToDelete) {
      // Event not found - nothing to delete
      console.warn(`[INBOX] Delete activity for unknown event: ${apObjectId}`);
      return;
    }

    // Check if this is from a Person actor (remote editor) vs a calendar actor
    const isPersonActor = await this.isPersonActorUri(actorUri);

    if (isPersonActor) {
      // Verify the Person is an authorized editor of this calendar
      const isAuthorizedEditor = await this.isAuthorizedRemoteEditor(calendar.id, actorUri);

      if (!isAuthorizedEditor) {
        console.warn(`[INBOX] Person actor ${actorUri} is not authorized to delete events on calendar ${calendar.urlName}`);
        logActivityRejection({
          rejection_type: 'unauthorized_editor',
          activity_type: 'Delete',
          actor_uri: actorUri,
          actor_domain: this.extractDomain(actorUri),
          calendar_id: calendar.id,
          calendar_url_name: calendar.urlName,
          reason: `Person actor is not an authorized editor of calendar ${calendar.urlName}`,
        });
        throw new Error('Actor is not an authorized editor of this calendar');
      }

      console.log(`[INBOX] Processing Delete from authorized remote editor: ${actorUri}`);
    }
    else {
      // Traditional calendar-to-calendar federation
      if (this.isLocalEvent(existingEvent)) {
        // Can't delete local events via federation from calendar actors
        return;
      }

      const ok = await this.actorOwnsObject(message);
      if (!ok) {
        logActivityRejection({
          rejection_type: 'ownership_verification_failed',
          activity_type: 'Delete',
          actor_uri: actorUri,
          actor_domain: this.extractDomain(actorUri),
          calendar_id: calendar.id,
          calendar_url_name: calendar.urlName,
          reason: `Actor ownership verification failed for event ${apObjectId}`,
        });
        return;
      }
    }

    await this.calendarInterface.deleteRemoteEvent(eventIdToDelete);

    // Also delete the EventObjectEntity record if it exists
    if (apObject) {
      await apObject.destroy();
    }

    console.log(`[INBOX] Deleted event ${eventIdToDelete} from ${isPersonActor ? 'Person' : 'Calendar'} actor ${actorUri}`);
  }

  /**
   * Processes a Follow activity by creating a new follower relationship
   * and queuing an Accept activity for asynchronous delivery.
   *
   * @param {Calendar} calendar - The calendar being followed
   * @param {FollowActivity} message - The Follow activity message
   * @returns {Promise<void>}
   */
  async processFollowAccount(calendar: Calendar, message: FollowActivity) {
    console.log(`[INBOX] Processing Follow activity from ${message.actor} for calendar ${calendar.urlName}`);

    // Get or create CalendarActorEntity for the follower
    const remoteCalendar = await this.remoteCalendarService.findOrCreateByActorUri(message.actor);

    let existingFollow = await FollowerCalendarEntity.findOne({
      where: {
        calendar_actor_id: remoteCalendar.id,
        calendar_id: calendar.id,
      },
    });

    if (!existingFollow) {
      console.log(`[INBOX] Creating new follower relationship for ${message.actor}`);

      // Create the follower relationship
      await FollowerCalendarEntity.create({
        id: uuidv4(),
        calendar_actor_id: remoteCalendar.id,
        calendar_id: calendar.id,
      });

      console.log(`[INBOX] Follower relationship created successfully`);

      // Queue Accept activity for asynchronous delivery
      const actorUrl = ActivityPubActor.actorUrl(calendar);
      const acceptActivity = new AcceptActivity(actorUrl, message);

      console.log(`[INBOX] Queueing Accept activity to ${message.actor}`);

      await addToOutbox(this.eventBus, calendar, acceptActivity);

      console.log(`[INBOX] Accept activity queued for delivery`);
    }
    else {
      console.log(`[INBOX] Follow relationship already exists for ${message.actor}, skipping`);
    }
  }
  /**
   * Processes an Accept activity received in response to a Follow or Flag request.
   * For Follow: Confirms the follow relationship on the initiating side.
   * For Flag: Updates the forward_status to 'acknowledged' on the forwarded report.
   *
   * @param {Calendar} calendar - The calendar that initiated the Follow/Flag
   * @param {AcceptActivity} message - The Accept activity message
   * @returns {Promise<void>}
   */
  async processAcceptActivity(calendar: Calendar, message: AcceptActivity) {
    console.log(`[INBOX] Processing Accept activity from ${message.actor} for calendar ${calendar.urlName}`);

    // The Accept activity's object should be the original activity (Follow or Flag)
    const acceptedObject = message.object;

    if (!acceptedObject) {
      console.warn(`[INBOX] Accept activity missing object`);
      return;
    }

    // Check if this is an Accept for a Flag activity
    if (typeof acceptedObject === 'object' && acceptedObject.type === 'Flag') {
      console.log(`[INBOX] Accept confirms Flag activity`);

      // Extract Flag ID from the accepted object
      const flagId = acceptedObject.id || (typeof acceptedObject === 'object' ? acceptedObject.id : null);

      if (!flagId) {
        console.warn(`[INBOX] Accept for Flag missing Flag ID`);
        return;
      }

      // Find the report by forwarded_report_id
      const report = await ReportEntity.findOne({
        where: { forwarded_report_id: flagId },
      });

      if (!report) {
        console.warn(`[INBOX] No report found for Flag ID: ${flagId}, Accept may be for unknown Flag`);
        return;
      }

      // Update forward_status to 'acknowledged'
      await report.update({ forward_status: 'acknowledged' });
      console.log(`[INBOX] Updated report ${report.id} forward_status to 'acknowledged'`);

      return;
    }

    // Verify this Accept corresponds to a Follow we sent
    if (typeof acceptedObject === 'object' && acceptedObject.type === 'Follow') {
      const followActivity = acceptedObject as FollowActivity;

      console.log(`[INBOX] Accept confirms Follow of ${followActivity.object}`);

      // Find the CalendarActorEntity for the remote calendar we're following
      const remoteActorUrl = followActivity.object as string;
      const remoteCalendar = await this.remoteCalendarService.getByActorUri(remoteActorUrl);

      if (!remoteCalendar) {
        console.warn(`[INBOX] No CalendarActorEntity found for ${remoteActorUrl}, Accept may be for unknown follow`);
        return;
      }

      // Find the corresponding FollowingCalendarEntity record
      const followingRecord = await FollowingCalendarEntity.findOne({
        where: {
          calendar_actor_id: remoteCalendar.id,
          calendar_id: calendar.id,
        },
      });

      if (followingRecord) {
        // The follow relationship is now confirmed
        // In the future, we could add a "confirmed" status field
        // For now, the existence of the record means it's active
        console.log(`[INBOX] Follow relationship confirmed for calendar ${calendar.id} following ${followActivity.object}`);
      }
      else {
        console.warn(`[INBOX] No FollowingCalendarEntity found for ${followActivity.object}, Accept may be for unknown follow`);
      }
    }
    else {
      console.warn(`[INBOX] Accept activity does not contain valid Follow or Flag object`);
    }
  }

  /**
   * Processes an Unfollow action (via Undo) by removing a follower relationship.
   *
   * @param {Calendar} calendar - The calendar being unfollowed
   * @param {any} message - The message containing the unfollow information
   * @returns {Promise<void>}
   */
  // TODO: proper message type
  async processUnfollowAccount(calendar: Calendar, message: any) {
    // Extract the actor from the original Follow activity message
    if (!message || (!message.message && !message.actor)) {
      console.warn(`[INBOX] Unfollow message missing required actor information`);
      return;
    }

    const actor = (typeof message.message === 'object' && message.message?.actor)
      ? message.message.actor
      : message.actor;

    if (!actor) {
      console.warn(`[INBOX] Unfollow message actor is null or undefined`);
      return;
    }

    // Find the CalendarActorEntity for this actor
    const remoteCalendar = await this.remoteCalendarService.getByActorUri(actor);
    if (!remoteCalendar) {
      console.warn(`[INBOX] No CalendarActorEntity found for ${actor}, cannot unfollow`);
      return;
    }

    await FollowerCalendarEntity.destroy({
      where: {
        calendar_actor_id: remoteCalendar.id,
        calendar_id: calendar.id,
      },
    });
  }

  /**
   * Processes an Announce (Share) activity for an event.
   *
   * @param {Calendar} calendar - The calendar context for the share
   * @param {AnnounceActivity} message - The Announce activity message
   * @returns {Promise<void>}
   */
  async processShareEvent(calendar: Calendar, message: AnnounceActivity) {
    // Extract event URL from the object (either a string URL or an object with id)
    if (!message.object) {
      console.warn(`[INBOX] Announce activity missing object`);
      return;
    }

    const apObjectId = typeof message.object === 'string'
      ? message.object
      : (message.object as any)?.id;

    if (!apObjectId) {
      console.warn(`[INBOX] Announce activity object missing id`);
      return;
    }

    // Check if we already have this AP object
    let apObject = await EventObjectEntity.findOne({
      where: { ap_id: apObjectId },
    });

    // If event doesn't exist locally, fetch and store it
    if (!apObject) {
      try {
        // Fetch the event object from the remote server
        const response = await axios.get(apObjectId, {
          timeout: 10000,
          headers: {
            'Accept': 'application/activity+json, application/ld+json',
          },
        });

        if (response && response.data) {
          // Generate a new UUID for the local event record
          const localEventId = uuidv4();

          // Determine the attributed_to from the fetched object or the announcer
          const attributedTo = response.data.attributedTo || message.actor;

          // Store the event locally with null calendar_id (remote event)
          const eventParams = {
            ...response.data,
            id: localEventId,
            event_source_url: apObjectId,
          };

          await this.calendarInterface.addRemoteEvent(calendar, eventParams);

          // Create EventObjectEntity to track the AP identity
          apObject = await EventObjectEntity.create({
            event_id: localEventId,
            ap_id: apObjectId,
            attributed_to: attributedTo,
          });
        }
      }
      catch (error: any) {
        logError(error, `[INBOX] Failed to fetch or store remote event ${apObjectId}`);
        return;
      }
    }

    // Track the Announce activity - use CalendarActorEntity reference
    const sharerRemoteCalendar = await this.remoteCalendarService.findOrCreateByActorUri(message.actor);

    const existingShare = await EventActivityEntity.findOne({
      where: {
        event_id: apObjectId,
        calendar_actor_id: sharerRemoteCalendar.id,
        type: 'share',
      },
    });

    if (!existingShare) {
      await EventActivityEntity.create({
        event_id: apObjectId,
        calendar_actor_id: sharerRemoteCalendar.id,
        type: 'share',
      });
    }

    // Check for auto-repost
    // Determine if this is an original (announcer is author) or a repost (announcer is sharing)
    const isOriginal = apObject?.attributed_to === message.actor;
    await this.checkAndPerformAutoRepost(calendar, message.actor, apObjectId, isOriginal);
  }

  /**
   * Processes an Unshare action (via Undo) for an event.
   *
   * @param {Calendar} calendar - The calendar context for the unshare
   * @param {any} message - The message containing the unshare information
   * @returns {Promise<void>}
   */
  // TODO: proper message type
  async processUnshareEvent(calendar: Calendar, message: any) {
    // Extract event ID from the object (either a string URL or an object with id)
    if (!message || !message.object) {
      console.warn(`[INBOX] Unshare message missing object`);
      return;
    }

    const eventId = typeof message.object === 'string'
      ? message.object
      : message.object?.id;

    if (!eventId) {
      console.warn(`[INBOX] Unshare message object missing id`);
      return;
    }

    // Extract the actor from the original Announce activity message
    if (!message.message && !message.actor) {
      console.warn(`[INBOX] Unshare message missing actor information`);
      return;
    }

    const actor = (typeof message.message === 'object' && message.message?.actor)
      ? message.message.actor
      : message.actor;

    if (!actor) {
      console.warn(`[INBOX] Unshare message actor is null or undefined`);
      return;
    }

    // Find the CalendarActorEntity for this actor
    const remoteCalendar = await this.remoteCalendarService.getByActorUri(actor);
    if (!remoteCalendar) {
      console.warn(`[INBOX] No CalendarActorEntity found for ${actor}, cannot unshare`);
      return;
    }

    let existingShare = await EventActivityEntity.findOne({
      where: {
        event_id: eventId,
        calendar_actor_id: remoteCalendar.id,
        type: 'share',
      },
    });
    if ( existingShare ) {
      await existingShare.destroy();
      // IF it's a event local to this server, send to all followers and sharers
    };
  }
}

export default ProcessInboxService;
