import { EventEmitter } from 'events';
import config from 'config';

import { DomainEventHandlers } from '@/server/common/types/domain';
import {
  ActivityPubEventCreatedPayload,
  ActivityPubEventUpdatedPayload,
  ActivityPubEventDeletedPayload,
  AccountCreatedPayload,
  CalendarCreatedPayload,
  RemoteEditorRevokedPayload,
  ActivityPubFollowAcceptedPayload,
} from './types';
import ActivityPubInterface from '../interface';
import CreateActivity from '../model/action/create';
import UpdateActivity from '../model/action/update';
import DeleteActivity from '../model/action/delete';
import AnnounceActivity from '../model/action/announce';
import { EventObject } from '../model/object/event';
import { NoteObject } from '../model/object/note';
import { ActivityPubOutboxMessageEntity, ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import UserActorService from '../service/user_actor';
import CalendarActorService from '../service/calendar_actor';
import CalendarInterface from '@/server/calendar/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import {
  BACKFILL_RETRY_LIMIT,
  BACKFILL_RETRY_DELAY_SECONDS,
  BACKFILL_RETRY_BACKOFF,
  BACKFILL_EXPIRE_SECONDS,
} from '@/server/activitypub/service/backfill';
import { Account } from '@/common/model/account';
import { logError } from '@/server/common/helper/error-logger';
import { Calendar } from '@/common/model/calendar';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

export default class ActivityPubEventHandlers implements DomainEventHandlers {
  private service: ActivityPubInterface;
  private userActorService: UserActorService;
  private calendarActorService: CalendarActorService;
  private housekeepingInterface: HousekeepingInterface;

  /**
   * @param housekeepingInterface Cross-domain handle used to publish
   *   background jobs (e.g. `activitypub:follow:backfill`) through the
   *   housekeeping-owned pg-boss queue.
   */
  constructor(
    service: ActivityPubInterface,
    calendarInterface: CalendarInterface,
    housekeepingInterface: HousekeepingInterface,
  ) {
    this.service = service;
    this.userActorService = new UserActorService(calendarInterface);
    this.calendarActorService = new CalendarActorService(calendarInterface);
    this.housekeepingInterface = housekeepingInterface;
  }

  /**
   * Whether to run domain-event handlers strictly one at a time.
   *
   * Every handler installed below opens its own DB transaction. On SQLite
   * (dev/test) the process holds a single shared connection that cannot BEGIN
   * a second transaction while one is open — "cannot start a transaction
   * within a transaction". A batch operation that emits many events in one
   * tick (e.g. a multi-VEVENT ICS file import, whose per-event `eventCreated`
   * emits all fire from one `afterCommit`) fans out to concurrent handlers
   * whose transactions overlap and take the process down with an unhandled
   * rejection. Serializing dispatch removes the overlap and matches DEC-013's
   * single chronological pipeline. PostgreSQL (production) draws a separate
   * pooled connection per transaction, so its handlers are safe to run
   * concurrently and we keep them concurrent to preserve throughput.
   */
  private readonly serializeDispatch: boolean =
    config.get<string>('database.dialect') === 'sqlite';

  /** Tail of the serialized-dispatch chain; only advanced when {@link serializeDispatch}. */
  private dispatchQueue: Promise<void> = Promise.resolve();

  /**
   * Adapt a domain-event handler for installation on the (never-awaited) bus.
   *
   * On every dialect the wrapper catches handler errors so a failed background
   * dispatch is logged rather than surfacing as a process-killing unhandled
   * rejection. On SQLite it additionally chains each invocation onto
   * {@link dispatchQueue} so no two handler transactions overlap; on
   * PostgreSQL invocations run concurrently as before.
   */
  private serialize<T>(handler: (payload: T) => Promise<void>): (payload: T) => void {
    const run = (payload: T): Promise<void> =>
      Promise.resolve()
        .then(() => handler(payload))
        .catch((error) => logError(error, '[ActivityPub] Domain-event handler failed'));

    if (!this.serializeDispatch) {
      return (payload: T): void => { void run(payload); };
    }
    return (payload: T): void => {
      this.dispatchQueue = this.dispatchQueue.then(() => run(payload));
    };
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('eventCreated', this.serialize(this.handleEventCreated.bind(this)));
    eventBus.on('eventUpdated', this.serialize(this.handleEventUpdated.bind(this)));
    eventBus.on('eventDeleted', this.serialize(this.handleEventDeleted.bind(this)));
    eventBus.on('outboxMessageAdded', this.serialize(this.processOutboxMessage.bind(this)));
    eventBus.on('inboxMessageAdded', this.serialize(this.processInboxMessage.bind(this)));
    eventBus.on('account.created', this.serialize(this.handleAccountCreated.bind(this)));
    eventBus.on('calendar.created', this.serialize(this.handleCalendarCreated.bind(this)));
    eventBus.on('remoteEditorRevoked', this.serialize(this.handleRemoteEditorRevoked.bind(this)));
    eventBus.on('activitypub:follow:accepted', this.serialize(this.handleFollowAccepted.bind(this)));
  }

  /**
   * Dispatch an outbound Announce for a locally-created event.
   * Returns early when payload.calendar is null/undefined, which indicates
   * the event originated from a remote instance (incoming AP Create routed
   * via EventService.addRemoteEvent). Without this guard, processing a
   * remote create would trigger an outbound Announce back to federation,
   * creating a loop. Mirrors the handleEventUpdated guard.
   */
  private async handleEventCreated(payload: ActivityPubEventCreatedPayload): Promise<void> {
    if (!payload.calendar) {
      return;
    }

    const actorUrl = await this.service.actorUrl(payload.calendar);
    const eventUrl = EventObject.eventUrl(payload.calendar, payload.event);

    // Ensure the AP identity for this event exists before dispatching.
    // checkAndPerformAutoRepost() in the inbox pipeline relies on
    // EventObjectEntity.attributed_to for attribution and loop-guard checks.
    const [eventObject, created] = await EventObjectEntity.findOrCreate({
      where: { event_id: payload.event.id },
      defaults: {
        event_id: payload.event.id,
        ap_id: eventUrl,
        attributed_to: actorUrl,
      },
    });

    // SECURITY: If a row already existed (e.g., a remote Announce arrived
    // for this event ID before its local creation), verify the attribution
    // matches this calendar's actor URL. A mismatch is an integrity signal
    // that must not be silently accepted.
    if (!created && eventObject.attributed_to !== actorUrl) {
      logger.warn(
        {
          eventId: payload.event.id,
          expected: actorUrl,
          found: eventObject.attributed_to,
        },
        '[EVENT-CREATED] Pre-existing EventObjectEntity has unexpected attributed_to — not updating',
      );
    }

    // The outbox dispatcher fans out to both local and remote followers.
    // Local followers are routed in-process via ProcessInboxService.
    await this.service.addToOutbox(
      payload.calendar,
      new AnnounceActivity(actorUrl, eventUrl).addressPublic(`${actorUrl}/followers`),
    );

    // Paired Create(Note) emission for Mastodon-class peers that ignore
    // Event-typed activities on profile timelines. The Note wraps the same
    // canonical event so the activity renders in Mastodon profile feeds.
    await this.service.addToOutbox(
      payload.calendar,
      new CreateActivity(
        actorUrl,
        new NoteObject(payload.calendar, payload.event),
      ).addressPublic(`${actorUrl}/followers`),
    );
  }

  /**
   * Re-broadcast a local event update to federation followers.
   * Returns early when payload.calendar is null/undefined, which indicates
   * the event update originated from a remote instance (incoming AP Update).
   * Without this guard, processing a remote update would trigger an outbound
   * Update back to federation, creating an infinite loop.
   */
  private async handleEventUpdated(payload: ActivityPubEventUpdatedPayload): Promise<void> {
    if (!payload.calendar) {
      return;
    }

    const actorUrl = await this.service.actorUrl(payload.calendar);
    await this.service.addToOutbox(
      payload.calendar,
      new UpdateActivity(
        actorUrl,
        new EventObject(payload.calendar, payload.event),
      ).addressPublic(`${actorUrl}/followers`),
    );

    // Paired Update(Note) emission so Mastodon-class peers see edits reflected
    // in profile timelines alongside the Pavillion-native Update(Event).
    await this.service.addToOutbox(
      payload.calendar,
      new UpdateActivity(
        actorUrl,
        new NoteObject(payload.calendar, payload.event),
      ).addressPublic(`${actorUrl}/followers`),
    );
  }

  private async handleEventDeleted(payload: ActivityPubEventDeletedPayload): Promise<void> {
    const actorUrl = await this.service.actorUrl(payload.calendar);
    await this.service.addToOutbox(
      payload.calendar,
      new DeleteActivity(
        actorUrl,
        EventObject.eventUrl(payload.calendar, payload.event),
      ).addressPublic(`${actorUrl}/followers`),
    );

    // Paired Delete(Note) emission. Uses the Note IRI string form because
    // DeleteActivity takes the object URL directly, mirroring the Event
    // Delete shape.
    await this.service.addToOutbox(
      payload.calendar,
      new DeleteActivity(
        actorUrl,
        NoteObject.noteUrl(payload.calendar, payload.event),
      ).addressPublic(`${actorUrl}/followers`),
    );
  }

  private async processOutboxMessage(e) {
    let message = await ActivityPubOutboxMessageEntity.findByPk(e.id);
    if ( message ) {
      try {
        await this.service.processOutboxMessage(message);
      }
      catch (error) {
        logError(error, `[ActivityPub] Error processing outbox message ${message.id}`);
        // Mark message as processed with error status to prevent retry loop
        await message.update({
          processed_time: new Date(),
          processed_status: `error: ${error.message}`,
        });
      }
    }
    else {
      logger.error('Outbox message not found for processing');
    }
  }

  private async processInboxMessage(e) {
    let message = await ActivityPubInboxMessageEntity.findByPk(e.id);

    if ( ! message ) {
      logger.error('Inbox message not found for processing');
      return;
    }
    if ( ! message.processed_time ) {
      await this.service.processInboxMessage(message);
    }
  }

  private async handleAccountCreated(payload: AccountCreatedPayload): Promise<void> {
    try {
      // Only create UserActor if username is set
      if (!payload.username) {
        logger.info({ accountId: payload.accountId }, 'Skipping UserActor creation: no username set');
        return;
      }

      const domain = payload.domain || config.get<string>('domain');
      if (!domain) {
        logger.error({ accountId: payload.accountId }, 'Cannot create UserActor: domain not configured');
        return;
      }

      // Create a minimal Account object for the service
      const account = new Account(payload.accountId, payload.username, '');

      await this.userActorService.createActor(account, domain);
      logger.info({ username: payload.username, accountId: payload.accountId }, 'Created UserActor for account');
    }
    catch (error) {
      // Log error but don't throw - UserActor creation failure should not break account creation
      logError(error, `[ActivityPub] Failed to create UserActor for account ${payload.accountId}`);
    }
  }

  private handleRemoteEditorRevoked(payload: RemoteEditorRevokedPayload): void {
    this.service.invalidateAuthorizationCache(payload.calendarId, payload.actorUri);
    logger.info({ actorUri: payload.actorUri, calendarId: payload.calendarId }, 'Invalidated authorization cache for actor');
  }

  /**
   * Publish a follow-backfill job in response to a remote Accept(Follow) that
   * confirmed a follow we initiated. The actual outbox pull is performed by
   * the worker (pv-wy2u.2.4); this handler only enqueues the job and returns
   * synchronously — no HTTP work happens on this code path.
   *
   * The retry policy is set here at publish time: a backfill that pauses on an
   * exhausted per-host rate budget throws `BackfillRateLimitError`, and the
   * BACKFILL_RETRY_DELAY_SECONDS delay (≥ the rate window) lets pg-boss re-run
   * the job once the sliding window has reset so the remaining outbox pages get
   * walked. The re-walk is idempotent via findOrCreate.
   *
   * Errors from the publish call are logged but not re-thrown. EventEmitter
   * surfaces unhandled async errors as `error` events with no listeners,
   * which terminates the Node process; swallowing here keeps a transient
   * pg-boss outage from crashing the server, at the cost of a missed
   * backfill that the next Accept (or manual trigger) will re-enqueue.
   */
  private async handleFollowAccepted(payload: ActivityPubFollowAcceptedPayload): Promise<void> {
    try {
      await this.housekeepingInterface.publishJob('activitypub:follow:backfill', payload, {
        retryLimit: BACKFILL_RETRY_LIMIT,
        retryDelaySeconds: BACKFILL_RETRY_DELAY_SECONDS,
        retryBackoff: BACKFILL_RETRY_BACKOFF,
        expireInSeconds: BACKFILL_EXPIRE_SECONDS,
      });
    }
    catch (error) {
      logError(error, '[ActivityPub] Failed to publish activitypub:follow:backfill job');
    }
  }

  private async handleCalendarCreated(payload: CalendarCreatedPayload): Promise<void> {
    try {
      // Only create CalendarActor if urlName is set
      if (!payload.urlName) {
        logger.info({ calendarId: payload.calendarId }, 'Skipping CalendarActor creation: no urlName set');
        return;
      }

      const domain = payload.domain || config.get<string>('domain');
      if (!domain) {
        logger.error({ calendarId: payload.calendarId }, 'Cannot create CalendarActor: domain not configured');
        return;
      }

      // Create a minimal Calendar object for the service
      const calendar = new Calendar(payload.calendarId, payload.urlName);

      await this.calendarActorService.createActor(calendar, domain);
      logger.info({ urlName: payload.urlName, calendarId: payload.calendarId }, 'Created CalendarActor for calendar');
    }
    catch (error) {
      // Log error but don't throw - CalendarActor creation failure should not break calendar creation
      logError(error, `[ActivityPub] Failed to create CalendarActor for calendar ${payload.calendarId}`);
    }
  }

}
