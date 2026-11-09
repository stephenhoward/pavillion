import { createHash } from "crypto";
import { DateTime } from "luxon";
import { EventEmitter } from "events";
import axios from "axios";
import { Op } from "sequelize";
import config from "config";
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

/** Hostname of a URL for log output, or null when the URL cannot be parsed. */
function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  }
  catch {
    return null;
  }
}

import { Calendar } from "@/common/model/calendar";
import { ActivityPubOutboxMessageEntity, EventActivityEntity, FollowerCalendarEntity, FollowingCalendarEntity } from "@/server/activitypub/entity/activitypub";
import { CalendarActorEntity } from "@/server/activitypub/entity/calendar_actor";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import AddActivity from "@/server/activitypub/model/action/add";
import RemoveActivity from "@/server/activitypub/model/action/remove";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AcceptActivity from "@/server/activitypub/model/action/accept";
import IgnoreActivity from "@/server/activitypub/model/action/ignore";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import CreateActivity from "@/server/activitypub/model/action/create";
import UndoActivity from "@/server/activitypub/model/action/undo";
import FlagActivity from "@/server/activitypub/model/action/flag";
import { ActivityPubActivity, ActivityPubObject, AS_PUBLIC } from "@/server/activitypub/model/base";
import CalendarInterface from "@/server/calendar/interface";
import CalendarActorService from "@/server/activitypub/service/calendar_actor";
import UserActorService from "@/server/activitypub/service/user_actor";
import ProcessInboxService from "@/server/activitypub/service/inbox";
import { FEDERATION_HTTP_TIMEOUT_MS } from "@/server/common/constants";
import { validateUrlNotPrivate } from "@/server/common/helper/ip-validation";
import { buildSignedHeaders } from "@/server/activitypub/service/http-signing";
import { sanitizePeerInboxUrl } from "@/server/activitypub/helper/url-sanitizer";
import { boundProcessedStatus } from "@/server/activitypub/helper/outbox";
import { FederationDeliveryError } from "@/common/exceptions/activitypub";
import { ActivityIdOriginMismatchError, isActivityIdOnOrigin } from "@/server/activitypub/helper/activity-id-origin";

/** Options for {@link ProcessOutboxService.processOutboxMessages}. */
export interface ProcessOutboxMessagesOptions {
  /** Leave rows whose `message_time` is less than this many ms ago. */
  skipNewerThanMs?: number;
}

/**
 * The id of an activity's `object`, which is either a bare IRI or an object
 * carrying `id`; null for anything else. (`extractObjectId` in the backfill
 * service does the same, but importing it here would close an import cycle
 * through `ActivityPubInterface`.)
 */
function objectIdOf(object: unknown): string | null {
  if (typeof object === 'string') {
    return object;
  }
  if (object && typeof object === 'object') {
    const id = (object as Record<string, unknown>).id;
    if (typeof id === 'string') {
      return id;
    }
  }
  return null;
}

/**
 * Service responsible for processing and distributing outgoing ActivityPub messages.
 * Handles delivery of various activity types to followers and other recipients.
 */
class ProcessOutboxService {
  calendarService: CalendarInterface;
  calendarActorService: CalendarActorService;
  private userActorService: UserActorService;
  private inboxService: ProcessInboxService;

  /**
   * @param eventBus - Shared event bus
   * @param inboxService - In-process inbox service used for local in-process
   *   dispatch of all activity types (Create, Update, Delete, Follow, Accept,
   *   Flag, Announce, Undo) when the recipient resolves to a local calendar.
   */
  constructor(eventBus: EventEmitter, inboxService: ProcessInboxService) {
    this.calendarService = new CalendarInterface(eventBus);
    this.calendarActorService = new CalendarActorService(this.calendarService);
    this.userActorService = new UserActorService(this.calendarService);
    this.inboxService = inboxService;
  }

  /**
   * Synchronously signs and delivers a single ActivityPub activity to a single
   * remote inbox, returning the parsed HTTP response. This is the "escape hatch"
   * counterpart to addToOutbox: callers use it only when they MUST read the
   * remote response body (currently only events.ts:createRemoteEventViaActivityPub,
   * which needs the created event document echoed back from the remote calendar).
   *
   * Behavior contract:
   *   - JSON.stringify the activity ONCE; the same string is used for digest
   *     computation and for the axios request body. This guarantees the
   *     receiver computes the same SHA-256 we signed.
   *   - Generates a fresh Date header and signature on each call (no stale-
   *     header retry).
   *   - validateUrlNotPrivate(inboxUrl) is called immediately before
   *     axios.post with no async work in between. The signing actor URI MUST
   *     match the activity's `actor` field for the keyId to be valid at the
   *     receiver.
   *
   * SECURITY (residual TOCTOU SSRF):
   *   Inbox URLs are pre-vetted at follow time (resolveInboxUrl runs
   *   validateUrlNotPrivate against the actor profile URL during follow), so
   *   the inbox values reaching this helper are not raw user input. The
   *   validateUrlNotPrivate call here is defense-in-depth: it re-checks the
   *   URL right before the POST so a DNS rebind between follow time and
   *   delivery time still fails closed.
   *
   * Error contract:
   *   - Network / TLS / timeout / signing failure  -> throws FederationDeliveryError
   *   - SSRF block (private IP rejected)            -> throws FederationDeliveryError
   *   - Non-2xx HTTP response                       -> resolves with { status, data: null }
   *   - 202 Accepted with empty body                -> resolves with { status: 202, data: null }
   *   - 2xx with JSON body                          -> resolves with { status, data: <parsed JSON> }
   *
   * Callers MUST guard `data?.id` (or whatever response field they consume)
   * because data is null on every non-success branch.
   *
   * @param signingActorUri - The actor URI used to sign the request. Must equal activity.actor.
   * @param activity - The ActivityPub activity object to deliver.
   * @param inboxUrl - The remote inbox URL to POST to (pre-vetted at follow time).
   * @returns Object with the HTTP status and the parsed JSON body (or null).
   * @throws FederationDeliveryError on signing/network/SSRF failure.
   */
  async deliverActivitySigned(
    signingActorUri: string,
    activity: Record<string, any>,
    inboxUrl: string,
  ): Promise<{ status: number; data: any }> {
    // JSON.stringify the activity ONCE so the digest header and the HTTP body
    // are guaranteed to be byte-identical. Re-stringifying could produce a
    // different key order and break signature verification at the receiver.
    const bodyString = JSON.stringify(activity);
    const digest = 'SHA-256=' + createHash('sha256').update(bodyString).digest('base64');

    let signedHeaders;
    try {
      signedHeaders = await buildSignedHeaders(
        signingActorUri,
        bodyString,
        inboxUrl,
        digest,
        this.calendarActorService,
        this.userActorService,
      );
    }
    catch (error: any) {
      throw new FederationDeliveryError(
        `Signing failed for actor ${signingActorUri}: ${error?.message ?? String(error)}`,
      );
    }
    if (!signedHeaders) {
      throw new FederationDeliveryError(
        `Signing failed for actor ${signingActorUri}: no matching key found`,
      );
    }

    // SECURITY: re-validate the inbox URL immediately before POST. No async
    // work between this check and axios.post — anything in the gap would
    // re-open the TOCTOU window we are trying to close.
    try {
      await validateUrlNotPrivate(inboxUrl);
    }
    catch (error: any) {
      throw new FederationDeliveryError(
        `Blocked delivery to private inbox URL: ${error?.message ?? String(error)}`,
      );
    }

    let response;
    try {
      response = await axios.post(inboxUrl, bodyString, {
        timeout: FEDERATION_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        // Treat any HTTP status code (including non-2xx) as a resolved
        // response so the caller can read `status` and decide. Network/TLS/
        // timeout errors still reject and become FederationDeliveryError below.
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/activity+json',
          ...signedHeaders,
        },
      });
    }
    catch (error: any) {
      throw new FederationDeliveryError(
        `Network failure delivering to ${inboxUrl}: ${error?.message ?? String(error)}`,
      );
    }

    const status = response.status;

    // Non-2xx: surface status to caller, but no body.
    if (status < 200 || status >= 300) {
      return { status, data: null };
    }

    // 2xx with empty/no body (typical for 202 Accepted).
    if (response.data === undefined || response.data === null || response.data === '') {
      return { status, data: null };
    }

    return { status, data: response.data };
  }

  /**
   * The outbox drain: delivers unprocessed rows oldest first, skipping
   * superseded ones and marking a row that throws `error:` (DEC-024 rules 9
   * and 10). Web process only, because delivery runs local dispatch.
   *
   * @param options.skipNewerThanMs - Leave rows whose `message_time` is later
   *   than this many ms before the call; the cutoff is fixed once per call
   * @returns {Promise<void>}
   */
  async processOutboxMessages(options: ProcessOutboxMessagesOptions = {}): Promise<void> {

    const where: Record<string, unknown> = { processed_time: null };
    if ( options.skipNewerThanMs !== undefined ) {
      // Fixed once, so rows written while this drain runs are never taken;
      // `lte` keeps a row written in the same millisecond as the call.
      where.message_time = { [Op.lte]: new Date(Date.now() - options.skipNewerThanMs) };
    }

    let delivered = 0;
    let failed = 0;
    let skipped = 0;
    let messages: ActivityPubOutboxMessageEntity[] = [];

    do {
      messages = await ActivityPubOutboxMessageEntity.findAll({
        where,
        order: [ ['message_time', 'ASC'] ],
        limit: 1000,
      });

      for( const message of messages ) {
        try {
          if ( await this.isSupersededOutboxMessage(message) ) {
            await message.update({
              processed_time: DateTime.now().toJSDate(),
              processed_status: 'skipped: superseded',
            });
            skipped++;
            continue;
          }
          await this.processOutboxMessage(message);
          delivered++;
        }
        catch (error) {
          failed++;
          await this.markOutboxMessageFailed(message, error);
        }
      }
    } while( messages.length > 0 );

    if ( delivered + failed + skipped > 0 ) {
      logger.info({ delivered, failed, skipped }, 'Outbox drain finished');
    }
  }

  /**
   * Whether a later row in the same outbox already retracts this one: for any
   * row, an Undo with id `{rowId}/undo` (an Undo(Follow) retracts a Follow);
   * for a Create, Update or Announce, also a Delete with id `{objectId}/delete`
   * (DEC-024 rule 10). The type is matched as well as the id, as
   * `readOutbox`'s Undo probe does.
   *
   * @param message - An unprocessed outbox row
   * @returns True when the row should be skipped rather than delivered
   */
  private async isSupersededOutboxMessage(message: ActivityPubOutboxMessageEntity): Promise<boolean> {
    const retractions: Record<string, string>[] = [{ id: `${message.id}/undo`, type: 'Undo' }];
    if ( ['Create', 'Update', 'Announce'].includes(message.type) ) {
      const objectId = objectIdOf((message.message as Record<string, unknown> | null)?.object);
      if ( objectId ) {
        retractions.push({ id: `${objectId}/delete`, type: 'Delete' });
      }
    }
    const found = await ActivityPubOutboxMessageEntity.count({ where: { [Op.or]: retractions } });
    return found > 0;
  }

  /**
   * Records that processing an outbox row threw: `processed_time` is set and
   * `processed_status` becomes `error: <message>`, bounded and stripped of
   * control characters by {@link boundProcessedStatus}. Used by the drain and
   * the live `outboxMessageAdded` handler, so both write the same status.
   *
   * If that write throws (a status the database still refuses), it is retried
   * once with the constant `error: processing failed`. If the retry throws
   * too, the database is failing and the error propagates.
   *
   * Logs the row's activity id and calendar id, never its message body.
   *
   * @param message - The outbox row whose processing threw
   * @param error - What it threw
   */
  async markOutboxMessageFailed(message: ActivityPubOutboxMessageEntity, error: unknown): Promise<void> {
    logError(error, `[ActivityPub] Outbox message ${message.id} (calendar ${message.calendar_id}) marked error`);
    try {
      // Inside the try: a thrown value String() cannot convert (a null-
      // prototype object, say) falls through to the fallback status.
      const detail = error instanceof Error ? error.message : String(error);
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: boundProcessedStatus(`error: ${detail}`),
      });
    }
    catch (writeError) {
      logError(writeError, `[ActivityPub] Could not record the error on outbox message ${message.id}; writing the fallback status`);
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'error: processing failed',
      });
    }
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
        // Honor explicit `to` for targeted single-recipient delivery (e.g.,
        // notifying the remote calendar that owns an event). The as:Public
        // IRI is an addressing marker, not a delivery target, so filter it
        // out before deciding. Fall back to follower fan-out for the
        // public-broadcast case.
        {
          const explicitTo = (activity.to ?? []).filter(uri => uri !== AS_PUBLIC);
          if (explicitTo.length > 0) {
            recipients = explicitTo;
            logger.info({ recipientCount: recipients.length }, 'Using explicit recipients from to field for Update activity');
          }
          else {
            recipients = await this.getRecipients(calendar, activity.object);
          }
        }
        break;
      case 'Delete':
        activity = DeleteActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Delete activity');
        }
        // Honor explicit `to` for targeted single-recipient delivery. The
        // as:Public IRI is an addressing marker, not a delivery target, so
        // filter it out before deciding. Fall back to follower fan-out for
        // the public-broadcast case.
        {
          const explicitTo = (activity.to ?? []).filter(uri => uri !== AS_PUBLIC);
          if (explicitTo.length > 0) {
            recipients = explicitTo;
            logger.info({ recipientCount: recipients.length }, 'Using explicit recipients from to field for Delete activity');
          }
          else {
            recipients = await this.getRecipients(calendar, activity.object);
          }
        }
        break;
      case 'Add':
        activity = AddActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Add activity');
        }
        // Add activities are inherently single-recipient (e.g. editor invite
        // to a remote actor). Honor explicit `to`. If `to` is absent, do NOT
        // fall back to follower fan-out — that would broadcast an editor
        // invite to every follower, which is never the intent. Log and skip.
        if (activity.to && activity.to.length > 0) {
          recipients = activity.to;
          logger.info({ recipientCount: recipients.length }, 'Using explicit recipients from to field for Add activity');
        }
        else {
          logger.warn({ activityId: activity.id }, 'Add activity has no explicit to field; skipping delivery (no follower fan-out for Add)');
        }
        break;
      case 'Remove':
        activity = RemoveActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Remove activity');
        }
        // Remove activities are inherently single-recipient (editor-revoke
        // to a remote actor) — mirror Add. No follower fan-out fallback:
        // broadcasting an editor-revoke is never the intent.
        if (activity.to && activity.to.length > 0) {
          recipients = activity.to;
          logger.info({ recipientCount: recipients.length }, 'Using explicit recipients from to field for Remove activity');
        }
        else {
          logger.warn({ activityId: activity.id }, 'Remove activity has no explicit to field; skipping delivery (no follower fan-out for Remove)');
        }
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
      case 'Ignore':
        activity = IgnoreActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Ignore activity');
        }
        // FEP-8a8e Join reply: deliver only to the actor of the embedded Join
        // (the sender). Mirrors Accept — a direct, single-recipient reply that
        // is never fanned out to followers or the public timeline.
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
          logger.info({ recipientCount: recipients.length }, 'Using explicit recipients from to field for Undo activity');
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
          logger.info({ recipientCount: recipients.length }, 'Using explicit recipients from to field for Flag activity');
        }
        break;
    }

    if ( activity ) {
      logger.info({ recipientCount: recipients.length, activityType: message.type }, 'Found recipients for activity');

      let deliveryErrors: string[] = [];

      // In-process dispatch covers all currently-handled activity types
      // (Create, Update, Delete, Follow, Accept, Flag, Announce, Undo) —
      // the trust contract is rooted at the outbox row itself, not at the
      // activity type. See ProcessInboxService.handleLocalActivityDispatch
      // for the full trust-contract documentation. `this.inboxService` is
      // non-nullable and always assigned in the constructor, so local
      // dispatch is available unconditionally for any recipient whose
      // actor URI resolves to a local calendar via
      // getLocalCalendarByActorUri.

      const resolved: { recipient: string; localCalendar: Calendar | null }[] = [];
      for (const recipient of recipients) {
        resolved.push({ recipient, localCalendar: await this.calendarActorService.getLocalCalendarByActorUri(recipient) });
      }

      // Local dispatch accepts only activity ids on our own origin. Checked
      // once, before anyone receives anything, so a broken own-origin
      // invariant ends the row `error:` (unpublished) whatever the recipient
      // order. Remote-only delivery of an off-origin id stays valid.
      if ( activity.id && resolved.some(entry => entry.localCalendar)
        && !isActivityIdOnOrigin(activity.id, `https://${config.get<string>('domain')}`) ) {
        throw new ActivityIdOriginMismatchError('Local dispatch refused: activity id is not on this instance\'s domain');
      }

      for (const { recipient, localCalendar } of resolved) {
        if (localCalendar) {
          // Local in-process path: skip HTTP entirely.
          try {
            await this.inboxService.handleLocalActivityDispatch(localCalendar, activity);
            logger.info({ recipient }, '[OUTBOX-LOCAL] Dispatched in-process');
          }
          catch (error: any) {
            // Defence in depth behind the check above: never a `partial:`.
            if (error instanceof ActivityIdOriginMismatchError) {
              throw error;
            }
            const errorMsg = `Failed local dispatch to ${recipient}: ${error.message}`;
            logError(error, `[ActivityPub] Failed local dispatch to ${recipient}`);
            deliveryErrors.push(errorMsg);
          }
          continue;
        }

        // Defensive null-local-calendar guard: when the recipient URL shares
        // a hostname with this outbox message's origin actor (i.e., the
        // recipient looks like it belongs to a local calendar on this
        // instance), a null result from getLocalCalendarByActorUri means the
        // CalendarActorEntity row is missing or stale. HTTP-delivering to
        // such a URL would loop back to ourselves and almost certainly fail
        // with 404, so skip it.
        //
        // Remote recipients (different hostname) and WebFinger handles
        // continue through deliverViaHttp unchanged.
        if (this.isSameHostAsActor(recipient, activity.actor)) {
          logger.warn(
            { recipient, actor: activity.actor },
            '[OUTBOX-LOCAL] Skip: recipient looks local but has no CalendarActorEntity row',
          );
          continue;
        }

        // Remote HTTP path (covers: remote actors on other hosts and
        // WebFinger handles). All activity types are eligible for local
        // in-process dispatch above; anything reaching this branch has a
        // recipient that did not resolve to a local CalendarActor.
        await this.deliverViaHttp(recipient, message, activity, deliveryErrors);
      }

      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: deliveryErrors.length > 0
          ? boundProcessedStatus(`partial: ${deliveryErrors.join('; ')}`)
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
   * signs the request with HTTP Signatures, and posts the activity payload.
   * Errors are accumulated into the supplied deliveryErrors array rather than
   * thrown, preserving the per-recipient partial-failure semantics of the
   * parent loop.
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
    // A peer that is gone (410), down or slow rejects here. That is this
    // recipient's failure, never the loop's: record it and let the caller
    // move on to the next recipient.
    let inboxUrl: string | null;
    try {
      inboxUrl = await this.resolveInboxUrl(recipient);
    }
    catch (error) {
      const errorMsg = `Failed to resolve inbox for ${recipient}: ${error instanceof Error ? error.message : String(error)}`;
      logError(error, `[ActivityPub] Failed to resolve inbox for ${recipient}`);
      deliveryErrors.push(errorMsg);
      return;
    }
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
      const bodyString = JSON.stringify(activityData);
      const digest = 'SHA-256=' + createHash('sha256').update(bodyString).digest('base64');

      const signedHeaders = await buildSignedHeaders(
        activity.actor,
        bodyString,
        inboxUrl,
        digest,
        this.calendarActorService,
        this.userActorService,
      );
      if (!signedHeaders) {
        const errorMsg = `Signing failed for actor ${activity.actor} delivering to ${recipient}`;
        logger.error({ actorUri: activity.actor, recipient }, 'Failed to sign outbound delivery');
        deliveryErrors.push(errorMsg);
        return;
      }

      await axios.post(inboxUrl, bodyString, {
        timeout: FEDERATION_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/activity+json',
          ...signedHeaders,
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
   * Invariant this guard defends: recipients are sourced from
   * FollowerCalendarEntity rows joined against CalendarActorEntity, so a
   * local-looking recipient with no CalendarActorEntity row is FK-impossible
   * under normal DB state. The guard exists only to fail safe against a
   * missing/stale row (e.g. mid-migration or manual DB surgery) rather than
   * HTTP-looping a delivery back to this instance.
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
        // SECURITY: the actor host was verified above, but the URL we POST to
        // is the `inbox` of a document the peer controls — bind it to the
        // actor host so a hostile document cannot redirect signed deliveries.
        const inboxUrl = sanitizePeerInboxUrl(response.data.inbox, profileUrl);
        if ( inboxUrl ) {
          logger.info({ inboxUrl }, 'Resolved inbox URL');
          return inboxUrl;
        }
        logger.warn({ actorHost: safeHostname(profileUrl) }, '[SECURITY] Rejected actor document inbox not bound to actor host');
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
