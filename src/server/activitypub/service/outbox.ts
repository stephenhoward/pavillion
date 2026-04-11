import { DateTime } from "luxon";
import { EventEmitter } from "events";
import axios from "axios";
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

import { Calendar } from "@/common/model/calendar";
import { ActivityPubOutboxMessageEntity, EventActivityEntity, FollowerCalendarEntity, FollowingCalendarEntity } from "@/server/activitypub/entity/activitypub";
import { CalendarActorEntity } from "@/server/activitypub/entity/calendar_actor";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AcceptActivity from "@/server/activitypub/model/action/accept";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import CreateActivity from "@/server/activitypub/model/action/create";
import UndoActivity from "@/server/activitypub/model/action/undo";
import FlagActivity from "@/server/activitypub/model/action/flag";
import { ActivityPubActivity, ActivityPubObject } from "@/server/activitypub/model/base";
import CalendarInterface from "@/server/calendar/interface";
import CalendarActorService from "@/server/activitypub/service/calendar_actor";
import ProcessInboxService from "@/server/activitypub/service/inbox";
import { FEDERATION_HTTP_TIMEOUT_MS } from "@/server/common/constants";
import { validateUrlNotPrivate } from "@/server/common/helper/ip-validation";

/**
 * Service responsible for processing and distributing outgoing ActivityPub messages.
 * Handles delivery of various activity types to followers and other recipients.
 */
class ProcessOutboxService {
  calendarService: CalendarInterface;
  calendarActorService: CalendarActorService;
  private inboxService: ProcessInboxService | null;

  /**
   * @param eventBus - Shared event bus
   * @param inboxService - Required in production (wired by ActivityPubInterface).
   *   Optional only to preserve backward compatibility with existing test
   *   fixtures that construct ProcessOutboxService(eventBus). When null,
   *   local recipients fall back to HTTP delivery — pre-Phase-3 behavior,
   *   a test-only degradation.
   */
  constructor(eventBus: EventEmitter, inboxService?: ProcessInboxService) {
    this.calendarService = new CalendarInterface(eventBus);
    this.calendarActorService = new CalendarActorService(this.calendarService);
    this.inboxService = inboxService ?? null;
    if (!this.inboxService) {
      logger.warn('[OUTBOX] constructed without ProcessInboxService — local recipients will degrade to HTTP delivery (test-only path)');
    }
  }

  /**
   * Processes all unprocessed outbox messages in batches.
   *
   * @returns {Promise<void>}
   */
  async processOutboxMessages() {

    let messages: ActivityPubOutboxMessageEntity[] = [];

    do {
      messages = await ActivityPubOutboxMessageEntity.findAll({
        where: { processedAt: null },
        order: [ ['messageTime', 'ASC'] ],
        limit: 1000,
      });

      for( const message of messages ) {
        await this.processOutboxMessage(message);
      }
    } while( messages.length > 0 );
  }

  /**
   * Processes a single outbox message, determining its type and sending it to appropriate recipients.
   *
   * @param {ActivityPubOutboxMessageEntity} message - The outbox message to process
   * @returns {Promise<void>}
   * @throws {Error} If no calendar is found for the message
   */
  async processOutboxMessage(message: ActivityPubOutboxMessageEntity) {
    let calendar = await this.calendarService.getCalendar(message.calendar_id);

    if ( ! calendar ) {
      throw new Error("No calendar found for message");
    }

    let activity = null;
    let recipients: string[] = [];

    logger.info({ activityType: message.type, calendarUrlName: calendar.urlName }, 'Processing outbox activity');

    switch( message.type ) {
      case 'Create':
        activity = CreateActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Create activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Update':
        activity = UpdateActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Update activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Delete':
        activity = DeleteActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Delete activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Follow':
        activity = FollowActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Follow activity');
        }
        // For Follow activities, send to the calendar being followed (the object)
        if (typeof activity.object === 'string') {
          recipients = [activity.object];
        }
        break;
      case 'Accept':
        activity = AcceptActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Accept activity');
        }
        // For Accept activities, send to the actor of the original Follow
        if (activity.object && typeof activity.object === 'object' && activity.object.actor) {
          recipients = [activity.object.actor];
        }
        break;
      case 'Announce':
        activity = AnnounceActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Announce activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Undo':
        activity = UndoActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Undo activity');
        }
        // Check if the activity has explicit recipients in the 'to' field
        if (activity.to && activity.to.length > 0) {
          recipients = activity.to;
          logger.info({ recipients }, 'Using explicit recipients from to field for Undo activity');
        }
        else {
          recipients = await this.getRecipients(calendar, activity.object);
        }
        break;
      case 'Flag':
        activity = FlagActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Flag activity');
        }
        // For Flag activities, use explicit 'to' field if present
        if (activity.to && activity.to.length > 0) {
          recipients = activity.to;
          logger.info({ recipients }, 'Using explicit recipients from to field for Flag activity');
        }
        break;
    }

    if ( activity ) {
      logger.info({ recipientCount: recipients.length, activityType: message.type }, 'Found recipients for activity');

      let deliveryErrors: string[] = [];

      for (const recipient of recipients) {
        // Decide whether this recipient can be served in-process (local) or
        // must be HTTP-delivered (remote). Only Announce activities are eligible
        // for in-process dispatch; Create/Update/Delete fall through to HTTP
        // regardless of actor type, pending pv-fs02 (HTTP signatures) and a
        // decision about whether to extend local dispatch to all activity types.
        const canDispatchLocally = this.inboxService !== null && message.type === 'Announce';
        const localCalendar = canDispatchLocally
          ? await this.calendarActorService.getLocalCalendarByActorUri(recipient)
          : null;

        if (localCalendar) {
          // Local in-process path: skip HTTP entirely.
          try {
            await this.inboxService!.handleLocalAnnounceDispatch(localCalendar, activity as AnnounceActivity);
            logger.info({ recipient }, '[OUTBOX-LOCAL] Dispatched in-process');
          }
          catch (error: any) {
            const errorMsg = `Failed local dispatch to ${recipient}: ${error.message}`;
            logError(error, `[ActivityPub] Failed local dispatch to ${recipient}`);
            deliveryErrors.push(errorMsg);
          }
          continue;
        }

        // Defensive null-local-calendar guard: when in-process dispatch is
        // available and the recipient URL shares a hostname with this
        // outbox message's origin actor (i.e., the recipient looks like it
        // belongs to a local calendar on this instance), a null result from
        // getLocalCalendarByActorUri means the CalendarActorEntity row is
        // missing or stale. HTTP-delivering to such a URL would loop back
        // to ourselves and almost certainly fail with 404, so skip it.
        //
        // Remote recipients (different hostname) and WebFinger handles
        // continue through deliverViaHttp unchanged.
        if (canDispatchLocally && this.isSameHostAsActor(recipient, activity.actor)) {
          logger.warn(
            { recipient, actor: activity.actor },
            '[OUTBOX-LOCAL] Skip: recipient looks local but has no CalendarActorEntity row',
          );
          continue;
        }

        // Remote HTTP path (covers: remote actors on other hosts, WebFinger
        // handles, local non-Announce activities, and the test-only
        // null-inboxService fallback).
        await this.deliverViaHttp(recipient, message, activity, deliveryErrors);
      }

      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: deliveryErrors.length > 0
          ? `partial: ${deliveryErrors.join('; ')}`
          : 'ok',
      });
    }
    else {
      logger.error({ activityType: message.type }, 'Bad message type');
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'bad message type',
      });
    }
  }

  /**
   * Delivers an activity to a recipient via HTTP POST to their inbox.
   * Resolves the recipient's inbox URL, validates it against SSRF protection,
   * and posts the activity payload. Errors are accumulated into the supplied
   * deliveryErrors array rather than thrown, preserving the per-recipient
   * partial-failure semantics of the parent loop.
   *
   * SECURITY: validateUrlNotPrivate is called before every HTTP POST to
   * block delivery to private/internal IPs that a malicious actor profile
   * could advertise via its inbox field.
   *
   * @param recipient - The recipient identifier (actor URI or handle)
   * @param message - The outbox message entity being processed
   * @param activity - The parsed activity to deliver
   * @param deliveryErrors - Accumulator for per-recipient delivery errors
   * @private
   */
  private async deliverViaHttp(
    recipient: string,
    message: ActivityPubOutboxMessageEntity,
    activity: ActivityPubActivity,
    deliveryErrors: string[],
  ): Promise<void> {
    const inboxUrl = await this.resolveInboxUrl(recipient);
    if (!inboxUrl) {
      logger.info({ recipient }, 'Skipping message because no inbox found');
      return;
    }
    try {
      await validateUrlNotPrivate(inboxUrl);
    }
    catch (error) {
      const errorMsg = `Security: Blocked delivery to private inbox URL for ${recipient}: ${error instanceof Error ? error.message : String(error)}`;
      logError(error, `[SECURITY] Blocked delivery to private inbox URL for ${recipient}`);
      deliveryErrors.push(errorMsg);
      return;
    }
    try {
      logger.info({ activityType: message.type, inboxUrl }, 'Delivering activity');
      const activityData = activity.toObject();
      await axios.post(inboxUrl, activityData, {
        timeout: FEDERATION_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/activity+json',
        },
      });
      logger.info({ activityType: message.type, recipient }, 'Successfully delivered activity');
    }
    catch (error: any) {
      const errorMsg = `Failed to deliver to ${recipient}: ${error.message}`;
      logError(error, `[ActivityPub] Failed to deliver to ${recipient}`);
      deliveryErrors.push(errorMsg);
    }
  }

  /**
   * Returns true when `recipient` is an HTTP(S) URL and its hostname matches
   * the hostname of `actorUrl`. Used by the null-local-calendar defensive
   * guard to detect recipients that look like they belong to this instance
   * but have no CalendarActorEntity row. WebFinger handles (user@domain) and
   * malformed URIs return false.
   *
   * @private
   */
  private isSameHostAsActor(recipient: string, actorUrl: string): boolean {
    if (!recipient.startsWith('http://') && !recipient.startsWith('https://')) {
      return false;
    }
    try {
      const recipientHost = new URL(recipient).hostname;
      const actorHost = new URL(actorUrl).hostname;
      return recipientHost === actorHost;
    }
    catch {
      return false;
    }
  }

  /**
   * Gets a list of recipient actor URIs for a given calendar and object.
   * Includes followers of the calendar and calendars that have shared the specific object.
   *
   * @param {Calendar} calendar - The source calendar
   * @param {ActivityPubObject|string} object - The ActivityPub object or its ID
   * @returns {Promise<string[]>} List of recipient actor URIs
   */
  async getRecipients(calendar: Calendar, object: ActivityPubObject|string): Promise<string[]> {
    let recipients: string[] = [];

    // Get followers with their CalendarActorEntity to get the actor_uri
    const followers = await FollowerCalendarEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });
    for (const follower of followers) {
      if (follower.calendarActor?.actor_uri) {
        recipients.push(follower.calendarActor.actor_uri);
      }
    }

    const object_id = typeof object === 'string' ? object : object.id;

    // Check if the object is a Follow ID (for Undo(Follow) activities)
    // Follow IDs have the format: https://domain/calendars/calendar/follows/uuid
    if (object_id.includes('/follows/')) {
      logger.info({ object_id }, 'Detected Follow ID in object, looking up follow relationship');
      const followEntity = await FollowingCalendarEntity.findOne({
        where: { id: object_id },
        include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
      });
      if (followEntity?.calendarActor?.actor_uri) {
        logger.info({ actorUri: followEntity.calendarActor.actor_uri }, 'Found follow relationship, adding recipient');
        recipients.push(followEntity.calendarActor.actor_uri);
      }
      else {
        logger.info({ object_id }, 'No follow relationship found for ID');
      }
    }

    // Get event activity observers with their CalendarActorEntity to get the actor_uri
    const observers = await EventActivityEntity.findAll({
      where: { event_id: object_id },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });
    for (const observer of observers) {
      if (observer.calendarActor?.actor_uri) {
        recipients.push(observer.calendarActor.actor_uri);
      }
    }

    return recipients;
  }

  /**
   * Resolves the inbox URL for a remote user by fetching their profile.
   *
   * SECURITY: Validates that the actor profile URL does not point to a private
   * IP address to prevent SSRF attacks via DNS rebinding or direct private IP hostnames.
   *
   * @param {string} remote_user - The remote user identifier (username@domain or full actor URL)
   * @returns {Promise<string|null>} The inbox URL if found, otherwise null
   */
  async resolveInboxUrl(remote_user: string): Promise<string|null> {
    let profileUrl: string | null = null;

    logger.info({ remote_user }, 'Resolving inbox for recipient');

    // Check if remote_user is a full URL (starts with http:// or https://)
    if (remote_user.startsWith('http://') || remote_user.startsWith('https://')) {
      // It's a full actor URL, use it directly as the profile URL
      profileUrl = remote_user;
      logger.info({ profileUrl }, 'Using full URL as profile URL');
    }
    else {
      // It's a username@domain format, resolve via WebFinger
      profileUrl = await this.fetchProfileUrl(remote_user);
      logger.info({ profileUrl }, 'Resolved WebFinger profile URL');
    }

    if ( profileUrl ) {
      // SECURITY: Validate that the actor profile URL does not point to a private IP address
      // to prevent SSRF attacks where a malicious actor advertises an internal network address.
      try {
        await validateUrlNotPrivate(profileUrl);
      }
      catch (error) {
        if (error instanceof Error) {
          logError(error, `[SECURITY] Blocked fetch of actor profile for ${remote_user}: private IP`);
        }
        return null;
      }

      logger.info({ profileUrl }, 'Fetching actor document');
      let response = await axios.get(profileUrl, {
        timeout: FEDERATION_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
      });

      if ( response && response.data ) {
        logger.info({ inboxUrl: response.data.inbox }, 'Resolved inbox URL');
        return response.data.inbox;
      }
    }

    logger.info({ remote_user }, 'Failed to resolve inbox');
    return null;
  }

  /**
   * Fetches the profile URL for a remote user using WebFinger protocol.
   *
   * SECURITY: Validates that the constructed WebFinger URL does not point to a private
   * IP address to prevent SSRF attacks via DNS rebinding or direct private IP hostnames.
   *
   * @param {string} remote_user - The remote user identifier (username@domain)
   * @returns {Promise<string|null>} The profile URL if found, otherwise null
   */
  async fetchProfileUrl(remote_user: string): Promise<string|null> {
    const [username, domain] = remote_user.split('@');
    logger.info({ remote_user, username, domain }, 'WebFinger lookup');

    if ( username && domain ) {
      const webfingerUrl = 'https://' + domain + '/.well-known/webfinger?resource=acct:' + username + '@' + domain;
      logger.info({ webfingerUrl }, 'Fetching WebFinger');

      // SECURITY: Validate that the WebFinger URL does not point to a private IP address
      // to prevent SSRF attacks where a remote actor uses a domain that resolves to an
      // internal network address (DNS rebinding or direct private IP).
      try {
        await validateUrlNotPrivate(webfingerUrl);
      }
      catch (error) {
        if (error instanceof Error) {
          logError(error, `[ActivityPub] Failed to fetch WebFinger for ${remote_user}: private IP blocked`);
        }
        return null;
      }

      try {
        let response = await axios.get(webfingerUrl, {
          timeout: FEDERATION_HTTP_TIMEOUT_MS,
          maxRedirects: 0,
        });

        if ( response && response.data && response.data.links ) {
          const profileLink = (await response).data.links.filter((link: any) => link.rel === 'self');
          if ( profileLink.length > 0 ) {
            logger.info({ profileUrl: profileLink[0].href }, 'WebFinger resolved');
            return profileLink[0].href;
          }
        }
      }
      catch (error: any) {
        logError(error, `[ActivityPub] WebFinger lookup failed for ${remote_user}`);
      }
    }
    return null;
  }
}

export default ProcessOutboxService;
